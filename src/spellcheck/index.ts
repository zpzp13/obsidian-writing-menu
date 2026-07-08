import { Editor, Notice, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { CorrectionModal } from './CorrectionModal';
import { fireAndForget } from '../utils/asyncUtils';

export interface Correction {
	original: string;
	corrected: string[];
	help: string;
	type?: string;
}

type RawResult = { token: string; suggestions: string[]; type: string; info: string };

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

function getFrontmatterOffset(text: string): number {
	if (!text.startsWith('---')) return 0;
	const afterOpen = text.indexOf('\n', 0);
	if (afterOpen === -1 || text.substring(0, afterOpen).trim() !== '---') return 0;
	let pos = afterOpen + 1;
	while (pos < text.length) {
		const lineEnd = text.indexOf('\n', pos);
		const line = lineEnd === -1 ? text.substring(pos) : text.substring(pos, lineEnd);
		if (line.replace(/\r$/, '') === '---') {
			return lineEnd === -1 ? text.length : lineEnd + 1;
		}
		if (lineEnd === -1) break;
		pos = lineEnd + 1;
	}
	return 0;
}

function decodeEntities(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return doc.body.textContent ?? html;
}

// ── Daum 검사 ─────────────────────────────────────────────────────────────

const DAUM_URL = 'https://dic.daum.net/grammar_checker.do';
const DAUM_MAX_CHARS = 1000;
const DAUM_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
	'(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Daum: 구분자(.,\n) 기준으로 최대 limit 글자씩 분리
function splitByLength(text: string, sep: string, limit: number): string[] {
	const parts: string[] = [];
	let lastSplit = -1;
	let lastFound = -1;
	for (let i = 0; i < text.length; i++) {
		if (sep.includes(text[i])) {
			if (i - lastSplit > limit) {
				parts.push(text.substring(lastSplit + 1, lastFound + 1));
				lastSplit = lastFound;
			}
			lastFound = i;
		}
	}
	if (lastSplit + 1 < text.length) {
		if (text.length - lastSplit - 1 <= limit) {
			parts.push(text.substring(lastSplit + 1));
		} else {
			if (lastSplit !== lastFound) parts.push(text.substring(lastSplit + 1, lastFound + 1));
			parts.push(text.substring(lastFound + 1));
		}
	}
	return parts.length ? parts : [text];
}

function getAttr(line: string, key: string): string {
	const idx = line.indexOf(key);
	if (idx === -1) return '';
	const q1 = line.indexOf('"', idx + key.length);
	const q2 = line.indexOf('"', q1 + 1);
	return q1 === -1 || q2 === -1 ? '' : line.substring(q1 + 1, q2);
}

function parseDaumResponse(html: string): RawResult[] {
	const results: RawResult[] = [];
	let found = -1;
	for (;;) {
		found = html.indexOf('data-error-type', found + 1);
		if (found === -1) break;
		const end = html.indexOf('>', found + 1);
		if (end === -1) break;
		const line = html.substring(found, end);

		const token = decodeEntities(getAttr(line, 'data-error-input='));
		const output = decodeEntities(getAttr(line, 'data-error-output='));
		const type = decodeEntities(getAttr(line, 'data-error-type='));

		if (!token || !output) continue;

		const infoBegin = html.indexOf('<div>', found);
		let infoEnd = html.indexOf('</div>', infoBegin + 1);
		if (infoBegin !== -1 && infoEnd !== -1) {
			const infoNextEnd = html.indexOf('</div>', infoEnd + 1);
			const nextFound = html.indexOf('inner_spell', infoBegin);
			if (infoNextEnd !== -1 && (nextFound === -1 || nextFound > infoNextEnd)) {
				infoEnd = infoNextEnd;
			}
		}

		let info = '';
		if (infoBegin !== -1 && infoEnd !== -1) {
			info = decodeEntities(html.substring(infoBegin, infoEnd + 6))
				.replace(/\t/g, '')
				.replace(/<strong class[^>]*>[^>]*>\n/gi, '')
				.replace(/<br[^>]*>/gi, '\n')
				.replace(/<[^>]*>/g, '')
				.replace(/\n\n\n\n\n/g, '\n(예)\n')
				.replace(/\n\n*$/, '')
				.replace(/^[ \n]+/, '');
		}
		if (info === '도움말이 없습니다.') info = '';

		results.push({ token, suggestions: [output], type, info });
	}
	return results;
}

async function checkChunkDaum(chunk: string): Promise<RawResult[]> {
	const body = new URLSearchParams({ sentence: chunk }).toString();
	const res = await requestUrl({
		url: DAUM_URL,
		method: 'POST',
		headers: { 'User-Agent': DAUM_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
		throw: false,
	});
	if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
	if (!res.text.includes('="screen_out">맞춤법 검사기 본문</h2>')) {
		throw new Error('Daum 서비스 응답 형식 오류');
	}
	return parseDaumResponse(res.text);
}

// ── 공통 후처리 ───────────────────────────────────────────────────────────

function formatHelp(help: string): string {
	help = help.replace(/\n{2,}/g, '\n\n');
	const lines = help.split('\n').filter(l => l.trim().length > 0);
	if (lines.length === 0) return help;
	const desc = lines[0].replace(/([^\s])\s*(\d+[.)])/g, '$1\n$2');
	if (lines.length > 1) {
		const sentences = lines.slice(1).join(' ').split('.').filter(s => s.trim().length > 0);
		if (sentences.length > 0) {
			const circles = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
			return desc + '\n\n' + sentences.map((s, i) => `${i < 10 ? circles[i] : `${i + 1})`} ${s.trim()}.`).join('\n');
		}
	}
	return desc;
}

