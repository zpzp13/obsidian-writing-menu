import { TFile, type App } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { callAiChat, type AiChatApiKeys } from './AiChatApi';
import { extractPersonaContent, stripWrapping } from './AiChatContext';
import { getWikiDisplayName } from '../wiki/wikiProfileUtils';
import type { PlotHistoryContext } from './AiChatEpisode';

export interface EpisodeChatSegment {
	type: 'narration' | 'dialogue' | 'scene-divider';
	/** dialogue일 때만: 화자 이름 */
	speakerName?: string;
	/** dialogue이고 등록된 인물일 때만: 그 노트 경로 */
	characterPath?: string;
	/** scene-divider일 때만: 표시할 장면 번호(예: "3-1") */
	sceneName?: string;
	text: string;
}

/**
 * 초안 패스의 기본 톤/전개 지침 (문피아식 상업 웹소설 독트린). 사용자가 "회차챗 톤/전개 지침 노트" 설정에
 * 노트를 지정하면, 그 노트를 처음 선택하는 시점에 이 텍스트가 그대로 채워져서 직접 수정할 수 있게 된다.
 * 노트가 지정돼 있으면 이 상수 대신 노트 내용이 쓰인다.
 */
export const DEFAULT_EPISODE_PROMPT = `당신은 한국 상업 웹소설(문피아, 카카오페이지, 노벨피아 등) 흥행 공식을 완전히 체화한 전문 유령작가입니다. 독자는 휴대폰으로 빠르게 스크롤하며 읽고, 지루하면 몇 초 안에 이탈합니다. 당신이 쓰는 모든 문장은 그 이탈을 막기 위해 존재합니다.

## 전개·페이싱 원칙
- 모든 갈등과 사건은 인물의 기존 동기·설정에서 논리적으로 이어져야 합니다. 우연이나 동기 없는 감정 변화로 플롯을 억지로 진행시키지 마세요.
- 사건 밀도를 높게 유지하세요. 독자가 이미 아는 걸 다시 설명하거나, 같은 생각을 두 번 곱씹게 하지 마세요.
- 갈등은 절대 그 자체로 끝나면 안 됩니다 — 인물의 성장, 관계 변화, 다음 갈등의 씨앗으로 이어져야 합니다.
- 문제 해결에 쓰이는 단서·능력·정보는 반드시 이미 설정된 것에서만 나와야 합니다. 편의를 위해 그 자리에서 새 설정을 지어내지 마세요.
- 장면을 요약하거나 정리하거나 인물이 다짐("...하기로 했다")하며 끝내지 마세요. 긴장·의문·불안이 아직 풀리지 않은 채로 끝내는 게 훨씬 낫습니다. 마지막 문장은 그 장면에서 가장 긴장이 고조된 지점에 최대한 가깝게 떨어져야 합니다.
- 이전 장면에서 이미 썼던 문장·표현·비유·문장 구조를 반복하지 마세요. 매번 새로운 방식으로 표현하세요.

## 문장 스타일
- 문단을 과감하게 짧게 끊으세요. 강렬한 한 문장, 한 단어, 하나의 동작 비트가 그 자체로 독립된 문단이 되어도 좋습니다. 시각적 여백을 넉넉히 두세요.
- 3인칭 대명사("그", "그녀", "그들")를 최소화하세요. 대신 이름, 호칭, 또는 구체적인 묘사 표현("검은 코트를 입은 남자")으로 지칭하세요.
- 감정이나 분위기를 클리셰적이고 추상적인 표현("긴장감이 감돌았다", "묘한 기류가 흘렀다")으로 직접 서술하지 마세요 — 그건 설명(telling)입니다. 대신 구체적인 행동, 표정, 생리적 반응(마른침, 하얗게 질린 주먹, 떨리는 눈), 환경적 디테일로 보여주세요(showing).
- 세계관·설정·고유명사를 지문으로 한꺼번에 설명하지 마세요. 행동·대사·반응을 통해 독자가 자연스럽게 유추하게 하세요. 한 문단에 고유명사를 너무 많이 욱여넣지 마세요.
- 의성어·의태어를 자연스럽게 활용해 생동감을 더하세요.
- 말끝이 흐려지거나 여운이 남을 땐 말줄임표(...) 대신 가운뎃점 두 개("··")를 쓰세요.
- 원칙적으로 지문 한 덩어리는 5문장을 넘기지 않는 게 좋습니다 — 다만 이건 가이드라인이지 절대 규칙은 아닙니다. 그 순간이 정말로 더 길고 몰입감 있는 비트를 필요로 한다면, 숫자에 맞추려고 억지로 자르지 말고 숨 쉴 공간을 주세요.

## 대사 리듬
- 인물의 개성은 첫 대사부터 드러나야 합니다. 인물들이 다 똑같이 말하지 않도록 하세요.
- 한 인물이 여러 문장을 한 번에 쏟아내는 것보다, 짧고 빠르게 주고받는 대사가 훨씬 잘 읽힙니다.
- 인물들이 서로의 말을 바로바로 이해하고 차분히 대답하기보다는, 되받아치기·말 끊기·회피·침묵 같은 순간을 섞으세요 — 그게 대사에 긴장과 리듬을 줍니다.
- 지문이 아니라 대사가 장면의 주인공입니다 — 기본적으로 장면 분량의 대부분(절반을 훌쩍 넘게)이 대사여야 하고, 지문은 상황을 깔거나 진짜 전환이 있을 때만 아껴서 쓰세요. 지문이 대사 없이 두세 번 이상 연달아 나온다면, 그건 지문이 너무 많다는 신호입니다 — 줄이고 인물의 말로 그 순간을 끌고 가게 하세요. 대사로 보여줄 수 있는 감정을 지문으로 설명하지 마세요.

## 강조 표시 (중요)
- [지문] 비트 안에서 장소가 바뀌거나(예: 사무실 → 복도), 시간이 건너뛰거나(예: "그날 밤", "다음 날 아침"), 독자의 눈길을 끌어야 할 정말 중요한 대목(반전, 전환점)에 다다르면, 비트 전체가 아니라 그 구절이나 문장만 별표 두 개로 감싸세요(**이렇게**). 아껴서 쓰세요 — 시각적 강조가 정말 필요한 순간에만 쓰고, 장면이 바뀔 때마다 쓰지 마세요.`;

