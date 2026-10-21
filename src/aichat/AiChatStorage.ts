import { App, Notice } from 'obsidian';
import type { AiChatMessage, AiChatSession } from './AiChatTypes';
import { readChatJson, withChatWrite, writeChatJson } from './ChatJsonStore';

const ROOT = '.writing-menu-aichat';
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
type SessionIndex = Pick<AiChatSession, 'id' | 'title' | 'characterPath' | 'updatedAt' | 'pinned' | 'parentId' | 'forkMessageId' | 'mode' | 'projectRoot'> & { count: number };

/** Old releases used encodeURIComponent(characterPath) as a literal basename. Never decode it into a path. */
export function isChatSessionId(key: unknown): key is string {
	return typeof key === 'string' && key.length > 0 && key.length <= 2048 && key.trim() === key && key !== '.' && key !== '..'
		&& !/[\\/:<>"|?*\u0000-\u001f]/.test(key) && !/[. ]$/.test(key);
}

export class AiChatStorage {
	private baselines = new WeakMap<AiChatSession, string | null>();
	private warnedRecords = new Set<string>();
	constructor(private app: App) {}
	private path(key: string): string {
		if (!isChatSessionId(key)) throw new Error('대화 파일의 식별자가 올바르지 않습니다. 경로를 포함하지 않는 파일 이름이어야 합니다.');
		return `${ROOT}/sessions/${key}.json`;
	}
	private async ensureDir(): Promise<void> {
		for (const path of [ROOT, `${ROOT}/sessions`]) if (!await this.app.vault.adapter.exists(path)) {
			try { await this.app.vault.adapter.mkdir(path); } catch (error) { if (!await this.app.vault.adapter.exists(path)) throw error; }
		}
	}
	async loadById(key: string): Promise<AiChatSession | null> {
		const raw = await readChatJson(this.app.vault.adapter, this.path(key)); if (raw === null) return null;
		let session: AiChatSession;
		try { session = JSON.parse(raw); } catch { throw new Error('대화 기록이 손상되었습니다. 원본은 덮어쓰지 않았습니다. 이전 .bak 파일이 있으면 복구에 사용할 수 있습니다.'); }
		if (!session || !Array.isArray(session.messages) || typeof session.characterPath !== 'string') throw new Error('대화 기록 형식이 올바르지 않습니다.');
		if (session.mode !== undefined && !['character', 'deus'].includes(session.mode)) throw new Error('대화 모드가 올바르지 않습니다. 원본은 보존했습니다.');
		const validSkill = (value: unknown) => value === undefined || ['research', 'character', 'description', 'dialogue', 'rewrite'].includes(value as string);
		const validParticipants = (value: unknown) => value === undefined || Array.isArray(value) && value.every(person => person && typeof person.path === 'string' && typeof person.name === 'string');
		if (!validSkill(session.skill) || !validParticipants(session.participants)) throw new Error('Deus 스킬 설정 형식이 올바르지 않습니다. 원본은 보존했습니다.');
		// Very early character-scoped sessions had neither id nor title, including an old undefined.json record.
		// Hydrate in memory only. The original file is not rewritten merely by listing or opening it.
		if (session.id == null) {
			session.id = key;
			if (typeof session.title !== 'string') session.title = session.characterPath.split('/').pop()?.replace(/\.md$/i, '') || '이전 대화';
		}
		if (session.id !== key || typeof session.title !== 'string') throw new Error('대화 기록의 식별자나 제목이 파일과 일치하지 않습니다.');
		if (!Number.isFinite(session.updatedAt)) session.updatedAt = 0;
		session.messages.forEach((message, index) => {
			if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('메시지 형식이 올바르지 않습니다.');
			if (!validSkill(message.skill) || !validParticipants(message.participants)) throw new Error('메시지의 스킬·참여 인물 형식이 올바르지 않습니다.');
			message.id ??= `legacy-${key}-${index}`;
			if (message.citations !== undefined && (!Array.isArray(message.citations) || message.citations.some(citation => !citation || !Number.isSafeInteger(citation.number) || citation.number < 1 || typeof citation.sourceId !== 'string' || typeof citation.quote !== 'string' || citation.quote.length > 300 || (citation.kind !== undefined && citation.kind !== 'reference') || (citation.kind === 'reference' && citation.quote !== '')))) throw new Error('대화의 인용 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.');
			if (message.context && (message.context.version !== 1 || !Array.isArray(message.context.sources) || !Array.isArray(message.context.warnings)
				|| message.context.warnings.some(warning => typeof warning !== 'string')
				|| message.context.sources.some(source => !source || typeof source.id !== 'string' || typeof source.title !== 'string' || typeof source.text !== 'string'
					|| (source.path !== undefined && typeof source.path !== 'string') || (source.location !== undefined && typeof source.location !== 'string')
					|| (source.contentHash !== undefined && typeof source.contentHash !== 'string')
					|| [source.from, source.to].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0)))
				|| (message.context.searches !== undefined && (!Array.isArray(message.context.searches) || message.context.searches.some(search => !search || typeof search.name !== 'string' || !Array.isArray(search.sourceIds) || search.sourceIds.some(value => typeof value !== 'string') || (search.query !== undefined && typeof search.query !== 'string') || (search.warning !== undefined && typeof search.warning !== 'string')))))) throw new Error('대화의 참고 자료 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.');
			if (message.context?.retrieval && (message.context.retrieval.version !== 1 || !['focused', 'character-history', 'character-relationship', 'episode', 'episode-range'].includes(message.context.retrieval.strategy))) throw new Error('대화의 검색 계획 형식이 올바르지 않습니다.');
			const range = message.context?.episodeRange;
			if (range && ([range.from, range.to, range.inspectedEpisodes, range.includedEpisodes, range.sourceCharacters, range.includedCharacters].some(value => !Number.isSafeInteger(value) || value < 0)
				|| range.from > range.to || range.inspectedEpisodes !== range.to - range.from + 1 || range.includedEpisodes > range.inspectedEpisodes || range.includedCharacters > range.sourceCharacters
				|| typeof range.partial !== 'boolean' || (range.volume !== undefined && (!Number.isSafeInteger(range.volume) || range.volume < 1)))) throw new Error('대화의 회차 범위 확인 정보가 올바르지 않습니다.');
			const research = message.context?.research;
			if (research && (!Array.isArray(research.characters) || research.characters.some(entity => !entity || typeof entity.id !== 'string' || typeof entity.name !== 'string')
				|| (research.purpose !== undefined && research.purpose !== 'relationship')
				|| typeof research.partial !== 'boolean' || [research.inspectedDocuments, research.matchedDocuments, research.matchedPassages, research.includedDocuments, research.includedPassages, research.shortenedPassages].some(value => !Number.isSafeInteger(value) || value < 0)
				|| research.includedDocuments > research.matchedDocuments || research.matchedDocuments > research.inspectedDocuments || research.includedPassages > research.matchedPassages || research.shortenedPassages > research.includedPassages)) throw new Error('대화의 행적 조사 범위가 올바르지 않습니다.');
		});
		// Recover replies left on the question by older releases; listing never rewrites the original file.
		session.messages = session.messages.flatMap((message, index, messages) => {
			const legacy = message as AiChatMessage & { responseDraft?: { content?: unknown; timestamp?: number } };
			const received = legacy.responseDraft; delete legacy.responseDraft;
			if (message.role !== 'user' || typeof received?.content !== 'string' || !received.content || messages[index + 1]?.role === 'assistant') return [message];
			return [message, { id: `${message.id}-reply`, role: 'assistant' as const, skill: message.skill, participants: message.participants?.map(person => ({ ...person })), content: received.content, timestamp: received.timestamp ?? message.timestamp, status: 'complete' as const }];
		});
		this.baselines.set(session, raw); return session;
	}
	async save(session: AiChatSession): Promise<void> {
		await this.ensureDir(); const path = this.path(session.id), adapter = this.app.vault.adapter;
		await withChatWrite(adapter, path, async () => {
			if (!this.baselines.has(session)) throw new Error('대화를 다시 불러온 뒤 저장해 주세요.');
			session.updatedAt = Date.now();
			const raw = await writeChatJson(adapter, path, session, this.baselines.get(session)!);
			this.baselines.set(session, raw);
		});
		await this.updateIndex(session);
	}
	private summary(session: AiChatSession): SessionIndex {
		return { id: session.id, title: session.title, characterPath: session.characterPath, updatedAt: session.updatedAt, pinned: session.pinned, parentId: session.parentId, forkMessageId: session.forkMessageId, mode: session.mode, projectRoot: session.projectRoot, count: session.messages.length };
	}
	private async index(): Promise<SessionIndex[]> {
		const raw = await readChatJson(this.app.vault.adapter, `${ROOT}/index.json`);
		if (raw === null) return [];
		try { const data = JSON.parse(raw); if (!Array.isArray(data)) throw new Error(); return data; }
		catch { throw new Error('대화 목록이 손상되었습니다. 목록 백업은 index.json.bak에 있습니다.'); }
	}
	private async updateIndex(session: AiChatSession | null, removeId?: string): Promise<void> {
		const adapter = this.app.vault.adapter, path = `${ROOT}/index.json`;
		await withChatWrite(adapter, path, async () => {
			const previous = await readChatJson(adapter, path);
			const data = await this.index();
			const next = data.filter(item => item.id !== (session?.id ?? removeId));
			if (session) next.push(this.summary(session));
			await writeChatJson(adapter, path, next, previous);
		});
	}
	async listSessions(): Promise<SessionIndex[]> {
		const adapter = this.app.vault.adapter, directory = `${ROOT}/sessions`;
		if (!await adapter.exists(directory)) return [];
		let entries = await this.index();
		const { files } = await adapter.list(directory), paths = new Set(files.filter(path => path.endsWith('.json')));
		entries = entries.filter(entry => entry && isChatSessionId(entry.id) && paths.has(this.path(entry.id)));
		const indexed = new Set(entries.map(entry => this.path(entry.id)));
		for (const path of paths) if (!indexed.has(path)) {
			try {
				const session = await this.loadById(path.slice(directory.length + 1, -5));
				if (session) { entries.push(this.summary(session)); await this.updateIndex(session); }
			} catch {
				// One damaged or externally renamed record must not hide every healthy conversation.
				if (!this.warnedRecords.has(path)) { this.warnedRecords.add(path); new Notice('일부 대화 기록을 읽지 못했습니다. 해당 원본 파일은 보존했으며, 다른 대화는 계속 사용할 수 있습니다.'); }
			}
		}
		return entries.filter(item => item.count > 0).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
	}
	async createNewSession(characterPath: string, title: string): Promise<AiChatSession> {
		const session: AiChatSession = { id: id(), characterPath, title, messages: [], updatedAt: Date.now() };
		this.baselines.set(session, null); return session;
	}
	async getOrCreateActiveSession(characterPath: string, name: string): Promise<AiChatSession> {
		const entry = (await this.listSessions()).find(item => item.mode !== 'deus' && item.characterPath === characterPath);
		return entry ? (await this.loadById(entry.id))! : this.createNewSession(characterPath, name);
	}
	async fork(session: AiChatSession, through: number, parentId = session.id): Promise<AiChatSession> {
		const next = await this.createNewSession(session.characterPath, `${session.title} · 분기`);
		next.mode = session.mode;
		next.skill = session.skill; next.participants = session.participants?.map(person => ({ ...person }));
		// Citation objects must not be shared by response branches.
		next.messages = session.messages.slice(0, through + 1).map(message => ({ ...message, segments: message.segments?.map(segment => ({ ...segment })), usage: message.usage?.map(item => ({ ...item })), context: message.context ? { ...message.context, retrieval: message.context.retrieval ? { ...message.context.retrieval } : undefined, research: message.context.research ? { ...message.context.research, characters: message.context.research.characters.map(entity => ({ ...entity })) } : undefined, sources: message.context.sources.map(source => ({ ...source })), warnings: [...message.context.warnings], searches: message.context.searches?.map(search => ({ ...search, sourceIds: [...search.sourceIds] })) } : undefined }));
		next.parentId = parentId; next.forkMessageId = session.messages[through]?.id;
		for (const message of next.messages) {
			if (message.participants) message.participants = message.participants.map(person => ({ ...person }));
			if (message.context?.episodeRange) message.context.episodeRange = { ...message.context.episodeRange };
			if (message.citations) message.citations = message.citations.map(citation => ({ ...citation }));
		}
		next.projectRoot = session.projectRoot; next.speakerPath = session.speakerPath;
		await this.save(next);

		return next;
	}
	async rename(key: string, title: string): Promise<void> { const session = await this.loadById(key); if (session) { session.title = title; await this.save(session); } }
	async deleteSession(key: string): Promise<void> {
		const path = this.path(key), adapter = this.app.vault.adapter;
		await withChatWrite(adapter, path, async () => {
			const previous = await readChatJson(adapter, path); if (previous === null) return;
			await adapter.write(`${path}.removed`, previous);
			if (await adapter.read(`${path}.removed`) !== previous) throw new Error('삭제 전 대화 보관을 검증하지 못했습니다.');
			await this.updateIndex(null, key); await adapter.remove(path);
		});
	}
}
