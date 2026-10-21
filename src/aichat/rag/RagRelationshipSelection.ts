import type { CorpusDocument } from './ChatCorpusProvider';
import type { ChatResearchCoverage } from '../AiChatTypes';
import { researchEvidenceText } from '../AiChatPrompt';
import { checkChatAbort } from '../ChatStream';
import { namePattern, type ResearchEntity, type ResearchRange } from './RagResearch';
import { ragHash, ragYield, type RagChunk } from './RagTypes';

const facets = {
	origin: /선후배|선배|후배|동창|동문|대학|학교|처음|만났|인연/g,
	friendship: /찐친|절친|친구|친해|친했|친한|가까워|친밀|언니|동생/g,
	affection: /짝사랑|연인|애인|연애|사랑|고백|좋아하|좋아했|마음|질투|설레/g,
	work: /캐스팅|출연|촬영|작가|배우|감독|작품|동료|작업/g,
	support: /도왔|도와|돕|구했|구하|구해|구출|보호|위로|응원|함께|공동|협력|협공|동지|동맹|제압|통제|감싸|붙잡|잡아/g,
	conflict: /갈등|원수|앙숙|악연|무시|원한|적대|배신|화해|싸웠|다퉜|응징/g,
	trust: /신뢰|믿고|믿었|의지|기대|고마|감사|약속/g,
	change: /이제|어느새|달라|변했|변화|발전|헤어|결별|재회/g,
};
type Facet = keyof typeof facets;
interface Candidate { document: CorpusDocument; hash: string; range: ResearchRange; score: number; facets: Facet[]; signals: Partial<Record<Facet, number>>; specific: Record<string, number>; profile: boolean; order: number }
const strongCue = /^(?:선후배|동창|동문|찐친|절친|친해|친했|친한|친밀|짝사랑|연인|애인|연애|사랑|고백|질투|설레|공동|협공|동지|동맹|제압|통제|구출|원수|앙숙|악연|원한|적대|배신|화해|응징|신뢰|의지|재회|결별)$/;
const weakCue = /^(?:선배|후배|대학|학교|처음|언니|동생|마음|작가|배우|감독|작품|함께|기대|고마|감사|이제|달라)$/;

function positions(text: string, entity: ResearchEntity): number[] {
	return [...new Set(entity.aliases.flatMap(alias => Array.from(text.matchAll(namePattern(alias)), match => match.index! + match[1].length)))].sort((a, b) => a - b);
}

function relationFeatures(text: string, targets: ResearchEntity[], document: CorpusDocument): { score: number; facets: Facet[]; signals: Candidate['signals']; specific: Candidate['specific']; paired: boolean } {
	const names = targets.map(entity => positions(text, entity));
	const mentions = names.flatMap((items, entity) => items.map(at => ({ at, entity }))).sort((a, b) => a.at - b.at);
	let distance = Infinity, pairs = 0;
	for (let index = 1; index < mentions.length; index++) if (mentions[index].entity !== mentions[index - 1].entity) {
		const gap = mentions[index].at - mentions[index - 1].at;
		distance = Math.min(distance, gap); if (gap <= 300) pairs++;
	}
	const signals: Candidate['signals'] = {}, specific: Candidate['specific'] = {};
	for (const facet of Object.keys(facets) as Facet[]) for (const match of text.matchAll(facets[facet])) {
		const proximity = Math.max(...names.map((items, index) => document.id === targets[index].id ? 0 : Math.min(...items.map(at => Math.abs(at - match.index!)))));
		if (proximity > 350) continue;
		const weight = strongCue.test(match[0]) ? 4 : weakCue.test(match[0]) ? 1 : 2, strength = weight * (2 - proximity / 350);
		signals[facet] = Math.max(signals[facet] ?? 0, strength);
		if (weight === 4) specific[`${facet}:${match[0]}`] = Math.max(specific[`${facet}:${match[0]}`] ?? 0, strength);
	}
	const found = Object.keys(signals) as Facet[];
	return { facets: found, signals, specific, paired: names.filter(items => items.length).length >= 2 && (distance <= 160 || pairs > 0 && found.length > 0),
		score: Object.values(signals).reduce((sum, strength) => sum + strength, 0) * 4 + Math.min(8, pairs) * 3 + Math.max(0, 6 * (1 - distance / 1000)) };
}

