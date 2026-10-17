export interface PageRange {
	index: number;
	from: number;
	to: number;
}

export interface PageGeometry {
	pageWidth: number;
	pageHeight: number;
	marginTop: number;
	marginRight: number;
	marginBottom: number;
	marginLeft: number;
	fontSize: number;
	lineHeight: number;
	paragraphSpacing: number;
	indentation: number;
}

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
	// A4 at 96 CSS pixels per inch.
	pageWidth: 794,
	pageHeight: 1123,
	marginTop: 76,
	marginRight: 72,
	marginBottom: 76,
	marginLeft: 72,
	fontSize: 16,
	lineHeight: 1.9,
	paragraphSpacing: 0,
	indentation: 0,
};

