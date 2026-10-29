/** Portable document interchange model. No Obsidian, filesystem, or renderer dependencies. */
export type DocumentFormat = 'txt' | 'docx' | 'hwpx';
export type ElementMode = 'keep' | 'text' | 'exclude';
export interface ContentPolicy {
	comments: 'keep' | 'exclude';
	properties: 'text' | 'exclude';
	headings: ElementMode;
	tables: ElementMode;
	footnotes: ElementMode;
	images: ElementMode;
	emphasis: boolean;
	/** Apply the plugin's configured heading and footnote typography. */
	formatting?: boolean;
	spaceIndent: boolean;
}
export interface DocumentStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	color: string;
	align: 'left' | 'center' | 'right' | 'justify';
	lineSpacing: number;
	lineSpacingType: 'percent' | 'fixed' | 'atLeast' | 'between';
	spaceBefore: number;
	spaceAfter: number;
	firstLineIndent: number;
	paragraphLeft: number;
	paragraphRight: number;
	pageWidth: number;
	pageHeight: number;
	marginTop: number;
	marginRight: number;
	marginBottom: number;
	marginLeft: number;
	background: string;
}
export interface SourceRange { path: string; from: number; to: number }
export interface TextRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	color?: string;
	background?: string;
	href?: string;
	footnote?: string;
	image?: string;
}
export interface ParagraphBlock {
	kind: 'paragraph' | 'heading';
	/** Original YAML properties, selectable independently of the manuscript body. */
	role?: 'properties';
	runs: TextRun[];
	level?: number;
	align?: DocumentStyle['align'];
	source?: SourceRange;
}
export interface TableBlock {
	kind: 'table';
	rows: TextRun[][][];
	source?: SourceRange;
}
export type DocumentBlock = ParagraphBlock | TableBlock;
export interface DocumentResource {
	id: string;
	bytes: Uint8Array;
	extension: 'png' | 'jpg' | 'gif' | 'bmp';
	width: number;
	height: number;
}
export interface TransferDocument {
	version: 1;
	blocks: DocumentBlock[];
	footnotes: Record<string, TextRun[]>;
	resources: DocumentResource[];
	/** Future importers can retain unsupported native parts and source mapping here. */
	native?: { format: DocumentFormat; parts: Record<string, Uint8Array> };
}
export interface TemplateStyle {
	id: string;
	label: string;
	style: DocumentStyle;
	charXml: string;
	paraXml: string;
}
export interface HwpxTemplate {
	styles: TemplateStyle[];
	defaultStyleId: string;
	headerXml: string;
	pageXml: string;
	backgroundXml: string;
	warnings: string[];
}
export interface ExportPreset { id: string; name: string; content: ContentPolicy; style: DocumentStyle }
export interface ExportDefaults {
	version: 1 | 2;
	format: DocumentFormat;
	content: ContentPolicy;
	style: DocumentStyle;
	/** Marks theme-derived appearance values in the current export draft. */
	appearance?: { fontFamily: boolean; color: boolean; background: boolean };
}
export interface DocumentCodec {
	format: DocumentFormat;
	encode(document: TransferDocument, options: EncodeOptions): Promise<Uint8Array>;
	/** Implemented by future import adapters; export UI does not pretend import is available. */
	decode?: (bytes: Uint8Array) => Promise<TransferDocument>;
}
export interface EncodeOptions {
	style: DocumentStyle;
	elementStyles?: { headings: ElementTextStyle[]; footnote: ElementTextStyle };
	fontFaces?: Record<string, Pick<DocumentStyle, 'fontFamily' | 'fontWeight'>>;
	title: string;
	template?: HwpxTemplate;
	templateStyleId?: string;
}
export type ElementTextStyle = Pick<DocumentStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'color' | 'lineSpacing'>;
/** Negative level denotes a footnote; zero denotes ordinary body text. */
export function elementDocumentStyle(options: EncodeOptions, level = 0): DocumentStyle {
	const element = level > 0 ? options.elementStyles?.headings[Math.min(5, level - 1)] : level < 0 ? options.elementStyles?.footnote : undefined;
	const style: DocumentStyle = element ? { ...options.style, ...element, lineSpacingType: 'percent' } : options.style;
	const face = options.fontFaces?.[JSON.stringify([style.fontFamily, style.fontWeight])];
	return face ? { ...style, ...face } : style;
}
export interface GeneratedDocument {
	bytes: Uint8Array;
	text: string;
	pages?: string[];
	warnings: string[];
}
export const DEFAULT_CONTENT: ContentPolicy = { comments: 'exclude', properties: 'exclude', headings: 'exclude', tables: 'exclude', footnotes: 'exclude', images: 'exclude', emphasis: false, formatting: false, spaceIndent: false };
export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = {
	fontFamily: 'Arial', fontSize: 14, fontWeight: 500, color: '#000000', align: 'justify',
	lineSpacing: 200, lineSpacingType: 'percent', spaceBefore: 0, spaceAfter: 0,
	firstLineIndent: 10, paragraphLeft: 0, paragraphRight: 0,
	pageWidth: 210, pageHeight: 297, marginTop: 20, marginRight: 10, marginBottom: 20, marginLeft: 10, background: '#ffffff',
};
export function documentText(document: TransferDocument): string {
	const runsText = (runs: TextRun[]): string => runs.map(run => run.footnote ? `[${run.footnote}]` : run.text).join('');
	return document.blocks.map(block => block.kind === 'table' ? block.rows.map(row => row.map(runsText).join('\t')).join('\n') : runsText(block.runs)).join('\n');
}
export function validateStyle(style: DocumentStyle): void {
	if (!style.fontFamily.trim()) throw new Error('글꼴 이름을 입력해 주세요.');
	for (const value of Object.values(style)) if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('문서 설정에 유효하지 않은 숫자가 있습니다.');
	if (style.fontSize < 1 || style.fontSize > 200 || style.lineSpacing <= 0) throw new Error('글꼴 크기는 1~200pt, 줄간격은 0보다 큰 값으로 입력해 주세요.');
	if (style.pageWidth < 20 || style.pageHeight < 20 || style.pageWidth > 2000 || style.pageHeight > 2000
		|| Math.min(style.marginLeft, style.marginRight, style.marginTop, style.marginBottom) < 0
		|| style.marginLeft + style.marginRight >= style.pageWidth || style.marginTop + style.marginBottom >= style.pageHeight) throw new Error('용지 안에 본문 영역이 남도록 쪽 크기와 여백을 입력해 주세요.');
	if (![style.color, style.background].every(color => /^#[0-9a-f]{6}$/i.test(color))) throw new Error('색상을 #RRGGBB 형식으로 입력해 주세요.');
}
