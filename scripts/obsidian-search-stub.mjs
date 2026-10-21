// Search contract double for offline fixtures. Real SDK matching is checked in the Test vault.
export function prepareSimpleSearch(query) {
	return text => {
		const at = text.toLowerCase().indexOf(query.toLowerCase());
		return at < 0 ? null : { score: -at, matches: [[at, at + query.length]] };
	};
}
export const obsidianSearchStub = `export const prepareSimpleSearch = ${prepareSimpleSearch.toString()};`;
