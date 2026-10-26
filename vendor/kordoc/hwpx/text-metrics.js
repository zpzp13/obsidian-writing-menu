// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwpx/text-metrics.ts. MIT; see LICENSE.
import { HANCOM_FALLBACK_W, fontWidthFn, hasFontMetrics, isHalfwidthForm } from "./font-metrics.js";
const ASCII_W = [
  300,
  320,
  320,
  610,
  610,
  830,
  724,
  320,
  320,
  320,
  550,
  550,
  320,
  550,
  320,
  550,
  // 0x20-0x2F
  550,
  550,
  550,
  550,
  550,
  550,
  550,
  550,
  550,
  550,
  320,
  320,
  550,
  550,
  550,
  550,
  // 0x30-0x3F
  830,
  706,
  605,
  685,
  719,
  627,
  617,
  683,
  734,
  305,
  315,
  660,
  605,
  839,
  734,
  732,
  // 0x40-0x4F
  603,
  705,
  660,
  627,
  664,
  731,
  706,
  910,
  705,
  705,
  626,
  320,
  550,
  320,
  550,
  550,
  // 0x50-0x5F
  320,
  569,
  597,
  552,
  597,
  536,
  356,
  562,
  635,
  287,
  288,
  582,
  287,
  907,
  635,
  588,
  // 0x60-0x6F
  597,
  579,
  478,
  496,
  356,
  635,
  563,
  720,
  542,
  543,
  486,
  320,
  320,
  320,
  550,
  0
  // 0x70-0x7E(+DEL)
];
const SYM_W = {
  160: 300,
  163: 568,
  165: 707,
  167: 498,
  171: 440,
  172: 564,
  176: 291,
  177: 798,
  182: 606,
  183: 320,
  187: 440,
  215: 617,
  247: 678,
  8211: 625,
  8212: 875,
  8213: 875,
  8216: 320,
  8217: 320,
  8220: 480,
  8221: 480,
  8224: 558,
  8225: 438,
  8229: 640,
  8230: 960,
  8240: 988,
  8242: 335,
  8243: 474,
  8251: 770,
  8364: 656,
  9756: 1012,
  9758: 1012,
  10061: 970,
  // ❍ 2단계 부호(일부 중앙부처) — 미실측, ○ 와 같은 전각으로 둔다
  // 한컴 PDF 임베드 HCRBatang /W 실측 — 종전 기본값 550 으로 떨어지던 기호
  700: 164,
  8226: 399,
  8227: 369,
  8228: 289,
  8231: 289
};
function charWidthEm1000(cp) {
  if (cp >= 32 && cp <= 126)
    return ASCII_W[cp - 32];
  const sym = SYM_W[cp];
  if (sym !== void 0)
    return sym;
  if (isHalfwidthForm(cp))
    return 500;
  if (cp >= 44032 && cp <= 55203)
    return 970;
  if (cp >= 4352 && cp <= 4607)
    return 970;
  if (cp >= 12593 && cp <= 12686)
    return 970;
  if (cp >= 19968 && cp <= 40959 || cp >= 63744 && cp <= 64255)
    return 1e3;
  if (cp >= 12296 && cp <= 12305 || cp >= 12308 && cp <= 12315)
    return 500;
  if (cp === 12288)
    return 970;
  if (cp >= 8544 && cp <= 8579)
    return 970;
  if (cp >= 8592 && cp <= 8959)
    return 970;
  if (cp >= 9312 && cp <= 9471)
    return 970;
  if (cp >= 9632 && cp <= 9983)
    return 970;
  if (cp >= 12800 && cp <= 13311)
    return 970;
  if (cp >= 65281 && cp <= 65376)
    return 970;
  if (cp >= 8960 && cp <= 9215 || cp >= 9472 && cp <= 9631 || cp >= 9984 && cp <= 10175)
    return 970;
  if (cp >= 983040)
    return 485;
  return cp >= 11904 ? 970 : 550;
}
function isZeroWidthCp(cp) {
  return cp >= 8203 && cp <= 8205 || cp === 8288 || cp === 65279 || cp >= 768 && cp <= 879;
}
const SPACE_EM_FIXED = 500;
const SPACE_EM_FONT = 300;
const FIXED_PITCH_FACES = /^(굴림체|돋움체|바탕체|궁서체|명조|고딕)$/;
function faceClassOf(face) {
  if (face && hasFontMetrics(face))
    return `font:${face.trim()}`;
  return face && FIXED_PITCH_FACES.test(face.trim()) ? "fixedPitch" : "hcr";
}
function syntheticBoldEm(face, hft = false) {
  if (!face)
    return 0;
  const f = face.trim();
  return /^(명조|고딕|필기)$/.test(f) || hft && (/^(한양|휴먼)/.test(f) || /^(#세나루|강낭콩|HCI Tulip|신명 태고딕)$/.test(f)) ? 50 : 0;
}
const REFLOW_FACE_ALIAS = {
  "Haansoft Batang": "\uD55C\uCEF4\uBC14\uD0D5",
  "Haansoft Dotum": "\uD55C\uCEF4\uB3CB\uC6C0",
  "HCR Batang": "\uD568\uCD08\uB86C\uBC14\uD0D5",
  "HCR Dotum": "\uD568\uCD08\uB86C\uB3CB\uC6C0"
};
function faceClassForReflow(face) {
  face = face && (REFLOW_FACE_ALIAS[face.trim()] ?? face);
  const c = faceClassOf(face);
  if (c !== "hcr" || !face || /^함초롬/.test(face.trim()))
    return c;
  return "cjk";
}
function faceClassForGen(face) {
  if (!face)
    return "hcr";
  const f = face.trim();
  if (hasFontMetrics(f))
    return `font:${f}`;
  if (FIXED_PITCH_FACES.test(f))
    return "fixedPitch";
  if (/^함초롬/.test(f))
    return "hcr";
  return "gothic";
}
function gothicWidthEm1000(cp) {
  if (cp >= 128)
    return 1e3;
  if (cp >= 65 && cp <= 90)
    return 720;
  if (cp >= 97 && cp <= 122)
    return 560;
  if (cp >= 48 && cp <= 57)
    return 580;
  if (cp === 40 || cp === 41 || cp === 91 || cp === 93)
    return 350;
  if (cp === 46 || cp === 44 || cp === 58 || cp === 59 || cp === 39)
    return 280;
  return 500;
}
function cjkWidthEm1000(cp) {
  return isHalfwidthForm(cp) ? 500 : cp >= 4352 ? 1e3 : charWidthEm1000(cp);
}
function fixedPitchWidthEm1000(cp) {
  return cp < 128 || isHalfwidthForm(cp) ? 500 : 1e3;
}
const isPuaFull = (cp) => cp <= 983803 || cp >= 983903 && cp <= 984052;
function widthFnOf(faceClass, fallback = true) {
  const base = baseWidthFnOf(faceClass, fallback);
  const hcr = faceClass === "hcr" || faceClass === "font:\uD568\uCD08\uB86C\uB3CB\uC6C0" || faceClass === "font:\uD568\uCD08\uB86C\uBC14\uD0D5";
  const f = (cp) => cp >= 983040 ? isPuaFull(cp) ? 1e3 : 500 : cp === 61600 ? base(32) : !hcr && cp >= 10102 && cp <= 10131 ? 1e3 : base(cp);
  if (fallback && (faceClass === "fixedPitch" || faceClass === "cjk"))
    return (cp) => isZeroWidthCp(cp) ? 0 : HANCOM_FALLBACK_W[cp] ?? f(cp);
  return (cp) => isZeroWidthCp(cp) ? 0 : f(cp);
}
function baseWidthFnOf(faceClass, fallback = true) {
  if (faceClass === "fixedPitch")
    return fixedPitchWidthEm1000;
  if (faceClass === "gothic")
    return (cp) => isHalfwidthForm(cp) ? 500 : gothicWidthEm1000(cp);
  if (faceClass === "cjk")
    return cjkWidthEm1000;
  if (faceClass?.startsWith("font:")) {
    const face = faceClass.slice(5);
    return fontWidthFn(face, fallback) ?? gothicWidthEm1000;
  }
  return charWidthEm1000;
}
function isSpaceCp(cp) {
  return cp === 32 || cp === 160;
}
function measureTextWidth(text, height, ratioPct, opts) {
  const spaceEm = opts?.spaceEm ?? SPACE_EM_FIXED;
  const spacing = opts?.spacingPct ?? 0;
  const widthEm = widthFnOf(opts?.faceClass);
  let em = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const w = cp === 8197 ? 250 : isSpaceCp(cp) ? spaceEm : widthEm(cp);
    em += w * (1 + spacing / 100);
  }
  return em / 1e3 * height * (ratioPct / 100);
}
function mulDiv(a, b, c) {
  const e = a * b;
  return Math.trunc(e < 0 ? (e - c / 2) / c : (e + c / 2) / c);
}
function hancomCharWidth(ch, height, ratioPct, spacingPct, faceClass, emAdd = 0, fallback = true) {
  const cp = ch.codePointAt(0);
  let w;
  if (cp === 8197) {
    const s = Math.trunc(height / 16);
    w = 4 * (ratioPct === 100 ? s : mulDiv(s, ratioPct, 100));
  } else if (isSpaceCp(cp)) {
    const s = Math.trunc(height / 8);
    w = 4 * (ratioPct === 100 ? s : mulDiv(s, ratioPct, 100));
  } else
    return hancomEmWidth(widthFnOf(faceClass, fallback)(cp) + emAdd, height, ratioPct, spacingPct);
  if (spacingPct)
    w += 4 * mulDiv(Math.trunc(w / 4), spacingPct, 100);
  return w;
}
function hancomEmWidth(em, height, ratioPct, spacingPct) {
  const q = Math.trunc(height / 4);
  let w = ratioPct === 100 ? 4 * mulDiv(em, q, 1e3) : 4 * Math.trunc(em * q * ratioPct / 1e5);
  if (spacingPct)
    w += 4 * mulDiv(Math.trunc(w / 4), spacingPct, 100);
  return w;
}
const FORBID_START = /* @__PURE__ */ new Set([..."!%),.:;?]}\xA2\xB0\u2032\u2033\u2103\u3009\u300B\u300D\u300F\u3011\u3015!%),.:;?]}\u20A9~\u2026\xB7\u3001\u3002\u3003"]);
const FORBID_END = /* @__PURE__ */ new Set([..."$([{\xA3\xA5\u3008\u300A\u300C\u300E\u3010\u3014$([{\u20A9"]);
const HANCOM_FORBID_START = /* @__PURE__ */ new Set([..."!%),.:;>?]^`}~\xB0\xB7\u3009\u300B\u300D\u300F\u3011\u3015\u3017\u3019\u301B\u30FB\uFF01\uFF05\uFF09\uFF0C\uFF0E\uFF1A\uFF1B\uFF1E\uFF1F\uFF3D\uFF3E\uFF40\uFF5D\uFF5E\uFF65\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308E\u30A1\u30A3\u30A5\u30A7\u30A9\u30C3\u30E3\u30E5\u30E7\u30EE\u30F5\u30F6\u3001\u3002\u3003\u3005\u30FC\u309B\u309C\u309D\u309E\u30FD\u30FE\u2019\u201D\u2024\u2025\u2026\u2030\u2031\u2032\u2033\u2034\u2035\u2036\u2037\u2103\u2109"]);
const HANCOM_FORBID_END = /* @__PURE__ */ new Set([..."(<[\\{\xA7\u2018\u201C\u3008\u300A\u300C\u300E\u3010\u3014\u3016\u3018\u301A\uFF04\uFF08\uFF1C\uFF3B\uFF3C\uFF5B\uFFE0\uFFE1\uFFE5\uFFE6$\xA2\xA3\xA4\xA5\u09F2\u09F3\u0E3F", ...Array.from({ length: 13 }, (_, i) => String.fromCharCode(8352 + i))]);
const isWrapSpace = (ch) => ch === " " || ch === "\u2005";
function prepareWrap(text, mode, opts) {
  const widthEm = widthFnOf(opts?.faceClass), spaceEm = opts?.spaceEm ?? SPACE_EM_FIXED;
  const advances = [], steps = [];
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    advances[i] = cp === 8197 ? 250 : isSpaceCp(cp) ? spaceEm : widthEm(cp);
    steps[i] = ch.length;
    i += ch.length;
  }
  return { units: splitWrapUnits(text, mode), advances, steps };
}
function splitWrapUnits(text, mode, latinBreak = false) {
  if (latinBreak)
    return text.match(mode === "keep" ? /[ \u2005]+|[\x21-\x7e]|[^ \u2005\x21-\x7e]+/gu : /[ \u2005]+|[^ \u2005](?:\u00a0[^ \u2005\u00a0]?)*/gu) ?? [];
  return text.match(mode === "keep" ? /[ \u2005]+|\ufdd0+(?=[^ \u2005\ufdd0])|[^ \u2005]+/gu : /[ \u2005]+|\u2060*(?:[\x21-\x7e\u00a1-\u024f\u2018-\u201f]+|[^ \u2005])(?:\u00a0(?:[\x21-\x7e\u00a1-\u024f\u2018-\u201f]+|[^ \u2005\u00a0])?)*/gu) ?? [];
}
function simulateWrap(text, firstWidth, contWidth, height, ratioPct, mode = "keep", opts) {
  if (!opts?.prepared && text.includes("\n")) {
    const starts2 = [];
    let off = 0, lastLineWidth = 0;
    for (; ; ) {
      const end = text.indexOf("\n", off), stop = end < 0 ? text.length : end, li = starts2.length;
      const lw = opts?.lineWidth;
      const sub = simulateWrap(text.slice(off, stop), li === 0 ? firstWidth : contWidth, contWidth, height, ratioPct, mode, {
        ...opts,
        widths: opts?.widths?.slice(off, stop),
        spacings: opts?.spacings?.slice(off, stop),
        lineWidth: lw ? (i) => lw(li + i) : void 0
      });
      for (const st of sub.starts)
        starts2.push(off + st);
      lastLineWidth = sub.lastLineWidth;
      if (end < 0)
        break;
      off = end + 1;
    }
    return { lines: starts2.length, starts: starts2, lastLineWidth };
  }
  const EPS = 0.5;
  const spaceEm = opts?.spaceEm ?? SPACE_EM_FIXED;
  const spacing = opts?.spacingPct ?? 0;
  const prepared = opts?.prepared;
  const widthEm = prepared ? null : widthFnOf(opts?.faceClass);
  const k = height * ratioPct / 100 / 1e3;
  const unitW = opts?.widths;
  const forbidStart = opts?.kinsoku === "hancom" ? HANCOM_FORBID_START : FORBID_START;
  const forbidEnd = opts?.kinsoku === "hancom" ? HANCOM_FORBID_END : FORBID_END;
  const condense = opts?.condensePct ?? 0;
  const hancom = opts?.kinsoku === "hancom";
  const spAt = opts?.spacings;
  const lastSp = (from, to) => {
    if (!spAt || to <= from)
      return 0;
    if (opts?.rightTabs?.size) {
      for (const t of opts.rightTabs)
        if (t >= lineStart() && t < to)
          return 0;
    }
    let i = to - 1;
    if (i > from && /[\uDC00-\uDFFF]/.test(text[i]))
      i--;
    return spAt[i] ?? 0;
  };
  const charWAt = (i, ch) => {
    if (unitW)
      return (unitW[i] ?? 0) + (ch.length === 2 ? unitW[i + 1] ?? 0 : 0);
    if (prepared)
      return prepared.advances[i] * (1 + spacing / 100) * k;
    const cp = ch.codePointAt(0);
    return (cp === 8197 ? 250 : isSpaceCp(cp) ? spaceEm : widthEm(cp)) * (1 + spacing / 100) * k;
  };
  const rangeW = (from, to) => {
    let w = 0;
    if (prepared && !unitW) {
      for (let i = from; i < to; i += prepared.steps[i])
        w += prepared.advances[i] * (1 + spacing / 100) * k;
      return w;
    }
    for (let i = from; i < to; ) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      w += charWAt(i, ch);
      i += ch.length;
    }
    return w;
  };
  const units = prepared?.units ?? splitWrapUnits(text, mode, opts?.latinBreak);
  const starts = [0];
  let lineW = 0;
  const lineWidth = opts?.lineWidth;
  let avail = lineWidth ? lineWidth(0) : firstWidth;
  let pos = 0;
  let spaceW = 0;
  let realSeen = false;
  let lineEnded = false;
  let placed = 0;
  const empty = () => lineW === 0 && (!hancom || placed === 0);
  const cap = () => avail + (condense > 0 ? Math.trunc(spaceW * condense / 100) : 0) + EPS;
  const lineStart = () => starts[starts.length - 1];
  const breakBefore = (unitPos, w, split = false) => {
    let bp = unitPos;
    const u = text[unitPos];
    const prevStart = (end) => end - (end >= 2 && /[\uDC00-\uDFFF]/.test(text[end - 1]) && /[\uD800-\uDBFF]/.test(text[end - 2]) ? 2 : 1);
    const old = opts?.before2024;
    const splitIn = opts?.kinsoku === "hancom" && split && u !== void 0 && !isWrapSpace(u) && !isWrapSpace(text[bp - 1]);
    const inWord = old && splitIn;
    if (!splitIn && u !== void 0 && forbidStart.has(u) && prevStart(bp) > lineStart() && !isWrapSpace(text[bp - 1])) {
      bp = prevStart(bp);
      if (old && forbidStart.has(text[bp]) && prevStart(bp) > lineStart() && !isWrapSpace(text[bp - 1]))
        bp = prevStart(bp);
    }
    while (!inWord && bp - 1 >= lineStart() && forbidEnd.has(text[bp - 1]))
      bp--;
    if (bp <= lineStart())
      bp = unitPos;
    starts.push(bp);
    avail = lineWidth ? lineWidth(starts.length - 1) : contWidth;
    spaceW = 0;
    realSeen = w > 0;
    lineEnded = false;
    placed = unitPos > bp ? 1 : 0;
    for (let i = bp; i < unitPos; i++) {
      if (!isWrapSpace(text[i]))
        realSeen = true;
      else if (text[i] === " " && condense > 0 && (realSeen || !hancom))
        spaceW += rangeW(i, i + 1) - (spAt?.[i] ?? 0);
    }
    lineW = rangeW(bp, unitPos) + w;
  };
  const breakAt = (at, leadW) => {
    starts.push(at);
    avail = lineWidth ? lineWidth(starts.length - 1) : contWidth;
    spaceW = 0;
    realSeen = false;
    lineEnded = false;
    placed = 0;
    lineW = leadW;
  };
  for (const u of units) {
    if (isWrapSpace(u[0])) {
      if (hancom) {
        let k2 = 0;
        for (; k2 < u.length; k2++) {
          if (!lineEnded && lineW >= avail)
            lineEnded = true;
          if (lineEnded && (k2 >= 2 || u[k2] === "\u2005") && pos + k2 > lineStart())
            break;
          if (!lineEnded) {
            const sw2 = rangeW(pos + k2, pos + k2 + 1);
            lineW += sw2;
            if (realSeen && u[k2] === " ")
              spaceW += sw2 - (spAt?.[pos + k2] ?? 0);
          }
        }
        if (k2 < u.length)
          breakAt(pos + k2, rangeW(pos + k2, pos + u.length));
        pos += u.length;
        continue;
      }
      const sw = rangeW(pos, pos + u.length);
      lineW += sw;
      for (let k2 = 0; k2 < u.length; k2++)
        if (u[k2] === " ")
          spaceW += rangeW(pos + k2, pos + k2 + 1);
      pos += u.length;
      continue;
    }
    if (u === "\uFDD0") {
      placed++;
      pos += u.length;
      continue;
    }
    if (u === "\u3000" && !empty() && lineW + rangeW(pos, pos + 1) - lastSp(pos, pos + 1) > cap()) {
      lineW += rangeW(pos, pos + 1);
      placed++;
      pos += u.length;
      continue;
    }
    if (lineEnded)
      breakAt(pos, 0);
    const w = rangeW(pos, pos + u.length);
    if (lineW + w - lastSp(pos, pos + u.length) <= cap()) {
      lineW += w;
      realSeen = true;
      placed++;
      pos += u.length;
      continue;
    }
    if (empty() || w > (lineWidth ? lineWidth(starts.length) : contWidth) + EPS) {
      if ((mode === "keep" || /^\u2060*[\x21-\x7e\u00a1-\u024f\u2018-\u201f]{2,}/.test(u)) && !empty())
        breakBefore(pos, 0);
      let sub = 0;
      for (const ch of u) {
        const c = charWAt(pos + sub, ch);
        if (lineW + c - lastSp(pos + sub, pos + sub + ch.length) > cap() && !empty() && ch !== "\u3000" && ch !== "\uFDD0")
          breakBefore(pos + sub, 0, true);
        lineW += c;
        realSeen = true;
        placed++;
        sub += ch.length;
      }
      pos += u.length;
      continue;
    }
    breakBefore(pos, w);
    placed++;
    pos += u.length;
  }
  return { lines: starts.length, starts, lastLineWidth: lineW };
}
function simulateWrapKeepWord(text, firstWidth, contWidth, height, ratioPct, opts) {
  return simulateWrap(text, firstWidth, contWidth, height, ratioPct, "keep", opts);
}
function fitRatioForFewerLines(text, firstWidth, contWidth, height, baseRatio, minRatio, opts) {
  const base = simulateWrap(text, firstWidth, contWidth, height, baseRatio, "keep", opts);
  if (base.lines < 2)
    return null;
  for (let r = baseRatio - 1; r >= minRatio; r--) {
    const sim = simulateWrap(text, firstWidth, contWidth, height, r, "keep", opts);
    if (sim.lines < base.lines)
      return r;
  }
  return null;
}
export {
  SPACE_EM_FIXED,
  SPACE_EM_FONT,
  charWidthEm1000,
  faceClassForGen,
  faceClassForReflow,
  faceClassOf,
  fitRatioForFewerLines,
  hancomCharWidth,
  hancomEmWidth,
  measureTextWidth,
  mulDiv,
  prepareWrap,
  simulateWrap,
  simulateWrapKeepWord,
  syntheticBoldEm
};