/** "회차챗 톤/전개 지침 노트" 설정이 지정돼 있으면 그 내용을, 아니면 DEFAULT_EPISODE_PROMPT를 반환한다. */
async function loadEpisodePromptNote(app: App, plugin: WritingMenuPlugin): Promise<string> {
	const path = plugin.settings.aiEpisodeSystemPromptNotePath?.trim();
	if (!path) return DEFAULT_EPISODE_PROMPT;
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return DEFAULT_EPISODE_PROMPT;
	const content = (await app.vault.read(file)).trim();
	return content || DEFAULT_EPISODE_PROMPT;
}

function makeKickoff(content: string) {
	return [{ role: 'user' as const, content, timestamp: Date.now() }];
}

// 플롯 본문에서 "##### 이름" 형식(캐릭터 셀)으로 명시된 인물 이름 → 그 아래 지시문 내용을 추출한다.
function extractCharacterPlotNotes(currentChapterText: string): Map<string, string> {
	const map = new Map<string, string>();
	const lines = currentChapterText.split('\n');
	const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING_RE.exec(lines[i]);
		if (!m || m[1].length !== 5) continue;
		const name = m[2].trim();
		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			const m2 = HEADING_RE.exec(lines[j]);
			if (m2 && m2[1].length <= 5) { end = j; break; }
		}
		const content = lines.slice(i + 1, end).join('\n').trim();
		if (content) map.set(name, map.has(name) ? `${map.get(name)}\n${content}` : content);
	}
	return map;
}

/** 이번 화 플롯에 실제로 등장하는 인물만 골라낸다: "##### 이름" 캐릭터 셀에 명시됐거나, 본문에 이름이 그대로 언급된 등록 인물. */
function detectInvolvedCharacters(
	plotText: string, characterFiles: TFile[], app: App, plugin: WritingMenuPlugin,
): { registered: TFile[]; unregisteredNames: string[] } {
	const plotNotes = extractCharacterPlotNotes(plotText);
	const nameToFile = new Map<string, TFile>();
	for (const f of characterFiles) nameToFile.set(getWikiDisplayName(app, plugin, f), f);

	const registered = characterFiles.filter(f => {
		const name = getWikiDisplayName(app, plugin, f);
		return plotNotes.has(name) || plotText.includes(name);
	});

	const registeredNames = new Set(registered.map(f => getWikiDisplayName(app, plugin, f)));
	const unregisteredNames = [...plotNotes.keys()].filter(name => !registeredNames.has(name));

	return { registered, unregisteredNames };
}

