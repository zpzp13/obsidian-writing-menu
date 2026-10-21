import { Notice, normalizePath, requestUrl } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export const MOBILE_WEB_FONTS = [
	{ id: 'ridibatang', name: '리디바탕', source: 'https://ridicorp.com/ridibatang/',
		faces: [{ weight: 400, url: 'https://ridicorp.com/wp-content/themes/ridicorp/css/font/RIDIBatang.otf' }] },
	{ id: 'maruburi', name: '마루 부리', source: 'https://hangeul.naver.com/font',
		faces: ([['ExtraLight', 200], ['Light', 300], ['Regular', 400], ['SemiBold', 600], ['Bold', 700]] as const)
			.map(([name, weight]) => ({ weight, url: `https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-${name}.woff2` })) },
	{ id: 'nanummyeongjo', name: '나눔명조', source: 'https://fonts.google.com/specimen/Nanum+Myeongjo',
		faces: ([['Regular', 400], ['Bold', 700], ['ExtraBold', 800]] as const)
			.map(([name, weight]) => ({ weight, url: `https://raw.githubusercontent.com/google/fonts/main/ofl/nanummyeongjo/NanumMyeongjo-${name}.ttf` })) },
	{ id: 'nanumgothic', name: '나눔고딕', source: 'https://fonts.google.com/specimen/Nanum+Gothic',
		faces: ([['Regular', 400], ['Bold', 700], ['ExtraBold', 800]] as const)
			.map(([name, weight]) => ({ weight, url: `https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-${name}.ttf` })) },
	{ id: 'pretendard', name: '프리텐다드', source: 'https://github.com/orioncactus/pretendard',
		faces: ([['Light', 300], ['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Bold', 700]] as const)
			.map(([name, weight]) => ({ weight, url: `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/static/woff2/Pretendard-${name}.woff2` })) },
	{ id: 'spoqahansansneo', name: '스포카 한 산스 네오', source: 'https://github.com/spoqa/spoqa-han-sans',
		faces: ([['Light', 300], ['Regular', 400], ['Medium', 500], ['Bold', 700]] as const)
			.map(([name, weight]) => ({ weight, url: `https://raw.githubusercontent.com/spoqa/spoqa-han-sans/master/Subset/SpoqaHanSansNeo/SpoqaHanSansNeo-${name}.woff2` })) },
] as const;

export function mobileFontName(id: string): string {
	return MOBILE_WEB_FONTS.find(font => font.id === id)?.name ?? '시스템 폰트';
}

/** Only font bytes from the curated catalog are fetched; no remote CSS is executed. */
export class MobileFontManager {
	private readonly faces = new Map<Document, Map<string, FontFace>>();
	private readonly pending = new Map<string, Promise<ArrayBuffer>>();
	private readonly loading = new Map<Document, Map<string, Promise<void>>>();
	private readonly failures = new Set<string>();
	private disposed = false;

	constructor(private readonly plugin: WritingMenuPlugin, private readonly onReady: () => void,
		private readonly fetchFont: typeof requestUrl = requestUrl) {}

	cssFamily(doc: Document): string {
		const selected = this.selection();
		const fallback = selected && ['nanumgothic', 'pretendard', 'spoqahansansneo'].includes(selected.font.id) ? 'sans-serif' : 'serif';
		return selected && this.faces.get(doc)?.has(selected.key) ? `"wm-mobile-${selected.font.id}", ${fallback}` : 'inherit';
	}

	async ensureSelected(doc: Document, retry = false): Promise<void> {
		const selected = this.selection();
		if (!selected || this.disposed || this.faces.get(doc)?.has(selected.key)) return;
		if (retry) this.failures.delete(selected.key);
		if (this.failures.has(selected.key)) return;
		let jobs = this.loading.get(doc);
		if (!jobs) this.loading.set(doc, jobs = new Map());
		const existing = jobs.get(selected.key);
		if (existing) return existing;
		const job = (async () => {
			try {
				const bytes = await this.fontBytes(selected.key, selected.face.url);
				const face = new FontFace(`wm-mobile-${selected.font.id}`, bytes, { weight: String(selected.face.weight), display: 'swap' });
				await face.load();
				if (this.disposed) return;
				doc.fonts.add(face);
				let loaded = this.faces.get(doc);
				if (!loaded) this.faces.set(doc, loaded = new Map());
				loaded.set(selected.key, face);
				this.onReady();
			} catch (error) {
				this.failures.add(selected.key);
				if (!this.disposed) new Notice(`${selected.font.name}을 불러오지 못해 시스템 글꼴을 사용합니다. 모바일 글꼴 설정에서 다시 시도할 수 있습니다.\n${error instanceof Error ? error.message : String(error)}`);
			} finally { jobs.delete(selected.key); }
		})();
		jobs.set(selected.key, job);
		return job;
	}

	dispose(): void {
		this.disposed = true;
		for (const [doc, fonts] of this.faces) for (const face of fonts.values()) doc.fonts.delete(face);
		this.faces.clear();
		this.loading.clear(); this.pending.clear(); this.failures.clear();
	}

	private selection() {
		const font = MOBILE_WEB_FONTS.find(item => item.id === this.plugin.settings.mobileFontFamily);
		if (!font) return null;
		const weight = this.plugin.settings.fontWeight || 400;
		const face = [...font.faces].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
		return { font, face, key: `${font.id}-${face.weight}-v1` };
	}

	private fontBytes(key: string, url: string): Promise<ArrayBuffer> {
		const existing = this.pending.get(key);
		if (existing) return existing;
		const job = (async () => {
			const adapter = this.plugin.app.vault.adapter;
			const directory = normalizePath(`${this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`}/webfonts`);
			const path = `${directory}/${key}.font`;
			if (await adapter.exists(path)) {
				try {
					const bytes = await adapter.readBinary(path);
					await new FontFace('wm-font-cache-probe', bytes).load();
					return bytes;
				} catch { /* An interrupted or stale cache must not prevent a fresh download. */ }
			}
			const response = await this.fetchFont({ url, throw: false });
			if (response.status !== 200) throw new Error(`다운로드 실패 (HTTP ${response.status})`);
			const bytes = response.arrayBuffer;
			if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) throw new Error('글꼴 파일 크기가 올바르지 않습니다.');
			await new FontFace('wm-font-download-probe', bytes).load();
			if (!this.disposed) {
				// Cache failure must not prevent using a successfully loaded font.
				try {
					if (!await adapter.exists(directory)) await adapter.mkdir(directory);
					await adapter.writeBinary(path, bytes);
				} catch { /* Retry caching on the next launch. */ }
			}
			return bytes;
		})();
		this.pending.set(key, job);
		void job.finally(() => this.pending.delete(key)).catch(() => {});
		return job;
	}
}