function sourceRanges(text: string, targets: ResearchEntity[], document: CorpusDocument): Array<ResearchRange & ReturnType<typeof relationFeatures>> {
	const ranges: ResearchRange[] = [];
	for (const entity of targets) for (const at of positions(text, entity)) {
		let from = Math.max(0, at - 400), to = Math.min(text.length, at + entity.name.length + 1300);
		const start = text.lastIndexOf('\n', from), end = text.indexOf('\n', to);
		if (start >= 0 && from - start < 120) from = start + 1;
		if (end >= 0 && end - to < 120) to = end;
		if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from--;
		if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
		ranges.push({ from, to });
	}
	const profile = targets.some(entity => document.id === entity.id);
	const linked = targets.filter(entity => entity.path && document.characterPaths?.includes(entity.path)).length >= 2;
	if (!ranges.length && (profile || linked) && text.trim()) ranges.push({ from: 0, to: text.length });
	return [...new Map(ranges.map(range => [`${range.from}:${range.to}`, range])).values()].map(range => ({ ...range, ...relationFeatures(text.slice(range.from, range.to), targets, document) }));
}

function mergeRanges(ranges: ResearchRange[]): ResearchRange[] {
	const result: ResearchRange[] = [];
	for (const range of [...ranges].sort((a, b) => a.from - b.from || a.to - b.to)) {
		const last = result[result.length - 1];
		if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
		else result.push({ from: range.from, to: range.to });
	}
	return result;
}

