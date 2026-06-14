import { requestUrl } from 'obsidian';
import type { DictEntry, DictSense } from './types';

export function parseXmlEntries(xmlText: string): DictEntry[] {
	const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
	const entries: DictEntry[] = [];

	xml.querySelectorAll('item').forEach(item => {
		const word = item.querySelector('word')?.textContent?.trim() ?? '';
		const pos = item.querySelector('pos')?.textContent?.trim() ?? '';
		const targetCode = item.querySelector('target_code')?.textContent?.trim() ?? '';
		const supNo = parseInt(item.querySelector('sup_no')?.textContent?.trim() ?? '0') || 0;
		const origin = item.querySelector('origin')?.textContent?.trim() ?? '';

		const senses: DictSense[] = [];
		item.querySelectorAll('sense').forEach((sense, idx) => {
			const definition = sense.querySelector('definition')?.textContent?.trim() ?? '';
			if (definition) senses.push({ no: String(idx + 1), definition });
		});

		if (word) entries.push({ targetCode, word, supNo, pos, origin, senses });
	});

	return entries;
}

export function parseXmlViewExamples(xmlText: string): string[] {
	const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
	const examples: string[] = [];
	xml.querySelectorAll('example').forEach(ex => {
		const text = ex.textContent?.trim();
		if (text) examples.push(text);
	});
	return examples;
}

export async function callStdictSearch(word: string, key: string): Promise<DictEntry[]> {
	const url = `https://stdict.korean.go.kr/api/search.do?key=${encodeURIComponent(key)}&q=${encodeURIComponent(word)}&num=20`;
	try {
		const res = await requestUrl({ url, method: 'GET' });
		return parseXmlEntries(res.text);
	} catch { return []; }
}

export async function callStdictAutocomplete(prefix: string, key: string): Promise<DictEntry[]> {
	const url = `https://stdict.korean.go.kr/api/search.do?key=${encodeURIComponent(key)}&q=${encodeURIComponent(prefix)}&num=20&advanced=y&method=start`;
	try {
		const res = await requestUrl({ url, method: 'GET' });
		return parseXmlEntries(res.text);
	} catch { return []; }
}

export async function callStdictView(targetCode: string, key: string): Promise<string[]> {
	const url = `https://stdict.korean.go.kr/api/view.do?key=${encodeURIComponent(key)}&q=${encodeURIComponent(targetCode)}&method=target_code`;
	try {
		const res = await requestUrl({ url, method: 'GET' });
		return parseXmlViewExamples(res.text);
	} catch { return []; }
}
