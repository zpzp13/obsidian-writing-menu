import type WritingMenuPlugin from '../../../main';
import { prepareSimpleSearch } from 'obsidian';
import type { WritingProject } from '../../types';
import { ChatCorpusProvider, type CorpusDocument } from './ChatCorpusProvider';
import { RagDatabase } from './RagDatabase';
import { RagWorkerClient } from './RagWorkerClient';
import { RAG_MODEL_KEY, ragHash, ragYield, type RagChunk, type RagDocument, type RagIndexStatus, type RagRecord, type RagToolCall, type RagTools, type RagSearchMode } from './RagTypes';
import { checkChatAbort, abortableChat } from '../ChatStream';
import { chatPassages, chatTerms } from '../AiChatRetrieval';
import type { ChatContextItem, ChatResearchCoverage, ChatEpisodeRangeCoverage } from '../AiChatTypes';
import { contextSourceText, researchEvidenceText } from '../AiChatPrompt';
import { ragBm25, ragLexicalTerms } from './RagLexical';
import { namePattern, researchEntities, researchRanges, researchScopeText, resolveResearchEntities, explicitResearchNames, type ResearchCache, type ResearchRange } from './RagResearch';
import { relatedDocumentDistances } from './RagSourceGraph';
import { episodeManuscripts, episodeFileNumber, episodeInVolume, type EpisodeScope } from './RagEpisodes';
import { collectRelationshipEvidence, relationshipTargets } from './RagRelationships';

interface ProjectState { status: RagIndexStatus; controller?: AbortController; task?: Promise<void>; warnings: string[]; documents: Map<string, CorpusDocument> }
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

