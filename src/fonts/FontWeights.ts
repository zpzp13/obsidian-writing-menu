import { wmT } from '../i18n/index';

export function fontWeightOptions(): Array<[number, string]> {
	return [
		[100, wmT("가장 가늘게")],
		[200, wmT("아주 가늘게")],
		[300, wmT("가늘게")],
		[400, wmT("보통")],
		[500, wmT("중간")],
		[600, wmT("조금 두껍게")],
		[700, wmT("두껍게")],
		[800, wmT("아주 두껍게")],
		[900, wmT("가장 두껍게")],
	];
}
