import { wmT } from '../../i18n/index';
import type WritingMenuPlugin from '../../../main';
import { prepareSimpleSearch, TFile } from 'obsidian';
import type { WritingProject } from '../../types';
import { ChatCorpusProvider, type CorpusDocument } from './ChatCorpusProvider';
import { RagDatabase } from './RagDatabase';
import { ragHash, ragYield, type RagChunk, type RagRecord, type RagToolCall, type RagTools } from './RagTypes';
import { checkChatAbort } from '../ChatStream';
import { chatPassages, chatTerms } from '../AiChatRetrieval';
import type { ChatContextItem, ChatResearchCoverage, ChatEpisodeRangeCoverage } from '../AiChatTypes';
import { contextSourceText, researchEvidenceText } from '../AiChatPrompt';
import { namePattern, researchEntities, researchRanges, researchScopeText, resolveResearchEntities, explicitResearchNames, type ResearchCache, type ResearchRange } from './RagResearch';
import { relatedDocumentDistances } from './RagSourceGraph';
import { episodeManuscripts, episodeFileNumber, episodeInVolume, type EpisodeScope } from './RagEpisodes';
import { collectRelationshipEvidence, relationshipTargets } from './RagRelationships';

const vaultIds = new WeakMap<object, string>();
const lexical = (query: Map<string, number>, text: string) => { const words = chatTerms(text); let score = 0; for (const [word, weight] of query) if (words.has(word)) score += weight; return score; };
const queryFocus = (query: string) => query.replace(/[?？!.,]/g, ' ').split(/\s+/)
	.filter(word => word && !/^(어떻게|무엇|뭐|좀|대해|관해서|알려줘|설명해줘|되는가|돼|될까|않아도|해도|있어|있나|있을까|할까|수|왜)$/.test(word))
	.map(word => word.replace(/(?:하지|되면|하면|이라면|으로|에서|에게|은|는|이|가|을|를|의|에|와|과)$/, '')).filter(Boolean).join(' ');
function top<T extends { group: string; text: string }>(values: Array<{ score: number; value: T }>, value: T, score: number, limit = 30) {
	// Diversify before truncating candidates, not only after fusion. Otherwise
	// overlapping windows of one long note consume the whole nearest-neighbor
	// pool and other documents never reach the reranking stage at all.
	const duplicate = values.findIndex(item => item.value.group === value.group && item.value.text === value.text);
	if (duplicate >= 0) { if (values[duplicate].score >= score) return; values.splice(duplicate, 1); }
	values.push({ value, score }); values.sort((a, b) => b.score - a.score);
	let inGroup = 0;
	for (let index = 0; index < values.length; index++) if (values[index].value.group === value.group && ++inGroup > 3) { values.splice(index--, 1); }
	if (values.length > limit) values.length = limit;
}

