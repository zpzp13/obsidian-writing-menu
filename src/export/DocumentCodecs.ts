import { createDocx } from './DocxDocument';
import { createStyledHwpx } from './StyledHwpxDocument';
import { documentText, validateStyle } from './DocumentModel';
import type { DocumentCodec, DocumentFormat, EncodeOptions, GeneratedDocument, TransferDocument } from './DocumentModel';
import { renderHwpxPages as upstreamRender } from '../../vendor/kordoc/render/svg-render.js';

type HwpxRenderer = (input: ArrayBuffer, options: { reflow: boolean }) => Promise<{ scene: { warnings: string[] }; pageSvgs: Map<number, string> }>;
const renderHwpx = upstreamRender as unknown as HwpxRenderer;
export const DOCUMENT_CODECS: Record<DocumentFormat, DocumentCodec> = {
	txt: { format: 'txt', encode: document => Promise.resolve(new TextEncoder().encode(documentText(document))) },
	docx: { format: 'docx', encode: createDocx },
	hwpx: { format: 'hwpx', encode: (document, options) => Promise.resolve(createStyledHwpx(document, options)) },
};
export async function generateDocument(document: TransferDocument, format: DocumentFormat, options: EncodeOptions): Promise<GeneratedDocument> {
	if (format !== 'txt') validateStyle(options.style);
	const bytes = await DOCUMENT_CODECS[format].encode(document, options);
	const output: GeneratedDocument = { bytes, text: documentText(document), warnings: [...(options.template?.warnings ?? [])] };
	if (format === 'hwpx') {
		const rendered = await renderHwpx(bytes.slice().buffer, { reflow: true });
		output.pages = [...rendered.pageSvgs.values()];
		output.warnings.push(...rendered.scene.warnings);
	}
	return output;
}