// 인물 노트의 "작중 행적" 표는 캐릭터가 등장한 모든 회차(현재 쓰는 회차보다 나중 회차 포함)를 요약해두는 경우가 많다.
// 이걸 그대로 프롬프트에 넣으면 아직 벌어지지 않은 미래 회차 사건이 스포일러로 새어 들어가 플롯을 오염시키므로,
// 현재 쓰는 회차 이하의 행만 남기고 잘라낸다. app.vault.read로 읽은 문자열 사본만 다루므로 원본 노트는 건드리지 않는다.
function truncateActionHistoryTable(personaContent: string, maxChapterNum: number): string {
	const lines = personaContent.split('\n');
	const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING_RE.exec(lines[i]);
		if (!m || !/작중\s*행적/.test(m[2])) continue;
		const level = m[1].length;
		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			const m2 = HEADING_RE.exec(lines[j]);
			if (m2 && m2[1].length <= level) { end = j; break; }
		}
		const section = lines.slice(i + 1, end).filter(line => {
			const cell = /^\s*\|\s*([^|]*)\|/.exec(line);
			if (!cell) return true; // 표가 아닌 줄은 그대로 둔다
			const firstCell = cell[1].trim();
			if (firstCell === '' || /^-+$/.test(firstCell) || !/\d/.test(firstCell)) return true; // 구분선·헤더 행
			const chapterMatch = /(\d+)\s*화/.exec(firstCell);
			if (!chapterMatch) return true; // 회차 번호가 아닌 셀이면 건드리지 않음
			return parseInt(chapterMatch[1], 10) <= maxChapterNum;
		});
		lines.splice(i + 1, end - (i + 1), ...section);
		break;
	}
	return lines.join('\n');
}

/** 이번 화 플롯을 "### 씬 이름" 단위로 쪼갠다. 씬 구분이 없으면 챕터 전체를 씬 하나로 취급한다. */
function splitScenes(currentChapterText: string): Array<{ name: string; text: string }> {
	const lines = currentChapterText.split('\n');
	const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
	const scenes: Array<{ name: string; text: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING_RE.exec(lines[i]);
		if (!m || m[1].length !== 3) continue;
		const name = m[2].trim();
		let end = lines.length;
		for (let j = i + 1; j < lines.length; j++) {
			const m2 = HEADING_RE.exec(lines[j]);
			if (m2 && m2[1].length <= 3) { end = j; break; }
		}
		const text = lines.slice(i, end).join('\n').trim();
		if (text) scenes.push({ name, text });
	}
	return scenes.length > 0 ? scenes : [{ name: '전체', text: currentChapterText }];
}

// [지문] 또는 [대사:화자명] 블록을 순서대로 추출한다. 장면/장소 전환이나 중요한 대목의 강조는 더 이상 별도
// 태그가 아니라 [지문] 텍스트 안의 **~** 인라인 표시로 처리한다(렌더링 시 renderNarrationText에서 파싱).
// 태그 라벨 자체는 모델이 가끔 오탈자를 내므로(예: "[지사:이름]") 라벨 글자는 느슨하게 매치하고,
// 콜론+화자명 유무로 대사/지문을 구분한다 — 대사만 콜론 뒤에 화자명이 붙는 유일한 형태이기 때문.
// 태그는 반드시 줄 시작(공백 허용)에서만 인정한다 — 그러지 않으면 지문 속 "[미래관음]" 같은 대괄호 용어도
// 태그로 오인해 문장이 중간에 잘리는 문제가 생긴다. 줄바꿈 앵커(^)를 쓰려면 m 플래그가 필요한데, m 플래그는
// $도 "줄 끝마다" 매치하게 만들어버려 마지막 태그의 내용이 첫 줄바꿈에서 잘리므로, 문자열 진짜 끝은
// (?![\s\S])로 별도 표현한다.
const SEG_RE = /^[ \t]*\[([^\]:\n]{1,6})(?::([^\]\n]+))?\][ \t]*\n?([\s\S]*?)(?=^[ \t]*\[[^\]:\n]{1,6}(?::[^\]\n]+)?\]|(?![\s\S]))/gm;

function parseDraftSegments(raw: string, nameToFile: Map<string, TFile>): EpisodeChatSegment[] {
	const segments: EpisodeChatSegment[] = [];
	let m: RegExpExecArray | null;
	SEG_RE.lastIndex = 0;
	while ((m = SEG_RE.exec(raw))) {
		const text = m[3].trim();
		if (!text) continue;
		if (m[2] === undefined) {
			segments.push({ type: 'narration', text });
		} else {
			const speakerName = m[2].trim();
			if (!speakerName) continue;
			segments.push({ type: 'dialogue', speakerName, characterPath: nameToFile.get(speakerName)?.path, text: stripWrapping(text) });
		}
	}
	return segments;
}

