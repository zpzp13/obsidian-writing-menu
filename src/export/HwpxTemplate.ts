import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Document as XmlDocument, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';
import { DEFAULT_DOCUMENT_STYLE } from './DocumentModel';
import type { DocumentStyle, HwpxTemplate, TemplateStyle } from './DocumentModel';

export const NS = {
	head: 'http://www.hancom.co.kr/hwpml/2011/head', para: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
	core: 'http://www.hancom.co.kr/hwpml/2011/core', section: 'http://www.hancom.co.kr/hwpml/2011/section',
};
export function parseXml(text: string): XmlDocument {
	if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD나 엔터티를 포함한 HWPX XML은 지원하지 않습니다.');
	return new DOMParser({ onError(level, message) { if (level !== 'warning') throw new Error(`Invalid HWPX XML: ${message}`); } }).parseFromString(text, 'text/xml');
}
export const serializeXml = (node: XmlNode): string => new XMLSerializer().serializeToString(node);
export function xmlElements(node: XmlDocument | XmlElement, name: string): XmlElement[] {
	return Array.from(node.getElementsByTagName('*')).filter(element => element.localName === name);
}
export const xmlFirst = (node: XmlDocument | XmlElement, name: string): XmlElement | undefined => xmlElements(node, name)[0];
export const xmlNumber = (element: XmlElement | undefined, name: string, fallback = 0): number => {
	const value = element?.getAttribute(name); return value == null || value === '' ? fallback : Number(value);
};
export function readHwpxXml(bytes: Uint8Array): Record<string, Uint8Array> {
	if (bytes.length > 64 * 1024 * 1024 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('올바른 HWPX 파일을 선택해 주세요.');
	let total = 0;
	const files = unzipSync(bytes, { filter(entry) {
		if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) throw new Error('HWPX 안에 올바르지 않은 파일 경로가 있습니다.');
		total += entry.originalSize;
		if (total > 64 * 1024 * 1024 || entry.originalSize > 20 * 1024 * 1024) throw new Error('HWPX 파일이 너무 큽니다. 64MB 이하의 파일을 선택해 주세요.');
		return entry.name === 'mimetype' || /^(?:Contents|META-INF)\/[^/]+\.(?:xml|hpf)$/i.test(entry.name);
	} });
	if (!files.mimetype || strFromU8(files.mimetype).trim() !== 'application/hwp+zip') throw new Error('올바른 HWPX 파일을 선택해 주세요.');
	return files;
}
function sectionPath(files: Record<string, Uint8Array>): string {
	const manifestBytes = files['Contents/content.hpf'];
	if (manifestBytes) {
		const manifest = parseXml(strFromU8(manifestBytes));
		const first = xmlFirst(manifest, 'itemref')?.getAttribute('idref');
		const href = xmlElements(manifest, 'item').find(item => item.getAttribute('id') === first)?.getAttribute('href');
		if (href) {
			const relative = href.startsWith('Contents/') ? href : `Contents/${href}`;
			if (files[relative] && /section[^/]*\.xml$/i.test(relative)) return relative;
		}
	}
	const path = Object.keys(files).filter(name => /^Contents\/section\d+\.xml$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
	if (!path) throw new Error('HWPX 파일에서 본문 구역을 찾지 못했습니다.');
	return path;
}
function bodyParagraphs(section: XmlDocument): XmlElement[] {
	return xmlElements(section, 'p').filter(paragraph => {
		for (let parent = paragraph.parentNode; parent; parent = parent.parentNode) {
			if (parent.nodeType === 1 && ['tc', 'header', 'footer', 'footNote', 'endNote'].includes((parent as XmlElement).localName ?? '')) return false;
		}
		return true;
	});
}
export function inspectHwpxTemplate(bytes: Uint8Array): HwpxTemplate {
	const files = readHwpxXml(bytes), headerBytes = files['Contents/header.xml'] ?? files['Contents/head.xml'];
	if (!headerBytes) throw new Error('HWPX 파일에서 서식 정의를 찾지 못했습니다.');
	const headerXml = strFromU8(headerBytes), header = parseXml(headerXml), section = parseXml(strFromU8(files[sectionPath(files)]));
	const page = xmlFirst(section, 'pagePr');
	if (!page) throw new Error('HWPX 파일에서 쪽 설정을 찾지 못했습니다.');
	const margin = xmlFirst(page, 'margin'), fills = xmlElements(section, 'pageBorderFill');
	const fill = fills.find(item => item.getAttribute('type') === 'BOTH') ?? fills[0];
	const border = xmlElements(header, 'borderFill').find(item => item.getAttribute('id') === fill?.getAttribute('borderFillIDRef'));
	const brush = border ? xmlFirst(border, 'winBrush') : undefined;
	const color = brush?.getAttribute('faceColor');
	const warnings: string[] = [];
	if (Object.keys(files).filter(name => /^Contents\/section\d+\.xml$/i.test(name)).length > 1) warnings.push('첫 번째 구역의 쪽 설정을 적용합니다.');
	if (border && (xmlFirst(border, 'gradation') || xmlFirst(border, 'imgBrush'))) warnings.push('그림·그라데이션 쪽 배경은 지원하지 않습니다.');
	const mm = (value: number): number => Math.round(value * 25.4 / 7200 * 1000) / 1000;
	let width = mm(xmlNumber(page, 'width', 59528)), height = mm(xmlNumber(page, 'height', 84186));
	if (page.getAttribute('landscape') === 'NARROWLY' && width < height) [width, height] = [height, width];
	const pageStyle: Partial<DocumentStyle> = {
		pageWidth: width, pageHeight: height, marginTop: mm(xmlNumber(margin, 'top')), marginRight: mm(xmlNumber(margin, 'right')),
		marginBottom: mm(xmlNumber(margin, 'bottom')), marginLeft: mm(xmlNumber(margin, 'left')),
		background: color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#ffffff',
	};
	const charProperties = xmlElements(header, 'charPr'), paraProperties = xmlElements(header, 'paraPr');
	if (!charProperties.length || !paraProperties.length) throw new Error('HWPX 파일에서 본문 서식을 찾지 못했습니다.');
	const namedStyles = xmlElements(header, 'style');
	const fonts = xmlElements(header, 'fontface').find(group => group.getAttribute('lang')?.toUpperCase() === 'HANGUL');
	const fontsById = new Map((fonts ? xmlElements(fonts, 'font') : []).map(font => [font.getAttribute('id'), font.getAttribute('face') ?? 'Arial']));
	const counts = new Map<string, number>();
	for (const paragraph of bodyParagraphs(section)) {
		const candidates = xmlElements(paragraph, 'run').filter(run => {
			if (!xmlFirst(run, 't')?.textContent) return false;
			for (let parent = run.parentNode; parent && parent !== paragraph; parent = parent.parentNode) if (parent.nodeType === 1 && ['tc', 'footNote', 'endNote', 'header', 'footer'].includes((parent as XmlElement).localName ?? '')) return false;
			return true;
		});
		const char = candidates.sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0];
		if (!char) continue;
		const id = `${char.getAttribute('charPrIDRef') ?? '0'}:${paragraph.getAttribute('paraPrIDRef') ?? '0'}`;
		counts.set(id, (counts.get(id) ?? 0) + candidates.reduce((sum, run) => sum + (run.textContent?.length ?? 0), 0));
	}
	if (!counts.size) counts.set(`${charProperties[0].getAttribute('id')}:${paraProperties[0].getAttribute('id')}`, 1);
	const styles: TemplateStyle[] = [];
	for (const [id] of [...counts].sort((a, b) => b[1] - a[1])) {
		const [charId, paraId] = id.split(':'), char = charProperties.find(item => item.getAttribute('id') === charId), para = paraProperties.find(item => item.getAttribute('id') === paraId);
		if (!char || !para) continue;
		const fontRef = xmlFirst(char, 'fontRef'), paraMargin = xmlFirst(para, 'margin'), spacing = xmlFirst(para, 'lineSpacing');
		const distance = (name: string): number => xmlNumber(paraMargin ? xmlFirst(paraMargin, name) : undefined, 'value') / 100;
		const type = spacing?.getAttribute('type') ?? 'PERCENT';
		const align = xmlFirst(para, 'align')?.getAttribute('horizontal')?.toLowerCase();
		const style: DocumentStyle = {
			...DEFAULT_DOCUMENT_STYLE, ...pageStyle,
			fontFamily: fontsById.get(fontRef?.getAttribute('hangul') ?? '') ?? 'Arial', fontSize: xmlNumber(char, 'height', 1200) / 100,
			fontWeight: xmlFirst(char, 'bold') ? 700 : 400, color: /^#[0-9a-f]{6}$/i.test(char.getAttribute('textColor') ?? '') ? char.getAttribute('textColor')! : '#000000',
			align: align === 'center' || align === 'right' || align === 'justify' ? align : 'left',
			lineSpacingType: type === 'FIXED' ? 'fixed' : type === 'AT_LEAST' ? 'atLeast' : type === 'BETWEEN_LINES' ? 'between' : 'percent',
			lineSpacing: xmlNumber(spacing, 'value', 160) / (type === 'PERCENT' ? 1 : 100),
			spaceBefore: distance('prev'), spaceAfter: distance('next'), firstLineIndent: distance('intent'), paragraphLeft: distance('left'), paragraphRight: distance('right'),
		};
		const named = namedStyles.find(item => item.getAttribute('charPrIDRef') === charId && item.getAttribute('paraPrIDRef') === paraId);
		styles.push({ id, label: `${named?.getAttribute('name') || 'Body'} · ${style.fontFamily} · ${style.fontSize} pt`, style, charXml: serializeXml(char), paraXml: serializeXml(para) });
	}
	if (!styles.length) throw new Error('HWPX 파일의 본문 서식 참조가 올바르지 않습니다.');
	return { styles, defaultStyleId: styles[0].id, headerXml, pageXml: serializeXml(page), backgroundXml: fills.map(serializeXml).join(''), warnings };
}
