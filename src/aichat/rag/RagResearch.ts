import type { CorpusDocument } from './ChatCorpusProvider';
import type { ChatResearchCoverage } from '../AiChatTypes';

export interface ResearchEntity { id: string; name: string; path: string; aliases: string[] }
export interface ResearchRange { from: number; to: number }
export interface ResearchCache { key: string; scope: string; documentKey: string; hash: string; ranges: ResearchRange[] }

export const isCharacterResearch = (question: string) => /행적|행보|일대기|연대기|여정|(?:회차별|시간순|처음부터|전반|전체).*?(?:정리|요약|변화|행동|사건)|(?:관계|성격|태도).*?변화|\b(?:timeline|character arc|all appearances)\b/i.test(question);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Korean particles are allowed only at a token boundary, never arbitrary name prefixes. */
export function namePattern(name: string): RegExp {
	return new RegExp(`(^|[^\\p{L}\\p{N}_])(${escape(name)})(?=$|[^\\p{L}\\p{N}_]|(?:(?:에게서|에게|한테|으로|에서|처럼|까지|부터|와|과|랑|라고|라는)(?:는|도|만)?|은|는|이|가|을|를|의|도|만|이다|였다|이고|이며|이지만|이라도|이라며|이란|이라는|이라고)(?=$|[^\\p{L}\\p{N}_]))`, 'giu');
}
export function researchEntities(documents: CorpusDocument[]): ResearchEntity[] {
	return documents.filter(document => document.kind === 'character' && document.path).map(document => {
		const baseName = (name: string) => name.normalize('NFKC').replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').trim();
		return { id: document.id, path: document.path!, name: baseName(document.title) || document.title,
			// Parenthetical casting/role labels do not become independent aliases.
			aliases: [...new Set([document.title, ...(document.names ?? [])].flatMap(name => [name.trim(), baseName(name)]).filter(Boolean))] };
	});
}

/** A supplied literal name can be investigated even without a character note. */
export function explicitResearchNames(question: string): string[] {
	const names: string[] = [];
	for (const match of question.normalize('NFKC').matchAll(/(?:^|[\s“"'‘])([\p{L}\p{N}_·.-]{1,60}?)(?:\s*의\s*|\s+)(?:(?:전체|모든|작중|전편|회차별|지금까지)\s*)?(?:행적|행보|일대기|연대기|여정)/gu)) {
		if (!/^(그|이|저|그녀|그는|인물|주인공|상대역|전체|모든|전편|작중|그사람)$/.test(match[1])) names.push(match[1]);
	}
	return [...new Set(names)];
}
export function resolveResearchEntities(entities: ResearchEntity[], question: string): ResearchEntity[] {
	const matches = entities.flatMap(entity => entity.aliases.flatMap(alias => {
		const found: Array<{ entity: ResearchEntity; alias: string; from: number; to: number }> = [];
		for (const match of question.matchAll(namePattern(alias))) { const from = match.index! + match[1].length; found.push({ entity, alias, from, to: from + alias.length }); }
		return found;
	}));
	// A shorter name embedded in a longer explicitly named character must not pick another character.
	const exact = matches.filter(match => !matches.some(other => other.from <= match.from && other.to >= match.to && other.alias.length > match.alias.length));
	for (const match of exact) {
		const ambiguous = entities.filter(entity => entity.aliases.some(alias => alias.toLocaleLowerCase() === match.alias.toLocaleLowerCase()));
		if (ambiguous.length > 1) throw new Error(`인물 이름 '${match.alias}'이 여러 노트에 있습니다: ${ambiguous.map(entity => entity.path).join(', ')}. 고유한 별칭을 지정해 주세요.`);
	}
	return [...new Map(exact.map(match => [match.entity.id, match.entity])).values()];
}

/** Exact source windows, never generated facts. Keeps every explicit mention before budgeting. */
export function researchRanges(text: string, entities: ResearchEntity[], linked = false): ResearchRange[] {
	const ranges: ResearchRange[] = [];
	for (const alias of new Set(entities.flatMap(entity => entity.aliases))) {
		const pattern = namePattern(alias); let match: RegExpExecArray | null;
		while ((match = pattern.exec(text))) {
			const position = match.index + match[1].length;
			let from = Math.max(text.lastIndexOf('\n', position - 1) + 1, position - 90);
			let to = text.indexOf('\n', position); if (to < 0) to = text.length;
			to = Math.min(to, position + alias.length + 240);
			// Include an adjacent short paragraph, often containing the action after a name-only line.
			if (to - from < 55 && to < text.length) { const next = text.indexOf('\n', to + 1); to = Math.min(next < 0 ? text.length : next, to + 180); }
			if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from--;
			if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
			ranges.push({ from, to });
		}
	}
	// Structured cast/character links establish relevance even without a literal name in the prose.
	if (linked && !ranges.length) {
		for (let from = 0; from < text.length; from += 600) if (text.slice(from, from + 600).trim()) ranges.push({ from, to: Math.min(text.length, from + 600) });
	}
	const merged: ResearchRange[] = [];
	for (const range of ranges.sort((a, b) => a.from - b.from || a.to - b.to)) {
		const previous = merged[merged.length - 1];
		if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
		else merged.push({ ...range });
	}
	// Limit individual evidence size without dropping the rest of a long linked scene.
	return merged.flatMap(range => {
		const parts: ResearchRange[] = [];
		for (let from = range.from; from < range.to;) {
			let to = Math.min(range.to, from + 600);
			if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
			parts.push({ from, to }); from = to;
		}
		return parts;
	});
}

export function researchScopeText(coverage: ChatResearchCoverage): string {
	return `인물 행적 조사: ${coverage.characters.map(entity => entity.name).join(', ')} · 프로젝트 ${coverage.inspectedDocuments}개 자료 검사 · 관련 ${coverage.matchedDocuments}개 자료/${coverage.matchedPassages}구간 중 ${coverage.includedDocuments}개 자료/${coverage.includedPassages}구간 전송${coverage.shortenedPassages ? ` (${coverage.shortenedPassages}구간은 짧게 발췌)` : ''}. ${coverage.partial ? '예산 때문에 전송하지 못한 근거 또는 문맥이 있습니다. 전편의 모든 행적을 정리했다고 말하지 마세요.' : '수집된 명시적 등장·연결 구간을 모두 전송했습니다.'} 회차 순서는 서술 순서이며 작중 시간순과 다를 수 있습니다. 대명사·간접 서술의 모든 사건을 찾았다는 보장은 아닙니다.`;
}