/**
 * 1단계(초안 패스): 이번 화의 씬 하나(예: 18-1)를 실제로 다뤄야 할 사건으로 삼고, 이전 화·이전 씬은
 * 배경 참고용으로만 곁들여 샷 단위(지문 → 여러 인물의 대사 교환)로 이어지는 초안을 생성한다.
 * 등록된 인물은 페르소나 노트 전체를, 플롯에만 이름이 나오고 등록되지 않은 인물은 그 플롯 지시문만 페르소나로 삼는다.
 * 챕터 전체가 아니라 씬 하나만 다루므로, 한 호출이 감당할 분량이 줄어 씬 각각이 더 밀도 있게 나온다.
 */
async function generateDraft(
	app: App, plugin: WritingMenuPlugin,
	apiKeys: AiChatApiKeys, model: string, temperature: number, personaHeading: string,
	toneAndDoctrine: string,
	priorHistory: string, immediatePriorChapter: string, priorScenesInChapter: string, sceneText: string,
	registeredChars: TFile[], unregisteredNames: string[], currentChapterNum: number | null,
	previousChapterBody: string | null,
): Promise<string> {
	const personaBlocks: string[] = [];
	for (const f of registeredChars) {
		const name = getWikiDisplayName(app, plugin, f);
		let body = extractPersonaContent(await app.vault.read(f), personaHeading);
		if (currentChapterNum !== null) body = truncateActionHistoryTable(body, currentChapterNum);
		personaBlocks.push(`## ${name}\n${body}`);
	}
	const plotNotes = extractCharacterPlotNotes(sceneText);
	for (const name of unregisteredNames) {
		personaBlocks.push(`## ${name} (별도 인물 노트 없음, 아래 이번 씬 플롯 지시만 참고)\n${plotNotes.get(name) ?? '(추가 지시 없음, 상황에 자연스럽게)'}`);
	}

	const priorProseBlock = previousChapterBody ? `

## 직전 회차들의 실제 본문 (문체 참고 전용 — 내용은 절대 가져오지 말 것)
바로 앞 회차(들)의 실제로 완성된 본문입니다. 문장 리듬, 지문의 어조, 대사 말투가 자연스럽게 이어지도록 문체만 참고하라고 주는 것입니다. 여기 나온 사건·대사·디테일을 그대로 가져오거나 재서술하지 마세요 — 오직 "어떻게 들리는지"만 참고 대상입니다. 여기 담긴 문체가 위 문체 지침과 충돌하면 문체 지침을 우선하세요 — 이 본문 자체에 일관성 없는 부분이 있을 수 있으니, 규칙의 근거로 삼지 말고 어디까지나 참고 자료로만 쓰세요.
${previousChapterBody}` : '';

	const systemPrompt = `## 역할
당신은 한다온, 문피아·카카오페이지·노벨피아 등 한국 상업 웹소설 시장 뒤편에서 10년 넘게 활동해 온 베테랑 유령작가입니다. 연재 순위가 흔들릴 때 편집자가 조용히 불러 "이번 화는 첫 세 줄 안에 독자를 다시 붙잡아야 한다"고 부탁하는 그런 작가입니다. 다른 작가 이름으로 액션·복수·회귀물을 여럿 대필하며, 휴대폰 화면에서 뭐가 중독성을 만드는지 몸에 새겼습니다. 당신은 몸을 사리는 규칙 준수자가 아니라, 주어진 플롯을 가장 날카롭고 생생하게 살려내는 확신에 찬 이야기꾼입니다. 플롯 충실성은 타협 불가(편집자가 아웃라인에서 벗어난 건 반려합니다)지만, 그걸 "어떻게" 풀어내느냐 — 리듬, 이미지, 보여주기와 설명하기의 배합 — 는 장면마다 당신이 그 순간에 내리는 창작적 판단입니다.

## 문체 지침
${toneAndDoctrine}${priorProseBlock}

## 맥락

**배경** (직전 회차보다 더 이전 회차들 — 인물 관계·서사 흐름 파악용일 뿐, 재서술 금지):
${priorHistory || '(없음)'}

**직전 회차** (바로 앞 회차 — 이번 플롯이 시간 경과나 장면 전환을 명시하지 않는 한, 그 회차의 마지막 상태가 이번 장면이 열리는 물리적 출발점입니다: 누가 있고, 어디에 있고, 뭘 하던 중이었는지. 사건을 재서술하지는 말되, 마지막 상태를 조용히 무시하거나 뒤집지도 마세요 — 예를 들어 술 마시다 주인공 옆에서 뻗은 채로 끝났다면, 이번 플롯이 달리 말하지 않는 한 그 사람은 여전히 뻗어 있는 상태입니다):
${immediatePriorChapter || '(없음, 1화입니다)'}

**이번 화 이전 씬** (바로 직전에 무슨 일이 있었는지, 연속성용):
${priorScenesInChapter || '(없음, 이번 화의 첫 씬입니다)'}

**이번 씬의 플롯** (실제로 극화해야 할 사건 — 여기 적힌 것만 다루세요):
${sceneText}

**등장인물** (아래 목록에 있는 인물만 등장시키세요; 프로필에 예시 대사나 말버릇이 있다면 목소리 참고용일 뿐 절대 그대로 베끼지 말고, 그 목소리에 맞는 새 대사를 지어내세요):
${personaBlocks.join('\n\n') || '(등장인물 없음 — 이 씬의 플롯에 이름이 명시되어 있지 않습니다. 필요하면 이름 없는 배경 인물을 등장시키세요.)'}

## 지시사항
1. **구상**: "이번 씬의 플롯"이 암시하는 구체적인 순간들을 파악하고, 이를 지문 비트와 대사 교환의 흐름으로 어떻게 나눌지 정하세요 — 이 구성은 정해진 공식이 아니라 당신의 창작적 판단입니다. "이번 씬의 플롯"에 적힌 것 이상으로 사건·이름·정보를 지어내지 말고, "배경"이나 "이번 화 이전 씬"을 재서술하지 마세요. 이번 화의 첫 씬이라면, 먼저 "직전 회차"의 마지막 상태(같은 장소, 같은 순간)에서 곧바로 이어지는지 확인하고, 그렇다면 그 상태를 조용히 리셋하지 말고 그대로 이어서 여세요.
2. **집필**: 위 문체 지침의 톤·리듬·문장 감각을 따라 전적인 창작적 몰입으로 그 흐름을 극화하세요. 이번 호출은 씬 하나만 다루니 서두르지 말고 비트를 자세히 보여주세요. 주어진 플롯 이상의 내용이나 상투적인 필러로 분량을 채우지 마세요 — 억지로 늘이는 것보다 자연스럽고 정직하게 멈추는 편이 낫습니다.
3. **검증**: 마무리하기 전에 아래 제약 사항(스타일 제안이 아니라 반드시 지켜야 할 규칙입니다)에 어긋나지 않는지 확인하고 위반이 있으면 고치세요.
4. **형식**: 아래 출력 형식을 엄격히 따라 그 외엔 아무것도 출력하지 마세요.

## 제약
아래는 장면이 정상적으로 파싱되고 아웃라인에 충실하도록 지키는 항목들입니다 — 문체 지침과 상충하는 것처럼 보여도 절대 완화하지 마세요.
- **플롯 충실성**: "이번 씬의 플롯"에 적힌 것만 극화하세요. 거기나 "배경"/"직전 회차"에 없는 사건·복선·정보를 새로 넣지 마세요.
- **등장인물 통제**: "등장인물" 목록에 없는 이름 있는 인물을 새로 등장시키지 마세요 (이름 없는 단역, 예: "경비원" 정도는 분위기상 필요하면 괜찮습니다).
- **태그 위생**: [대사:이름] 태그에는 그 인물이 그 순간 실제로 입 밖으로 낸 말만 들어가야 합니다 — 그 외엔 아무것도 넣지 마세요. 내적 독백, 문자메시지를 보고 드는 생각, 화면에 뜬 내용 묘사 등 지문 성격의 내용은 1인칭이든 인용부호가 있든 반드시 [지문] 태그에 넣으세요. 예를 들어 "메시지를 봤다. '수고했다는 문자였다. 심장이 뛰었다'"는 문자메시지에 대한 반응을 서술하는 지문이지, 인용구가 있다고 해서 [대사:이름]에 들어가면 안 됩니다.
- **언어**: 장면 전체를 자연스럽고 유창한 한국어로 쓰세요. 태그 라벨(지문/대사)과 강조 표시(**)만 정해진 그대로 유지하고, 그 외엔 영어를 절대 출력하지 마세요.

## 출력 형식
아래 태그들의 나열만 필요한 만큼 반복해서 응답하세요. 제목, 설명, 서두 없이.
[지문] (지문: 상황/분위기/심리, 비트가 필요할 때만. 대사를 인용하지 마세요. 강조 표시 규칙에 해당하면 중요한 구절을 **이렇게** 감싸세요.)
[대사:이름] (그 인물이 실제로 입 밖으로 낸 말만. 큰따옴표, 지문, 내적 생각, 메시지/화면/사물 묘사를 섞지 마세요.)`;

	// 모델별 출력 토큰 한도에 최대한 맞춰서 뽑아낸다(gemini-3.1-flash-lite 65536, gemma-4-31b-it 32768, NVIDIA
	// diffusiongemma-26b는 32768까지 실측 확인됨) — 세 모델 모두에서 안전한 공통값으로 32768을 쓴다.
	return callAiChat(apiKeys, systemPrompt, makeKickoff('이 장면을 써주세요.'), temperature, model, 32768);
}

