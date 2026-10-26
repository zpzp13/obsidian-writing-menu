import { AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, ImageRun, LineRuleType, Packer, Paragraph, ShadingType, Tab, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { IRunOptions, ParagraphChild } from 'docx';
import type { DocumentStyle, EncodeOptions, TextRun as ModelRun, TransferDocument } from './DocumentModel';
import { elementDocumentStyle, validateStyle } from './DocumentModel';

export async function createDocx(document: TransferDocument, options: EncodeOptions): Promise<Uint8Array> {
	const style = elementDocumentStyle(options);
	validateStyle(style);
	const noteIds = new Map(Object.keys(document.footnotes).map((id, index) => [id, index + 1]));
	const twips = (pt: number): number => Math.round(pt * 20), mm = (value: number): number => Math.round(value * 1440 / 25.4);
	const alignments = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
	const typography = (textStyle: DocumentStyle) => ({
		font: { ascii: textStyle.fontFamily, hAnsi: textStyle.fontFamily, eastAsia: textStyle.fontFamily, cs: textStyle.fontFamily },
		size: Math.round(textStyle.fontSize * 2), bold: textStyle.fontWeight >= 600, color: textStyle.color.replace('#', ''),
	});
	const runs = (items: ModelRun[], level = 0): ParagraphChild[] => items.flatMap<ParagraphChild>(item => {
		const textStyle = elementDocumentStyle(options, level);
		if (item.footnote) return [new FootnoteReferenceRun(noteIds.get(item.footnote)!)];
		if (item.image) {
			const resource = document.resources.find(image => image.id === item.image);
			if (!resource) throw new Error(`Image not found: ${item.image}`);
			const maxWidth = (style.pageWidth - style.marginLeft - style.marginRight) * 96 / 25.4;
			const maxHeight = Math.max(1, (style.pageHeight - style.marginTop - style.marginBottom) * 96 / 25.4 - style.fontSize * 96 / 72);
			const ratio = Math.min(1, maxWidth / resource.width, maxHeight / resource.height);
			return [new ImageRun({ type: resource.extension === 'jpg' ? 'jpg' : resource.extension, data: resource.bytes, transformation: { width: Math.max(1, Math.round(resource.width * ratio)), height: Math.max(1, Math.round(resource.height * ratio)) }, altText: { name: item.text, title: item.text, description: item.text } })];
		}
		const pieces = item.text.split(/(\n|\t)/);
		return pieces.filter(piece => piece !== '').map(piece => { const properties: IRunOptions = {
			text: piece === '\n' || piece === '\t' ? undefined : piece,
			break: piece === '\n' ? 1 : undefined, children: piece === '\t' ? [new Tab()] : undefined,
			...typography(textStyle), bold: item.bold || textStyle.fontWeight >= 600,
			italics: item.italic, underline: item.underline ? {} : undefined, strike: item.strike,
			color: (item.color || textStyle.color).replace('#', ''), shading: item.background ? { type: ShadingType.CLEAR, fill: item.background.replace('#', '') } : undefined,
		}; return new TextRun(properties); });
	});
	const paragraph = (items: ModelRun[], level = 0, alignment?: DocumentStyle['align']): Paragraph => {
		const textStyle = elementDocumentStyle(options, level);
		return new Paragraph({
			children: runs(items, level), alignment: alignments[alignment ?? textStyle.align],
			heading: level > 0 ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1] : undefined,
			spacing: { before: twips(textStyle.spaceBefore), after: twips(textStyle.spaceAfter), line: textStyle.lineSpacingType === 'percent' ? Math.round(textStyle.lineSpacing * 2.4) : twips(textStyle.lineSpacingType === 'between' ? textStyle.fontSize + textStyle.lineSpacing : textStyle.lineSpacing), lineRule: textStyle.lineSpacingType === 'percent' ? LineRuleType.AUTO : textStyle.lineSpacingType === 'atLeast' ? LineRuleType.AT_LEAST : LineRuleType.EXACT },
			indent: { firstLine: style.firstLineIndent >= 0 ? twips(style.firstLineIndent) : undefined, hanging: style.firstLineIndent < 0 ? twips(-style.firstLineIndent) : undefined, left: twips(style.paragraphLeft), right: twips(style.paragraphRight) },
		});
	};
	const children = document.blocks.map(block => block.kind === 'table' ? new Table({
		width: { size: 100, type: WidthType.PERCENTAGE },
		rows: block.rows.map((row, index) => new TableRow({ tableHeader: index === 0, children: row.map(cell => new TableCell({ children: [paragraph(cell)] })) })),
	}) : paragraph(block.runs, block.kind === 'heading' ? block.level : undefined));
	const notes = Object.fromEntries([...noteIds].map(([id, number]) => [number, { children: [paragraph(document.footnotes[id], -1)] }]));
	const file = new Document({
		title: options.title, creator: 'Writing Menu', footnotes: notes,
		background: { color: style.background.replace('#', '') },
		styles: { default: { document: { run: typography(style) }, footnoteReference: { run: { ...typography(elementDocumentStyle(options, -1)), superScript: true } }, footnoteText: { run: typography(elementDocumentStyle(options, -1)) }, footnoteTextChar: { run: typography(elementDocumentStyle(options, -1)) } } },
		sections: [{ properties: { page: { size: { width: mm(style.pageWidth), height: mm(style.pageHeight) }, margin: { top: mm(style.marginTop), right: mm(style.marginRight), bottom: mm(style.marginBottom), left: mm(style.marginLeft), header: 0, footer: 0, gutter: 0 } } }, children: children.length ? children : [paragraph([])] }],
	});
	return new Uint8Array(await Packer.toArrayBuffer(file));
}
