import { FileSystemAdapter, requireApiVersion, type App } from 'obsidian';

const prefix = 'writing-menu:paged-zoom:';

function legacyKey(app: App, path: string): string {
	const adapter = app.vault.adapter;
	const vault = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : app.vault.getName();
	return prefix + JSON.stringify([vault, path]);
}

/** Keep device-local zoom on 1.7.2 while retaining existing values on newer apps. */
export function loadPagedZoom(app: App, path: string): unknown {
	try {
		if (requireApiVersion('1.8.7')) {
			const saved: unknown = app.loadLocalStorage(prefix + path);
			if (saved !== null && saved !== undefined) return saved;
		}
		const saved = window.localStorage.getItem(legacyKey(app, path));
		return saved === null ? null : JSON.parse(saved) as unknown;
	} catch { return null; }
}

export function savePagedZoom(app: App, path: string, value: number | null): void {
	try {
		if (requireApiVersion('1.8.7')) app.saveLocalStorage(prefix + path, value);
		// Mirror the compatible store so upgrades, downgrades and renames keep the same zoom.
		const key = legacyKey(app, path);
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, JSON.stringify(value));
	} catch { /* A blocked/full local store must never interrupt document editing. */ }
}
