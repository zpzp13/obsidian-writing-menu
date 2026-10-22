import type { ChatContextItem } from '../AiChatTypes';

export interface RagChunk extends ChatContextItem {
	group: string;
	from: number;
	to: number;
	contentHash: string;
	links: string[];
	boost?: number;
}
export interface RagRecord { key: string; scope: string; documentKey: string; source: RagChunk; termKeys?: string[] }
export interface RagToolCall { id?: string; name: string; args: Record<string, unknown> }
export type RagSearchMode = 'hybrid' | 'keyword' | 'semantic';
export interface RagTrace { name: string; query?: string; sourceIds: string[]; warning?: string }
export interface RagTools {
	searchModes?: RagSearchMode[];
	/** A failed/incomplete source operation must stop generation, not become a warning. */
	strict?: boolean;
	/** Per-request evidence stays readable even after the service's small transient cache rotates. */
	useSources?(sources: ChatContextItem[]): void;
	execute(call: RagToolCall, signal?: AbortSignal): Promise<{ sources: ChatContextItem[]; warnings: string[] }>;
}
export async function ragHash(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const hash = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
// Timer clamping can turn every document into a one-second wait when Obsidian
// is in the background. MessageChannel yields to UI tasks without that clamp.
export const ragYield = () => new Promise<void>(resolve => {
	if (typeof MessageChannel === 'undefined') { window.setTimeout(resolve, 0); return; }
	const channel = new MessageChannel();
	channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
	channel.port2.postMessage(null);
});