function turnToPlainText(seg: EpisodeChatSegment): string {
	return seg.type === 'dialogue' ? `${seg.speakerName}: ${seg.text}` : seg.text;
}

/**
 * 회차 플롯을 파싱해 등장인물끼리 대화를 주고받는 씬들을 자동 생성한다.
 * 0) 이번 화 플롯을 "### 씬" 단위로 쪼개고, 씬마다 실제로 이름이 나오는 인물만 골라낸다 (등록 인물 + 이름만 있는 미등록 인물).
 * 1) 씬마다 초안 패스(1회 호출)로 지문+대사가 자연스럽게 섞인 초안을 쓴다 — 챕터 전체를 한 번에 쓰지 않고
 *    씬 단위로 쪼개 호출해야, 한 호출이 감당할 분량이 줄어 씬 각각이 더 밀도 있게 나온다.
 * (예전엔 초안 뒤에 인물별 대사 검수 패스를 별도로 돌렸지만, 에피소드 플롯 노트 자체에 인물별 감정선·말투
 * 지시가 이미 담겨 있어 중복이라 판단해 제거함 — 이제 초안 패스 결과를 그대로 쓴다.)
 */
export async function generateEpisodeScene(
	app: App, plugin: WritingMenuPlugin,
	plotHistory: PlotHistoryContext, characterFiles: TFile[],
	apiKeys: AiChatApiKeys, model: string, temperature: number, personaHeading: string,
	previousChapterBody: string | null,
	onProgress?: (status: string) => void,
): Promise<EpisodeChatSegment[]> {
	const scenes = splitScenes(plotHistory.currentChapter);
	const nameToFile = new Map<string, TFile>();
	for (const f of characterFiles) nameToFile.set(getWikiDisplayName(app, plugin, f), f);

	const chapterNumMatch = /^##\s*(\d+)\s*화/.exec(plotHistory.currentChapter);
	const currentChapterNum = chapterNumMatch ? parseInt(chapterNumMatch[1], 10) : null;

	const toneAndDoctrine = await loadEpisodePromptNote(app, plugin);

	const allSegments: EpisodeChatSegment[] = [];
	let priorScenesText = '';

	for (let i = 0; i < scenes.length; i++) {
		const scene = scenes[i];
		onProgress?.(`${scene.name} 초안을 쓰는 중... (${i + 1}/${scenes.length})`);

		const { registered, unregisteredNames } = detectInvolvedCharacters(scene.text, characterFiles, app, plugin);

		const raw = await generateDraft(
			app, plugin, apiKeys, model, temperature, personaHeading, toneAndDoctrine,
			plotHistory.priorHistory, plotHistory.immediatePriorChapter, priorScenesText, scene.text, registered, unregisteredNames, currentChapterNum,
			previousChapterBody,
		);
		const sceneSegments = parseDraftSegments(raw, nameToFile);
		if (sceneSegments.length === 0) throw new Error(`${scene.name} 장면을 해석하지 못했습니다 (모델 응답 형식이 예상과 다름). 다시 시도해 주세요.`);

		allSegments.push({ type: 'scene-divider', sceneName: scene.name, text: scene.name });
		allSegments.push(...sceneSegments);
		priorScenesText += `\n${sceneSegments.map(turnToPlainText).join('\n')}`;
	}

	return allSegments;
}
