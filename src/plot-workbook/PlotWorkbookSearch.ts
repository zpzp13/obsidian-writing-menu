export interface PlotWorkbookSearchQuery {
	text: string;
	row: string;
	column: string;
}

/** @ targets a column (letter, title or role); # targets a numbered row. */
export function parsePlotWorkbookSearch(value: string): PlotWorkbookSearchQuery {
	let row = '';
	let column = '';
	const text = value.replace(
		/(?:^|\s)(?:(열|행)\s*:\s*|([@#])\s*)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+))/gu,
		(match, word: string, symbol: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
			const selector = (doubleQuoted ?? singleQuoted ?? bare ?? '').replace(/\\(["'\\])/g, '$1').trim();
			const isRow = word === '행' || symbol === '#';
			if (!selector || (isRow && !/^\d+(?:-\d+)?$/.test(selector))) return match;
			if (isRow) row = selector;
			else column = selector;
			return ' ';
		},
	).trim().replace(/\s+/g, ' ');
	return { text, row, column };
}
