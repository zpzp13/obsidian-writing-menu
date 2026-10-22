/** SSE needs a readable body and AbortSignal; Obsidian requestUrl buffers responses. */
export function requestGeminiStream(url: string, key: string, body: string, signal?: AbortSignal): Promise<Response> {
	return fetch(url, {
		method: 'POST', signal,
		headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
		body,
	});
}
