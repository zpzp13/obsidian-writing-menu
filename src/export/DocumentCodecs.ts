import { createDocx } from './DocxDocument';
import { createStyledHwpx } from './StyledHwpxDocument';
import { documentText, validateStyle } from './DocumentModel';
import type { DocumentCodec, DocumentFormat, EncodeOptions, GeneratedDocument, TransferDocument } from './DocumentModel';
export const DOCUMENT_CODECS: Record<DocumentFormat, DocumentCodec> = {
	txt: { format: 'txt', encode: document => Promise.resolve(new TextEncoder().encode(documentText(document))) },
	docx: { format: 'docx', encode: createDocx },
	hwpx: { format: 'hwpx', encode: (document, options) => Promise.resolve(createStyledHwpx(document, options)) },
};
export async function generateDocument(document: TransferDocument, format: DocumentFormat, options: EncodeOptions): Promise<GeneratedDocument> {
	if (format !== 'txt') validateStyle(options.style);
	const bytes = await DOCUMENT_CODECS[format].encode(document, options);
	const output: GeneratedDocument = { bytes, text: documentText(document), warnings: [...(options.template?.warnings ?? [])] };
	return output;
}
