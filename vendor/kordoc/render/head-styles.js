// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/head-styles.ts. MIT; see LICENSE.
import { createXmlParser, findChildByLocalName } from "../hwpx/parser-shared.js";
const DEFAULT_PARA_GEOM = {
  lineSpacingType: "PERCENT",
  lineSpacingValue: 160,
  marginLeft: 0,
  marginRight: 0,
  marginIntent: 0,
  spaceBefore: 0,
  spaceAfter: 0
};
function hwpxAppBuild(versionXml) {
  const m = versionXml?.match(/appVersion="\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)/);
  return m ? Number(m[1]) : void 0;
}
function hwpxAppMajor(versionXml) {
  const m = versionXml?.match(/appVersion="\s*(\d+)/);
  return m ? Number(m[1]) : void 0;
}
function docColor(v, fallback) {
  return v != null && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : fallback;
}
const DEFAULT_CHAR = { height: 1e3, bold: false, italic: false, underline: false, ratio: 100, spacing: 0 };
const FONT_ALIASES = {
  "\uD568\uCD08\uB86C\uBC14\uD0D5": "'HCR Batang','\uD568\uCD08\uB86C\uBC14\uD0D5','\uD55C\uCEF4\uBC14\uD0D5'",
  "\uD55C\uCEF4\uBC14\uD0D5": "'HCR Batang','\uD568\uCD08\uB86C\uBC14\uD0D5','\uD55C\uCEF4\uBC14\uD0D5'",
  "\uD568\uCD08\uB86C\uB3CB\uC6C0": "'HCR Dotum','\uD568\uCD08\uB86C\uB3CB\uC6C0','\uD55C\uCEF4\uB3CB\uC6C0'",
  "\uD55C\uCEF4\uB3CB\uC6C0": "'HCR Dotum','\uD568\uCD08\uB86C\uB3CB\uC6C0','\uD55C\uCEF4\uB3CB\uC6C0'",
  "\uB9D1\uC740 \uACE0\uB515": "'Malgun Gothic','\uB9D1\uC740 \uACE0\uB515'",
  "\uB9D1\uC740\uACE0\uB515": "'Malgun Gothic','\uB9D1\uC740 \uACE0\uB515'",
  "\uAD74\uB9BC": "'Gulim','\uAD74\uB9BC'",
  "\uAD74\uB9BC\uCCB4": "'GulimChe','\uAD74\uB9BC\uCCB4','Gulim'",
  "\uB3CB\uC6C0": "'Dotum','\uB3CB\uC6C0'",
  "\uB3CB\uC6C0\uCCB4": "'DotumChe','\uB3CB\uC6C0\uCCB4','Dotum'",
  "\uBC14\uD0D5": "'Batang','\uBC14\uD0D5'",
  "\uBC14\uD0D5\uCCB4": "'BatangChe','\uBC14\uD0D5\uCCB4','Batang'",
  "\uAD81\uC11C": "'Gungsuh','\uAD81\uC11C'",
  "\uAD81\uC11C\uCCB4": "'GungsuhChe','\uAD81\uC11C\uCCB4','Gungsuh'",
  "\uB098\uB214\uACE0\uB515": "'NanumGothic','\uB098\uB214\uACE0\uB515'",
  "\uB098\uB214\uBA85\uC870": "'NanumMyeongjo','\uB098\uB214\uBA85\uC870'",
  "\uB9D1\uC740 \uACE0\uB515 Semilight": "'Malgun Gothic Semilight','\uB9D1\uC740 \uACE0\uB515'"
};
function isSerifFace(face) {
  return /바탕|명조|Batang|Myeong|Mincho|궁서|Gungsuh|Serif|신명|순명|Song|송/i.test(face);
}
function cssQuote(name) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `'${name.replace(/['"\\]/g, "")}'`;
}
function hwpFaceToCssStack(face) {
  const trimmed = (face ?? "").trim();
  if (!trimmed)
    return "";
  const generic = isSerifFace(trimmed) ? "'HCR Batang','Batang','Noto Serif KR',serif" : "'Malgun Gothic','HCR Dotum','Noto Sans KR',sans-serif";
  const head = FONT_ALIASES[trimmed] ?? cssQuote(trimmed);
  return `${head},${generic}`;
}
function collectHangulFonts(root, lang = "HANGUL", hftIds, substKoPub = false) {
  const map = /* @__PURE__ */ new Map();
  const findFaces = (el, depth) => {
    if (depth > 24)
      return null;
    for (const ch of Array.from(el.childNodes)) {
      if (ch.nodeType !== 1)
        continue;
      const e = ch;
      if ((e.tagName || "").replace(/^[^:]+:/, "") === "fontfaces")
        return e;
      const f = findFaces(e, depth + 1);
      if (f)
        return f;
    }
    return null;
  };
  const faces = findFaces(root, 0);
  if (!faces)
    return map;
  let group = null;
  let firstGroup = null;
  for (const ch of Array.from(faces.childNodes)) {
    if (ch.nodeType !== 1)
      continue;
    const e = ch;
    if ((e.tagName || "").replace(/^[^:]+:/, "") !== "fontface")
      continue;
    if (!firstGroup)
      firstGroup = e;
    if ((e.getAttribute("lang") ?? "").toUpperCase() === lang) {
      group = e;
      break;
    }
  }
  group = group ?? firstGroup;
  if (!group)
    return map;
  for (const ch of Array.from(group.childNodes)) {
    if (ch.nodeType !== 1)
      continue;
    const e = ch;
    if ((e.tagName || "").replace(/^[^:]+:/, "") !== "font")
      continue;
    const id = e.getAttribute("id");
    let face = e.getAttribute("face");
    let type = e.getAttribute("type");
    if (face && type === "TTF" && (/^한양/.test(face) || substKoPub && /^KoPub/.test(face))) {
      const sub = Array.from(e.childNodes).find((c) => c.nodeType === 1 && (c.tagName || "").replace(/^[^:]+:/, "") === "substFont");
      const sf = sub?.getAttribute("face");
      if (sf) {
        face = sf;
        type = sub.getAttribute("type");
      }
    }
    if (id != null && face)
      map.set(id, face);
    if (id != null && hftIds && type === "HFT")
      hftIds.add(id);
  }
  return map;
}
function borderWidthPt(v) {
  const n = parseFloat(v ?? "");
  if (!Number.isFinite(n))
    return 0.34;
  return n * 2.834645;
}
function parseEdge(el) {
  if (!el)
    return void 0;
  const type = el.getAttribute("type") ?? "NONE";
  if (type === "NONE")
    return void 0;
  return { type, widthPt: borderWidthPt(el.getAttribute("width")), color: docColor(el.getAttribute("color"), "#000000") };
}
function findDeep(el, name, depth = 0) {
  if (depth > 32)
    return null;
  const children = el.childNodes;
  if (!children)
    return null;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch.nodeType !== 1)
      continue;
    const e = ch;
    if ((e.tagName || "").replace(/^[^:]+:/, "") === name)
      return e;
    const found = findDeep(e, name, depth + 1);
    if (found)
      return found;
  }
  return null;
}
function parseParaGeom(el, oldUnit = false) {
  const g = { ...DEFAULT_PARA_GEOM };
  const condense = Number(el.getAttribute("condense")) || 0;
  if (condense > 0)
    g.condense = condense;
  if (el.getAttribute("fontLineHeight") === "1")
    g.fontLineHeight = true;
  const ls = findDeep(el, "lineSpacing");
  if (ls) {
    g.lineSpacingType = ls.getAttribute("type") ?? "PERCENT";
    const lv = Number(ls.getAttribute("value"));
    g.lineSpacingValue = Number.isFinite(lv) && ls.getAttribute("value") !== null ? lv : 160;
  }
  const margin = findDeep(el, "margin");
  if (margin) {
    const plain = oldUnit && (margin.parentNode?.tagName ?? "").replace(/^[^:]+:/, "") === "paraPr";
    const v = (n) => {
      const c = findDeep(margin, n);
      const x = c ? (Number(c.getAttribute("value")) || 0) * (c.getAttribute("unit") === "CHAR" ? 5 : 1) : 0;
      return plain ? Math.trunc(x / 2) : x;
    };
    g.marginLeft = v("left");
    g.marginRight = v("right");
    g.marginIntent = v("intent");
    g.spaceBefore = v("prev");
    g.spaceAfter = v("next");
  }
  const va = findDeep(el, "align")?.getAttribute("vertical");
  if (va && va !== "BASELINE")
    g.vertAlign = va;
  const bs = findDeep(el, "breakSetting");
  if (bs) {
    if (bs.getAttribute("breakLatinWord") === "BREAK_WORD")
      g.latinBreak = true;
    if (bs.getAttribute("lineWrap") === "SQUEEZE")
      g.squeeze = true;
    if (bs.getAttribute("widowOrphan") === "1")
      g.widowOrphan = true;
    if (bs.getAttribute("keepLines") === "1")
      g.keepLines = true;
    if (bs.getAttribute("keepWithNext") === "1")
      g.keepWithNext = true;
    if (bs.getAttribute("pageBreakBefore") === "1")
      g.pageBreakBefore = true;
    const nl = bs.getAttribute("breakNonLatinWord");
    if (nl === "BREAK_WORD")
      g.wrapMode = "keep";
    else if (nl === "KEEP_WORD")
      g.wrapMode = "charAll";
  }
  return g;
}
function parseRenderStyles(headXml, opts) {
  const before2024 = opts?.appMajor !== void 0 && opts.appMajor > 0 && opts.appMajor < 13;
  const major = opts?.appMajor ?? 0, build = opts?.appBuild ?? 0;
  const halfQuote = major === 12 && build >= 4605 || major === 13 && build >= 3901 || major > 13;
  const early2024 = major === 13 && build > 0 && build < 3622;
  const styles = { charPr: /* @__PURE__ */ new Map(), paraAlign: /* @__PURE__ */ new Map(), paraGeom: /* @__PURE__ */ new Map(), borderFill: /* @__PURE__ */ new Map(), ...before2024 ? { before2024 } : {}, ...early2024 ? { early2024 } : {} };
  const doc = createXmlParser().parseFromString(headXml, "text/xml");
  const root = doc.documentElement;
  if (!root)
    return styles;
  const hv = Number.parseFloat(root.getAttribute("version") ?? "");
  const oldUnit = Number.isFinite(hv) && hv < 1.4;
  const hftHangul = /* @__PURE__ */ new Set(), hftLatin = /* @__PURE__ */ new Set();
  const sk = !!opts?.substKoPub;
  const hangulFonts = collectHangulFonts(root, "HANGUL", hftHangul, sk);
  const latinFonts = collectHangulFonts(root, "LATIN", hftLatin, sk);
  const hftHanja = /* @__PURE__ */ new Set(), hftJapanese = /* @__PURE__ */ new Set(), hftSymbol = /* @__PURE__ */ new Set();
  const langFonts = { hanja: [collectHangulFonts(root, "HANJA", hftHanja, sk), hftHanja], japanese: [collectHangulFonts(root, "JAPANESE", hftJapanese, sk), hftJapanese], symbol: [collectHangulFonts(root, "SYMBOL", hftSymbol, sk), hftSymbol] };
  const autoTabPr = /* @__PURE__ */ new Set();
  const paraTabRef = /* @__PURE__ */ new Map();
  const paraBullet = /* @__PURE__ */ new Map();
  const bullets = /* @__PURE__ */ new Map();
  const paraNumber = /* @__PURE__ */ new Map();
  const numberings = /* @__PURE__ */ new Map();
  const walk = (el) => {
    const tag = (el.tagName || "").replace(/^[^:]+:/, "");
    if (tag === "charPr") {
      const id = el.getAttribute("id");
      if (id != null) {
        const ratioEl = findChildByLocalName(el, "ratio");
        const spacingEl = findChildByLocalName(el, "spacing");
        const underlineEl = findChildByLocalName(el, "underline");
        const textColor = el.getAttribute("textColor");
        const shadeColor = el.getAttribute("shadeColor");
        const fontRef = findChildByLocalName(el, "fontRef");
        const fontId = fontRef?.getAttribute("hangul") ?? fontRef?.getAttribute("latin");
        const face = fontId != null ? hangulFonts.get(fontId) : void 0;
        const relEl = findChildByLocalName(el, "relSz");
        const num = (e, a, d) => {
          const v = e?.getAttribute(a);
          return v == null || v === "" ? d : Number(v);
        };
        const latinFace = latinFonts.get(fontRef?.getAttribute("latin") ?? "");
        const latinHft = hftLatin.has(fontRef?.getAttribute("latin") ?? "");
        const latin = { face: latinFace ?? face, ratio: num(ratioEl, "latin", 100), spacing: num(spacingEl, "latin", 0), rel: num(relEl, "latin", 100), ...latinHft ? { hft: true } : {} };
        const rel = num(relEl, "hangul", 100);
        const hangulRatio = Number(ratioEl?.getAttribute("hangul")) || 100, hangulSpacing = Number(spacingEl?.getAttribute("hangul")) || 0, hangulHft = hftHangul.has(fontRef?.getAttribute("hangul") ?? "");
        const langs = {};
        for (const lang of ["hanja", "japanese", "symbol"]) {
          const ref = fontRef?.getAttribute(lang) ?? "", [fonts, hfts] = langFonts[lang];
          const ls = { face: fonts.get(ref) ?? face, ratio: num(ratioEl, lang, 100), spacing: num(spacingEl, lang, 0), rel: num(relEl, lang, 100), ...(fonts.has(ref) ? hfts.has(ref) : hangulHft) ? { hft: true } : {} };
          if (ls.face !== face || ls.ratio !== hangulRatio || ls.spacing !== hangulSpacing || ls.rel !== rel || !!ls.hft !== hangulHft)
            langs[lang] = ls;
        }
        styles.charPr.set(id, {
          height: Number(el.getAttribute("height")) || 1e3,
          bold: findChildByLocalName(el, "bold") != null,
          italic: findChildByLocalName(el, "italic") != null,
          underline: underlineEl != null && (underlineEl.getAttribute("type") ?? "NONE") !== "NONE",
          color: textColor !== "#000000" ? docColor(textColor) : void 0,
          ratio: Number(ratioEl?.getAttribute("hangul")) || 100,
          spacing: Number(spacingEl?.getAttribute("hangul")) || 0,
          fontFamily: face ? hwpFaceToCssStack(face) : void 0,
          face,
          ...rel !== 100 ? { rel } : {},
          // 흰 음영은 흰 바탕에서 보이지 않고 색 칸 위에서만 흰 상자가 된다 — 확인 전이라 그리지 않는다
          ...shadeColor && /^#[0-9A-Fa-f]{6}$/.test(shadeColor) && shadeColor.toUpperCase() !== "#FFFFFF" ? { shade: shadeColor } : {},
          ...el.getAttribute("borderFillIDRef") ? { borderFill: el.getAttribute("borderFillIDRef") } : {},
          ...hftHangul.has(fontRef?.getAttribute("hangul") ?? "") ? { hft: true } : {},
          ...latin.face !== face || latin.ratio !== (Number(ratioEl?.getAttribute("hangul")) || 100) || latin.spacing !== (Number(spacingEl?.getAttribute("hangul")) || 0) || latin.rel !== rel ? { latin } : {},
          ...langs,
          ...el.getAttribute("useFontSpace") === "1" ? { fontSpace: true } : {},
          ...findChildByLocalName(el, "supscript") ? { script: "sup" } : findChildByLocalName(el, "subscript") ? { script: "sub" } : {}
        });
      }
    } else if (tag === "tabPr") {
      const id = el.getAttribute("id");
      if (id != null && el.getAttribute("autoTabLeft") === "1")
        autoTabPr.add(id);
    } else if (tag === "paraPr") {
      const id = el.getAttribute("id");
      if (id != null) {
        const align = findChildByLocalName(el, "align");
        styles.paraAlign.set(id, align?.getAttribute("horizontal") || "JUSTIFY");
        styles.paraGeom.set(id, parseParaGeom(el, oldUnit));
        const tab = el.getAttribute("tabPrIDRef");
        if (tab != null)
          paraTabRef.set(id, tab);
        const heading = findDeep(el, "heading");
        if (heading?.getAttribute("type") === "BULLET")
          paraBullet.set(id, heading.getAttribute("idRef") ?? "");
        else if (heading?.getAttribute("type") === "NUMBER")
          paraNumber.set(id, { id: heading.getAttribute("idRef") ?? "", level: (Number(heading.getAttribute("level")) || 0) + 1 });
      }
    } else if (tag === "bullet") {
      const id = el.getAttribute("id"), head = findChildByLocalName(el, "paraHead");
      if (id != null && el.getAttribute("useImage") !== "1") {
        const cpr = head?.getAttribute("charPrIDRef");
        bullets.set(id, {
          ch: el.getAttribute("char") ?? "",
          ...cpr != null && cpr !== "4294967295" ? { charPrId: cpr } : {},
          offset: Number(head?.getAttribute("textOffset")) || 0,
          offsetPct: (head?.getAttribute("textOffsetType") ?? "PERCENT") === "PERCENT",
          autoIndent: head?.getAttribute("autoIndent") !== "0",
          ...head?.hasAttribute("useInstWidth") ? { useInstWidth: head.getAttribute("useInstWidth") !== "0" } : {}
        });
      }
    } else if (tag === "numbering") {
      const id = el.getAttribute("id");
      if (id != null) {
        const levels = /* @__PURE__ */ new Map();
        for (let i = 0; i < el.childNodes.length; i++) {
          const h = el.childNodes[i];
          if (h.nodeType !== 1 || (h.tagName || "").replace(/^[^:]+:/, "") !== "paraHead")
            continue;
          const cpr = h.getAttribute("charPrIDRef");
          levels.set(Number(h.getAttribute("level")) || 1, {
            head: { text: h.textContent ?? "", format: h.getAttribute("numFormat") ?? "DIGIT", start: Number(h.getAttribute("start") ?? 1) },
            ...cpr != null && cpr !== "4294967295" ? { charPrId: cpr } : {},
            offset: Number(h.getAttribute("textOffset")) || 0,
            offsetPct: (h.getAttribute("textOffsetType") ?? "PERCENT") === "PERCENT",
            autoIndent: h.getAttribute("autoIndent") !== "0"
          });
        }
        numberings.set(id, levels);
      }
    } else if (tag === "borderFill") {
      const id = el.getAttribute("id");
      if (id != null) {
        const bf = {
          left: parseEdge(findChildByLocalName(el, "leftBorder")),
          right: parseEdge(findChildByLocalName(el, "rightBorder")),
          top: parseEdge(findChildByLocalName(el, "topBorder")),
          bottom: parseEdge(findChildByLocalName(el, "bottomBorder"))
        };
        const fillBrush = findChildByLocalName(el, "fillBrush");
        const winBrush = fillBrush ? findChildByLocalName(fillBrush, "winBrush") : null;
        const face = winBrush?.getAttribute("faceColor");
        const fill = docColor(face);
        if (fill)
          bf.fill = fill;
        styles.borderFill.set(id, bf);
      }
    }
    if (tag === "style" && (el.getAttribute("engName") === "Page Number" || el.getAttribute("name") === "\uCABD \uBC88\uD638")) {
      const cp = el.getAttribute("charPrIDRef");
      if (cp != null && styles.pageNumCharPr == null)
        styles.pageNumCharPr = cp;
    }
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      const ch = children[i];
      if (ch.nodeType === 1)
        walk(ch);
    }
  };
  walk(root);
  for (const [id, tab] of paraTabRef) {
    const g = styles.paraGeom.get(id);
    if (g && autoTabPr.has(tab))
      g.autoTabLeft = true;
  }
  for (const [id, n] of paraNumber) {
    const g = styles.paraGeom.get(id), levels = numberings.get(n.id), lv = levels?.get(n.level);
    if (g && levels && lv)
      g.number = { id: n.id, level: n.level, heads: new Map([...levels].map(([k, v]) => [k, v.head])), ...lv.charPrId != null ? { charPrId: lv.charPrId } : {}, offset: lv.offset, offsetPct: lv.offsetPct, autoIndent: lv.autoIndent };
  }
  for (const [id, b] of paraBullet) {
    const g = styles.paraGeom.get(id), bu = bullets.get(b);
    if (g && bu?.ch)
      g.bullet = bu;
  }
  if (before2024)
    for (const st of styles.charPr.values())
      st.before2024 = true;
  if (halfQuote)
    for (const st of styles.charPr.values())
      st.halfQuote = true;
  return styles;
}
export {
  DEFAULT_CHAR,
  DEFAULT_PARA_GEOM,
  docColor,
  hwpFaceToCssStack,
  hwpxAppBuild,
  hwpxAppMajor,
  parseRenderStyles
};
