import type { App, TFile } from 'obsidian';
import type { DictEntry } from './types';

function isSeparatorRow(cells: string[]): boolean {
	return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}

/**
 * 단어장 노트(마크다운 표)를 파싱한다.
 * 형식: `| 단어 | 유의어 후보 |` — 단어는 형태소 분석기가 이미 정규화해 저장한 형태이므로
 * 활용형을 따로 만들지 않고 그대로 매칭한다.
 */
export function parseDictText(text: string): DictEntry[] {
	const entries: DictEntry[] = [];
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line.startsWith('|')) continue;
		const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
		if (cells.length < 1) continue;
		if (isSeparatorRow(cells)) continue;
		const word = cells[0];
		if (!word || word === '단어') continue; // 헤더 행 skip

		const candidates = (cells[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
		entries.push({ word, candidates });
	}
	return entries;
}

/** 단어 → 유의어 후보[] 조회용 맵 */
export function buildDictLookup(entries: DictEntry[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const entry of entries) map.set(entry.word, entry.candidates);
	return map;
}

export async function loadSynonymDict(app: App, notePath: string): Promise<Map<string, string[]>> {
	if (!notePath) return new Map();
	const file = app.vault.getAbstractFileByPath(notePath);
	if (!file || !('extension' in file)) return new Map();
	const text = await app.vault.cachedRead(file as TFile);
	return buildDictLookup(parseDictText(text));
}
