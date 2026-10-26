// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/equation-text.ts. MIT; see LICENSE.
const SYMBOLS = {
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  varepsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  vartheta: "\u03D1",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  pi: "\u03C0",
  rho: "\u03C1",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  varphi: "\u03C6",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  Gamma: "\u0393",
  Delta: "\u0394",
  Theta: "\u0398",
  Lambda: "\u039B",
  Xi: "\u039E",
  Pi: "\u03A0",
  Sigma: "\u03A3",
  Phi: "\u03A6",
  Psi: "\u03A8",
  Omega: "\u03A9",
  times: "\xD7",
  cdot: "\xB7",
  div: "\xF7",
  pm: "\xB1",
  mp: "\u2213",
  le: "\u2264",
  leq: "\u2264",
  ge: "\u2265",
  geq: "\u2265",
  ne: "\u2260",
  neq: "\u2260",
  approx: "\u2248",
  equiv: "\u2261",
  sim: "\u223C",
  infty: "\u221E",
  rightarrow: "\u2192",
  leftarrow: "\u2190",
  Rightarrow: "\u21D2",
  Leftarrow: "\u21D0",
  leftrightarrow: "\u2194",
  Leftrightarrow: "\u21D4",
  to: "\u2192",
  angle: "\u2220",
  triangle: "\u25B3",
  perp: "\u22A5",
  parallel: "\u2225",
  circ: "\u2218",
  degree: "\xB0",
  sum: "\u03A3",
  prod: "\u03A0",
  int: "\u222B",
  oint: "\u222E",
  partial: "\u2202",
  nabla: "\u2207",
  in: "\u2208",
  notin: "\u2209",
  subset: "\u2282",
  supset: "\u2283",
  subseteq: "\u2286",
  supseteq: "\u2287",
  cup: "\u222A",
  cap: "\u2229",
  emptyset: "\u2205",
  forall: "\u2200",
  exists: "\u2203",
  therefore: "\u2234",
  because: "\u2235",
  prime: "\u2032",
  cdots: "\u22EF",
  ldots: "\u2026",
  dots: "\u2026",
  vdots: "\u22EE",
  lim: "lim",
  log: "log",
  ln: "ln",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  sec: "sec",
  csc: "csc",
  cot: "cot",
  exp: "exp",
  max: "max",
  min: "min",
  quad: " ",
  qquad: "  ",
  ",": " ",
  ";": " ",
  "!": "",
  "{": "{",
  "}": "}",
  "|": "\u2016",
  backslash: "\\",
  lbrace: "{",
  rbrace: "}",
  langle: "\u27E8",
  rangle: "\u27E9"
};
const SUP = { "0": "\u2070", "1": "\xB9", "2": "\xB2", "3": "\xB3", "4": "\u2074", "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079", "+": "\u207A", "-": "\u207B", "=": "\u207C", "(": "\u207D", ")": "\u207E", n: "\u207F", i: "\u2071", x: "\u02E3", "\u2032": "\u2032" };
const SUB = { "0": "\u2080", "1": "\u2081", "2": "\u2082", "3": "\u2083", "4": "\u2084", "5": "\u2085", "6": "\u2086", "7": "\u2087", "8": "\u2088", "9": "\u2089", "+": "\u208A", "-": "\u208B", "=": "\u208C", "(": "\u208D", ")": "\u208E" };
function latexToPlain(latex) {
  let i = 0;
  const s = latex;
  const skipWs = () => {
    while (i < s.length && s[i] === " ")
      i++;
  };
  const arg = () => {
    skipWs();
    if (s[i] === "{") {
      i++;
      const v = seq("}");
      i++;
      return v;
    }
    return atom();
  };
  const wrap = (v) => v.length > 1 && !/^[\w.′]+$|^\(.*\)$/u.test(v) ? `(${v})` : v;
  const script = (v, map, mark) => {
    const t = v.trim();
    return [...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join("") : `${mark}${wrap(t)}`;
  };
  const atom = () => {
    const c = s[i];
    if (c === void 0)
      return "";
    if (c === "\\") {
      i++;
      let name = "";
      if (/[A-Za-z]/.test(s[i] ?? ""))
        while (/[A-Za-z]/.test(s[i] ?? ""))
          name += s[i++];
      else
        name = s[i++] ?? "";
      if (name === "frac") {
        const a = arg(), b = arg();
        return `${wrap(a.trim())}/${wrap(b.trim())}`;
      }
      if (name === "sqrt") {
        skipWs();
        let root = "";
        if (s[i] === "[") {
          i++;
          root = seq("]");
          i++;
        }
        const a = arg();
        return `${root ? script(root, SUP, "") : ""}\u221A${wrap(a.trim())}`;
      }
      if (name === "left" || name === "right" || name === "big" || name === "Big" || name === "bigg" || name === "Bigg") {
        skipWs();
        const d = s[i] === "\\" ? atom() : s[i++] ?? "";
        return d === "." ? "" : d;
      }
      if (name === "overline" || name === "bar" || name === "hat" || name === "vec" || name === "dot" || name === "tilde") {
        const a = arg().trim(), mark = { overline: "\u0305", bar: "\u0304", hat: "\u0302", vec: "\u20D7", dot: "\u0307", tilde: "\u0303" }[name];
        return [...a].map((ch) => ch + mark).join("");
      }
      if (name === "mathrm" || name === "text" || name === "rm" || name === "mathbf" || name === "it" || name === "mathit" || name === "operatorname")
        return name === "rm" || name === "it" ? "" : arg();
      return SYMBOLS[name] ?? name;
    }
    i++;
    if (c === "{") {
      const v = seq("}");
      i++;
      return v;
    }
    if (c === "^")
      return script(arg(), SUP, "^");
    if (c === "_")
      return script(arg(), SUB, "_");
    if (c === "~" || c === "`")
      return " ";
    return c;
  };
  const seq = (end) => {
    let out = "";
    while (i < s.length && s[i] !== end) {
      if (s[i] === " ") {
        i++;
        continue;
      }
      out += atom();
    }
    return out;
  };
  return seq("\0").replace(/\s+/g, " ").trim();
}
export {
  latexToPlain
};