function buildCorrections(raw: RawResult[]): Correction[] {
	const map = new Map<string, Correction>();
	for (const r of raw) {
		if (!r.token || !r.suggestions?.length) continue;
		if (map.has(r.token)) {
			const ex = map.get(r.token)!;
			const newSugs = r.suggestions.filter(s => !ex.corrected.includes(s));
			if (newSugs.length) map.set(r.token, { ...ex, corrected: [...ex.corrected, ...newSugs] });
		} else {
			map.set(r.token, {
				original: r.token,
				corrected: r.suggestions,
				help: formatHelp(r.info || '맞춤법 교정'),
				type: r.type,
			});
		}
	}
	return Array.from(map.values());
}

async function collectRaw(chunks: string[], checkFn: (chunk: string) => Promise<RawResult[]>, delay = 0): Promise<RawResult[]> {
	const raw: RawResult[] = [];
	for (let i = 0; i < chunks.length; i++) {
		if (i > 0 && delay > 0) await new Promise(r => window.setTimeout(r, delay));
		raw.push(...await checkFn(chunks[i]));
	}
	return raw;
}

// ── 서비스 ────────────────────────────────────────────────────────────────

export class SpellCheckerService {
	async checkByDaum(text: string): Promise<Correction[]> {
		const cleaned = text.replace(/<[^ㄱ-ㅎㅏ-ㅣ가-힣>]+>/g, '');
		return buildCorrections(await collectRaw(splitByLength(cleaned, '.,\n', DAUM_MAX_CHARS), checkChunkDaum, 400));
	}

	async run(editor: Editor, plugin: WritingMenuPlugin): Promise<void> {
		const text = editor.getValue();
		if (!text.trim()) { new Notice('검사할 내용이 없습니다.'); return; }

		const bodyOffset = getFrontmatterOffset(text);
		const body = bodyOffset > 0 ? text.substring(bodyOffset) : text;

		const loadingNotice = new Notice('맞춤법 검사 중...', 0);
		try {
			let corrections = await this.checkByDaum(body);

			const ignoredStems = plugin.settings.spellCheckIgnoredWords ?? [];
			corrections = corrections.filter(c =>
				!ignoredStems.some(stem => c.original === stem || (stem.length >= 2 && c.original.startsWith(stem)))
			);

			loadingNotice.hide();
			if (corrections.length === 0) { new Notice('맞춤법 오류가 없습니다. ✓'); return; }

			new CorrectionModal(plugin.app, {
				text,
				bodyOffset,
				editor,
				corrections,
				onIgnoredWordAdded: (words) => {
					fireAndForget(async () => {
						const current = plugin.settings.spellCheckIgnoredWords ?? [];
						plugin.settings.spellCheckIgnoredWords = [...new Set([...current, ...words])];
						await plugin.saveSettings();
					});
				},
			}).open();
		} catch {
			loadingNotice.hide();
			new Notice('맞춤법 검사 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
		}
	}
}
