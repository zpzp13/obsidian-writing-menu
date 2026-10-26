// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwpx/para-heading.ts. MIT; see LICENSE.
import { hangulOrdinal, circledNumber, circledHangul, romanNumeral } from "../shared/numbering.js";
const HANGUL_JAMO_SEQ = "\u3131\u3134\u3137\u3139\u3141\u3142\u3145\u3147\u3148\u314A\u314B\u314C\u314D\u314E";
function formatHeadNumber(n, numFormat) {
  if (n === 0 && numFormat === "DIGIT")
    return "0";
  if (n <= 0)
    n = 1;
  switch (numFormat) {
    case "DIGIT":
      return String(n);
    case "CIRCLED_DIGIT":
      return n <= 50 ? circledNumber(n - 1) : `(${n})`;
    case "HANGUL_SYLLABLE":
      return hangulOrdinal(n - 1);
    case "CIRCLED_HANGUL_SYLLABLE":
      return n <= 14 ? circledHangul(n - 1) : hangulOrdinal(n - 1);
    case "HANGUL_JAMO":
      return HANGUL_JAMO_SEQ[(n - 1) % HANGUL_JAMO_SEQ.length];
    case "CIRCLED_HANGUL_JAMO":
      return n <= 14 ? String.fromCodePoint(12896 + n - 1) : HANGUL_JAMO_SEQ[(n - 1) % 14];
    case "LATIN_CAPITAL":
      return String.fromCharCode(65 + (n - 1) % 26);
    case "LATIN_SMALL":
      return String.fromCharCode(97 + (n - 1) % 26);
    case "CIRCLED_LATIN_CAPITAL":
      return n <= 26 ? String.fromCodePoint(9398 + n - 1) : String.fromCharCode(65 + (n - 1) % 26);
    case "CIRCLED_LATIN_SMALL":
      return n <= 26 ? String.fromCodePoint(9424 + n - 1) : String.fromCharCode(97 + (n - 1) % 26);
    case "ROMAN_CAPITAL":
      return romanNumeral(n, true);
    case "ROMAN_SMALL":
      return romanNumeral(n, false);
    default:
      return String(n);
  }
}
function resolveParaHeading(paraEl, ctx) {
  const sm = ctx.styleMap;
  if (!sm)
    return null;
  const styleId = paraEl.getAttribute("styleIDRef");
  let styleHeading;
  if (styleId && styleId !== "0") {
    const st = sm.styles.get(styleId);
    const m = st && /^개요\s*([1-6])$/.exec(st.name);
    if (m)
      styleHeading = Math.min(parseInt(m[1], 10), 6);
  }
  const prId = paraEl.getAttribute("paraPrIDRef");
  if (!prId)
    return styleHeading ? { headingLevel: styleHeading } : null;
  const ref = sm.paraHeadings.get(prId);
  if (!ref)
    return styleHeading ? { headingLevel: styleHeading } : null;
  if (ref.type === "BULLET") {
    const char = sm.bullets.get(ref.idRef);
    return char ? { prefix: char } : null;
  }
  const numId = ref.type === "OUTLINE" ? ctx.outlineNumId || "1" : ref.idRef;
  const level = Math.min(ref.level + 1, 10);
  const headingLevel = ref.type === "OUTLINE" ? Math.min(ref.level + 1, 6) : void 0;
  const numDef = sm.numberings.get(numId);
  if (!numDef)
    return headingLevel ? { headingLevel } : null;
  let counters = ctx.shared.numState.get(numId);
  if (!counters) {
    counters = new Array(11).fill(-1);
    ctx.shared.numState.set(numId, counters);
  }
  const head = numDef.heads.get(level);
  counters[level] = counters[level] < 0 ? head?.start ?? 1 : counters[level] + 1;
  for (let l = level + 1; l <= 10; l++)
    counters[l] = -1;
  const fmtText = head ? head.text.trim() : `^${level}.`;
  const prefix = fmtText.replace(/\^(10|[1-9])/g, (_, d) => {
    const lv = parseInt(d, 10);
    const refHead = numDef.heads.get(lv);
    const n = counters[lv] >= 0 ? counters[lv] : refHead?.start ?? 1;
    return formatHeadNumber(n, refHead?.numFormat || "DIGIT");
  }).replace(/\^(?![\p{L}\p{N}])/gu, "").trim();
  return { prefix: prefix || void 0, headingLevel };
}
export {
  formatHeadNumber,
  resolveParaHeading
};
