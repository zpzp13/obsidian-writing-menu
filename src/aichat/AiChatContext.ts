import { TFile, type App } from 'obsidian';
import type WritingMenuPlugin from '../../main';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** 설정된 "시스템 프롬프트 노트"(문체·톤 등 사용자 지정 지침)를 읽어온다. 없으면 빈 문자열. */
export async function loadCustomStyleNote(app: App, plugin: WritingMenuPlugin): Promise<string> {
	const path = plugin.settings.aiChatSystemPromptNotePath?.trim();
	if (!path) return '';
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return '';
	return (await app.vault.read(file)).trim();
}

/** 사용자 지정 스타일 노트 내용을 "충돌 시 이 내용 우선" 문구와 함께 프롬프트에 덧붙일 블록으로 만든다. */
export function buildCustomStyleBlock(customText: string): string {
	if (!customText) return '';
	return `\n\n${customText}\n\n(위 내용이 이 프롬프트의 앞부분과 충돌하면, 위 내용을 우선하세요.)`;
}

/** 마크다운 본문에서 주어진 헤딩 아래 섹션(다음 동급 이상 헤딩 전까지)만 추출한다. 못 찾으면 null. */
export function extractHeadingSection(content: string, headingText: string): string | null {
	const target = headingText.trim();
	if (!target) return null;

	const lines = content.split('\n');
	let startIdx = -1;
	let level = 0;

	for (let i = 0; i < lines.length; i++) {
		const m = HEADING_RE.exec(lines[i]);
		if (m && m[2].trim().toLowerCase() === target.toLowerCase()) {
			startIdx = i + 1;
			level = m[1].length;
			break;
		}
	}
	if (startIdx === -1) return null;

	let endIdx = lines.length;
	for (let i = startIdx; i < lines.length; i++) {
		const m = HEADING_RE.exec(lines[i]);
		if (m && m[1].length <= level) { endIdx = i; break; }
	}

	const section = lines.slice(startIdx, endIdx).join('\n').trim();
	return section.length > 0 ? section : null;
}

/** 설정된 헤딩 섹션만 추출하고, 못 찾으면 노트 전체로 폴백한다. */
export function extractPersonaContent(fullContent: string, headingSetting: string): string {
	if (!headingSetting.trim()) return fullContent;
	return extractHeadingSection(fullContent, headingSetting) ?? fullContent;
}

/** 앞뒤에 남은 큰따옴표/괄호를 벗겨낸다 (모델이 형식 지침을 어겼을 때의 방어용). */
export function stripWrapping(text: string): string {
	let t = text.trim();
	for (let i = 0; i < 2; i++) {
		const before = t;
		t = t.replace(/^["“”']+|["“”']+$/g, '').trim();
		t = t.replace(/^\(([\s\S]*)\)$/, '$1').trim();
		if (t === before) break;
	}
	return t;
}

export interface AiChatSegment {
	type: 'narration' | 'dialogue';
	text: string;
}

/** AI 응답에서 "[지문]...[대사]...[지문]...[대사]..." 형식을 순서대로 반복 분리한다.
 * 마커가 하나도 없으면 전체를 대사 한 덩어리로 취급(폴백). */
export function parseAssistantSegments(raw: string): AiChatSegment[] {
	const markerRe = /\[(지문|대사)\]/g;
	const markers: Array<{ type: AiChatSegment['type']; start: number; end: number }> = [];
	let m: RegExpExecArray | null;
	while ((m = markerRe.exec(raw))) {
		markers.push({ type: m[1] === '지문' ? 'narration' : 'dialogue', start: m.index, end: m.index + m[0].length });
	}

	if (markers.length === 0) {
		const stripped = stripWrapping(raw);
		return stripped ? [{ type: 'dialogue', text: stripped }] : [];
	}

	const segments: AiChatSegment[] = [];
	for (let i = 0; i < markers.length; i++) {
		const from = markers[i].end;
		const to = i + 1 < markers.length ? markers[i + 1].start : raw.length;
		const text = stripWrapping(raw.slice(from, to));
		if (text) segments.push({ type: markers[i].type, text });
	}
	return segments;
}
