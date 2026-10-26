// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwpx/equation.ts. MIT; see LICENSE.
const CONVERT_MAP = {
  TIMES: "\\times",
  times: "\\times",
  LEFT: "\\left",
  RIGHT: "\\right",
  under: "\\underline",
  SMALLSUM: "\\sum",
  sum: "\\sum",
  SMALLPROD: "\\prod",
  prod: "\\prod",
  SMALLINTER: "\\cap",
  CUP: "\\cup",
  OPLUS: "\\oplus",
  OMINUS: "\\ominus",
  OTIMES: "\\otimes",
  ODIV: "\\oslash",
  ODOT: "\\odot",
  LOR: "\\lor",
  LAND: "\\land",
  SUBSET: "\\subset",
  SUPERSET: "\\supset",
  SUBSETEQ: "\\subseteq",
  SUPSETEQ: "\\supseteq",
  IN: "\\in",
  OWNS: "\\owns",
  NOTIN: "\\notin",
  LEQ: "\\leq",
  GEQ: "\\geq",
  "<<": "\\ll",
  ">>": "\\gg",
  "<<<": "\\lll",
  ">>>": "\\ggg",
  PREC: "\\prec",
  SUCC: "\\succ",
  UPLUS: "\\uplus",
  "\xB1": "\\pm",
  "+-": "\\pm",
  "-+": "\\mp",
  "\xF7": "\\div",
  cdot: "\\cdot",
  CIRC: "\\circ",
  BULLET: "\\bullet",
  DEG: " ^\\circ",
  AST: "\\ast",
  STAR: "\\bigstar",
  BIGCIRC: "\\bigcirc",
  EMPTYSET: "\\emptyset",
  THEREFORE: "\\therefore",
  BECAUSE: "\\because",
  EXIST: "\\exists",
  // 한글 수식 편집기는 소문자 therefore·because 도 같은 기호로 그린다(#148) — 생성 쪽 정준형은 대문자(equation-generate COMMAND_MAP)
  therefore: "\\therefore",
  because: "\\because",
  "!=": "\\neq",
  SMCOPROD: "\\coprod",
  coprod: "\\coprod",
  SQCAP: "\\sqcap",
  SQCUP: "\\sqcup",
  SQSUBSET: "\\sqsubset",
  SQSUBSETEQ: "\\sqsubseteq",
  BIGSQCUP: "\\bigsqcup",
  BIGOPLUS: "\\bigoplus",
  BIGOTIMES: "\\bigotimes",
  BIGODOT: "\\bigodot",
  BIGUPLUS: "\\biguplus",
  inter: "\\bigcap",
  union: "\\bigcup",
  BIGOMINUS: "{\\Large\\ominus}",
  BIGODIV: "{\\Large\\oslash}",
  UNDEROVER: "",
  SIM: "\\sim",
  APPROX: "\\approx",
  SIMEQ: "\\simeq",
  CONG: "\\cong",
  "==": "\\equiv",
  DIAMOND: "\\diamond",
  FORALL: "\\forall",
  prime: "'",
  Partial: "\\partial",
  INF: "\\infty",
  PROPTO: "\\propto",
  lim: "\\lim",
  Lim: "\\lim",
  larrow: "\\leftarrow",
  "->": "\\rightarrow",
  uparrow: "\\uparrow",
  downarrow: "\\downarrow",
  LARROW: "\\Leftarrow",
  RARROW: "\\Rightarrow",
  UPARROW: "\\Uparrow",
  DOWNARROW: "\\Downarrow",
  udarrow: "\\updownarrow",
  "<->": "\\leftrightarrow",
  UDARROW: "\\Updownarrow",
  LRARROW: "\\Leftrightarrow",
  NWARROW: "\\nwarrow",
  SEARROW: "\\searrow",
  NEARROW: "\\nearrow",
  SWARROW: "\\swarrow",
  HOOKLEFT: "\\hookleftarrow",
  HOOKRIGHT: "\\hookrightarrow",
  PVER: "\\|",
  MAPSTO: "\\mapsto",
  CDOTS: "\\cdots",
  LDOTS: "\\ldots",
  VDOTS: "\\vdots",
  DDOTS: "\\ddots",
  DAGGER: "\\dagger",
  DDAGGER: "\\ddagger",
  DOTEQ: "\\doteq",
  image: "\\fallingdotseq",
  REIMAGE: "\\risingdotseq",
  ASYMP: "\\asymp",
  ISO: "\\Bumpeq",
  DSUM: "\\dotplus",
  XOR: "\\veebar",
  TRIANGLE: "\\triangle",
  NABLA: "\\nabla",
  ANGLE: "\\angle",
  MSANGLE: "\\measuredangle",
  SANGLE: "\\sphericalangle",
  VDASH: "\\vdash",
  DASHV: "\\dashv",
  BOT: "\\bot",
  TOP: "\\top",
  MODELS: "\\models",
  LAPLACE: "\\mathcal{L}",
  CENTIGRADE: "^{\\circ}C",
  FAHRENHEIT: "^{\\circ}F",
  LSLANT: "\\diagup",
  RSLANT: "\\diagdown",
  sqrt: "\\sqrt",
  int: "\\int",
  dint: "\\iint",
  tint: "\\iiint",
  oint: "\\oint",
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
  delta: "\\delta",
  epsilon: "\\epsilon",
  zeta: "\\zeta",
  eta: "\\eta",
  theta: "\\theta",
  iota: "\\iota",
  kappa: "\\kappa",
  lambda: "\\lambda",
  mu: "\\mu",
  nu: "\\nu",
  xi: "\\xi",
  omicron: "\\omicron",
  pi: "\\pi",
  rho: "\\rho",
  sigma: "\\sigma",
  tau: "\\tau",
  upsilon: "\\upsilon",
  phi: "\\phi",
  chi: "\\chi",
  psi: "\\psi",
  omega: "\\omega",
  ALPHA: "A",
  BETA: "B",
  GAMMA: "\\Gamma",
  DELTA: "\\Delta",
  EPSILON: "E",
  ZETA: "Z",
  ETA: "H",
  THETA: "\\Theta",
  IOTA: "I",
  KAPPA: "K",
  LAMBDA: "\\Lambda",
  MU: "M",
  NU: "N",
  XI: "\\Xi",
  OMICRON: "O",
  PI: "\\Pi",
  RHO: "P",
  SIGMA: "\\Sigma",
  TAU: "T",
  UPSILON: "\\Upsilon",
  PHI: "\\Phi",
  CHI: "X",
  PSI: "\\Psi",
  OMEGA: "\\Omega",
  "\u2308": "\\lceil",
  "\u2309": "\\rceil",
  "\u230A": "\\lfloor",
  "\u230B": "\\rfloor",
  "\u2225": "\\|",
  "\u2290": "\\sqsupset",
  "\u2292": "\\sqsupseteq",
  odint: "\\mathop \u222F",
  otint: "\\mathop \u2230",
  BIGSQCAP: "\\mathop \u2A05",
  ATT: "\\mathop \u203B",
  HUND: "\\mathop \u2030",
  THOU: "\\mathop \u2031",
  IDENTICAL: "\\mathop \u2237",
  RTANGLE: "\\mathop \u22BE",
  BASE: "\\mathop \u2302",
  BENZENE: "\\mathop \u232C"
};
const MIDDLE_CONVERT_MAP = {
  matrix: "HULKMATRIX",
  pmatrix: "HULKPMATRIX",
  bmatrix: "HULKBMATRIX",
  dmatrix: "HULKDMATRIX",
  eqalign: "HULKEQALIGN",
  cases: "HULKCASE",
  vec: "HULKVEC",
  dyad: "HULKDYAD",
  acute: "HULKACUTE",
  grave: "HULKGRAVE",
  dot: "HULKDOT",
  ddot: "HULKDDOT",
  bar: "HULKBAR",
  hat: "HULKHAT",
  check: "HULKCHECK",
  arch: "HULKARCH",
  tilde: "HULKTILDE",
  BOX: "HULKBOX",
  OVERBRACE: "HULKOVERBRACE",
  UNDERBRACE: "HULKUNDERBRACE"
};
const BAR_CONVERT_MAP = {
  HULKVEC: "\\overrightarrow",
  HULKDYAD: "\\overleftrightarrow",
  HULKACUTE: "\\acute",
  HULKGRAVE: "\\grave",
  HULKDOT: "\\dot",
  HULKDDOT: "\\ddot",
  HULKBAR: "\\overline",
  HULKHAT: "\\widehat",
  HULKCHECK: "\\check",
  HULKARCH: "\\overset{\\frown}",
  HULKTILDE: "\\widetilde",
  HULKBOX: "\\boxed"
};
const MATRIX_CONVERT_MAP = {
  HULKMATRIX: { begin: "\\begin{matrix}", end: "\\end{matrix}", removeOutterBrackets: true },
  HULKPMATRIX: { begin: "\\begin{pmatrix}", end: "\\end{pmatrix}", removeOutterBrackets: true },
  HULKBMATRIX: { begin: "\\begin{bmatrix}", end: "\\end{bmatrix}", removeOutterBrackets: true },
  HULKDMATRIX: { begin: "\\begin{vmatrix}", end: "\\end{vmatrix}", removeOutterBrackets: true },
  HULKCASE: { begin: "\\begin{cases}", end: "\\end{cases}", removeOutterBrackets: true },
  HULKEQALIGN: { begin: "\\eqalign{", end: "}", removeOutterBrackets: false }
};
const BRACE_CONVERT_MAP = {
  HULKOVERBRACE: "\\overbrace",
  HULKUNDERBRACE: "\\underbrace"
};
function findBrackets(eqString, startIdx) {
  const startCur = eqString.indexOf("{", startIdx);
  if (startCur === -1)
    throw new Error("cannot find bracket");
  let bracketCount = 1;
  for (let i = startCur + 1; i < eqString.length; i++) {
    const ch = eqString[i];
    if (ch === "{")
      bracketCount += 1;
    else if (ch === "}")
      bracketCount -= 1;
    if (bracketCount === 0)
      return [startCur, i + 1];
  }
  throw new Error("cannot find bracket");
}
function findOutterBrackets(eqString, startIdx) {
  const outer = findEnclosingBrackets(eqString, startIdx);
  if (!outer)
    throw new Error("cannot find bracket");
  return outer;
}
function findEnclosingBrackets(eqString, startIdx) {
  let depth = 0;
  for (let idx = startIdx - 1; idx >= 0; idx--) {
    const ch = eqString[idx];
    if (ch === "}") {
      depth += 1;
    } else if (ch === "{") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      try {
        const [start, end] = findBrackets(eqString, idx);
        if (start === idx && end > startIdx)
          return [start, end];
      } catch {
        return null;
      }
      return null;
    }
  }
  return null;
}
function maskLiteralSpans(eqString) {
  return eqString.replace(/"[^"]*"/g, (m) => "\uFFFF".repeat(m.length)).replace(/\\text\{[^}]*\}/g, (m) => "\uFFFF".repeat(m.length));
}
function findKeywordToken(eqString, word, from = 0) {
  const masked = maskLiteralSpans(eqString);
  for (let i = masked.indexOf(word, from); i !== -1; i = masked.indexOf(word, i + 1)) {
    const okL = i === 0 || /\s/.test(masked[i - 1]);
    const okR = i + word.length === masked.length || /\s/.test(masked[i + word.length]);
    if (okL && okR)
      return i;
  }
  return -1;
}
function replaceFrac(eqString) {
  const hmlFrac = "over";
  const masked = maskLiteralSpans(eqString);
  const out = [];
  let pos = 0;
  for (let cursor = masked.indexOf(hmlFrac); cursor !== -1; cursor = masked.indexOf(hmlFrac, cursor + 1)) {
    const okL = cursor === 0 || /\s/.test(masked[cursor - 1]);
    const okR = cursor + hmlFrac.length === masked.length || /\s/.test(masked[cursor + hmlFrac.length]);
    if (!okL || !okR)
      continue;
    for (; pos < cursor; pos++)
      out.push(eqString[pos]);
    let end = out.length;
    while (end > 0 && /\s/.test(out[end - 1]))
      end--;
    let numStart = end;
    if (end > 0 && out[end - 1] === "}") {
      let depth = 0;
      for (numStart = end - 1; numStart >= 0; numStart--) {
        if (out[numStart] === "}")
          depth++;
        else if (out[numStart] === "{" && --depth === 0)
          break;
      }
      if (numStart < 0)
        break;
      out.length = end;
      out.splice(numStart, 0, "\\frac");
    } else {
      while (numStart > 0 && !/\s/.test(out[numStart - 1]))
        numStart--;
      if (numStart === end)
        break;
      out.length = end;
      out.splice(numStart, 0, "\\frac", "{");
      out.push("}");
    }
    pos = cursor + hmlFrac.length;
  }
  return out.join("") + eqString.slice(pos);
}
function replaceRootOf(eqString) {
  while (true) {
    const rootCursor = findKeywordToken(eqString, "root");
    if (rootCursor === -1)
      break;
    try {
      const elem1 = findBrackets(eqString, rootCursor);
      const ofCursor = findKeywordToken(eqString, "of", elem1[1]);
      if (ofCursor === -1)
        return eqString;
      const elem2 = findBrackets(eqString, ofCursor);
      const e1 = eqString.slice(elem1[0] + 1, elem1[1] - 1);
      const e2 = eqString.slice(elem2[0] + 1, elem2[1] - 1);
      eqString = eqString.slice(0, rootCursor) + "\\sqrt[" + e1 + "]{" + e2 + "}" + eqString.slice(elem2[1] + 1);
    } catch {
      return eqString;
    }
  }
  return eqString;
}
function replaceAllMatrix(eqString) {
  const replaceElements = (bracketStr) => {
    let inner = bracketStr.slice(1, -1);
    inner = inner.replace(/#/g, " \\\\ ");
    inner = inner.replace(/&amp;/g, "&");
    return inner;
  };
  const replaceMatrix = (input, matStr, matElem) => {
    while (true) {
      const cursor = input.indexOf(matStr);
      if (cursor === -1)
        break;
      try {
        const [eStart, eEnd] = findBrackets(input, cursor);
        const elem = replaceElements(input.slice(eStart, eEnd));
        let beforeMat;
        let afterMat;
        const outer = matElem.removeOutterBrackets ? findEnclosingBrackets(input, cursor) : null;
        if (outer && outer[1] >= eEnd) {
          const [bStart, bEnd] = outer;
          beforeMat = input.slice(0, bStart);
          afterMat = input.slice(bEnd);
        } else {
          beforeMat = input.slice(0, cursor);
          afterMat = input.slice(eEnd);
        }
        input = beforeMat + matElem.begin + elem + matElem.end + afterMat;
      } catch {
        return input;
      }
    }
    return input;
  };
  for (const [matKey, matElem] of Object.entries(MATRIX_CONVERT_MAP)) {
    eqString = replaceMatrix(eqString, matKey, matElem);
  }
  return eqString;
}
function replaceAllBar(eqString) {
  const replaceBar = (input, barStr, barElem) => {
    while (true) {
      const cursor = input.indexOf(barStr);
      if (cursor === -1)
        break;
      try {
        const [eStart, eEnd] = findBrackets(input, cursor);
        const elem = input.slice(eStart, eEnd);
        const outer = findEnclosingBrackets(input, cursor);
        const [replaceStart, replaceEnd] = outer && outer[1] >= eEnd ? outer : [cursor, eEnd];
        const beforeBar = input.slice(0, replaceStart);
        const afterBar = input.slice(replaceEnd);
        input = beforeBar + barElem + elem + afterBar;
      } catch {
        return input;
      }
    }
    return input;
  };
  for (const [barKey, barElem] of Object.entries(BAR_CONVERT_MAP)) {
    eqString = replaceBar(eqString, barKey, barElem);
  }
  return eqString;
}
function replaceAllBrace(eqString) {
  const replaceBrace = (input, braceStr, braceElem) => {
    while (true) {
      const cursor = input.indexOf(braceStr);
      if (cursor === -1)
        break;
      try {
        const [eStart1, eEnd1] = findBrackets(input, cursor);
        const [eStart2, eEnd2] = findBrackets(input, eEnd1);
        const elem1 = input.slice(eStart1, eEnd1);
        const elem2 = input.slice(eStart2, eEnd2);
        const beforeBrace = input.slice(0, cursor);
        const afterBrace = input.slice(eEnd2);
        input = beforeBrace + braceElem + elem1 + "^" + elem2 + afterBrace;
      } catch {
        return input;
      }
    }
    return input;
  };
  for (const [braceKey, braceElem] of Object.entries(BRACE_CONVERT_MAP)) {
    eqString = replaceBrace(eqString, braceKey, braceElem);
  }
  return eqString;
}
function replaceBracket(strList) {
  for (let i = 0; i < strList.length; i++) {
    if (strList[i] === "{" && i > 0 && strList[i - 1] === "\\left")
      strList[i] = "\\{";
    if (strList[i] === "}" && i > 0 && strList[i - 1] === "\\right")
      strList[i] = "\\}";
  }
  return strList;
}
function hmlToLatex(hmlEqStr) {
  if (!hmlEqStr)
    return "";
  let s = hmlEqStr.replace(/[\r\n\t]+/g, " ").replace(/`/g, " ");
  s = s.replace(/\{/g, " { ").replace(/\}/g, " } ").replace(/&/g, " & ");
  let tokens = s.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (Object.hasOwn(CONVERT_MAP, t))
      tokens[i] = CONVERT_MAP[t];
    else if (Object.hasOwn(MIDDLE_CONVERT_MAP, t))
      tokens[i] = MIDDLE_CONVERT_MAP[t];
    else {
      const quoted = /^"(.+)"$/.exec(t);
      if (quoted)
        tokens[i] = `\\text{${quoted[1]}}`;
    }
  }
  tokens = tokens.filter((tok) => tok.length !== 0);
  tokens = replaceBracket(tokens);
  let out = tokens.join(" ");
  out = replaceFrac(out);
  out = replaceRootOf(out);
  out = replaceAllMatrix(out);
  out = replaceAllBar(out);
  out = replaceAllBrace(out);
  return out;
}
export {
  CONVERT_MAP,
  MIDDLE_CONVERT_MAP,
  hmlToLatex
};
