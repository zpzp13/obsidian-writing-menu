import type { App } from 'obsidian';

/** Older public SDK declarations omit the host's editor configuration accessor. */
export function obsidianConfig(app: App, key: string): unknown {
	const vault = app.vault as App['vault'] & { getConfig?: (key: string) => unknown };
	return vault?.getConfig?.(key);
}
