// HWPX inline picture/note/table shapes follow kordoc's MIT generators; see vendor/kordoc/LICENSE.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';
import { BLANK_HWPX_BASE64 } from './BlankHwpx';
import { documentText, elementDocumentStyle, validateStyle } from './DocumentModel';
import type { EncodeOptions, TextRun, TransferDocument } from './DocumentModel';
import { NS, parseXml, serializeXml, xmlElements, xmlFirst } from './HwpxTemplate';

export function escapeXml(value: string): string {
	for (const char of value) {
		const code = char.codePointAt(0)!;
		if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) throw new Error('원고에 한글 문서에 저장할 수 없는 제어 문자가 있습니다.');
	}
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const hu = (pt: number): number => Math.round(pt * 100);
const mm = (value: number): number => Math.round(value * 7200 / 25.4);
const textXml = (text: string): string => `<hp:t>${escapeXml(text).replace(/\t/g, '<hp:tab width="0" leader="0" type="1"/>').replace(/\n/g, '<hp:lineBreak/>')}</hp:t>`;
const subList = (body: string): string => `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${body}</hp:subList>`;

export function createStyledHwpx(document: TransferDocument, options: EncodeOptions): Uint8Array {
	const { template } = options, style = elementDocumentStyle(options);
	validateStyle(style);
	const files = unzipSync(Uint8Array.from(atob(BLANK_HWPX_BASE64), char => char.charCodeAt(0)));
	const header = parseXml(strFromU8(files['Contents/header.xml'])), section = parseXml(strFromU8(files['Contents/section0.xml']));
	const head = header.documentElement!, sec = section.documentElement!, secPr = xmlFirst(section, 'secPr')!;
	const chosen = template?.styles.find(item => item.id === (options.templateStyleId ?? template.defaultStyleId));
	if (template && !chosen) throw new Error('템플릿에서 사용할 기준 서식을 선택해 주세요.');
	if (template) {
		const refs = xmlFirst(parseXml(template.headerXml), 'refList');
		if (!refs) throw new Error('템플릿에 필요한 서식 정의가 없습니다.');
		const old = xmlFirst(header, 'refList')!;
		old.parentNode!.replaceChild(header.importNode(refs, true), old);
	}
	head.setAttribute('secCnt', '1');
	const element = (doc: XmlDocument, namespace: string, name: string, attrs: Record<string, string | number> = {}): XmlElement => {
		const node = doc.createElementNS(namespace, name);
		for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
		return node;
	};
	const ensure = (parent: XmlElement, name: string, namespace = NS.head): XmlElement => {
		let child = xmlFirst(parent, name);
		if (!child) { child = element(header, namespace, `${namespace === NS.core ? 'hc' : 'hh'}:${name}`); parent.appendChild(child); }
		return child;
	};
	const refs = xmlFirst(header, 'refList')!;
	const chars = ensure(refs, 'charProperties'), paras = ensure(refs, 'paraProperties'), borders = ensure(refs, 'borderFills'), fonts = ensure(refs, 'fontfaces');
	const nextId = (name: string): number => Math.max(-1, ...xmlElements(header, name).map(node => Number(node.getAttribute('id')) || 0)) + 1;
	let charId = nextId('charPr'), paraId = nextId('paraPr'), borderId = nextId('borderFill'), objectId = 1_600_000_000, paragraphId = 1;
	const baseChar = chosen ? parseXml(chosen.charXml).documentElement! : xmlFirst(header, 'charPr')!;
	const basePara = chosen ? parseXml(chosen.paraXml).documentElement! : xmlFirst(header, 'paraPr')!;
	const fontCache = new Map<string, Record<string, number>>();
	const fontIds = (family: string): Record<string, number> => {
		const cached = fontCache.get(family); if (cached) return cached;
		const ids: Record<string, number> = {};
		for (const language of ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']) {
			let group = xmlElements(fonts, 'fontface').find(item => item.getAttribute('lang') === language);
			if (!group) { group = element(header, NS.head, 'hh:fontface', { lang: language }); fonts.appendChild(group); }
			const matching = xmlElements(group, 'font').find(item => item.getAttribute('face') === family);
			const id = matching ? Number(matching.getAttribute('id')) : Math.max(-1, ...xmlElements(group, 'font').map(item => Number(item.getAttribute('id')))) + 1;
			if (!matching) group.appendChild(element(header, NS.head, 'hh:font', { id, face: family, type: 'TTF', isEmbedded: '0' }));
			group.setAttribute('fontCnt', String(xmlElements(group, 'font').length)); ids[language.toLowerCase()] = id;
		}
		fontCache.set(family, ids); return ids;
	};
	const charCache = new Map<string, number>(), paraCache = new Map<string, number>();
	const makeChar = (run: TextRun = { text: '' }, level = 0): number => {
		const textStyle = elementDocumentStyle(options, level);
		const key = JSON.stringify([run.bold, run.italic, run.underline, run.strike, run.color, run.background, level]);
		if (charCache.has(key)) return charCache.get(key)!;
		const id = charId++, node = header.importNode<XmlElement>(baseChar, true);
		node.setAttribute('id', String(id)); node.setAttribute('height', String(hu(textStyle.fontSize)));
		node.setAttribute('textColor', /^#[0-9a-f]{6}$/i.test(run.color ?? '') ? run.color! : textStyle.color);
		if (level !== 0 || !chosen || textStyle.fontFamily !== chosen.style.fontFamily) {
			const ref = ensure(node, 'fontRef'); for (const [language, font] of Object.entries(fontIds(textStyle.fontFamily))) ref.setAttribute(language, String(font));
		}
		const bold = textStyle.fontWeight >= 600 || run.bold;
		for (const old of xmlElements(node, 'bold')) old.parentNode!.removeChild(old);
		node.removeAttribute('bold'); if (bold) node.appendChild(element(header, NS.head, 'hh:bold'));
		if (run.italic && !xmlFirst(node, 'italic')) node.appendChild(element(header, NS.head, 'hh:italic'));
		if (run.underline) { const underline = ensure(node, 'underline'); underline.setAttribute('type', 'BOTTOM'); underline.setAttribute('shape', 'SOLID'); underline.setAttribute('color', textStyle.color); }
		if (run.strike) { const strike = ensure(node, 'strikeout'); strike.setAttribute('shape', 'SOLID'); strike.setAttribute('color', textStyle.color); }
		if (/^#[0-9a-f]{6}$/i.test(run.background ?? '')) node.setAttribute('shadeColor', run.background!);
		chars.appendChild(node); charCache.set(key, id); return id;
	};
	const makePara = (level = 0): number => {
		const textStyle = elementDocumentStyle(options, level);
		const key = String(level); if (paraCache.has(key)) return paraCache.get(key)!;
		const id = paraId++, node = header.importNode<XmlElement>(basePara, true);
		node.setAttribute('id', String(id)); ensure(node, 'align').setAttribute('horizontal', style.align.toUpperCase());
		const margins = xmlElements(node, 'margin');
		for (const margin of margins.length ? margins : [ensure(node, 'margin')]) {
			for (const [keyName, value] of Object.entries({ intent: style.firstLineIndent, left: style.paragraphLeft, right: style.paragraphRight, prev: style.spaceBefore, next: style.spaceAfter })) {
				const child = xmlFirst(margin, keyName) ?? element(header, NS.core, `hc:${keyName}`);
				child.setAttribute('value', String(hu(value))); child.setAttribute('unit', 'HWPUNIT'); if (!child.parentNode) margin.appendChild(child);
			}
		}
		const spacings = xmlElements(node, 'lineSpacing');
		for (const spacing of spacings.length ? spacings : [ensure(node, 'lineSpacing')]) {
			spacing.setAttribute('type', { percent: 'PERCENT', fixed: 'FIXED', atLeast: 'AT_LEAST', between: 'BETWEEN_LINES' }[textStyle.lineSpacingType]);
			spacing.setAttribute('value', String(textStyle.lineSpacingType === 'percent' ? textStyle.lineSpacing : hu(textStyle.lineSpacing))); spacing.setAttribute('unit', 'HWPUNIT');
		}
		if (level > 0) { const heading = ensure(node, 'heading'); heading.setAttribute('type', 'OUTLINE'); heading.setAttribute('level', String(level - 1)); }
		paras.appendChild(node); paraCache.set(key, id); return id;
	};
	const fillId = borderId++;
	const pageFill = element(header, NS.head, 'hh:borderFill', { id: fillId, threeD: 0, shadow: 0, centerLine: 'NONE', breakCellSeparateLine: 0 });
	for (const edge of ['left', 'right', 'top', 'bottom']) pageFill.appendChild(element(header, NS.head, `hh:${edge}Border`, { type: 'NONE', width: '0.1 mm', color: '#000000' }));
	const fillBrush = element(header, NS.core, 'hc:fillBrush'); fillBrush.appendChild(element(header, NS.core, 'hc:winBrush', { faceColor: style.background, hatchColor: '#000000', alpha: 0 })); pageFill.appendChild(fillBrush); borders.appendChild(pageFill);
	const tableBorderId = borderId++;
	const tableFill = pageFill.cloneNode(true) as XmlElement; tableFill.setAttribute('id', String(tableBorderId));
	for (const edge of ['left', 'right', 'top', 'bottom']) xmlFirst(tableFill, `${edge}Border`)!.setAttribute('type', 'SOLID');
	xmlFirst(tableFill, 'winBrush')!.setAttribute('faceColor', 'none'); borders.appendChild(tableFill);
	let page = xmlFirst(secPr, 'pagePr')!;
	if (template) { const imported = section.importNode<XmlElement>(parseXml(template.pageXml).documentElement!, true); page.parentNode!.replaceChild(imported, page); page = imported; }
	page.setAttribute('width', String(mm(style.pageWidth))); page.setAttribute('height', String(mm(style.pageHeight))); page.setAttribute('landscape', 'WIDELY');
	const margin = xmlFirst(page, 'margin')!;
	for (const [key, value] of Object.entries({ left: style.marginLeft, right: style.marginRight, top: style.marginTop, bottom: style.marginBottom })) margin.setAttribute(key, String(mm(value)));
	for (const old of xmlElements(secPr, 'pageBorderFill')) old.parentNode!.removeChild(old);
	const background = element(section, NS.para, 'hp:pageBorderFill', { type: 'BOTH', borderFillIDRef: fillId, textBorder: 'PAPER', headerInside: 0, footerInside: 0, fillArea: 'PAPER' });
	background.appendChild(element(section, NS.para, 'hp:offset', { left: 0, right: 0, top: 0, bottom: 0 })); secPr.appendChild(background);
	const controls = serializeXml(secPr) + xmlElements(section, 'colPr').map(item => `<hp:ctrl>${serializeXml(item)}</hp:ctrl>`).join('');
	const bodyWidth = mm(style.pageWidth - style.marginLeft - style.marginRight);
	const imageBodyHeight = Math.max(1, mm(style.pageHeight - style.marginTop - style.marginBottom) - Number(margin.getAttribute('header') || 0) - Number(margin.getAttribute('footer') || 0) - hu(style.fontSize));
	const styleId = xmlElements(header, 'style')[0]?.getAttribute('id') ?? '0';
	const paragraph = (runs: TextRun[], level = 0, prefix = ''): string => `<hp:p id="${paragraphId++}" paraPrIDRef="${makePara(level)}" styleIDRef="${escapeXml(styleId)}" pageBreak="0" columnBreak="0" merged="0">${prefix}${runs.length ? runs.map(run => runXml(run, level)).join('') : `<hp:run charPrIDRef="${makeChar(undefined, level)}"><hp:t/></hp:run>`}</hp:p>`;
	let noteNumber = 0;
	const runXml = (run: TextRun, level = 0): string => {
		let body = textXml(run.text);
		if (run.footnote) {
			const number = ++noteNumber;
			const notePrefix = `<hp:run charPrIDRef="${makeChar(undefined, -1)}"><hp:ctrl><hp:autoNum num="${number}" numType="FOOTNOTE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/></hp:autoNum></hp:ctrl><hp:t> </hp:t></hp:run>`;
			body = `<hp:ctrl><hp:footNote number="${number}" suffixChar="41" instId="${objectId++}">${subList(paragraph(document.footnotes[run.footnote] ?? [], -1, notePrefix))}</hp:footNote></hp:ctrl>`;
		} else if (run.image) {
			const resourceIndex = document.resources.findIndex(item => item.id === run.image), resource = document.resources[resourceIndex];
			if (!resource) throw new Error(`Image not found: ${run.image}`);
			const ratio = Math.min(1, bodyWidth / (resource.width * 75), imageBodyHeight / (resource.height * 75)), w = Math.max(1, Math.round(resource.width * 75 * ratio)), h = Math.max(1, Math.round(resource.height * 75 * ratio)), id = objectId++;
			body = `<hp:pic id="${id}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0"><hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.floor(w / 2)}" centerY="${Math.floor(h / 2)}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect><hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hc:img binaryItemIDRef="wmimg${resourceIndex}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/><hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:pic>`;
		}
		return `<hp:run charPrIDRef="${makeChar(run, run.footnote ? -1 : level)}">${body}</hp:run>`;
	};
	const body = document.blocks.map(block => {
		if (block.kind !== 'table') return paragraph(block.runs, block.kind === 'heading' ? block.level : 0);
		const cols = Math.max(1, ...block.rows.map(row => row.length)), cellW = Math.floor(bodyWidth / cols), rowH = Math.max(1800, hu(style.fontSize * 1.8));
		const rows = block.rows.map((row, rowIndex) => `<hp:tr>${Array.from({ length: cols }, (_, column) => `<hp:tc name="" header="${rowIndex === 0 ? 1 : 0}" hasMargin="1" protect="0" editable="1" dirty="0" borderFillIDRef="${tableBorderId}">${subList(paragraph(row[column] ?? []))}<hp:cellAddr colAddr="${column}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${cellW}" height="${rowH}"/><hp:cellMargin left="200" right="200" top="141" bottom="141"/></hp:tc>`).join('')}</hp:tr>`).join('');
		const table = `<hp:tbl id="${objectId++}" zOrder="0" numberingType="TABLE" pageBreak="CELL" repeatHeader="1" rowCnt="${block.rows.length}" colCnt="${cols}" cellSpacing="0" borderFillIDRef="${tableBorderId}" noShading="0"><hp:sz width="${cellW * cols}" widthRelTo="ABSOLUTE" height="${rowH * block.rows.length}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="0" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>${rows}</hp:tbl>`;
		return paragraph([], 0, `<hp:run charPrIDRef="${makeChar()}">${table}</hp:run>`);
	}).join('') || paragraph([]);
	const withControls = body.replace(/(<hp:p\b[^>]*>)/, `$1<hp:run charPrIDRef="${makeChar()}">${controls}</hp:run>`);
	while (sec.firstChild) sec.removeChild(sec.firstChild);
	const fragment = parseXml(`<root xmlns:hp="${NS.para}" xmlns:hc="${NS.core}" xmlns:hh="${NS.head}" xmlns:hs="${NS.section}">${withControls}</root>`);
	for (const child of Array.from(fragment.documentElement!.childNodes)) sec.appendChild(section.importNode(child, true));
	for (const [container, tag] of [[chars, 'charPr'], [paras, 'paraPr'], [borders, 'borderFill']] as const) container.setAttribute('itemCnt', String(xmlElements(container, tag).length));
	files['Contents/header.xml'] = strToU8(serializeXml(header)); files['Contents/section0.xml'] = strToU8(serializeXml(section));
	files['Preview/PrvText.txt'] = strToU8(documentText(document));
	const content = parseXml(strFromU8(files['Contents/content.hpf'])), manifest = xmlFirst(content, 'manifest')!;
	for (const title of xmlElements(content, 'title')) title.textContent = options.title;
	document.resources.forEach((resource, index) => {
		const name = `BinData/wmimg${index}.${resource.extension}`; files[name] = new Uint8Array(resource.bytes);
		manifest.appendChild(element(content, 'http://www.idpf.org/2007/opf/', 'opf:item', { id: `wmimg${index}`, href: name, 'media-type': `image/${resource.extension === 'jpg' ? 'jpeg' : resource.extension}`, isEmbeded: 1 }));
	});
	files['Contents/content.hpf'] = strToU8(serializeXml(content));
	const archive: Zippable = { mimetype: [files.mimetype, { level: 0 }] };
	for (const [name, bytes] of Object.entries(files)) if (name !== 'mimetype' && name !== 'Preview/PrvImage.png') archive[name] = bytes;
	return zipSync(archive);
}
