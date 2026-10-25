import { wmT } from '../i18n/index';
export function checkChatAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException(wmT("응답 수신을 중단했습니다."), 'AbortError'); }

/** requestUrl has no cancellation primitive; stop accepting its result without starting another request. */
export function abortableChat<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return task;
	return new Promise((resolve, reject) => {
		const stop = () => reject(new DOMException(wmT("응답 수신을 중단했습니다."), 'AbortError'));
		signal.addEventListener('abort', stop, { once: true });
		if (signal.aborted) stop();
		task.then(value => { if (!signal.aborted) resolve(value); }, reject).finally(() => signal.removeEventListener('abort', stop));
	});
}

/** One SSE decoder for text and tool responses, including split UTF-8 and cancellation. */
export async function readChatSse(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, consume: (event: unknown) => void): Promise<void> {
	const reader = body.getReader(), decoder = new TextDecoder();
	let buffer = '', complete = false;
	const stop = () => { void reader.cancel().catch(() => {}); };
	signal?.addEventListener('abort', stop, { once: true });
	const frame = (value: string) => {
		const data = value.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
		if (!data || data.trim() === '[DONE]') return;
		consume(JSON.parse(data));
	};
	try {
		while (true) {
			checkChatAbort(signal);
			const { value, done } = await reader.read();
			checkChatAbort(signal);
			buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
			let boundary: RegExpExecArray | null;
			while ((boundary = /\r?\n\r?\n/.exec(buffer))) { frame(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length); }
			if (done) { if (buffer.trim()) frame(buffer); complete = true; break; }
		}
	} finally {
		signal?.removeEventListener('abort', stop);
		if (!complete) await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export async function readGeminiStream(body: ReadableStream<Uint8Array>, signal: AbortSignal | undefined, onText?: (text: string) => void): Promise<string> {
	let text = '';
	await readChatSse(body, signal, value => {
		const event = value as { error?: unknown; candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
		if (event.error) throw new Error(wmT("AI 스트리밍 응답에 오류가 있습니다."));
		const chunk = event.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? '';
		if (chunk) { text += chunk; onText?.(text); }
	});
	if (!text.trim()) throw new Error(wmT("빈 응답"));
	return text.trim();
}