/** One worker per plugin, independently scoped persistent indices per vault/project. */
export class RagIndexService {
	readonly database = new RagDatabase();
	private legacyWorker?: RagWorkerClient;
	/** Retained for explicit legacy index maintenance; normal chat never creates it. */
	get worker(): RagWorkerClient { return this.legacyWorker ??= new RagWorkerClient(this.plugin, this.database); }
	private states = new Map<string, ProjectState>();
	private listeners = new Set<() => void>();
	private scopeKeys = new Map<string, Promise<string>>();
	private timers = new Map<string, number>();
	private temporary = new Map<string, RagRecord>();
	private revisions = new Map<string, number>();
	private researchMemory = new Map<string, ResearchCache>();
	private installation?: Promise<void>;
	constructor(private plugin: WritingMenuPlugin) {
		plugin.register?.(() => { for (const state of this.states.values()) state.controller?.abort(); for (const timer of this.timers.values()) window.clearTimeout(timer); this.legacyWorker?.dispose(); this.listeners.clear(); });
		if (plugin.app.vault.on) for (const event of ['modify', 'delete', 'rename', 'create'] as const) plugin.registerEvent(plugin.app.vault.on(event as 'modify', file => {
			const project = plugin.projectContext.getProjectForFile(file as any); if (!project) return;
			this.revisions.set(project.rootFolder, (this.revisions.get(project.rootFolder) ?? 0) + 1);
		}));
	}
	private state(project: WritingProject): ProjectState {
		let state = this.states.get(project.rootFolder);
		if (!state) { state = { status: { state: 'idle', completed: 0, total: 0, chunks: 0 }, warnings: [], documents: new Map() }; this.states.set(project.rootFolder, state); }
		return state;
	}
	status(project: WritingProject): RagIndexStatus { return { ...this.state(project).status }; }
	get installing(): boolean { return Boolean(this.installation); }
	onChange(callback: () => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
	private emit(): void { for (const callback of this.listeners) callback(); }
	async scope(project: WritingProject): Promise<string> {
		let ready = this.scopeKeys.get(project.rootFolder);
		if (!ready) {
			const adapter = this.plugin.app.vault.adapter;
			let identity: string | undefined = adapter.getResourcePath?.(this.plugin.app.vault.configDir ?? '.obsidian')?.replace(/[?#].*$/, '');
			if (!identity) { identity = vaultIds.get(adapter); if (!identity) { identity = crypto.randomUUID(); vaultIds.set(adapter, identity); } }
			ready = ragHash(`${identity}\n${project.rootFolder}\n${RAG_MODEL_KEY}`); this.scopeKeys.set(project.rootFolder, ready);
		}
		return ready;
	}
	async install(project: WritingProject): Promise<void> {
		if (this.installation) return this.installation;
		const state = this.state(project); state.status.state = 'installing'; state.status.message = '저장된 파일과 실행 환경 확인 중…';
		this.installation = (async () => {
			try { await this.worker.prepare(true, message => { state.status.message = message; this.emit(); }); state.status.state = 'idle'; state.status.message = '의미 검색 모델 준비 완료. 기본 검색은 모델 없이도 사용할 수 있습니다.'; this.emit(); }
			catch (error) { if (this.status(project).state !== 'paused') { state.status.state = 'error'; state.status.message = error instanceof Error ? error.message : String(error); } this.emit(); throw error; }
		})().finally(() => { this.installation = undefined; this.emit(); });
		this.emit(); return this.installation;
	}
	cancelInstall(): void {
		for (const state of this.states.values()) if (state.status.state === 'installing') { state.status.state = 'paused'; state.status.message = '모델 설치를 중단했습니다. 완료된 다운로드 파일은 재사용하며 기본 검색은 계속 사용할 수 있습니다.'; }
		this.worker.dispose(new DOMException('모델 설치를 중단했습니다.', 'AbortError')); this.emit();
	}
	pause(project: WritingProject): void { const state = this.state(project); state.controller?.abort(); if (state.status.state === 'installing') this.worker.dispose(new DOMException('모델 다운로드를 중단했습니다.', 'AbortError')); state.status.state = 'paused'; state.status.message = '완료한 구간은 저장되어 있습니다.'; this.emit(); }
	async clear(project: WritingProject): Promise<void> { const state = this.state(project); this.pause(project); await state.task?.catch(() => {}); await this.database.clearScope(await this.scope(project)); state.status = { state: 'idle', completed: 0, total: 0, chunks: 0 }; state.documents.clear(); this.emit(); }
	async refresh(project: WritingProject): Promise<void> {
		const state = this.state(project); if (state.task) return state.task;
		state.controller = new AbortController(); const signal = state.controller.signal;
		state.task = this.index(project, signal).catch(error => {
			state.status.state = signal.aborted ? 'paused' : 'error'; state.status.message = error instanceof Error ? error.message : String(error); this.emit();
			if (!signal.aborted) throw error;
		}).finally(() => { state.task = undefined; });
		return state.task;
	}
	/** Complete the real device-local index, then audit every current document and
	 * every stored range/vector. No lexical downgrade is allowed on this path. */
	async ensureComplete(project: WritingProject, signal?: AbortSignal): Promise<void> {
		checkChatAbort(signal);
		if (this.status(project).state === 'paused') throw new Error('프로젝트 색인이 일시정지되어 있습니다. AI 챗 설정에서 갱신 / 이어서를 실행해 주세요. 부분 자료로 답변하지 않았습니다.');
		if (!await this.worker.installed()) throw new Error('전체 검색에 필요한 로컬 모델을 먼저 설치해 주세요. AI 챗 설정 → 로컬 검색 모델 → 모델 설치 후 색인을 자동으로 준비합니다. 부분 검색으로 답변하지 않았습니다.');
		const scope = await this.scope(project);
		for (let attempt = 0; attempt < 2; attempt++) {
			await abortableChat(this.refresh(project), signal); checkChatAbort(signal);
			const state = this.state(project);
			if (state.status.state === 'paused') throw new Error('색인 준비가 중단되어 답변을 시작하지 않았습니다. 완료한 색인은 보존됩니다.');
			if (state.status.state !== 'ready') {
				if (!attempt) continue;
				throw new Error(`프로젝트 전체 색인을 완료하지 못해 답변을 시작하지 않았습니다. ${state.status.message ?? ''}`);
			}
			const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
			const revision = this.revisions.get(project.rootFolder) ?? 0;
			if (corpus.warnings.length) throw new Error(`프로젝트 자료를 모두 읽지 못해 답변을 시작하지 않았습니다. ${corpus.warnings.join('\n')}`);
			const repair = new Set<string>();
			for (const document of corpus.documents) {
				checkChatAbort(signal);
				const key = `${scope}\0${document.id}`, checkpoint = await this.database.get<RagDocument>('documents', key);
				const text = await document.read();
				if (!checkpoint || checkpoint.hash !== await ragHash(`${document.title}\n${text}`)) { repair.add(key); continue; }
				let after: string | undefined, count = 0;
				const ranges: Array<[number, number]> = [];
				while (true) {
					const page = await this.database.page<RagRecord>('records', 'documentKey', key, after);
					if (!page.length) break;
					for (const record of page) {
						const source = record.source; count++; ranges.push([source.from, source.to]);
						if (record.scope !== scope || source.group !== document.id || source.path !== document.path
							|| !record.vector || record.vector.length !== 384 || !record.vector.every(Number.isFinite)
							|| !Number.isSafeInteger(source.from) || !Number.isSafeInteger(source.to) || source.from < 0 || source.to < source.from
							|| text.slice(source.from, source.to) !== source.text) repair.add(key);
					}
					after = page[page.length - 1].key; await ragYield(); checkChatAbort(signal);
				}
				let covered = 0;
				for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) { if (from > covered && text.slice(covered, from).trim()) repair.add(key); covered = Math.max(covered, to); }
				if (text.slice(covered).trim() || count !== checkpoint.chunks) repair.add(key);
				await ragYield();
			}
			if (!repair.size && revision === (this.revisions.get(project.rootFolder) ?? 0)) return;
			if (attempt) throw new Error('변경되었거나 누락된 색인 구간이 남아 있어 답변을 시작하지 않았습니다. 원고 저장 후 다시 시도해 주세요.');
			// These are reproducible device-local index records, never user notes.
			for (const key of repair) await this.database.removeDocument(key);
		}
	}
	private async index(project: WritingProject, signal: AbortSignal): Promise<void> {
		const state = this.state(project), scope = await this.scope(project);
		await this.worker.prepare(); checkChatAbort(signal);
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		state.documents = new Map(corpus.documents.map(document => [document.id, document])); state.warnings = corpus.warnings;
		state.status = { state: 'indexing', completed: 0, total: corpus.documents.length, chunks: 0 }; this.emit();
		const generation = crypto.randomUUID();
		let failed = 0;
		for (const document of corpus.documents) {
			checkChatAbort(signal);
			const key = `${scope}\0${document.id}`, previous = await this.database.get<RagDocument>('documents', key);
			try {
				if (document.stamp && previous?.stamp === document.stamp) {
					await this.database.put('documents', { ...previous, generation }); state.status.chunks += previous.chunks;
				} else {
					const text = await document.read(), hash = await ragHash(`${document.title}\n${text}`);
					if (previous?.hash === hash) { await this.database.put('documents', { ...previous, generation, stamp: document.stamp }); state.status.chunks += previous.chunks; }
					else {
						const chunks = await this.worker.chunks(text, document.title, signal), keep = new Set<string>(), duplicates = new Map<string, number>();
						for (const chunk of chunks) {
							checkChatAbort(signal);
							const contentHash = await ragHash(`${document.title}\n${chunk.text}`), occurrence = duplicates.get(contentHash) ?? 0; duplicates.set(contentHash, occurrence + 1);
							const id = `${document.id}#${contentHash}:${occurrence}`, recordKey = `${scope}\0${id}`; keep.add(recordKey);
							const old = await this.database.get<RagRecord>('records', recordKey);
							const vector = old?.vector ?? await this.worker.embed(`${document.title.slice(0, 160)}\n${chunk.text}`, false, signal);
							checkChatAbort(signal);
							const source: RagChunk = { id, title: document.title, text: chunk.text, path: document.path, kind: document.kind, location: chunk.location, automatic: true, group: document.id, from: chunk.from, to: chunk.to, contentHash, links: document.links };
							const terms = ragLexicalTerms(`${source.title}\n${source.location ?? ''}\n${source.text}`);
							await this.database.put('records', { key: recordKey, scope, documentKey: key, source, vector, lexical: terms, termKeys: terms.counts.map(([term]) => `${scope}\0${term}`) } satisfies RagRecord); state.status.chunks++; this.emit(); await ragYield();
							checkChatAbort(signal);
						}
						await this.database.pruneDocument(key, keep);
						await this.database.put('documents', { key, scope, id: document.id, hash, chunks: chunks.length, generation, stamp: document.stamp });
					}
				}
			} catch (error) { checkChatAbort(signal); failed++; state.warnings.push(`${document.title}: ${error instanceof Error ? error.message : String(error)}`); }
			state.status.completed++; this.emit(); await ragYield();
		}
		// A failed plot read must not delete its existing checkpoint, but stale content is never silently authoritative.
		checkChatAbort(signal);
		for await (const document of this.database.documents(scope)) if (!state.documents.has(document.id) && !(corpus.warnings.length && document.id.startsWith('plot:'))) await this.database.removeDocument(document.key);
		// Partial note checkpoints may exist after interruption. Remove them only when the source is gone.
		for await (const page of this.database.records(scope)) for (const record of page) if (!state.documents.has(record.source.group) && !(corpus.warnings.length && record.source.group.startsWith('plot:'))) await this.database.removeDocument(record.documentKey);
		state.status.state = failed || corpus.warnings.length ? 'error' : 'ready'; state.status.message = state.warnings.length ? `${failed ? `미완료 자료 ${failed}개\n` : ''}${state.warnings.slice(0, 3).join('\n')}` : '프로젝트 전체 자료 색인 완료'; this.emit();
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
					const from = text.indexOf(part.text, offset); if (from < 0) throw new Error(`${document.title}의 원문 위치를 확인하지 못했습니다.`);
					offset = from + part.text.length;
					let score = named.has(document.id) ? 100 : 0;
					for (const matcher of matchers) {
						if (matcher.match(part.text)) score += matcher.weight;
						if (matcher.match(document.title)) score += matcher.weight * 3;
					}
					if (score > 0) top(candidates, { ...part, from, to: offset, links: document.links, contentHash: '' }, score, 60);
				}
				inspected++;
			} catch (error) { checkChatAbort(signal); if (strict) throw error; failures++; warnings.push(`${document.title} 조회 실패`); }
			await ragYield();
		}
		const sources: RagChunk[] = [], texts = new Set<string>(), allowed = new Map(corpus.documents.map(document => [document.id, document]));
		for (const candidate of candidates) {
			checkChatAbort(signal); const source = candidate.value;
			if (texts.has(source.text)) continue;
			const current = await allowed.get(source.group)!.read();
			if (current.slice(source.from, source.to) !== source.text) { if (strict) throw new Error('검색 도중 원문이 변경되었습니다. 다시 질문해 주세요.'); continue; }
			const hash = await ragHash(`${source.title}\n${source.text}`), frozen = { ...source, id: `${source.id}#${hash}`, contentHash: hash };
			this.temporary.set(`${scope}\0${frozen.id}`, { key: `${scope}\0${frozen.id}`, scope, documentKey: `${scope}\0${source.group}`, source: frozen });
			sources.push(frozen); texts.add(source.text); if (sources.length >= limit) break;
		}
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		checkChatAbort(signal);
		if (strict && revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('검색 도중 프로젝트 자료가 변경되었습니다. 다시 질문해 주세요.');
		warnings.push(`Obsidian API로 프로젝트 ${inspected}/${corpus.documents.length}개 자료를 키워드 검색했습니다.${failures ? ' 읽지 못한 자료가 있습니다.' : ''} 전송한 내용은 관련 발췌이며 모든 사건을 의미적으로 조사한 것은 아닙니다.`);
		return { sources, warnings };
	}
	async search(project: WritingProject, query: string, signal?: AbortSignal, limit = 10, explicitQuery = query, requireComplete = false, mode: RagSearchMode = 'keyword'): Promise<{ sources: RagChunk[]; warnings: string[] }> {
		if (mode === 'keyword') return this.searchObsidian(project, query, signal, limit, explicitQuery, requireComplete);
		if (requireComplete) await this.ensureComplete(project, signal);
		checkChatAbort(signal); const state = this.state(project), scope = await this.scope(project), warnings: string[] = [];
		const revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal), allowed = new Map(corpus.documents.map(document => [document.id, document])); warnings.push(...corpus.warnings);
		if (requireComplete && corpus.warnings.length) throw new Error(`검색할 자료 일부를 읽지 못했습니다. ${corpus.warnings.join('\n')}`);
		// Resolve literal names before tokenization (which deliberately drops
		// single-letter tokens). Never restrict retrieval to a character subfolder.
		const named = new Set(corpus.documents.filter(document => (document.names ?? [document.title]).some(name => {
			const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}]|은|는|이|가|을|를|의|와|과|에게|한테|에 대해)`, 'iu').test(explicitQuery);
		})).map(document => document.id));
		let vector: Float32Array | undefined;
		const queryVectors: Float32Array[] = [];
			try { vector = await this.worker.embed(query.slice(0, 1200), true, signal); }
			catch (error) { checkChatAbort(signal); if (requireComplete || mode === 'semantic') throw error; warnings.push(`의미 검색 미준비: ${error instanceof Error ? error.message : String(error)}`); }
		if (vector) {
			queryVectors.push(vector);
			// Retain the full question for polarity/context, and independently
			// search its topic words so polite endings/old scenes cannot dominate.
			const focused = queryFocus(explicitQuery).slice(0, 1200);
			if (focused.length >= 2 && focused !== query.trim()) {
				try { queryVectors.push(await this.worker.embed(focused, true, signal)); }
				catch (error) { checkChatAbort(signal); if (requireComplete) throw error; }
			}
		}
		const words = new Map([...chatTerms(query)].slice(0, 64)), sparse: Array<{ score: number; value: RagChunk }> = [], dense: typeof sparse = [];
		const frequencies = new Map<string, number>(); let indexedDocuments = 0, totalLength = 0;
		try { for await (const page of this.database.records(scope)) {
			checkChatAbort(signal);
			for (const record of page) {
				if (!allowed.has(record.source.group)) continue;
				if (mode !== 'semantic') {
					let terms = record.lexical;
					if (terms?.version !== 1 || !Array.isArray(terms.counts)) {
						terms = ragLexicalTerms(`${record.source.title}\n${record.source.location ?? ''}\n${record.source.text}`);
						await this.database.put('records', { ...record, lexical: terms, termKeys: terms.counts.map(([term]) => `${scope}\0${term}`) });
					}
					indexedDocuments++; totalLength += terms.length;
					for (const [term] of terms.counts) if (words.has(term)) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
				}
				if (vector && record.vector?.length === vector.length) {
					let similarity = -Infinity;
					for (const queryVector of queryVectors) { let score = 0; for (let index = 0; index < queryVector.length; index++) score += queryVector[index] * record.vector[index]; similarity = Math.max(similarity, score); }
					top(dense, record.source, similarity);
				}
			}
			await ragYield();
		}
		if (mode !== 'semantic') {
			const matches = typeof this.database.matchingRecords === 'function' ? this.database.matchingRecords(scope, words.keys()) : this.database.records(scope);
			for await (const page of matches) {
				checkChatAbort(signal);
				for (const record of page) if (allowed.has(record.source.group)) {
					const score = ragBm25(record.lexical ?? ragLexicalTerms(`${record.source.title}\n${record.source.text}`), words, frequencies, indexedDocuments, totalLength / Math.max(1, indexedDocuments)) + (named.has(record.source.group) ? 100 : 0);
					if (score > 0) top(sparse, record.source, score);
				}
				await ragYield();
			}
		}
		} catch (error) { checkChatAbort(signal); if (requireComplete) throw error; warnings.push(`저장된 색인을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
		// Semantic readiness and corpus coverage are different. An unfinished
		// embedding index does not mean the lexical scan skipped project files.
		let scanned = 0, scanFailures = 0;
		for (const document of mode === 'semantic' ? [] : corpus.documents) {
			checkChatAbort(signal);
			if (state.status.state === 'ready' && vector && document.stamp) {
				try {
					const checkpoint = await this.database.get<RagDocument>('documents', `${scope}\0${document.id}`);
					if (checkpoint?.stamp === document.stamp && !named.has(document.id)) { scanned++; continue; }
				} catch (error) { if (requireComplete) throw error; /* Non-strict lexical read can still work without IDB. */ }
			}
			try {
				const text = await document.read(); let offset = 0, processed = 0;
				for (const part of chatPassages(text, { id: document.id, title: document.title, path: document.path, kind: document.kind, automatic: true, group: document.id })) {
					if (++processed % 16 === 0) { await ragYield(); checkChatAbort(signal); }
					const from = Math.max(0, text.indexOf(part.text, offset)); offset = from + part.text.length;
					const score = lexical(words, `${part.title}\n${part.text}`) + (named.has(document.id) ? 100 : 0);
					if (score > 0) top(sparse, { ...part, from, to: offset, contentHash: '', links: document.links }, score);
				}
				scanned++;
			} catch (error) { checkChatAbort(signal); if (requireComplete) throw error; scanFailures++; warnings.push(`${document.title} 조회 실패`); }
			await ragYield();
		}
		const fused = new Map<string, { source: RagChunk; score: number }>();
		// Dense retrieval must still surface synonyms with no literal overlap. Equal RRF weights
		// otherwise let weak keyword matches crowd out the very semantic-only passages we need.
		for (const [list, weight] of [[sparse, vector ? 0.45 : 1], [dense, 1]] as const) list.forEach((item, rank) => { const before = fused.get(item.value.id); fused.set(item.value.id, { source: item.value, score: (before?.score ?? 0) + weight / (60 + rank) }); });
		const counts = new Map<string, number>(), sources: RagChunk[] = [], texts = new Set<string>();
		for (const { source: candidate } of [...fused.values()].sort((a, b) => Number(named.has(b.source.group)) - Number(named.has(a.source.group)) || b.score - a.score)) {
			if ((counts.get(candidate.group) ?? 0) >= 3) continue;
			const uniqueText = candidate.text.replace(/^#{1,6}[^\n]*$/gm, '').trim();
			if (texts.has(uniqueText)) continue;
			const document = allowed.get(candidate.group); if (!document) continue;
			try {
				const current = await document.read();
				if (current.slice(candidate.from, candidate.to) !== candidate.text) {
					if (requireComplete) throw new Error(`${document.title}의 검색 구간이 변경되었습니다. 최신 색인으로 다시 검색해야 합니다.`);
					warnings.push(`${document.title}의 검색 구간이 변경되어 제외했습니다. 색인을 갱신하세요.`); continue;
				}
			} catch (error) { if (requireComplete) throw error; continue; }
			const source = { ...candidate, contentHash: candidate.contentHash || await ragHash(`${candidate.title}\n${candidate.text}`) };
			if (!candidate.contentHash) { source.id += `#${source.contentHash}`; this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${source.group}`, source }); }
			sources.push(source); texts.add(uniqueText); counts.set(source.group, (counts.get(source.group) ?? 0) + 1); if (sources.length >= limit) break;
		}
		while (this.temporary.size > 200) this.temporary.delete(this.temporary.keys().next().value!);
		checkChatAbort(signal);
		if (requireComplete && revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('검색 도중 프로젝트 자료가 변경되어 일부 자료로 답변하지 않았습니다. 변경된 자료를 포함해 다시 검색해 주세요.');
		if (scanFailures || corpus.warnings.length) warnings.push(`프로젝트 자료 ${scanned}/${corpus.documents.length}개를 검색했습니다. 읽기 실패 자료가 있어 전체 자료를 확인했다고 답하지 마세요.`);
		else if (!requireComplete && state.status.state !== 'ready') warnings.push(mode === 'semantic'
			? '현재 저장된 의미 색인에서만 검색했습니다. 전체 자료의 색인 완료를 확인하지 않았습니다.'
			: `프로젝트 전체 ${scanned}개 자료를 키워드로 검색했습니다. 의미 색인은 ${state.status.state === 'paused' ? '일시정지' : '준비 중 또는 미설치'}이지만 자료를 일부만 검색한 것은 아닙니다. 전송된 내용은 관련 발췌이므로 모든 원문을 읽은 것처럼 답하지 마세요.`);
		return { sources, warnings };
	}
	/** Resolve a numbered manuscript and provide the entire current text before the first model call. */
	async episode(project: WritingProject, number: number, budget: number, signal?: AbortSignal): Promise<{ sources: RagChunk[]; warnings: string[] }> {
		checkChatAbort(signal);
		const scope = await this.scope(project), revision = this.revisions.get(project.rootFolder) ?? 0;
		const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
		// A uniquely identified manuscript needs no embedding model or global index.
		// Its full current text is read and checked directly; do not claim a corpus-wide audit.
		const matches = episodeManuscripts(corpus.documents, project, number);
		if (!matches.length) throw new Error(`${number}화에 해당하는 본문 파일을 찾지 못했습니다. 본문 폴더의 회차 파일명(예: 003화, 3화, 003. 제목)을 확인해 주세요.`);
		if (matches.length > 1) throw new Error(`${number}화로 해석되는 본문이 여러 개입니다. 파일을 지정해 주세요: ${matches.map(document => document.path).join(', ')}`);
		const document = matches[0], text = await document.read(); checkChatAbort(signal);
		if (!text.trim()) throw new Error(`${number}화 본문이 비어 있어 내용을 확인하지 못했습니다.`);
		const hash = await ragHash(`${document.title}\n${text}`);
		const source: RagChunk = { id: `${document.id}#episode:${hash}`, group: document.id, title: document.title, path: document.path, kind: 'reference', automatic: true,
			text, from: 0, to: text.length, location: `1–${text.split('\n').length}행 · ${number}화 본문 전체`, contentHash: hash, links: document.links };
		if (contextSourceText(source, true).length + 50 > budget) throw new Error(`${number}화 본문 전체(${text.length.toLocaleString()}자)가 현재 참고 문맥 범위를 넘습니다. 참고 문맥 한도를 늘려 주세요. 일부만 읽고 전체 회차를 요약하지 않았습니다.`);
		// Keep exact evidence readable for optional follow-up tools and source inspection.
		this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${document.id}`, source });
		while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
		if (await document.read() !== text || revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('회차 본문을 준비하는 중 원문이 변경되었습니다. 다시 질문해 주세요.');
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
		if (!numbered.length) throw new Error('요청한 권·회차 범위의 본문 파일을 찾지 못했습니다. 본문 폴더와 회차 파일명을 확인해 주세요.');
		const from = requested.from ?? Math.min(...numbered.map(item => item.number)), to = requested.to ?? Math.max(...numbered.map(item => item.number));
		if (from > to || to - from > 1000) throw new Error('요청한 회차 범위가 너무 큽니다. 범위를 나눠 주세요.');
		const documents: Array<{ document: CorpusDocument; number: number; text: string; start: number }> = [];
		for (let number = from; number <= to; number++) {
			checkChatAbort(signal); const matches = numbered.filter(item => item.number === number);
			if (matches.length !== 1) throw new Error(matches.length ? `${number}화 본문이 여러 개라 범위를 확정하지 못했습니다.` : `요청 범위에 ${number}화 본문이 없습니다. 빠진 회차를 다른 자료로 대신하지 않았습니다.`);
			const text = await matches[0].document.read(); if (!text.trim()) throw new Error(`${number}화 본문이 비어 있습니다.`);
			const start = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/.exec(text)?.[0].length ?? 0;
			if (!text.slice(start).trim()) throw new Error(`${number}화에 속성을 제외한 본문 내용이 없습니다.`);
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
				if (width < 64) throw new Error(`${from}~${to}화 모든 회차의 근거를 담기에는 참고 문맥 한도가 작습니다. 한도를 늘리거나 범위를 나눠 주세요.`);
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
			if (await item.document.read() !== item.text) throw new Error('범위 요약을 준비하는 중 본문이 변경되었습니다. 다시 질문해 주세요.');
			await ragYield();
		}
		if (remaining < 0 || revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('회차 범위의 근거를 정해진 문맥 안에서 준비하지 못했습니다. 다시 질문해 주세요.');
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
		if (revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('관계 조사 중 프로젝트가 변경되었습니다. 최신 자료로 다시 조사해 주세요.');
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
		if (!targets.length) throw new Error('행적을 조사할 인물의 이름이나 고유한 별칭을 질문에 지정해 주세요.');
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
		if (literalNames.length && !groups.length) throw new Error(`프로젝트 본문·인물·설정·플롯에서 '${literalNames.join(', ')}'의 명시적 등장 구간을 찾지 못했습니다. 이름의 표기를 확인해 주세요.`);
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
			if (hash !== await ragHash(`research:v1\n${signature}\n${document.title}\n${document.kind}\n${linked}\n${text}`)) throw new Error('행적 조사 중 원문이 변경되었습니다. 최신 자료로 다시 조사해 주세요.');
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
		if (revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('행적 조사 중 프로젝트가 변경되었습니다. 최신 자료로 다시 조사해 주세요.');
		if (groups.length && !sources.length) throw new Error('인물 행적 근거를 담을 문맥이 부족합니다. 참고 문맥 한도를 늘려 주세요.');
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
			const document = corpus.documents.find(item => item.id === source.group); if (!document) throw new Error('검색한 자료가 현재 프로젝트에 없습니다.');
			const text = await document.read(); if (text.slice(source.from, source.to) !== source.text) throw new Error('검색한 원문이 변경되었습니다. 다시 검색해 주세요.');
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
				if (!Number.isSafeInteger(offset) || Number(offset) < 0 || (kind !== undefined && !['character', 'plot', 'reference'].includes(String(kind)))) throw new Error('목록 범위가 올바르지 않습니다.');
				const corpus = await new ChatCorpusProvider(this.plugin, project).documents(signal);
				if (strict && corpus.warnings.length) throw new Error(corpus.warnings.join('\n'));
				const documents = corpus.documents.filter(document => !kind || document.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
				const start = Number(offset), page = documents.slice(start, start + 30);
				return { sources: [{ id: `catalog:${project.rootFolder}:${kind ?? 'all'}:${start}`, title: '프로젝트 자료 목록', kind: 'reference', automatic: true,
					text: `전체 ${documents.length}개 중 ${start + 1}–${start + page.length}\n${page.map(document => `[source_id:${document.id}] ${document.title} · ${document.path ?? document.id}`).join('\n')}` }],
					warnings: [...corpus.warnings, ...(start + page.length < documents.length ? [`목록이 더 있습니다. list_sources next_offset: ${start + page.length}`] : [])] };
			}
			if (call.name === 'search_sources') {
				if (typeof call.args.query !== 'string' || !call.args.query.trim() || call.args.query.length > 2000) throw new Error('검색어가 올바르지 않습니다.');
				const mode = call.args.mode ?? 'keyword'; if (typeof mode !== 'string' || !['hybrid', 'keyword', 'semantic'].includes(mode)) throw new Error('검색 방식이 올바르지 않습니다.');
				const result = await this.searchObsidian(project, call.args.query, signal, 8, call.args.query, strict);
				if (mode !== 'keyword') result.warnings.push('현재 기본 검색 도구는 Obsidian 키워드 검색을 사용했습니다. 의미 검색을 수행한 것으로 답하지 마세요.');
				return result;
			}
			if (!['read_source', 'related_sources'].includes(call.name) || typeof call.args.source_id !== 'string') throw new Error('허용되지 않은 자료 조회 요청입니다.');
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
			if (!record || record.scope !== scope) throw new Error('현재 프로젝트에서 찾은 자료 ID만 읽을 수 있습니다.');
			const document = corpus.documents.find(item => item.id === record.source.group);
			if (!document) throw new Error('삭제되었거나 검색 범위 밖으로 이동한 자료입니다.');
			if (call.name === 'read_source') {
				const offset = call.args.offset ?? 0, before = call.args.before ?? 0;
				if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(before) || Number(before) < 0 || Number(before) > 2000) throw new Error('원문 위치가 올바르지 않습니다.');
				const text = await document.read(); let from = Math.min(text.length, Math.max(0, record.source.from + Number(offset) - Number(before))), to = Math.min(text.length, from + 6000);
				if (text.slice(record.source.from, record.source.to) !== record.source.text) throw new Error('조회한 원문이 변경되었습니다. 다시 검색한 자료 ID로 읽어 주세요.');
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
			if (!Number.isSafeInteger(hops) || Number(hops) < 1 || Number(hops) > 2 || typeof query !== 'string' || query.length > 2000) throw new Error('관련 자료 탐색 범위가 올바르지 않습니다.');
			const revision = this.revisions.get(project.rootFolder) ?? 0;
			const current = await document.read(); if (current.slice(record.source.from, record.source.to) !== record.source.text) throw new Error('조회한 원문이 변경되었습니다. 다시 검색한 자료 ID로 조회해 주세요.');
			const graph = relatedDocumentDistances(corpus.documents, document.id, Number(hops), query);
			const words = new Map([...chatTerms(query)].slice(0, 64));
			const candidates: Array<{ source: RagChunk; score: number; distance: number }> = [], warnings = [...corpus.warnings];
			for (const target of corpus.documents) {
				const distance = graph.distances.get(target.id); if (distance === undefined) continue;
				let best: typeof candidates[number] | undefined, offset = 0, processed = 0;
				const targetText = await target.read();
				for (const part of chatPassages(targetText, { id: target.id, title: target.title, path: target.path, kind: target.kind, group: target.id, automatic: true })) {
					checkChatAbort(signal); if (++processed % 8 === 0) await ragYield();
					const from = targetText.indexOf(part.text, offset); if (from < 0) throw new Error('연결된 원문 구간을 확인하지 못했습니다.'); offset = from + part.text.length;
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
				try { const text = await target.read(); if (text.slice(candidate.source.from, candidate.source.to) !== candidate.source.text) throw new Error(`${target.title}의 관련 구간이 변경되어 다시 검색해야 합니다.`); }
				catch (error) { checkChatAbort(signal); if (strict) throw error; warnings.push(`${target.title}의 관련 구간을 확인하지 못해 제외했습니다.`); continue; }
				const hash = await ragHash(`${candidate.source.title}\n${candidate.source.text}`), source = { ...candidate.source, id: `${candidate.source.id}#${hash}`, contentHash: hash };
				this.temporary.set(`${scope}\0${source.id}`, { key: `${scope}\0${source.id}`, scope, documentKey: `${scope}\0${source.group}`, source });
				related.push(source); if (related.length >= 8) break;
			}
			if (graph.truncated) warnings.push('연결 자료가 많아 질문과 문서명을 기준으로 최대 96개 자료까지 탐색했습니다. 모든 연결을 조사한 것은 아닙니다.');
			while (this.temporary.size > 400) this.temporary.delete(this.temporary.keys().next().value!);
			if (candidates.length > related.length) warnings.push(`관련 자료 ${candidates.length}개 중 ${related.length}개 구간만 반환했습니다. 전체 행적 조사가 아닙니다.`);
			if (strict && revision !== (this.revisions.get(project.rootFolder) ?? 0)) throw new Error('연결 탐색 중 프로젝트 자료가 변경되었습니다. 다시 조회해 주세요.');
			return { sources: related, warnings };
		} };
	}
}
const services = new WeakMap<WritingMenuPlugin, RagIndexService>();
export function ragIndex(plugin: WritingMenuPlugin): RagIndexService { let service = services.get(plugin); if (!service) { service = new RagIndexService(plugin); services.set(plugin, service); } return service; }
