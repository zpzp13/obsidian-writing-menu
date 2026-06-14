export interface DictEntry {
	targetCode: string;
	word: string;
	supNo: number;
	pos: string;
	origin: string;
	senses: DictSense[];
}

export interface DictSense {
	no: string;
	definition: string;
}
