// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/shared/pua.ts. MIT; see LICENSE.
import { wingdingsChar } from "./symbol-fonts.js";
import { circledNumber } from "./numbering.js";
const BMP_SYMBOL_MAP = {
  // 도형/기호
  108: "\u25CF",
  // ●
  109: "\u25CF",
  // ● (그림자 원 근사)
  110: "\u25A0",
  // ■
  111: "\u25A1",
  // □
  112: "\u25A1",
  // □ (굵은 흰 사각 근사)
  113: "\u25A1",
  // □ (그림자 근사)
  114: "\u25A1",
  // □ (그림자 근사)
  115: "\u2B27",
  // ⬧
  116: "\u29EB",
  // ⧫
  117: "\u25C6",
  // ◆
  118: "\u2756",
  // ❖
  119: "\u2B25",
  // ⬥
  // 체크/별/점
  158: "\xB7",
  // ·
  159: "\u2022",
  // •
  160: "\xB7",
  // · (한컴 PDF 정답지 정합 — ▪ 아님)
  161: "\u26AA",
  // ⚪
  162: "\u25CB",
  // ○
  163: "\u25CB",
  // ○
  164: "\u25C9",
  // ◉
  165: "\u25CE",
  // ◎
  167: "\u25AA",
  // ▪
  168: "\u25FB",
  // ◻
  170: "\u2726",
  // ✦
  171: "\u2605",
  // ★
  172: "\u2736",
  // ✶
  173: "\u2734",
  // ✴
  174: "\u2739",
  // ✹
  // 손 모양
  69: "\u261C",
  // ☜
  70: "\u261E",
  // ☞
  71: "\u261D",
  // ☝
  72: "\u261F",
  // ☟
  // 체크마크
  251: "\u2717",
  // ✗
  252: "\u2714",
  // ✔
  253: "\u2612",
  // ☒
  254: "\u2611",
  // ☑
  // 화살표
  232: "\u2794",
  // ➔ (heavy wide-headed — 한컴 PDF 정답지 정합)
  239: "\u21E6",
  // ⇦
  240: "\u21E8",
  // ⇨
  241: "\u21E7",
  // ⇧
  242: "\u21E9",
  // ⇩
  // 기타
  34: "\u2702",
  // ✂
  54: "\u231B",
  // ⌛
  74: "\u263A",
  // ☺
  78: "\u2620",
  // ☠
  82: "\u263C",
  // ☼
  84: "\u2744",
  // ❄
  88: "\u2720",
  // ✠
  89: "\u2721"
  // ✡
};
const SUPPLEMENTARY_MAP = {
  983099: "\u2193",
  // ↓
  983791: "\xB7",
  // ·
  985172: "\u300A",
  // 《
  985173: "\u300B",
  // 》
  // 네모 안 "예" — 예시 표지(편람 "[예] 여자(女子)", 시험지 "관계([예]단풍 철:철 성분)"). 한컴 글꼴 6종의 글리프와
  // 시험지 PDF 에 찍힌 윤곽 모두 네모 안 예다(종전 ▸)
  983258: "[\uC608]",
  985103: "\u2501",
  // ━
  985127: "\u25A0",
  // ■
  984005: "\u25A1",
  // □ 글머리 — HWP3→HWP5 한컴 변환본 보존 코드, 한컴오피스 표시값 (rhwp #1105)
  // 아래 5종 — rhwp 44cabad9 verified_hancom_pua 표 (한컴 PDF 대조 확정)
  983339: "(\uC778)",
  // 결재·서명란
  // 한컴 PDF 실렌더 대조(v4.12.3): 네모 테두리 안 "인" 글리프 — 결재 위치("수련치과병원장"·"청원주"·"경찰서장"
  // 뒤, licbyl2 17754757·17975885). HWP5 에는 A0E1 로 접혀 저장(record.ts PUA-A 접힘 해제)
  983265: "(\uC778)",
  983804: "\u25BA",
  // 2025 행정업무운영 편람 callout 글머리
  983836: "\u25A0",
  // 2025 행정업무운영 편람 목차 글머리
  983968: "\u21B5",
  // 하이퍼텍스트 안내문의 Enter 키 픽토그램
  // 머리말 회사명 6자 (HWP3 johab 0x37C0~0x37C5의 HWP5/HWPX 변환본 대응 코드)
  984047: "\uD55C",
  984048: "\uAE00",
  984049: "\uACFC",
  984050: "\uCEF4",
  984051: "\uD4E8",
  984052: "\uD130",
  // 아래는 rhwp VERIFIED_HANCOM_PUA_DISPLAY(한컴 PDF 대조 확정표)에서 kordoc 에만
  // 빠져 있던 항목. 매핑이 없으면 sanitizeText 가 지워 글자가 사라진다 —
  // hwp3-sample11 한 문서에서만 괘선 조각·원문자 57자가 그렇게 증발했다.
  983184: "\u273A",
  // 물방울 asterisk 글머리
  // 원 숫자·네모 숫자(U+F0288~F029B·F02B0~F02CC)는 아래 번호 글리프 규칙
  983788: "\u25C7",
  // 작은 빈 마름모 글머리
  983803: "\u25B8",
  // 중첩 표 글머리
  983975: "\u229F",
  // 둥근 네모 안 −
  983976: "\u229E",
  // 둥근 네모 안 +
  984026: "\u25A1",
  // 둥근 모서리 빈 네모 글머리
  984063: "\u25A1",
  // 표 셀 제목 빈 네모 글머리
  985094: "\u250C",
  // 텍스트 다이어그램 괘선 조각
  985095: "\u252C",
  985096: "\u2510",
  985100: "\u2514",
  985102: "\u2518",
  985104: "\u2502",
  985116: "\u2508",
  // 점선 괘선 조각
  985138: "\u2550",
  // 이중 가로 괘선 조각
  985160: "\u2501"
  // 굵은 가로 막대 글머리
};
function enclosedNumber(n) {
  return n === 0 ? "\u24EA" : circledNumber(n - 1);
}
function tensDigit(code) {
  if (code >= 983688 && code <= 983697)
    return code - 983688;
  if (code >= 983738 && code <= 983746)
    return code - 983737;
  return void 0;
}
function unitsDigit(code) {
  if (code >= 983698 && code <= 983707)
    return code - 983698;
  if (code >= 983747 && code <= 983756)
    return code - 983747;
  return void 0;
}
function numberGlyph(code) {
  const t = tensDigit(code);
  if (t !== void 0)
    return enclosedNumber(t);
  if (code >= 983728 && code <= 983737)
    return enclosedNumber(code - 983728);
  const u = unitsDigit(code);
  return u === void 0 ? void 0 : String(u);
}
function pairedNumber(a, b) {
  const t = tensDigit(a.codePointAt(0) ?? 0), u = unitsDigit(b.codePointAt(0) ?? 0);
  return t !== void 0 && u !== void 0 ? enclosedNumber(t * 10 + u) : void 0;
}
function composeText(chars, enclosed) {
  return enclosed && /^\d{1,2}$/.test(chars) ? enclosedNumber(Number(chars)) : chars;
}
function mapPuaChar(code) {
  if (code >= 61472 && code <= 61695) {
    return BMP_SYMBOL_MAP[code - 61440] ?? wingdingsChar(code - 61440);
  }
  if (code >= 983040 && code <= 985599) {
    return numberGlyph(code) ?? SUPPLEMENTARY_MAP[code];
  }
  return void 0;
}
function mapPuaText(text) {
  let out = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const pair = i + 1 < chars.length ? pairedNumber(chars[i], chars[i + 1]) : void 0;
    if (pair !== void 0) {
      out += pair;
      i++;
      continue;
    }
    out += mapPuaChar(chars[i].codePointAt(0)) ?? chars[i];
  }
  return out;
}
export {
  composeText,
  enclosedNumber,
  mapPuaText,
  pairedNumber
};