/** Model-free project search with per-vault evidence and research caches. */
export class RagIndexService {
	readonly database = new RagDatabase();
	private scopeKeys = new Map<string, Promise<string>>();
	private temporary = new Map<string, RagRecord>();
	private revisions = new Map<string, number>();
	private researchMemory = new Map<string, ResearchCache>();
	constructor(private plugin: WritingMenuPlugin) {
		plugin.register?.(() => { this.temporary.clear(); this.researchMemory.clear(); this.scopeKeys.clear(); this.revisions.clear(); });
		if (plugin.app.vault.on) for (const event of ['modify', 'delete', 'rename', 'create'] as const) plugin.registerEvent(plugin.app.vault.on(event as 'modify', file => {
			if (!(file instanceof TFile)) return;
			const project = plugin.projectContext.getProjectForFile(file); if (!project) return;
			this.revisions.set(project.rootFolder, (this.revisions.get(project.rootFolder) ?? 0) + 1);
		}));
	}
	async scope(project: WritingProject): Promise<string> {
		let ready = this.scopeKeys.get(project.rootFolder);
		if (!ready) {
			const adapter = this.plugin.app.vault.adapter;
			let identity: string | undefined = adapter.getResourcePath?.(this.plugin.app.vault.configDir)?.replace(/[?#].*$/, '');
			if (!identity) { identity = vaultIds.get(adapter); if (!identity) { identity = crypto.randomUUID(); vaultIds.set(adapter, identity); } }
			ready = ragHash(`${identity}\n${project.rootFolder}\nobsidian-search:v1`); this.scopeKeys.set(project.rootFolder, ready);
		}
		return ready;
	}
	/** Clear derived project caches; conversation evidence and source notes are separate. */
	async clear(project: WritingProject): Promise<void> {
		const prefix = `${await this.scope(project)}\0`;
		await this.database.clearScope(prefix.slice(0, -1));
		for (const key of this.temporary.keys()) if (key.startsWith(prefix)) this.temporary.delete(key);
		for (const key of this.researchMemory.keys()) if (key.startsWith(prefix)) this.researchMemory.delete(key);
	}
	/** Default retrieval uses the public Obsidian string-search API over current vault documents. */
	async searchObsidian(project: WritingProject, query: string, signal?: AbortSignal, limit = 10, explicitQuery = query, strict = false): Promise<{ sources: RagChunk[]; warnings: string[] }> {
		checkChatAbort(signal);
		const revision = this.revisions.get(project.rootFolder) ?? 0, scope = await this.scope(project);
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal), warnings = [...corpus.warnings];
		if (strict && warnings.length) throw new Error(warnings.join('\n'));
		const matchers = [...chatTerms(queryFocus(query))].slice(0, 64).map(([term, weight]) => ({ weight, match: prepareSimpleSearch(term) }));
		const named = new Set(corpus.documents.filter(document => (document.names ?? [document.title]).some(name => name && namePattern(name).test(explicitQuery))).map(document => document.id));
		const candidates: Array<{ score: number; value: RagChunk }> = [];
		let inspected = 0, failures = 0;
		for (const document of corpus.documents) {
			checkChatAbort(signal);
			try {
				const text = await document.read(); let offset = 0, parts = 0;
				for (const part of chatPassages(text, { id: document.id, title: document.title, path: document.path, kind: document.kind, group: document.id, automatic: true })) {
					if (++parts % 8 === 0) { await ragYield(); checkChatAbort(signal); }
					const from = text.indexOf(part.text, offset); if (from < 0) throw new Error(wmT("{0}의 원문 위치를 확인하지 못했습니다.", document.title));
					offset = from + part.text.length;
					let score = named.has(document.id) ? 100 : 0;
					for (const matcher of matchers) {
						if (matcher.match(part.text)) score += matcher.weight;
						if (matcher.match(document.title)) score += matcher.weight * 3;
					}
					if (score > 0) top(candidates, { ...part, from, to: offset, links: document.links, contentHash: '' }, score, 60);
				}
				inspected++;
			} catch (error) { checkChatAbort(signal); if (strict) throw error; failures++; warnings.push(wmT("{0} 조회 실패", document.title)); }
			await ragYield();
		}
		const sources: RagChunk[] = [], texts = new Set<string>(), allowed = new Map(corpus.documents.map(document => [document.id, document]));
		for (const candidate of candidates) {
			checkChatAbort(signal); const source = candidate.value;
			if (texts.has(source.text)) continue;
			const current = await allowed.get(source.group)!.read();
			if (current.slice(source.from, source.to) !== source.text) { if (strict) throw new Error(wmT("검색 도중 원문이 변경되었습니다. 다시 질문해 주세요.")); continue; }
			const hash = await ragHash(`${source.title}\n${source.text}`), frozen = { ...source, id: `${source.id}#${hash}`, contentHash: hash };
			this.temporary.set(`${scope}\0${frozen.id}`, { key: `${scope}\0${frozen.id}`, scope, documentKey: `${scope}\0${source.group}`, source: frozen });
			sources.push(frozen); texts.add(source.text); if (sources.length >= limit) break;
		}
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		checkChatAbort(signal);
		if (strict && revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("검색 도중 프로젝트 자료가 변경되었습니다. 다시 질문해 주세요."));
		warnings.push(wmT("Obsidian API로 프로젝트 {0}/{1}개 자료를 키워드 검색했습니다.{2} 전송한 내용은 관련 발췌이며 모든 사건을 의미적으로 조사한 것은 아닙니다.", inspected, corpus.documents.length, failures ? wmT(" 읽지 못한 자료가 있습니다.") : ''));
		return { sources, warnings };
	}
	async search(project: WritingProject, query: string, signal?: AbortSignal, limit = 10, explicitQuery = query, requireComplete = false): Promise<{ sources: RagChunk[]; warnings: string[] }> {
		return this.searchObsidian(project, query, signal, limit, explicitQuery, requireComplete);
	}
	/** Resolve a numbered manuscript and provide the entire current text before the first model call. */
	async episode(project: WritingProject, number: number, budget: number, signal?: AbortSignal): Promise<{ sources: RagChunk[]; warnings: string[] }> {
		checkChatAbort(signal);
		const scope = await this.scope(project), revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		// A uniquely identified manuscript needs no embedding model or global index.
		// Its full current text is read and checked directly; do not claim a corpus-wide audit.
		const matches = episodeManuscripts(corpus.documents, project, number);
		if (!matches.length) throw new Error(wmT("{0}화에 해당하는 본문 파일을 찾지 못했습니다. 본문 폴더의 회차 파일명(예: 003화, 3화, 003. 제목)을 확인해 주세요.", number));
		if (matches.length > 1) throw new Error(wmT("{0}화로 해석되는 본문이 여러 개입니다. 파일을 지정해 주세요: {1}", number, matches.map(document => document.path).join(', ')));
		const document = matches[0], text = await document.read(); checkChatAbort(signal);
		if (!text.trim()) throw new Error(wmT("{0}화 본문이 비어 있어 내용을 확인하지 못했습니다.", number));
		const hash = await ragHash(`${document.title}\n${text}`);
		const source: RagChunk = { id: `${document.id}#episode:${hash}`, group: document.id, title: document.title, path: document.path, kind: 'reference', automatic: true,
			text, from: 0, to: text.length, location: `1–${text.split('\n').length}행 · ${number}화 본문 전체`, contentHash: hash, links: document.links };
		if (contextSourceText(source, true).length + 50 > budget) throw new Error(wmT("{0}화 본문 전체({1}자)가 현재 참고 문맥 범위를 넘습니다. 참고 문맥 한도를 늘려 주세요. 일부만 읽고 전체 회차를 요약하지 않았습니다.", number, text.length.toLocaleString()));
		// Keep exact evidence readable for optional follow-up tools and source inspection.
		this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${document.id}`, source });
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		if (await document.read() !== text || revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("회차 본문을 준비하는 중 원문이 변경되었습니다. 다시 질문해 주세요."));
		return { sources: [source], warnings: [...corpus.warnings, `${number}화 본문 전체를 직접 읽고 원문과 대조했습니다. 프로젝트 전체를 검색한 것은 아닙니다. 이 회차 내용은 제공된 본문을 우선해 답하세요. 다른 회차나 플롯의 계획을 이 회차에서 일어난 사건으로 섞지 마세요.`] };
	}
	/** Range identity is resolved before retrieval. Every requested episode gets evidence. */
	async episodeRange(project: WritingProject, requested: EpisodeScope, budget: number, signal?: AbortSignal): Promise<{ sources: RagChunk[]; warnings: string[]; coverage: ChatEpisodeRangeCoverage }> {
		checkChatAbort(signal);
		const scope = await this.scope(project), revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		const numbered = corpus.documents.filter(document => document.path && document.kind === 'reference'
			&& (!project.manuscriptFolder || document.path.startsWith(project.manuscriptFolder.replace(/\/$/, '') + '/'))
			&& (requested.volume === undefined || episodeInVolume(document, project, requested.volume)))
			.map(document => ({ document, number: episodeFileNumber(document.path!.split('/').pop()!.replace(/\.md$/i, '')) })).filter((item): item is { document: CorpusDocument; number: number } => item.number !== undefined);
		if (!numbered.length) throw new Error(wmT("요청한 권·회차 범위의 본문 파일을 찾지 못했습니다. 본문 폴더와 회차 파일명을 확인해 주세요."));
		const from = requested.from ?? Math.min(...numbered.map(item => item.number)), to = requested.to ?? Math.max(...numbered.map(item => item.number));
		if (from > to || to - from > 1000) throw new Error(wmT("요청한 회차 범위가 너무 큽니다. 범위를 나눠 주세요."));
		const documents: Array<{ document: CorpusDocument; number: number; text: string; start: number }> = [];
		for (let number = from; number <= to; number++) {
			checkChatAbort(signal); const matches = numbered.filter(item => item.number === number);
			if (matches.length !== 1) throw new Error(matches.length ? wmT("{0}화 본문이 여러 개라 범위를 확정하지 못했습니다.", number) : wmT("요청 범위에 {0}화 본문이 없습니다. 빠진 회차를 다른 자료로 대신하지 않았습니다.", number));
			const text = await matches[0].document.read(); if (!text.trim()) throw new Error(wmT("{0}화 본문이 비어 있습니다.", number));
			const start = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/.exec(text)?.[0].length ?? 0;
			if (!text.slice(start).trim()) throw new Error(wmT("{0}화에 속성을 제외한 본문 내용이 없습니다.", number));
			documents.push({ ...matches[0], text, start }); await ragYield();
		}
		const make = (item: typeof documents[number], begin: number, end: number): RagChunk => ({
			id: `${item.document.id}#range:${begin}:${end}`, group: item.document.id, path: item.document.path, title: item.document.title, kind: 'reference', automatic: true,
			text: item.text.slice(begin, end), from: begin, to: end, location: `${item.number}화 · ${item.text.slice(0, begin).split('\n').length}–${item.text.slice(0, end).split('\n').length}행`, contentHash: '', links: item.document.links,
		});
		const cost = (source: RagChunk, index: number) => researchEvidenceText(source, index).length + 8;
		const full = documents.map(item => make(item, item.start, item.text.length)), complete = full.reduce((sum, source, index) => sum + cost(source, index), 0) <= budget;
		const sources: RagChunk[] = []; let remaining = budget;
		for (const [index, item] of documents.entries()) {
			checkChatAbort(signal);
			const allowance = Math.floor(remaining / (documents.length - index));
			if (complete || cost(full[index], sources.length) <= allowance) { sources.push(full[index]); remaining -= cost(full[index], sources.length - 1); }
			else {
				const parts = allowance >= 700 ? 3 : 2;
				const width = Math.floor(allowance / parts) - cost(make(item, item.start, item.start), sources.length + parts) - 12;
				if (width < 64) throw new Error(wmT("{0}~{1}화 모든 회차의 근거를 담기에는 참고 문맥 한도가 작습니다. 한도를 늘리거나 범위를 나눠 주세요.", from, to));
				let previousEnd = item.start;
				for (let part = 0; part < parts; part++) {
					let begin = Math.max(previousEnd, item.start + Math.floor((item.text.length - item.start - width) * part / (parts - 1)));
					if (begin >= item.text.length) break;
					let end = Math.min(item.text.length, begin + width);
					if (begin > 0 && /[\uDC00-\uDFFF]/.test(item.text[begin])) begin++;
					if (end < item.text.length && /[\uD800-\uDBFF]/.test(item.text[end - 1])) end--;
					const source = make(item, begin, end); sources.push(source); remaining -= cost(source, sources.length - 1); previousEnd = end;
				}
			}
			if (await item.document.read() !== item.text) throw new Error(wmT("범위 요약을 준비하는 중 본문이 변경되었습니다. 다시 질문해 주세요."));
			await ragYield();
		}
		if (remaining < 0 || revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("회차 범위의 근거를 정해진 문맥 안에서 준비하지 못했습니다. 다시 질문해 주세요."));
		for (const source of sources) {
			source.contentHash = await ragHash(`${source.title}\n${source.text}`); source.id += `#${source.contentHash}`;
			this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${source.group}`, source });
		}
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		const coverage: ChatEpisodeRangeCoverage = { from, to, ...(requested.volume !== undefined ? { volume: requested.volume } : {}), inspectedEpisodes: documents.length,
			includedEpisodes: new Set(sources.map(source => source.group)).size, sourceCharacters: documents.reduce((sum, item) => sum + item.text.length - item.start, 0), includedCharacters: sources.reduce((sum, source) => sum + source.text.length, 0), partial: !complete };
		return { sources, coverage, warnings: [`회차 범위 조사: ${requested.volume !== undefined ? `${requested.volume}권 · ` : ''}${from}~${to}화 본문 ${coverage.inspectedEpisodes}개를 직접 조회하고 모든 회차의 근거를 제공했습니다. ${complete ? '해당 범위의 본문 전체를 전송했습니다.' : '현재 문맥 한도에 맞춰 각 회차의 앞·중간·뒤에서 원문을 발췌했습니다. 답변을 발췌 기반 개요로 표시하고, 전체 본문을 전달받았거나 모든 사건을 빠짐없이 요약했다고 말하지 마세요.'} 이전 질문의 인물이나 범위 밖 회차로 대신 답하지 마세요.`] };
	}
	/** Enumerate all explicit appearances before budget selection; no top-K cutoff or remote preprocessing. */
	async relationship(project: WritingProject, question: string, budget: number, signal?: AbortSignal, previous = ''): Promise<{ sources: RagChunk[]; warnings: string[]; coverage: ChatResearchCoverage } | undefined> {
		checkChatAbort(signal);
		const revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		if (corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
		const targets = relationshipTargets(researchEntities(corpus.documents), question, previous);
		if (!targets.length) return;
		const result = await collectRelationshipEvidence(corpus.documents, targets, budget, signal, question);
		if (revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("관계 조사 중 프로젝트가 변경되었습니다. 최신 자료로 다시 조사해 주세요."));
		const scope = await this.scope(project);
		for (const source of result.sources) this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${source.group}`, source });
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		return result;
	}
	async research(project: WritingProject, question: string, budget: number, signal?: AbortSignal, fallbackQuestion = '', preferredPath?: string): Promise<{ sources: RagChunk[]; warnings: string[]; coverage: ChatResearchCoverage }> {
		checkChatAbort(signal);
		const scope = await this.scope(project), revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		if (corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
		const entities = researchEntities(corpus.documents);
		let targets = resolveResearchEntities(entities, question);
		const literalNames = !targets.length ? explicitResearchNames(question) : [];
		if (literalNames.length) targets = literalNames.map(name => ({ id: `literal:${encodeURIComponent(name)}`, name, path: '', aliases: [name] }));
		if (!targets.length && preferredPath) targets = entities.filter(entity => entity.path === preferredPath);
		if (!targets.length) targets = resolveResearchEntities(entities, fallbackQuestion);
		if (!targets.length) throw new Error(wmT("행적을 조사할 인물의 이름이나 고유한 별칭을 질문에 지정해 주세요."));
		const targetIds = targets.map(entity => entity.id).sort(), signature = JSON.stringify(targets.map(entity => [entity.id, entity.aliases]));
		const groups: Array<{ document: CorpusDocument; hash: string; ranges: ResearchRange[] }> = [];
		for (const document of corpus.documents) {
			checkChatAbort(signal);
			const text = await document.read(), documentKey = `${scope}\0${document.id}`;
			const linked = targets.some(entity => document.id === entity.id || document.characterPaths?.includes(entity.path));
			const hash = await ragHash(`research:v1\n${signature}\n${document.title}\n${document.kind}\n${linked}\n${text}`);
			const key = `${documentKey}\0${targetIds.join('\0')}`;
			const cached = this.researchMemory.get(key);
			const valid = cached?.hash === hash && Array.isArray(cached.ranges) && cached.ranges.every(range => Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && range.from >= 0 && range.to > range.from && range.to <= text.length);
			const ranges = valid ? cached.ranges : researchRanges(text, targets, linked);
			const entry = { key, scope, documentKey, hash, ranges } satisfies ResearchCache;
			this.researchMemory.set(key, entry);
			while (this.researchMemory.size > 4000) this.researchMemory.delete(this.researchMemory.keys().next().value!);
			if (ranges.length) groups.push({ document, hash, ranges });
			await ragYield();
		}
		if (literalNames.length && !groups.length) throw new Error(wmT("프로젝트 본문·인물·설정·플롯에서 '{0}'의 명시적 등장 구간을 찾지 못했습니다. 이름의 표기를 확인해 주세요.", literalNames.join(', ')));
		const fullyOrdered = groups.filter(group => group.document.kind !== 'character').every(group => group.document.sequence !== undefined);
		groups.sort((a, b) => Number(targetIds.includes(b.document.id)) - Number(targetIds.includes(a.document.id))
			|| (fullyOrdered ? (a.document.sequence ?? 0) - (b.document.sequence ?? 0) : 0)
			|| (a.document.path ?? a.document.title).localeCompare(b.document.path ?? b.document.title, 'ko', { numeric: true })
			|| a.document.id.localeCompare(b.document.id));
		const coverage: ChatResearchCoverage = { characters: targets.map(entity => ({ id: entity.id, name: entity.name })), inspectedDocuments: corpus.documents.length,
			matchedDocuments: groups.length, matchedPassages: groups.reduce((sum, group) => sum + group.ranges.length, 0), includedDocuments: 0, includedPassages: 0, shortenedPassages: 0, partial: false };
		const sources: RagChunk[] = [];
		let remaining = Math.max(0, budget);
		const minimumCost = groups.reduce((cost, group) => Math.max(cost, researchEvidenceText({ id: '', title: group.document.title, text: ' '.repeat(32), kind: group.document.kind, location: '99999–99999행' }, groups.length).length + 4), 1);
		const capacity = Math.min(groups.length, Math.max(1, Math.floor(remaining / minimumCost)));
		const chosen = capacity >= groups.length ? groups : Array.from({ length: capacity }, (_, index) => groups[capacity === 1 ? 0 : Math.round(index * (groups.length - 1) / (capacity - 1))]);
		for (let index = 0; index < chosen.length; index++) {
			checkChatAbort(signal);
			const { document, hash, ranges } = chosen[index], text = await document.read();
			const linked = targets.some(entity => document.id === entity.id || document.characterPaths?.includes(entity.path));
			if (hash !== await ragHash(`research:v1\n${signature}\n${document.title}\n${document.kind}\n${linked}\n${text}`)) throw new Error(wmT("행적 조사 중 원문이 변경되었습니다. 최신 자료로 다시 조사해 주세요."));
			let allowance = Math.floor(remaining / (chosen.length - index)), included = 0;
			for (const range of ranges) {
				let from = range.from, to = range.to;
				const make = (): RagChunk => ({ id: `${document.id}#research:${hash}:${from}:${to}`, group: document.id, title: document.title, path: document.path, kind: document.kind,
					from, to, text: text.slice(from, to), location: `${text.slice(0, from).split('\n').length}–${text.slice(0, to).split('\n').length}행`, contentHash: '', links: document.links, automatic: true });
				let source = make(), cost = researchEvidenceText(source, sources.length).length + 4;
				if (cost > allowance) {
					const available = allowance - researchEvidenceText({ ...source, text: '' }, sources.length).length - 4;
					if (available < 32) break;
					let mention = Infinity;
					for (const entity of targets) for (const alias of entity.aliases) { const match = namePattern(alias).exec(source.text); if (match) mention = Math.min(mention, match.index + match[1].length); }
					if (Number.isFinite(mention)) from += Math.max(0, mention - 12);
					to = Math.min(range.to, from + available);
					if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from--;
					if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
					source = make(); cost = researchEvidenceText(source, sources.length).length + 4;
					if (cost > allowance) break;
					coverage.shortenedPassages++;
				}
				source.contentHash = await ragHash(`${source.title}\n${source.text}`);
				sources.push(source); allowance -= cost; remaining -= cost; included++;
				this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${document.id}`, source });
			}
			if (included) coverage.includedDocuments++;
			await ragYield();
		}
		coverage.includedPassages = sources.length; coverage.partial = sources.length < coverage.matchedPassages || coverage.shortenedPassages > 0;
		if (revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("행적 조사 중 프로젝트가 변경되었습니다. 최신 자료로 다시 조사해 주세요."));
		if (groups.length && !sources.length) throw new Error(wmT("인물 행적 근거를 담을 문맥이 부족합니다. 참고 문맥 한도를 늘려 주세요."));
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		return { sources, coverage, warnings: [researchScopeText(coverage)] };
	}
	/** Read a little before and after a hit; returned evidence remains one exact source range. */
	async expand(project: WritingProject, sources: RagChunk[], budget: number, signal?: AbortSignal): Promise<RagChunk[]> {
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		if (corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
		const scope = await this.scope(project), result: RagChunk[] = [];
		let available = budget - sources.reduce((sum, source) => sum + source.text.length + source.id.length + source.title.length + (source.path?.length ?? 0) + (source.location?.length ?? 0) + 100, 0);
		for (const source of sources) {
			checkChatAbort(signal);
			const document = corpus.documents.find(item => item.id === source.group); if (!document) throw new Error(wmT("검색한 자료가 현재 프로젝트에 없습니다."));
			const text = await document.read(); if (text.slice(source.from, source.to) !== source.text) throw new Error(wmT("검색한 원문이 변경되었습니다. 다시 검색해 주세요."));
			const extra = Math.max(0, Math.min(420, available - 100));
			if (extra < 40) { result.push(source); continue; }
			let from = Math.max(0, source.from - Math.floor(extra * 0.4)), to = Math.min(text.length, source.to + Math.floor(extra * 0.6));
			if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from--;
			if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
			const part = text.slice(from, to), expanded: RagChunk = { ...source, id: `${source.id}:scene:${from}:${to}`, from, to, text: part,
				location: `${text.slice(0, from).split('\n').length}–${text.slice(0, to).split('\n').length}행`, contentHash: await ragHash(`${source.title}\n${part}`) };
			available -= part.length - source.text.length + 100; result.push(expanded);
			this.temporary.set(`${scope}\0${expanded.id}`, { key: `${scope}\0${expanded.id}`, scope, documentKey: `${scope}\0${source.group}`, source: expanded });
		}
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		return result;
	}
	tools(project: WritingProject, strict = false): RagTools {
		const evidence = new Map<string, ChatContextItem>();
		return { strict, searchModes: ['keyword'], useSources: sources => { evidence.clear(); for (const source of sources) evidence.set(source.id, source); }, execute: async (call: RagToolCall, signal) => {
			checkChatAbort(signal);
			if (call.name === 'list_sources') {
				const offset = call.args.offset ?? 0, kind = call.args.kind;
				if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || (kind !== undefined && (typeof kind !== 'string' || !['character', 'plot', 'reference'].includes(kind)))) throw new Error(wmT("목록 범위가 올바르지 않습니다."));
				const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
				if (strict && corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
				const documents = corpus.documents.filter(document => !kind || document.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
				const start = Number(offset), page = documents.slice(start, start + 30);
				return { sources: [{ id: `catalog:${project.rootFolder}:${kind ?? 'all'}:${start}`, title: '프로젝트 자료 목록', kind: 'reference', automatic: true,
					text: `전체 ${documents.length}개 중 ${start + 1}–${start + page.length}\n${page.map(document => `[source_id:${document.id}] ${document.title} · ${document.path ?? document.id}`).join('\n')}` }],
					warnings: [...corpus.warnings, ...(start + page.length < documents.length ? [`목록이 더 있습니다. list_sources next_offset: ${start + page.length}`] : [])] };
			}
			if (call.name === 'search_sources') {
				if (typeof call.args.query !== 'string' || !call.args.query.trim() || call.args.query.length > 2000) throw new Error(wmT("검색어가 올바르지 않습니다."));
				const mode = call.args.mode ?? 'keyword'; if (typeof mode !== 'string' || !['hybrid', 'keyword', 'semantic'].includes(mode)) throw new Error(wmT("검색 방식이 올바르지 않습니다."));
				const result = await this.searchObsidian(project, call.args.query, signal, 8, call.args.query, strict);
				if (mode !== 'keyword') result.warnings.push(wmT("현재 기본 검색 도구는 Obsidian 키워드 검색을 사용했습니다. 의미 검색을 수행한 것으로 답하지 마세요."));
				return result;
			}
			if (!['read_source', 'related_sources'].includes(call.name) || typeof call.args.source_id !== 'string') throw new Error(wmT("허용되지 않은 자료 조회 요청입니다."));
			const scope = await this.scope(project), key = `${scope}\0${call.args.source_id}`;
			let record = this.temporary.get(key);
			const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
			if (strict && corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
			if (!record) {
				const frozen = evidence.get(call.args.source_id);
				const origin = frozen && corpus.documents.find(item => frozen.id.startsWith(`${item.id}#`) || frozen.id === item.id);
				if (frozen && origin && frozen.from !== undefined && frozen.to !== undefined && origin.path === frozen.path) {
					record = { key, scope, documentKey: `${scope}\0${origin.id}`, source: { ...frozen, from: frozen.from, to: frozen.to, group: origin.id, contentHash: frozen.contentHash ?? '', links: origin.links } };
				}
			}
			if (!record) {
				const listed = corpus.documents.find(item => item.id === call.args.source_id);
				if (listed) {
					const text = (await listed.read()).slice(0, 6000);
					record = { key, scope, documentKey: `${scope}\0${listed.id}`, source: { id: listed.id, title: listed.title, path: listed.path, kind: listed.kind, group: listed.id, text, from: 0, to: text.length, links: listed.links, contentHash: await ragHash(`${listed.title}\n${text}`), automatic: true } };
				}
			}
			if (!record || record.scope !== scope) throw new Error(wmT("현재 프로젝트에서 찾은 자료 ID만 읽을 수 있습니다."));
			const document = corpus.documents.find(item => item.id === record.source.group);
			if (!document) throw new Error(wmT("삭제되었거나 검색 범위 밖으로 이동한 자료입니다."));
			if (call.name === 'read_source') {
				const offset = call.args.offset ?? 0, before = call.args.before ?? 0;
				if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(before) || Number(before) < 0 || Number(before) > 2000) throw new Error(wmT("원문 위치가 올바르지 않습니다."));
				const text = await document.read(); let from = Math.min(text.length, Math.max(0, record.source.from + Number(offset) - Number(before))), to = Math.min(text.length, from + 6000);
				if (text.slice(record.source.from, record.source.to) !== record.source.text) throw new Error(wmT("조회한 원문이 변경되었습니다. 다시 검색한 자료 ID로 읽어 주세요."));
				if (from > 0 && /[\uDC00-\uDFFF]/.test(text[from])) from--;
				to = Math.min(text.length, from + 6000);
				if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to--;
				const part = text.slice(from, to);
				const location = `${text.slice(0, from).split('\n').length}–${text.slice(0, to).split('\n').length}행`;
				const source = { ...record.source, id: `${record.source.id}:read:${from}`, text: part, from, to, location, contentHash: await ragHash(`${document.title}\n${part}`) };
				this.temporary.set(`${scope}\0${source.id}`, { ...record, key: `${scope}\0${source.id}`, source });
				while (this.temporary.size > 200) this.temporary.delete(this.temporary.keys().next().value!);
				return { sources: [source], warnings: [...corpus.warnings, ...(to < text.length ? [`원문에 뒤 내용이 더 있습니다. 반환된 source_id의 다음 offset: ${to - from}`] : [])] };
			}
			const hops = call.args.hops ?? 1, query = call.args.query ?? '';
			if (!Number.isSafeInteger(hops) || Number(hops) < 1 || Number(hops) > 2 || typeof query !== 'string' || query.length > 2000) throw new Error(wmT("관련 자료 탐색 범위가 올바르지 않습니다."));
			const revision = this.revisions.get(project.rootFolder) ?? 0;
			const current = await document.read(); if (current.slice(record.source.from, record.source.to) !== record.source.text) throw new Error(wmT("조회한 원문이 변경되었습니다. 다시 검색한 자료 ID로 조회해 주세요."));
			const graph = relatedDocumentDistances(corpus.documents, document.id, Number(hops), query);
			const words = new Map([...chatTerms(query)].slice(0, 64));
			const candidates: Array<{ source: RagChunk; score: number; distance: number }> = [], warnings = [...corpus.warnings];
			for (const target of corpus.documents) {
				const distance = graph.distances.get(target.id); if (distance === undefined) continue;
				let best: typeof candidates[number] | undefined, offset = 0, processed = 0;
				const targetText = await target.read();
				for (const part of chatPassages(targetText, { id: target.id, title: target.title, path: target.path, kind: target.kind, group: target.id, automatic: true })) {
					checkChatAbort(signal); if (++processed % 8 === 0) await ragYield();
					const from = targetText.indexOf(part.text, offset); if (from < 0) throw new Error(wmT("연결된 원문 구간을 확인하지 못했습니다.")); offset = from + part.text.length;
					const source: RagChunk = { ...part, from, to: offset, links: target.links, contentHash: '' };
					if (source.text === record.source.text) continue;
						const score = words.size ? lexical(words, `${source.title}\n${source.location ?? ''}\n${source.text}`) : 0;
						const candidate = { source, score, distance };
						// Keep only one chunk per document, selected by the actual question.
						if (!best || score > best.score || score === best.score && (target.id === document.id
							? Math.abs(source.from - record.source.to) < Math.abs(best.source.from - record.source.to)
							: source.from < best.source.from)) best = candidate;
				}
				if (best) candidates.push(best);
			}
			candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || a.source.group.localeCompare(b.source.group));
			const related: ChatContextItem[] = [], allowed = new Map(corpus.documents.map(item => [item.id, item]));
			for (const candidate of candidates) {
				checkChatAbort(signal); const target = allowed.get(candidate.source.group)!;
				try { const text = await target.read(); if (text.slice(candidate.source.from, candidate.source.to) !== candidate.source.text) throw new Error(wmT("{0}의 관련 구간이 변경되어 다시 검색해야 합니다.", target.title)); }
				catch (error) { checkChatAbort(signal); if (strict) throw error; warnings.push(wmT("{0}의 관련 구간을 확인하지 못해 제외했습니다.", target.title)); continue; }
				const hash = await ragHash(`${candidate.source.title}\n${candidate.source.text}`), source = { ...candidate.source, id: `${candidate.source.id}#${hash}`, contentHash: hash };
				this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${source.group}`, source });
				related.push(source); if (related.length >= 8) break;
			}
			if (graph.truncated) warnings.push(wmT("연결 자료가 많아 질문과 문서명을 기준으로 최대 96개 자료까지 탐색했습니다. 모든 연결을 조사한 것은 아닙니다."));
			while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
			if (candidates.length > related.length) warnings.push(wmT("관련 자료 {0}개 중 {1}개 구간만 반환했습니다. 전체 행적 조사가 아닙니다.", candidates.length, related.length));
			if (strict && revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error(wmT("연결 탐색 중 프로젝트 자료가 변경되었습니다. 다시 조회해 주세요."));
			return { sources: related, warnings };
		} };
	}
}
const services = new WeakMap<WritingMenuPlugin, RagIndexService>();
export function ragIndex(plugin: WritingMenuPlugin): RagIndexService { let service = services.get(plugin); if (!service) { service = new RagIndexService(plugin); services.set(plugin, service); } return service; }
