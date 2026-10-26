import { createDocumentElement } from '../utils/documentDom';
import type { DocumentStyle, ElementTextStyle, EncodeOptions } from './DocumentModel';

/** Resolve the same Style Settings rules consumed by project Markdown/Paged documents. */
export function projectExportStyles(doc: Document, body: DocumentStyle): NonNullable<EncodeOptions['elementStyles']> | undefined {
	const win = doc.defaultView;
	if (!win) return undefined;
	const root = createDocumentElement(doc, 'div');
	root.className = 'wm-styled-document wm-export-style-snapshot';
	root.dataset.writingMenuId = 'export-style-snapshot';
	root.setAttribute('aria-hidden', 'true');
	for (const [key, value] of Object.entries({ '--wm-font-family': body.fontFamily, '--wm-font-size': `${body.fontSize * 4 / 3}px`, '--wm-font-weight': String(body.fontWeight), '--wm-font-color': body.color, '--wm-line-height': String(body.lineSpacingType === 'percent' ? body.lineSpacing / 100 : 1.5) })) root.style.setProperty(key, value);
	const content = createDocumentElement(doc, 'div'); content.className = 'markdown-rendered'; root.appendChild(content);
	Object.assign(content.style, { fontFamily: body.fontFamily, fontSize: `${body.fontSize * 4 / 3}px`, fontWeight: String(body.fontWeight), color: body.color });
	const headings = Array.from({ length: 6 }, (_, index) => content.appendChild(createDocumentElement(doc, `h${index + 1}` as keyof HTMLElementTagNameMap)));
	const footnote = content.appendChild(createDocumentElement(doc, 'div')); footnote.className = 'footnotes';
	const canvas = createDocumentElement(doc, 'canvas'); canvas.width = canvas.height = 1;
	const context = canvas.getContext('2d');
	const color = (value: string): string => {
		if (!context) return body.color;
		context.clearRect(0, 0, 1, 1); context.fillStyle = body.color; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
		const rgba = context.getImageData(0, 0, 1, 1).data, alpha = rgba[3] / 255;
		return '#' + [0, 1, 2].map(index => Math.round(rgba[index] * alpha + parseInt(body.background.slice(1 + index * 2, 3 + index * 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('');
	};
	const read = (node: HTMLElement): ElementTextStyle => {
		const computed = win.getComputedStyle(node), pixels = parseFloat(computed.fontSize) || body.fontSize * 4 / 3;
		return { fontFamily: computed.fontFamily.split(',')[0].replace(/["']/g, '').trim() || body.fontFamily,
			fontSize: pixels * 3 / 4, fontWeight: parseInt(computed.fontWeight, 10) || (computed.fontWeight === 'bold' ? 700 : 400), color: color(computed.color),
			lineSpacing: (parseFloat(computed.lineHeight) / pixels || 1.5) * 100 };
	};
	doc.body.appendChild(root);
	try { return { headings: headings.map(read), footnote: read(footnote) }; }
	finally { root.remove(); }
}
