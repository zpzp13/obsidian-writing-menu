// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/para-number.ts. MIT; see LICENSE.
const HANGUL_SYLLABLE = "\uAC00\uB098\uB2E4\uB77C\uB9C8\uBC14\uC0AC\uC544\uC790\uCC28\uCE74\uD0C0\uD30C\uD558";
const HANGUL_JAMO = "\u3131\u3134\u3137\u3139\u3141\u3142\u3145\u3147\u3148\u314A\u314B\u314C\u314D\u314E";
const IDEOGRAPH = "\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D\u4E03\u516B\u4E5D\u5341";
function roman(n) {
  const t = [[1e3, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t)
    while (n >= v) {
      s += r;
      n -= v;
    }
  return s;
}
function formatHeadNumber(n, format) {
  const cyc = (set) => set[(n - 1) % set.length];
  switch (format) {
    case "HANGUL_SYLLABLE":
      return cyc(HANGUL_SYLLABLE);
    case "HANGUL_JAMO":
      return cyc(HANGUL_JAMO);
    case "CIRCLED_DIGIT":
      return n >= 1 && n <= 20 ? String.fromCodePoint(9311 + n) : String(n);
    case "CIRCLED_HANGUL_SYLLABLE":
      return String.fromCodePoint(12910 + (n - 1) % 14);
    case "CIRCLED_HANGUL_JAMO":
      return String.fromCodePoint(12896 + (n - 1) % 14);
    case "LATIN_SMALL":
      return String.fromCharCode(97 + (n - 1) % 26);
    case "LATIN_CAPITAL":
      return String.fromCharCode(65 + (n - 1) % 26);
    case "ROMAN_SMALL":
      return roman(n).toLowerCase();
    case "ROMAN_CAPITAL":
      return roman(n);
    case "IDEOGRAPH":
      return n >= 1 && n <= 10 ? IDEOGRAPH[n - 1] : String(n);
    default:
      return String(n);
  }
}
function nextParaNumber(counters, geom) {
  const num = geom?.number;
  if (!num)
    return "";
  const cur = counters.get(num.id) ?? [];
  const head = num.heads.get(num.level);
  cur[num.level] = (cur[num.level] ?? (head?.start ?? 1) - 1) + 1;
  cur.length = num.level + 1;
  counters.set(num.id, cur);
  return (head?.text ?? "").replace(/\^(\d)?/g, (_m, d) => {
    if (d === void 0)
      return "";
    const lv = Number(d), h = num.heads.get(lv);
    return formatHeadNumber(cur[lv] ?? h?.start ?? 1, h?.format ?? "DIGIT");
  });
}
export {
  formatHeadNumber,
  nextParaNumber
};
