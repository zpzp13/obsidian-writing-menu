// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwp5/equation.ts. MIT; see LICENSE.
import { CONVERT_MAP, MIDDLE_CONVERT_MAP, hmlToLatex } from "../hwpx/equation.js";
const WORD_ALIASES = {
  // 삼각/로그 함수 — 정본 맵 부재
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  sec: "\\sec",
  csc: "\\csc",
  cot: "\\cot",
  log: "\\log",
  ln: "\\ln",
  // 연산자·관계 기호 (정본은 대문자 키만 보유)
  divide: "\\div",
  div: "\\div",
  le: "\\leq",
  ge: "\\geq",
  geq: "\\geq",
  deg: "^\\circ",
  rarrow: "\\rightarrow",
  lrarrow: "\\leftrightarrow",
  rightarrow: "\\rightarrow",
  leftarrow: "\\leftarrow",
  in: "\\in",
  notin: "\\notin",
  emptyset: "\\emptyset",
  subset: "\\subset",
  nsubset: "\\nsubseteq",
  cup: "\\cup",
  cap: "\\cap",
  smallinter: "\\cap",
  smallsum: "\\sum",
  sim: "\\sim",
  circ: "\\circ",
  bot: "\\perp",
  partial: "\\partial",
  nabla: "\\nabla",
  angle: "\\angle",
  triangle: "\\triangle",
  inf: "\\infty",
  left: "\\left",
  right: "\\right",
  // 글꼴 지시자 — 제거
  rm: "",
  it: ""
};
const STRUCTURAL_FOLD = /* @__PURE__ */ new Set(["over", "root", "of"]);
function normalizeWords(input) {
  return input.replace(/(?<![\\A-Za-z0-9])([A-Za-z][A-Za-z0-9]*)(?![A-Za-z0-9])/g, (word) => {
    if (Object.hasOwn(CONVERT_MAP, word) || Object.hasOwn(MIDDLE_CONVERT_MAP, word))
      return word;
    const lower = word.toLowerCase();
    if (STRUCTURAL_FOLD.has(lower))
      return lower;
    if (Object.hasOwn(WORD_ALIASES, lower))
      return WORD_ALIASES[lower];
    if (lower !== word && (Object.hasOwn(CONVERT_MAP, lower) || Object.hasOwn(MIDDLE_CONVERT_MAP, lower)))
      return lower;
    return word;
  });
}
function normalizeScripts(input) {
  return input.replace(/\s*\^\s*/g, "^").replace(/\s*_\s*/g, "_").replace(/\^(?!\{)([^\s{}_^]+)/g, "^{$1}").replace(/_(?!\{)([^\s{}_^]+)/g, "_{$1}").replace(/([_^])/g, " $1 ");
}
function normalizeOperators(input) {
  return input.replace(/\+-/g, " \\pm ").replace(/-\+/g, " \\mp ").replace(/\/\//g, " \\parallel ").replace(/!=/g, " \\neq ").replace(/<=/g, " \\leq ").replace(/>=/g, " \\geq ").replace(/==/g, " \\equiv ").replace(/△/g, " \\triangle ").replace(/□/g, " \\square ").replace(/‧/g, " \\cdot ");
}
function hwpEquationToLatex(equation) {
  let s = equation.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (!s)
    return "";
  s = normalizeScripts(s);
  s = normalizeOperators(s);
  s = normalizeWords(s);
  s = s.replace(/\broot\s+(?!\{)(\S+)\s+of(?![A-Za-z0-9])/gi, "root { $1 } of");
  return hmlToLatex(s).replace(/\s+/g, " ").trim();
}
export {
  hwpEquationToLatex
};
