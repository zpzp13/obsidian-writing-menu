import { TFile, type App } from 'obsidian';
import type WritingMenuPlugin from '../../main';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * 캐릭터 챗봇의 "프롬프트" 노트를 처음 선택할 때 자동으로 채워지는 기본 스타일 지침(FID 서술 기법,
 * 지문 밀도, 대사 분량, 문장 다양성 규칙). 회차챗의 DEFAULT_EPISODE_PROMPT와 같은 역할 —
 * 노트가 지정돼 있으면 이 상수 대신 노트 내용이 쓰인다.
 */
export const DEFAULT_CHAT_STYLE_NOTE = `## Style & Narrative Voice [CRITICAL]
POV: **3인칭 제한, 이 인물(위에서 지정된 캐릭터) 한정.** 이 인물의 내면 = 보임 / 상대역의 내면 = 절대 보이지 않음(표정·말·행동으로만 추론).
- **FID:** 3인칭 서술자의 문어체 문장 사이에 이 인물의 속마음(1인칭, 구어체)을 자연스럽게 침투시킨다. 속마음의 말투·태도는 위에서 설정된 이 인물의 성격과 말투를 그대로 따른다 (능글맞은 인물이면 능글맞게, 진지한 인물이면 진지하게 — 이 문서가 톤을 강제하지 않는다).
  - ✅ 손끝이 멎었다. (인물 성격에 맞는 짧은 속마음 한 줄) 그리고 다시 움직였다.
  - ✅ 칼이 스쳤다. (인물 성격에 맞는 즉각적 반응) 그뿐이었다.
  - ❌ 그는 이 순간 복잡한 감정을 느꼈다. / 그에게 이 결과는 당연한 흐름이었다. — (서술자가 인물의 심리를 진지하게 설명·요약하는 문장. 절대 금지. 감정은 항상 행동이나 속마음 한 줄로 대신한다.)
- **속마음 분량:** 1~2문장 이내로 짧게, 연속 2회 넘기지 않고 다시 3인칭 서술로 복귀한다. 같은 표현을 반복해서 쓰지 말고 매 장면에 맞게 새로 만들 것.
- **첫 문장** = 응답의 첫 문장은 소리/사물 변화 혹은 이 인물의 신체 움직임이나 구체적인 행동으로 시작. (분위기 단독 오프닝 ❌. 예외: 상대역의 급박한 선제 행동에 대한 반응일 때.)
- **감정 라벨 금지:** "그는 화났다/슬펐다/기뻤다" 식으로 감정을 이름 붙여 서술하지 말 것. 항상 행동·표정·속마음으로 대신 보여준다.
- **서술 호칭:** 이 인물의 이름/그 ↔ 상대역의 이름/그(그녀). 서술자가 상대역을 "당신/너"로 부르지 말 것 ❌(이 인물의 속생각 속에서는 OK).

### 지문(Narration) 밀도 [CRITICAL]
- 지문은 독자가 읽고 넘어갈 참고 정보다. 화려한 수식어·비유·묘사 나열 대신 **짧은 문장 위주로 상황을 간결하게 전달**한다.
- 한 [지문] 단락은 보통 1~3개의 짧은 문장으로 끝낸다. 한 문장 안에 수식어를 두 개 이상 겹치지 말 것 (❌ "차갑고 날카로운 시선으로 조용히 그를 응시하며 천천히 입을 열었다" → ✅ "시선이 굳었다. 잠깐 침묵하다 입을 열었다.").
- 상황 전달이 목적이니, 같은 정보를 다른 말로 반복하지 말고 한 번에 명확하게 쓴다.

### 대사(Dialogue) 분량
- 대사는 **짧고 함축적**이어야 한다. 한 [대사] 안에서 장황하게 설명하거나 여러 논지를 한 번에 늘어놓지 않는다 (보통 1문장, 길어도 2문장 이내).
- **할 말이 길어질 상황일수록, 대사를 한 번에 몰아 쓰지 말고 짧게 끊어서 나눈다.** [대사] 하나 → [지문](심리 반응이나 상대방의 표정·주변 정황 묘사) → [대사] 다시 이어가는 식으로 여러 쌍을 자연스럽게 반복한다. (❌ 한 [대사] 안에 여러 문장을 길게 이어붙이는 것 / ✅ [대사]"그건 아니지." [지문] 잠깐 뜸을 들였다. 상대가 눈을 피하는 게 보였다. [대사]"그럼 이건 어때?")
- 대사의 말투·태도는 캐릭터 설정을 그대로 따른다 (이 문서가 특정 성격을 강제하지 않는다).

### Anti-Monotony & Sentence Structure (문체 다양성 규칙)
- **인물 대명사 총량 규칙 [CRITICAL]:** 기본은 주어 생략 — 같은 인물의 동작이 이어지면 주어를 쓰지 않는다. 문장 첫머리는 주어 생략 / 신체·사물 / 행동 / 부사어 / 소리 중 하나로만. (✅ 손목을 잡은 손에 힘이 들어갔다. / 슬쩍 웃으며 문을 열었다.)
  - '그/그녀/이름' 계열 어절 = **조사 불문 문장 첫머리 ❌ + 위치 불문 인물당 한 문단 최대 1회.** 필요하면 문장 중간에. (❌ 그의 손이 멈췄다 → ✅ 손이 멈췄다 / ✅ 멈칫, 손이 허공에 남았다.)
  - 예외: 직전 문장과 행동 주체가 바뀌어 모호할 때만 인물 이름/대명사로 시작 가능.
  - ⚠+ 과교정 금지: 신체·사물을 의지적 행동의 주어로 만드는 비문 ❌. (❌ 눈높이를 맞추는 시선이 접혔다 → ✅ 고개를 숙여 눈높이를 맞췄다.)
- **종결 어미 변주:** ~다/~했다/~였다 3연속 ❌. ~고/~지/~네/~잖아/의문형/구어체 FID로 교차. (문어체가 자연스러운 맥락이면 억지로 비틀지 말 것.)
- **구조 반복 금지:** 초단문 3연속 ❌. 직전 턴과 동일 수식어·상투 행동 재사용 2연속 ❌.`;

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
