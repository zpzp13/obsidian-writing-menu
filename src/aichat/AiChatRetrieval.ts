import type { ChatContextItem } from './AiChatTypes';

export interface ChatPassage extends ChatContextItem { group: string; boost?: number; characterPaths?: string[]; sequence?: number }
const STOP = new Set('이 그 저 것 거 수 때 좀 나 너 넌 저라면 여기 여기서 지금 상황 선택문 문장 내용 질문 작가 인물 캐릭터 어떻게 어떡할래 어떨까 알려줘 말해줘 해줘 반응 대사 할까 할래 있지 있는 있다 어떤 무슨'.split(' '));
const PARTICLE = /(에게서|으로부터|에게|한테|에서는|으로는|이라고|라는|처럼|에서|으로|까지|부터|은|는|이|가|을|를|의|과|와|도|만|에|로)$/u;
const CORE = /성격|가치관|신념|말투|화법|성향|욕망|목표|동기|약점|두려움|태도|관계|personality|voice|values/i;

/** Korean particles + low-weight bigrams let 조사/어미 changes match without a remote embedding request. */
export function chatTerms(text: string): Map<string, number> {
	const result = new Map<string, number>();
	for (const raw of text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []) {
		if (STOP.has(raw)) continue;
		const word = raw.length > 2 ? raw.replace(PARTICLE, '') : raw;
		if (word.length < 2 || STOP.has(word)) continue;
		result.set(word, 1);
		if (/^[가-힣]+$/.test(word) && word.length > 2) for (let index = 0; index < word.length - 1; index++) {
			const gram = word.slice(index, index + 2);
			if (!STOP.has(gram) && !result.has(gram)) result.set(gram, 0.22);
		}
	}
	return result;
}

/** Bounded passages retain headings and exact line locations rather than one opaque note-sized blob. */
export function chatPassages(text: string, source: Omit<ChatPassage, 'text' | 'location'>, size = 1400): ChatPassage[] {
	const result: ChatPassage[] = [], lines = text.split('\n');
	let heading = '', from = 0, buffer = '';
	const flush = (to: number) => {
		if (buffer.trim()) result.push({ ...source, id: `${source.id}:${from + 1}:${result.length}`, text: buffer.trim(), location: `${heading ? `${heading} · ` : ''}${from + 1}–${to}행` });
		buffer = '';
	};
	for (let index = 0; index < lines.length; index++) {
		const nextHeading = /^(#{1,6})\s+(.+)/.exec(lines[index]);
		if (nextHeading) { flush(index); heading = nextHeading[2]; from = index; }
		if (buffer && buffer.length + lines[index].length + 1 > size) { flush(index); from = index; }
		// Also bound a single enormous line, keeping its original line number.
		for (let offset = 0; offset < lines[index].length; offset += size) {
			if (!buffer) from = index;
			buffer += lines[index].slice(offset, offset + size) + '\n';
			if (buffer.length >= size) flush(index + 1);
		}
		if (!lines[index].length) buffer += '\n';
	}
	flush(lines.length);
	return result;
}

export function rankChatPassages(passages: ChatPassage[], question: string, scene: string, previousQuestions = ''): ChatPassage[] {
	const query = new Map<string, number>();
	for (const [text, weight] of [[previousQuestions, 0.4], [scene, 0.8], [question, 3]] as const) {
		for (const [word, value] of chatTerms(text.slice(0, 16000))) query.set(word, Math.max(query.get(word) ?? 0, value * weight));
	}
	if (/성격|가치관|신념|반응|어떻|어떡|너라면|넌|판단|선택|왜/.test(question)) {
		for (const word of ['성격', '가치관', '신념', '동기', '말투', '태도', '관계']) query.set(word, Math.max(query.get(word) ?? 0, 1));
	}
	const frequencies = new Map<string, number>();
	const documents = passages.map(passage => {
		const words = chatTerms(`${passage.title} ${passage.location ?? ''}\n${passage.text}`);
		for (const word of query.keys()) if (words.has(word)) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
		return words;
	});
	return passages.map((passage, index) => {
		let score = passage.boost ?? 0;
		for (const [word, weight] of query) if (documents[index].has(word)) {
			score += weight * Math.log(1 + (passages.length + 1) / ((frequencies.get(word) ?? 0) + 1));
		}
		return { passage, score };
	}).filter(item => item.score > 1).sort((a, b) => b.score - a.score || a.passage.id.localeCompare(b.passage.id)).map(item => item.passage);
}

/** Keep an entire short profile; for large profiles preserve key traits and question-relevant original passages. */
export function fitCharacterProfile(text: string, source: ChatContextItem, question: string, scene: string, limit: number): ChatContextItem {
	if (text.length <= limit) return { ...source, text };
	const chunks = chatPassages(text, { ...source, group: source.path ?? source.id });
	const chosen = new Set<ChatPassage>();
	let size = 0;
	const add = (chunk: ChatPassage) => {
		if (!chosen.has(chunk) && size + chunk.text.length + (chunk.location?.length ?? 0) + 6 <= limit) { chosen.add(chunk); size += chunk.text.length + (chunk.location?.length ?? 0) + 6; }
	};
	const headings = new Set<string>();
	for (const chunk of chunks) {
		const heading = chunk.location?.split(' · ')[0] ?? '';
		if (CORE.test(heading) && !headings.has(heading)) { headings.add(heading); add(chunk); }
	}
	for (const chunk of rankChatPassages(chunks, question, scene)) add(chunk);
	for (const chunk of chunks) add(chunk);
	const selected = chunks.filter(chunk => chosen.has(chunk));
	return { ...source, location: '인물 노트 발췌', text: selected.length ? selected.map(chunk => `【${chunk.location}】\n${chunk.text}`).join('\n\n') : text.slice(0, Math.max(0, limit - 20)) + '\n… (뒤 내용 생략)' };
}

export function selectChatPassages(ranked: ChatPassage[], budget: number, max = 10): ChatContextItem[] {
	const result: ChatContextItem[] = [], groups = new Map<string, number>();
	for (const passage of ranked) {
		if ((groups.get(passage.group) ?? 0) >= 2) continue;
		const cost = passage.text.length + passage.title.length + (passage.path?.length ?? 0) + (passage.location?.length ?? 0) + 70;
		if (cost > budget) continue;
		const { group, boost, ...source } = passage;
		result.push(source); budget -= cost; groups.set(group, (groups.get(group) ?? 0) + 1);
		if (result.length >= max) break;
	}
	return result;
}