/** Select relationship evidence by subject, facet and narrative change, never by a token ceiling. */
export async function collectRelationshipEvidence(documents: CorpusDocument[], targets: ResearchEntity[], budget = Infinity, signal?: AbortSignal, question = ''): Promise<{ sources: RagChunk[]; warnings: string[]; coverage: ChatResearchCoverage }> {
	const ordered = [...documents].sort((a, b) => (a.path ?? a.title).localeCompare(b.path ?? b.title, 'ko', { numeric: true }) || a.id.localeCompare(b.id));
	const candidates: Candidate[] = [], originals = new Map<string, { document: CorpusDocument; hash: string }>();
	for (const [order, document] of ordered.entries()) {
		checkChatAbort(signal);
		const text = await document.read(), hash = await ragHash(text), profile = targets.some(entity => entity.id === document.id);
		const linked = targets.filter(entity => entity.path && document.characterPaths?.includes(entity.path)).length >= 2;
		const ranges = sourceRanges(text, targets, document);
		const useful = ranges.filter(range => range.paired || linked || profile && (range.from === ranges[0]?.from || targets.some(entity => entity.id !== document.id && entity.aliases.some(alias => namePattern(alias).test(text.slice(range.from, range.to))))));
		if (useful.length) {
			originals.set(document.id, { document, hash });
			for (const { score, facets: found, signals, specific, paired, ...range } of useful) candidates.push({ document, hash, range, score, facets: found, signals, specific, profile, order });
		}
		await ragYield();
	}
	const selected = new Set<Candidate>();
	const byTime = (a: Candidate, b: Candidate) => a.order - b.order || a.range.from - b.range.from;
	const byScore = (a: Candidate, b: Candidate) => b.score - a.score || byTime(a, b);
	const body = candidates.filter(candidate => !candidate.profile);
	const exhaustive = /빠짐없이|전부|모든|회차별|전편|전체\s*(?:행적|사건|장면)/.test(question);
	if (exhaustive) for (const candidate of body) selected.add(candidate);
	else {
		// Keep the beginning/current state and each facet's strongest/first/latest evidence.
		// More genuinely distinct facets yield more evidence; no character/token cap is involved.
		if (body.length) { selected.add([...body].sort(byTime)[0]); selected.add([...body].sort(byTime).at(-1)!); }
		for (const facet of Object.keys(facets) as Facet[]) {
			const matches = body.filter(candidate => candidate.facets.includes(facet));
			if (!matches.length) continue;
			selected.add([...matches].sort((a, b) => (b.signals[facet] ?? 0) - (a.signals[facet] ?? 0) || byScore(a, b))[0]);
			selected.add([...matches].sort(byTime)[0]); selected.add([...matches].sort(byTime).at(-1)!);
		}
		for (const cue of new Set(body.flatMap(candidate => Object.keys(candidate.specific)))) {
			selected.add(body.filter(candidate => cue in candidate.specific).sort((a, b) => b.specific[cue] - a.specific[cue] || byScore(a, b))[0]);
		}
		if (!selected.size && body.length) selected.add([...body].sort(byScore)[0]);
	}
	for (const entity of targets) {
		const profile = candidates.filter(candidate => candidate.document.id === entity.id);
		if (profile.length) { selected.add([...profile].sort(byScore)[0]); selected.add([...profile].sort(byTime)[0]); }
	}
	// Merge every overlap after selection, so no repeated source characters are sent twice.
	const groups = new Map<string, Candidate[]>();
	for (const candidate of [...selected].sort(byScore)) { const group = groups.get(candidate.document.id) ?? []; group.push(candidate); groups.set(candidate.document.id, group); }
	const sources: RagChunk[] = []; let remaining = budget;
	for (const [id, group] of groups) {
		checkChatAbort(signal);
		const { document, hash } = originals.get(id)!, text = await document.read();
		if (await ragHash(text) !== hash) throw new Error('관계 조사 중 원문이 변경되었습니다. 최신 자료로 다시 조사해 주세요.');
		for (const range of mergeRanges(group.map(candidate => candidate.range))) {
			const excerpt = text.slice(range.from, range.to), source: RagChunk = { id: `${id}#relationship:${hash}:${range.from}:${range.to}`, group: id, title: document.title, path: document.path, kind: document.kind, ...range,
				text: excerpt, location: `${text.slice(0, range.from).split('\n').length}–${text.slice(0, range.to).split('\n').length}행`, contentHash: await ragHash(`${document.title}\n${excerpt}`), links: document.links, automatic: true };
			const cost = researchEvidenceText(source, sources.length).length + 4;
			if (cost > remaining) continue; // Only an explicit caller-supplied budget can take this branch.
			sources.push(source); remaining -= cost;
		}
		await ragYield();
	}
	const covered = (candidate: Candidate) => sources.some(source => source.group === candidate.document.id && source.from <= candidate.range.from && source.to >= candidate.range.to);
	const coverage: ChatResearchCoverage = { purpose: 'relationship', characters: targets.map(({ id, name }) => ({ id, name })), inspectedDocuments: documents.length,
		matchedDocuments: originals.size, matchedPassages: candidates.length, includedDocuments: new Set(sources.map(source => source.group)).size, includedPassages: sources.length, shortenedPassages: 0, partial: candidates.some(candidate => !covered(candidate)) };
	if (candidates.length && !sources.length) throw new Error('지정된 발췌 범위에 관계 근거를 담지 못했습니다.');
	const warnings = [`인물 관계 조사: ${targets.map(entity => entity.name).join(', ')} · 프로젝트 ${documents.length}개 자료 검사 · 공동 등장·관계 설정 후보 ${coverage.matchedDocuments}개 자료/${coverage.matchedPassages}구간에서 ${coverage.includedDocuments}개 자료/${sources.length}구간 제공. ${exhaustive ? '요청한 전체 범위의 명시적 공동 등장·연결 구간을 수집했습니다.' : '관계의 출발점·주요 관계 유형·최근 상태를 설명할 대표 근거를 선별했습니다. 모든 관계 사건을 전송한 것은 아닙니다.'} ${coverage.partial ? '후보 일부만 제공했습니다.' : '선정 범위의 겹치는 원문을 병합했습니다.'} 함께 등장하거나 플롯에 연결된 사실만으로 친밀도·갈등·공동 행동을 단정하지 마세요. 본문·인물 설정·플롯 계획을 구별하세요. 한 사람과 제삼자의 관계를 두 사람 사이의 관계로 바꾸지 마세요. 출발점·공동 사건·현재 관계를 근거가 있는 범위에서 종합하세요. 필요한 사건이나 관계의 원인이 비어 있으면 search_sources에 두 인물과 사건·상대 인물·관계 표현을 지정하고, read_source로 해당 장면 앞뒤를 더 읽으세요. 이미 받은 원문을 반복 검색하지 마세요. 대명사·간접 서술로만 이어지는 장면은 누락될 수 있습니다.`];
	checkChatAbort(signal); return { sources, warnings, coverage };
}
