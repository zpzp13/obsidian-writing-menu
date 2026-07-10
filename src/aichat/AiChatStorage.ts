import { App, normalizePath } from 'obsidian';
import type { AiChatSession } from './AiChatTypes';

const STORAGE_ROOT = '.writing-menu-aichat';

function makeId(): string {
	return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AiChatStorage {
	constructor(private app: App) {}

	private sessionPath(id: string): string {
		return normalizePath(`${STORAGE_ROOT}/sessions/${id}.json`);
	}

	private async ensureDir(): Promise<void> {
		const dir = normalizePath(`${STORAGE_ROOT}/sessions`);
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.adapter.mkdir(dir);
		}
	}

	async loadById(id: string): Promise<AiChatSession | null> {
		const p = this.sessionPath(id);
		if (!(await this.app.vault.adapter.exists(p))) return null;
		try {
			const raw = await this.app.vault.adapter.read(p);
			return JSON.parse(raw) as AiChatSession;
		} catch {
			return null;
		}
	}

	async save(session: AiChatSession): Promise<void> {
		await this.ensureDir();
		session.updatedAt = Date.now();
		await this.app.vault.adapter.write(this.sessionPath(session.id), JSON.stringify(session, null, 2));
	}

	async deleteSession(id: string): Promise<void> {
		const p = this.sessionPath(id);
		if (await this.app.vault.adapter.exists(p)) await this.app.vault.adapter.remove(p);
	}

	async rename(id: string, title: string): Promise<void> {
		const session = await this.loadById(id);
		if (!session) return;
		session.title = title;
		await this.save(session);
	}

	/** 손상 파일은 건너뛰고, 모든 세션을 최신순으로 반환 (빈 대화 포함) */
	private async listAll(): Promise<AiChatSession[]> {
		const dir = normalizePath(`${STORAGE_ROOT}/sessions`);
		if (!(await this.app.vault.adapter.exists(dir))) return [];
		const { files } = await this.app.vault.adapter.list(dir);
		const sessions: AiChatSession[] = [];
		for (const f of files) {
			if (!f.endsWith('.json')) continue;
			try {
				const raw = await this.app.vault.adapter.read(f);
				sessions.push(JSON.parse(raw) as AiChatSession);
			} catch { /* 손상된 세션 파일은 건너뜀 */ }
		}
		return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	/** 히스토리 목록용: 메시지가 하나라도 있는 세션만 */
	async listSessions(): Promise<AiChatSession[]> {
		return (await this.listAll()).filter(s => s.messages.length > 0);
	}

	/** 해당 인물의 "이어서 볼" 세션을 찾는다 — 가장 최근 세션(빈 대화 포함)을 재사용하고,
	 * 하나도 없으면 새로 만든다. */
	async getOrCreateActiveSession(characterPath: string, characterName: string): Promise<AiChatSession> {
		const existing = (await this.listAll()).find(s => s.characterPath === characterPath);
		if (existing) return existing;
		return this.createNewSession(characterPath, characterName);
	}

	/** "새 대화" — 기존 대화 내역은 히스토리에 그대로 남기고, 완전히 새 세션을 만든다. */
	async createNewSession(characterPath: string, characterName: string): Promise<AiChatSession> {
		return { id: makeId(), characterPath, title: characterName, messages: [], updatedAt: Date.now() };
	}
}
