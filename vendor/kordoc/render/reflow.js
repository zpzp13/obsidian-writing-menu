// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/reflow.ts. MIT; see LICENSE.
import { buildPara, findFirst, isDeletedControl, measureTableHeight, tabAdvance, paraHeadAdvance, captionExtra, OBJ_TAGS } from "./para-model.js";
import { squareTableOver, bulletEmptyHost, hasTbFloat, m0Objs, bandTableOver, splitFloatTableRemainder, spacesHost, subFloatBottoms, pageBottomReserve, columnWidthIn, reflowSubListsIn, reflowTablesIn, splitWhole, splitNotesLast, splitMovedLast } from "./reflow-tables.js";
import { nextParaNumber } from "./para-number.js";
import { simulateWrap, hancomCharWidth, hancomEmWidth, faceClassForReflow, mulDiv, syntheticBoldEm } from "../hwpx/text-metrics.js";
import { BEFORE_2024_WIDTH } from "../hwpx/face-width-fix.js";
import { fontSpaceEm, fontHasGlyph } from "../hwpx/font-metrics.js";
import { DEFAULT_CHAR, DEFAULT_PARA_GEOM } from "./head-styles.js";
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { toInt32 } from "./layout.js";
import { cachedParagraphBottom } from "./reflow-cache.js";
import { appendNarrowLineFragments } from "./reflow-fragments.js";
import { lineBorderBox } from "./reflow-borders.js";
const geomMemo = (styles) => ({ cell: /* @__PURE__ */ new WeakMap(), table: /* @__PURE__ */ new WeakMap(), paraGeom: styles.paraGeom });
const LINESEG_FLAGS = "393216";
const BASELINE_RATIO = 0.85;
const FONT_LINE_METRICS = [
  [/^맑은 고딕/, 2230 / 2048, 496 / 2048, true],
  [/^(바탕|돋움|굴림|궁서)(체)?$|^한컴바탕$|^HY/, 1758 / 2048, 290 / 2048],
  [/^휴먼명조$/, 0.859, 0.195],
  [/^KoPub(World)?(돋움|바탕)체 Light$/, 0.85, 0.25]
];
function fontLineMetrics(face, hft) {
  if (!face || hft && face.trim() === "\uD55C\uCEF4\uBC14\uD0D5")
    return void 0;
  for (const [re, a, d, up] of FONT_LINE_METRICS)
    if (re.test(face.trim()))
      return [a, d, up];
  return void 0;
}
function ln(el) {
  return (el.tagName || "").replace(/^[^:]+:/, "");
}
function elements(el) {
  const out = [];
  const kids = el.childNodes;
  if (!kids)
    return out;
  for (let i = 0; i < kids.length; i++)
    if (kids[i].nodeType === 1)
      out.push(kids[i]);
  return out;
}
function num(el, attr, fallback = 0) {
  return el ? toInt32(el.getAttribute(attr) ?? void 0, fallback) : fallback;
}
function shiftParaVert(p, delta) {
  for (const lsa of elements(p)) {
    if (ln(lsa) !== "linesegarray")
      continue;
    for (const seg of elements(lsa)) {
      if (ln(seg) !== "lineseg")
        continue;
      seg.setAttribute("vertpos", String(num(seg, "vertpos") + delta));
    }
  }
}
const isJamoL = (cp) => cp >= 4352 && cp <= 4447 || cp >= 43360 && cp <= 43388;
const isJamoV = (cp) => cp >= 4448 && cp <= 4519 || cp >= 55216 && cp <= 55238;
const isJamoT = (cp) => cp >= 4520 && cp <= 4607 || cp >= 55243 && cp <= 55291;
const isJamoLV = (cp) => isJamoL(cp) || isJamoV(cp);
const isJamoVT = (cp) => isJamoV(cp) || isJamoT(cp);
const joinsJamo = (prevCp, cp) => isJamoVT(cp) && isJamoLV(prevCp);
const isLatinCp = (cp) => cp < 592 || cp >= 7680 && cp < 8192 || cp >= 8216 && cp < 8224;
function hancomLangOf(cp) {
  if (isLatinCp(cp))
    return "latin";
  if (cp >= 4352 && cp < 4608 || cp >= 12592 && cp < 12688 || cp >= 43360 && cp < 43392 || cp >= 44032 && cp < 55296)
    return "hangul";
  if (cp >= 13312 && cp < 19904 || cp >= 19968 && cp < 40960 || cp >= 63744 && cp < 64256 || cp >= 131072 && cp < 196608)
    return "hanja";
  if (cp >= 12352 && cp < 12544 || cp >= 12784 && cp < 12800 || cp === 12306)
    return "japanese";
  if (cp >= 57344 && cp < 63744 || cp >= 983040)
    return "hangul";
  return "symbol";
}
function glyphWidth(ch, st, fallback = true) {
  const cp = ch.codePointAt(0);
  const space = cp === 32 || cp === 160;
  const lang = space ? "hangul" : hancomLangOf(cp);
  const L = space || lang === "hangul" ? void 0 : st[lang];
  const rel = space ? st.rel ?? 100 : L ? L.rel : st.rel ?? 100;
  let h = rel !== 100 ? mulDiv(st.height, rel, 100) : st.height;
  if (!space && st.script)
    h = mulDiv(h, 16, 25);
  const ratio = L ? L.ratio : st.ratio;
  const spacing = space ? st.latin?.spacing ?? st.spacing : L ? L.spacing : st.spacing;
  const face1 = L?.face ?? st.face;
  const face0 = face1 === "Batang" ? st.before2024 ? "\uBC14\uD0D5" : "\uD55C\uCEF4\uBC14\uD0D5" : face1;
  const boldFace = !space && st.bold && (L ? L.hft : st.hft) && face0 && fontHasGlyph(`${face0} Bold`, cp) ? `${face0} Bold` : void 0;
  const oldEm = st.halfQuote && face0 === "\uD734\uBA3C\uBA85\uC870" && (cp === 8220 || cp === 8221) ? 500 : st.halfQuote && !st.before2024 && face0 === "\uD734\uBA3C\uBA85\uC870" && (cp === 8216 || cp === 8217) ? 312 : st.before2024 && face0 && !(face0 === "\uC2E0\uBA85\uC870" && (st.halfQuote || (L?.face ? L.hft : st.hft))) ? BEFORE_2024_WIDTH[face0]?.[cp] : !st.halfQuote && face0 === "\uD734\uBA3C\uBA85\uC870" && cp === 8231 ? BEFORE_2024_WIDTH[face0]?.[cp] : void 0;
  const fc = faceClassForReflow(boldFace ?? face0);
  const fsEm = space && st.fontSpace ? fontSpaceEm(st.face) : void 0;
  if (fsEm !== void 0) {
    const q = Math.trunc(h / 4), b = ratio === 100 ? 4 * mulDiv(fsEm, q, 1e3) : 4 * Math.trunc(fsEm * q * ratio / 1e5);
    const s = spacing ? 4 * mulDiv(Math.trunc(b / 4), spacing, 100) : 0;
    return { w: b + s, sp: s };
  }
  const bAdd = !space && st.bold && !boldFace ? syntheticBoldEm(L?.face ?? st.face, L ? L.hft : st.hft) : 0;
  if (oldEm !== void 0) {
    const b0 = hancomEmWidth(oldEm + bAdd, h, ratio, 0), w0 = spacing ? hancomEmWidth(oldEm + bAdd, h, ratio, spacing) : b0;
    return { w: w0, sp: w0 - b0 };
  }
  const base = hancomCharWidth(ch, h, ratio, 0, fc, bAdd, fallback);
  const w = spacing ? hancomCharWidth(ch, h, ratio, spacing, fc, bAdd, fallback) : base;
  return { w, sp: w - base };
}
function pitchFor(height, geom) {
  const v = geom.lineSpacingValue;
  switch (geom.lineSpacingType) {
    case "PERCENT": {
      const e = Math.trunc(height / 4) * (v - 100) / 100;
      return height + 4 * Math.sign(e) * Math.floor(Math.abs(e) + 0.5);
    }
    case "FIXED":
      return Math.max(0, v);
    case "AT_LEAST":
      return Math.max(v, height);
    default:
      return Math.round(height * 1.6);
  }
}
function reflowPara(p, doc, styles, areaW, startV, mode, zones = [], nums = /* @__PURE__ */ new Map(), bodyFlow = true, pageH = 0) {
  const m = buildPara(p);
  const geom = styles.paraGeom.get(m.paraPrId ?? "") ?? DEFAULT_PARA_GEOM;
  const numText = nextParaNumber(nums, geom);
  if (m.segs.length > 0)
    return null;
  const realIdx = [];
  const rightTabs = /* @__PURE__ */ new Set();
  const rightTabFit = [];
  const widths = [];
  const spacings = [];
  let text = "";
  let x = Math.max(geom.marginIntent, 0);
  const inlineAt = /* @__PURE__ */ new Map();
  for (const o of m.objs)
    if (o.inline)
      inlineAt.set(o.index, o);
  for (let i = 0; i < m.chars.length; i++) {
    const c = m.chars[i];
    const io = inlineAt.get(i);
    if (io) {
      const adv = io.omL + io.width + io.omR;
      realIdx.push(i);
      widths.push(adv);
      spacings.push(0);
      text += "\uFFFC";
      x += adv;
      continue;
    }
    if (c.tab) {
      let adv = tabAdvance(x, true, geom, c.tabW);
      if (c.tabRight) {
        rightTabs.add(text.length);
        let after = 0;
        for (let k = i + 1; k < m.chars.length && !m.chars[k].tab; k++) {
          const ck = m.chars[k];
          if (!ck.ch)
            continue;
          after += glyphWidth(ck.ch, (ck.prId != null ? styles.charPr.get(ck.prId) : void 0) ?? DEFAULT_CHAR).w;
        }
        rightTabFit.push({ wi: widths.length, x, after });
      }
      realIdx.push(i);
      widths.push(adv);
      spacings.push(0);
      text += "	";
      x += adv;
      continue;
    }
    if (c.ctrl) {
      let w2 = 0;
      if (c.ctrlText) {
        const st0 = (c.prId != null ? styles.charPr.get(c.prId) : void 0) ?? DEFAULT_CHAR;
        const st1a = styles.before2024 ? st0 : { ...st0, bold: false };
        const st1 = c.ctrlSup ? st1a : { ...st1a, spacing: 0, ...st1a.latin ? { latin: { ...st1a.latin, spacing: 0 } } : {} };
        const st2 = c.ctrlSup ? { ...st1, height: mulDiv(st1.height, 3, 4) } : st1;
        for (const ch of c.ctrlText)
          w2 += glyphWidth(ch, st2).w;
      }
      realIdx.push(i);
      widths.push(w2);
      spacings.push(0);
      text += w2 > 0 ? "\uFFFC" : c.fieldEnd ? "\uFDD0" : "\u2060";
      x += w2;
      continue;
    }
    if (c.br) {
      realIdx.push(i);
      widths.push(0);
      spacings.push(0);
      text += "\n";
      x = Math.max(0, -geom.marginIntent);
      continue;
    }
    if (c.ch === "")
      continue;
    const st = (c.prId != null ? styles.charPr.get(c.prId) : void 0) ?? DEFAULT_CHAR;
    const cp = c.ch.codePointAt(0);
    const joins = joinsJamo(text.codePointAt(text.length - 1) ?? 0, cp);
    const { w, sp } = joins ? { w: 0, sp: 0 } : glyphWidth(c.ch, st);
    for (let u = 0; u < c.ch.length; u++) {
      realIdx.push(i);
      widths.push(u === 0 ? w : 0);
      spacings.push(u === 0 ? sp : 0);
    }
    text += c.nb ? "\xA0" : c.ch;
    x += w;
  }
  let domChar = DEFAULT_CHAR;
  for (const c of m.chars) {
    if (c.ch !== "" && c.prId != null) {
      const st = styles.charPr.get(c.prId);
      if (st) {
        domChar = st;
        break;
      }
    }
  }
  if (domChar === DEFAULT_CHAR) {
    for (const run of elements(p)) {
      if (ln(run) !== "run")
        continue;
      const st = styles.charPr.get(run.getAttribute("charPrIDRef") ?? "");
      if (st) {
        domChar = st;
        break;
      }
    }
  }
  const height = domChar.height || 1e3;
  const marginL = geom.marginLeft;
  const avail = Math.max(1440, Math.floor(areaW / 4) * 4 - marginL - geom.marginRight);
  const firstWidth = avail;
  const bu = geom.bullet ?? (numText && geom.number ? { ch: numText, ...geom.number } : void 0);
  const bst = (bu?.charPrId != null ? styles.charPr.get(bu.charPrId) : void 0) ?? domChar;
  let headW = 0;
  if (bu)
    for (const ch of bu.ch)
      headW += glyphWidth(ch, bst, bu.useInstWidth !== false).w;
  const bulletW = bu ? paraHeadAdvance(bu, height, headW) : 0;
  const contBullet = bu?.autoIndent ? bulletW : 0;
  const squeeze = p.parentNode?.getAttribute?.("lineWrap") === "SQUEEZE" || !!geom.squeeze;
  const NO_WRAP = 1e9;
  const intentPos = geom.marginIntent >= avail ? 0 : Math.max(0, geom.marginIntent);
  const firstWrapWidth = squeeze ? NO_WRAP : Math.max(500, avail - (styles.before2024 && bulletW > 0 ? Math.max(intentPos, bulletW) : intentPos + bulletW));
  const condenseUse = !styles.before2024 && !styles.early2024 && (geom.number || geom.bullet) ? 0 : geom.condense;
  for (const r of rightTabFit) {
    const edge = avail - bulletW;
    if (r.x + widths[r.wi] + r.after > edge && edge - r.x - r.after >= 0)
      widths[r.wi] = edge - r.x - r.after;
  }
  const contSegWidth = avail;
  const hang = avail + Math.min(0, geom.marginIntent) - contBullet;
  const contWidth = squeeze ? NO_WRAP : hang < height ? avail - contBullet : hang;
  const contHorz = marginL;
  const paraMode = geom.wrapMode ?? mode;
  const pitch = pitchFor(height, geom);
  let floatBelow = 0;
  let firstFloatVo = 0;
  const lineFloats = [];
  let objBottom = startV;
  const effHOf = (o) => (o.tag === "tbl" ? Math.max(o.height, measureTableHeight(o.el, geomMemo(styles))) : o.inline ? Math.max(o.height, drawTextHeight(o.el)) : o.height) + captionExtra(o.el);
  let cellFloatBottom = 0, cellTextBelow = 0;
  const spacesOnly = spacesHost(p);
  const zoneStart = zones.length;
  const OVP = bodyFlow && m.objs.length > 0 && !m.chars.some((c) => c.ch !== "" && c.ch.trim() !== "") && m.objs.every((o) => !o.inline && o.tag === "pic" && o.el.getAttribute("textWrap") === "TOP_AND_BOTTOM" && findChildByLocalName(o.el, "pos")?.getAttribute("allowOverlap") === "1");
  const spacesText = bodyFlow && (spacesOnly || !!OVP || bulletEmptyHost(p, geom));
  const textish = m.chars.some((c) => c.ch !== "" && !c.nb && c.ch.trim() !== "") || m.objs.some((o) => o.inline) || spacesText;
  for (const o of m.objs) {
    if (o.inline)
      continue;
    const pos = findChildByLocalName(o.el, "pos");
    const om = findChildByLocalName(o.el, "outMargin");
    const outT = num(om, "top"), outB = num(om, "bottom");
    const wrapAttr = o.el.getAttribute("textWrap") ?? "";
    if (wrapAttr === "BEHIND_TEXT" || wrapAttr === "IN_FRONT_OF_TEXT")
      continue;
    const vertRel = pos?.getAttribute("vertRelTo") ?? "PARA";
    const paperBand = wrapAttr === "TOP_AND_BOTTOM" && (pos?.getAttribute("vertAlign") ?? "TOP") === "TOP";
    if (vertRel === "PAPER" && bodyFlow && (wrapAttr !== "TOP_AND_BOTTOM" || paperBand)) {
      const [oxL, oyT, paperW] = paperOrigin(p);
      const hRel2 = pos?.getAttribute("horzRelTo") ?? "COLUMN", hAlign2 = pos?.getAttribute("horzAlign") ?? "LEFT";
      const ho2 = num(pos, "horzOffset"), base2 = hRel2 === "PAPER" ? -oxL : hRel2 === "PARA" ? marginL : 0, span2 = hRel2 === "PAPER" ? paperW : hRel2 === "PARA" ? avail : areaW;
      const x02 = base2 + (hAlign2 === "RIGHT" ? span2 - ho2 - o.width : hAlign2 === "CENTER" ? (span2 - o.width) / 2 + ho2 : ho2);
      const vo0 = Math.max(0, num(pos, "vertOffset")), top2 = vertRel === "PAPER" ? vo0 - oyT : vo0;
      const omLx2 = num(om, "left"), omRx2 = num(om, "right");
      const xs2 = hAlign2 === "RIGHT" ? x02 - omRx2 : hAlign2 === "CENTER" ? x02 : x02 + omLx2;
      zones.push({ top: top2, bottom: top2 + outT + effHOf(o) + outB, left: paperBand ? -1e9 : xs2 - omLx2, right: paperBand ? 1e9 : xs2 + o.width + omRx2, flow: o.el.getAttribute("textFlow") ?? "BOTH_SIDES", anchor: o.index });
      continue;
    }
    if (vertRel === "PAGE" || vertRel === "PAPER")
      continue;
    const vo = Math.max(0, num(pos, "vertOffset"));
    const voRaw = num(pos, "vertOffset"), voSigned = Math.max(0, voRaw >= 2 ** 31 ? voRaw - 2 ** 32 : voRaw);
    const effH = effHOf(o);
    if (wrapAttr === "TOP_AND_BOTTOM") {
      const hR = pos?.getAttribute("horzRelTo") ?? "COLUMN", hA = pos?.getAttribute("horzAlign") ?? "LEFT";
      const hoff = num(pos, "horzOffset"), b0 = hR === "PARA" ? marginL : 0, sp = hR === "PARA" ? avail : areaW;
      const xL = b0 + (hA === "RIGHT" ? sp - hoff - o.width : hA === "CENTER" ? (sp - o.width) / 2 + hoff : hoff);
      if ((hR === "COLUMN" || hR === "PARA") && (xL >= areaW || xL + o.width <= 0))
        continue;
    }
    if (wrapAttr === "TOP_AND_BOTTOM") {
      if (bodyFlow) {
        if (voSigned === 0 && textish) {
          lineFloats.push({ index: o.index, h: outT + effH + outB });
          continue;
        }
        if (floatBelow === 0)
          firstFloatVo = voSigned;
        floatBelow = Math.max(floatBelow, voSigned) + outT + effH + outB;
      } else if (spacesOnly)
        cellTextBelow = Math.max(cellTextBelow, voSigned + outT + effH + outB);
      else
        cellFloatBottom = Math.max(cellFloatBottom, voSigned + outT + effH + outB);
      continue;
    }
    const hRel = pos?.getAttribute("horzRelTo") ?? "COLUMN", hAlign = pos?.getAttribute("horzAlign") ?? "LEFT";
    const ho = num(pos, "horzOffset"), base = hRel === "PARA" ? marginL : 0, span = hRel === "PARA" ? avail : areaW;
    const x0 = base + (hAlign === "RIGHT" ? span - ho - o.width : hAlign === "CENTER" ? (span - o.width) / 2 + ho : ho);
    const top = startV - (bodyFlow && vertRel === "PARA" && wrapAttr === "SQUARE" ? geom.spaceBefore : 0) + vo;
    const omLx = num(om, "left"), omRx = num(om, "right");
    const xs = hAlign === "RIGHT" ? x0 - omRx : hAlign === "CENTER" ? x0 : x0 + omLx;
    const nextPage = pageH > 0 && top + effH + outB > pageH;
    zones.push({ top: nextPage ? -1 : top, bottom: nextPage ? -1 : top + effH + outB, left: xs - omLx, right: xs + o.width + omRx, flow: o.el.getAttribute("textFlow") ?? "BOTH_SIDES", anchor: nextPage ? void 0 : o.index, carry: outT + effH + outB, ...nextPage ? { nextPage } : {} });
  }
  const hasText = textish;
  const nFloat = m.objs.filter((o) => !o.inline && o.el.getAttribute("textWrap") === "TOP_AND_BOTTOM" && (findChildByLocalName(o.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA").length;
  const areaTop = bodyFlow ? startV - (geom.spaceBefore ?? 0) : startV;
  let floatFloor = 0;
  if (!hasText && nFloat < 2) {
    objBottom = areaTop + floatBelow;
    if (bodyFlow)
      floatFloor = objBottom;
    floatBelow = 0;
  }
  let band;
  if (floatBelow > 0 && hasText && areaTop + firstFloatVo > startV) {
    band = [areaTop + firstFloatVo, areaTop + floatBelow];
    floatBelow = 0;
  }
  let textStartV = floatBelow > 0 ? Math.max(startV, areaTop + floatBelow) : startV;
  if (cellTextBelow > 0)
    textStartV = Math.max(textStartV, startV + cellTextBelow);
  const firstInline = m.objs.find((o) => o.inline);
  const needW = firstInline && !m.chars.slice(0, firstInline.index).some((c) => c.ch !== "" && c.ch.trim() !== "") ? Math.max(1440, firstInline.omL + firstInline.width + firstInline.omR) : 1440;
  for (let guard = 0; guard < 8 && zoneStart > 0; guard++) {
    const y0 = textStartV, y1 = y0 + height;
    let free = [[marginL, marginL + avail]], bottom = -1;
    for (const z of zones.slice(0, zoneStart)) {
      if (!(y1 > z.top && y0 < z.bottom))
        continue;
      bottom = Math.max(bottom, z.bottom);
      free = free.flatMap(([a, b]) => (z.right <= a || z.left >= b ? [[a, b]] : [[a, Math.max(a, z.left)], [Math.min(b, z.right), b]]).filter(([c, d]) => d - c > 0));
    }
    if (bottom < 0 || free.some(([a, b]) => b - a >= needW))
      break;
    textStartV = bottom;
  }
  const lineBox = [];
  const lineParts = [];
  const collisionHeights = [];
  const boxAt = (i) => {
    if (!zones.length)
      return void 0;
    if (i in lineBox)
      return lineBox[i];
    const y0 = textStartV + i * pitch, y1 = y0 + Math.max(height, collisionHeights[i] ?? 0);
    let free = [[marginL, marginL + avail]], hit = false, flow = "BOTH_SIDES";
    for (const z of zones) {
      if (!(y1 > z.top && y0 < z.bottom))
        continue;
      hit = true;
      flow = z.flow;
      free = free.flatMap(([a, b]) => {
        const parts = z.right <= a || z.left >= b ? [[a, b]] : [[a, Math.max(a, z.left)], [Math.min(b, z.right), b]];
        return parts.filter(([c, d]) => d - c > 0);
      });
    }
    let box;
    if (hit) {
      const pick = flow === "LEFT_ONLY" ? free[0] : flow === "RIGHT_ONLY" ? free[free.length - 1] : free.reduce((x2, y) => y[1] - y[0] > x2[1] - x2[0] ? y : x2, free[0] ?? [marginL, marginL]);
      box = pick ? [pick[0], pick[1] - pick[0]] : [marginL, 0];
      if (flow === "BOTH_SIDES" && free.length > 1)
        lineParts[i] = free;
    }
    lineBox[i] = box;
    return box;
  };
  const lineWidth = zones.length ? (i) => {
    const b = boxAt(i);
    const w = b ? b[1] - (!styles.before2024 && b[0] > marginL ? marginL : 0) : avail;
    return Math.max(500, i === 0 ? w - intentPos - bulletW : w + Math.min(0, geom.marginIntent) - contBullet);
  } : void 0;
  const own = zones.slice(zoneStart);
  if (own.length && text.length) {
    const keep = zones.slice(0, zoneStart);
    const saved = zones.splice(0, zones.length, ...keep);
    lineBox.length = 0;
    const pre = simulateWrap(text, firstWrapWidth, contWidth, height, 100, paraMode, { widths, spacings, condensePct: condenseUse, kinsoku: "hancom", before2024: styles.before2024, lineWidth: zones.length ? lineWidth : void 0, latinBreak: geom.latinBreak, rightTabs });
    zones.splice(0, zones.length, ...saved);
    lineBox.length = 0;
    for (const z of own) {
      const k = realIdx.indexOf(z.anchor);
      if (k < 0)
        continue;
      let li = 0;
      for (let j = 1; j < pre.starts.length; j++)
        if (pre.starts[j] <= k)
          li = j;
      const h = z.bottom - z.top, lineTop = textStartV + li * pitch;
      if (lineTop > z.top) {
        z.top = lineTop;
        z.bottom = lineTop + h;
      } else if (z.top > lineTop && k > pre.starts[li])
        z.top = Math.max(z.top, lineTop + pitch);
    }
  }
  if (own.length && textish) {
    for (let guard = 0; guard < 8; guard++) {
      const y0 = textStartV, y1 = y0 + height;
      let free = [[marginL, marginL + avail]], bottom = -1;
      for (const z of zones) {
        if (!(y1 > z.top && y0 < z.bottom))
          continue;
        bottom = Math.max(bottom, z.bottom);
        free = free.flatMap(([a, b]) => (z.right <= a || z.left >= b ? [[a, b]] : [[a, Math.max(a, z.left)], [Math.min(b, z.right), b]]).filter(([c, d]) => d - c > 0));
      }
      if (bottom < 0 || free.some(([a, b]) => b - a >= 1440))
        break;
      textStartV = bottom;
      lineBox.length = 0;
      lineParts.length = 0;
    }
  }
  const wrapLines = () => text.length === 0 ? { lines: 1, starts: [0], lastLineWidth: 0 } : simulateWrap(text, firstWrapWidth, contWidth, height, 100, paraMode, { widths, spacings, condensePct: condenseUse, kinsoku: "hancom", before2024: styles.before2024, lineWidth, latinBreak: geom.latinBreak, rightTabs });
  let wrap = wrapLines();
  if (zones.length)
    for (let pass = 0; pass < text.length; pass++) {
      let changed = false;
      for (const o of m.objs)
        if (o.inline) {
          const k = realIdx.indexOf(o.index), om = findChildByLocalName(o.el, "outMargin");
          if (k < 0)
            continue;
          let li = 0;
          for (let j = 1; j < wrap.starts.length; j++)
            if (wrap.starts[j] <= k)
              li = j;
          const h = num(om, "top") + effHOf(o) + num(om, "bottom");
          if (h > Math.max(height, collisionHeights[li] ?? 0)) {
            collisionHeights[li] = h;
            changed = true;
          }
        }
      if (!changed)
        break;
      lineBox.length = 0;
      lineParts.length = 0;
      wrap = wrapLines();
    }
  const lineObjH = new Array(wrap.starts.length).fill(0);
  const lineObjAsc = new Array(wrap.starts.length).fill(0);
  const lineObjLs = new Array(wrap.starts.length).fill(false);
  const lineOf = (slot) => {
    let li = 0;
    for (let k = 1; k < wrap.starts.length; k++)
      if ((wrap.starts[k] < realIdx.length ? realIdx[wrap.starts[k]] : Infinity) <= slot)
        li = k;
    return li;
  };
  for (const o of m.objs) {
    if (!o.inline)
      continue;
    const om = findChildByLocalName(o.el, "outMargin");
    const li = lineOf(o.index);
    const h = num(om, "top") + effHOf(o) + num(om, "bottom");
    if (o.tag === "tbl" && li > 0 && o.omL + o.width + o.omR > (lineWidth?.(li - 1) ?? (li === 1 ? firstWrapWidth : contWidth)) && /^[\u2060\ufdd0]+$/.test(text.slice(wrap.starts[li - 1], wrap.starts[li])))
      collisionHeights[li - 1] = Math.max(collisionHeights[li - 1] ?? 0, h);
    lineObjH[li] = Math.max(lineObjH[li], h);
    if (findChildByLocalName(o.el, "pos")?.getAttribute("affectLSpacing") === "1")
      lineObjLs[li] = true;
    const bl = o.tag === "equation" ? Number(o.el.getAttribute("baseLine")) : NaN;
    lineObjAsc[li] = Math.max(lineObjAsc[li], Math.round(h * (Number.isFinite(bl) ? bl / 100 : BASELINE_RATIO)));
  }
  const lsa = doc.createElement("hp:linesegarray");
  const subList = p.parentNode;
  const verticalCenter = subList?.getAttribute?.("vertAlign") === "CENTER" && ["VERTICAL", "VERTICALALL"].includes(subList.getAttribute("textDirection") ?? "");
  let v = textStartV;
  let firstAcc = 0;
  const textposOf = wrap.starts.map((startReal, li) => li === 0 ? 0 : startReal < realIdx.length ? realIdx[startReal] : realIdx.length ? m.chars.length : 0);
  const heightOf = (prId) => (prId != null ? styles.charPr.get(prId)?.height : void 0) || 0;
  const lineTextH = (li) => {
    const s = textposOf[li], last = li === wrap.starts.length - 1, e = last ? m.chars.length : textposOf[li + 1];
    let h = 0;
    for (let k = s; k < e; k++)
      h = Math.max(h, heightOf(m.chars[k].prId));
    for (const r of m.runs)
      if (r.at >= s && (last ? r.at <= e : r.at < e))
        h = Math.max(h, heightOf(r.prId));
    if (li === 0 && bu?.charPrId != null)
      h = Math.max(h, heightOf(bu.charPrId));
    return h || height;
  };
  const fontLineOf = (li) => {
    if (!geom.fontLineHeight)
      return void 0;
    const s = textposOf[li], e = li === wrap.starts.length - 1 ? m.chars.length : textposOf[li + 1];
    if (!m.chars.slice(s, e).some((c) => c.ch && c.ch !== " "))
      return void 0;
    let h = 0, b = 0, any = false;
    for (let k = s; k < e; k++) {
      const c = m.chars[k];
      if (!c.ch)
        continue;
      const st = c.prId != null ? styles.charPr.get(c.prId) : void 0;
      if (!st)
        continue;
      const cp = c.ch.codePointAt(0);
      const font = c.ch !== " " && st.latin && isLatinCp(cp) ? st.latin : st;
      const fm = fontLineMetrics(font.face, font.hft);
      any = true;
      h = Math.max(h, fm ? Math.round(st.height * fm[0]) + (fm[2] ? Math.round : Math.trunc)(st.height * fm[1]) : st.height);
      b = Math.max(b, fm ? Math.round(st.height * fm[0]) : Math.round(st.height * BASELINE_RATIO));
    }
    return any ? [h, b] : void 0;
  };
  const natW = widths.reduce((a, w) => a + w, 0) + spacings.reduce((a, w) => a + w, 0);
  for (let li = 0; li < wrap.starts.length; li++) {
    const textpos = textposOf[li];
    const fl = fontLineOf(li);
    const [boxTop, boxAll, emptyBorder] = lineBorderBox(m, styles, textposOf[li], textposOf[li + 1] ?? m.chars.length);
    const textH0 = fl ? Math.max(fl[0], lineTextH(li)) : lineTextH(li);
    const textH = Math.max(textH0, boxAll);
    const objOnly = lineObjH[li] > 0 && lineObjH[li] < textH && (() => {
      const s0 = textposOf[li], e = li === wrap.starts.length - 1 ? m.chars.length : textposOf[li + 1];
      for (let k = s0; k < e; k++) {
        const c = m.chars[k];
        if (c.ch && c.ch.trim() !== "")
          return false;
      }
      return m.objs.some((o) => o.inline && o.tag === "equation" && lineOf(o.index) === li);
    })();
    const endH = li === wrap.starts.length - 1 && lineObjH[li] > 0 && lineObjH[li] < textH && !m.chars.slice(textposOf[li]).some((c) => c.ch && c.ch.trim() !== "") && m.objs.some((o) => o.inline && o.tag === "tbl" && lineOf(o.index) === li) ? heightOf(m.runs[m.runs.length - 1]?.prId ?? null) : -1;
    const lineH = objOnly ? lineObjH[li] : endH >= 0 ? Math.max(lineObjH[li], endH) : Math.max(textH, lineObjH[li]);
    const spBase = lineObjLs[li] || geom.lineSpacingType === "FIXED" ? lineH : textH;
    const spacing = pitchFor(spBase, geom) - spBase;
    if (band && v < band[1] && v + lineH > band[0])
      v = band[1];
    for (const lf of lineFloats)
      if (lineOf(lf.index) === li) {
        if (li > 0)
          v += lf.h;
        else {
          firstAcc += lf.h;
          v = Math.max(v, areaTop + firstAcc);
        }
      }
    const vertpos = v;
    const nextStart = textposOf[li + 1], nextChar = m.chars[nextStart];
    const boundaryH = !m.objs.length && !geom.fontLineHeight && nextChar?.ch.trim() && m.runs.some((r) => r.at === nextStart && r.prId === nextChar.prId) ? heightOf(nextChar.prId) : 0;
    const occupiedH = Math.max(lineH, collisionHeights[li] ?? 0, boundaryH);
    v += lineH + spacing;
    const isFirst = li === 0;
    const seg = doc.createElement("hp:lineseg");
    seg.setAttribute("textpos", String(textpos));
    seg.setAttribute("vertpos", String(vertpos));
    seg.setAttribute("vertsize", String(emptyBorder ? textH0 : occupiedH === textH && boxAll > textH0 ? Math.max(textH0, boxTop) : occupiedH));
    seg.setAttribute("textheight", String(lineH));
    seg.setAttribute("baseline", String(geom.vertAlign === "TOP" ? 0 : geom.vertAlign === "CENTER" || verticalCenter && (!geom.vertAlign || geom.vertAlign === "BASELINE") ? Math.floor(lineH / 2) : geom.vertAlign === "BOTTOM" ? lineH : endH >= 0 ? Math.max(Math.round(endH * BASELINE_RATIO), lineObjAsc[li]) : Math.max(fl ? fl[1] : Math.round(textH0 * BASELINE_RATIO), boxTop > textH0 ? Math.round(boxTop * BASELINE_RATIO) : 0, lineObjAsc[li])));
    seg.setAttribute("spacing", String(spacing));
    let box = boxAt(li);
    const fit = wrap.starts.length === 1 && lineObjH[li] === 0 ? lineParts[li]?.filter(([a, b]) => b - a >= 1440) : void 0;
    const parts = fit && fit.length > 1 && natW <= fit[0][1] - fit[0][0] - Math.max(0, geom.marginIntent) ? fit : void 0;
    if (parts)
      box = [parts[0][0], parts[0][1] - parts[0][0]];
    seg.setAttribute("horzpos", String(box ? box[0] : isFirst ? marginL : contHorz));
    seg.setAttribute("horzsize", String(box ? box[1] : isFirst ? firstWidth : contSegWidth));
    seg.setAttribute("flags", LINESEG_FLAGS);
    if (paraMode === "charAll" && !inlineAt.size && !geom.marginIntent && !bulletW && !condenseUse && appendNarrowLineFragments(
      lsa,
      seg,
      lineParts[li],
      box,
      { text, widths, spacings, slots: realIdx, start: wrap.starts[li], end: wrap.starts[li + 1] ?? text.length }
    ))
      continue;
    lsa.appendChild(seg);
    for (const [a, b] of parts?.slice(1) ?? []) {
      const more = seg.cloneNode(false);
      more.setAttribute("textpos", String(m.chars.length + 1));
      more.setAttribute("horzpos", String(a));
      more.setAttribute("horzsize", String(b - a));
      lsa.appendChild(more);
    }
  }
  p.appendChild(lsa);
  const textBottom = v;
  if (cellFloatBottom > 0)
    floatFloor = Math.max(floatFloor, startV + cellFloatBottom);
  if (band)
    zones.push({ top: band[0], bottom: band[1], left: -1e9, right: 1e9, flow: "BOTH_SIDES" });
  return { paraBottom: Math.max(textBottom, objBottom), floatFloor, textBottom, spaceAfter: geom.spaceAfter };
}
const originMemo = /* @__PURE__ */ new WeakMap();
function paperOrigin(p) {
  const d = p.ownerDocument;
  const hit = originMemo.get(d);
  if (hit)
    return hit;
  const pagePr = p.ownerDocument?.getElementsByTagName("hp:pagePr")[0] ?? null;
  const mg = pagePr ? findChildByLocalName(pagePr, "margin") : null;
  const tb = pagePr?.getAttribute("gutterType") === "TOP_BOTTOM", gut = num(mg, "gutter");
  const o = [num(mg, "left", 8504) + (tb ? 0 : gut), num(mg, "top", 5668) + num(mg, "header") + (tb ? gut : 0), num(pagePr, "width", 59528)];
  originMemo.set(d, o);
  return o;
}
function carryZones(zones, bodyH, oneColumn) {
  const moved = oneColumn ? zones.filter((z) => z.carry !== void 0 && (z.bottom > bodyH || z.nextPage)).map((z) => ({ ...z, top: 0, bottom: z.carry, carry: void 0, nextPage: void 0 })) : [];
  zones.length = 0;
  zones.push(...moved);
}
function pageTopBand(p) {
  let top = Infinity, bot = 0;
  for (const run of elements(p)) {
    if (ln(run) !== "run")
      continue;
    for (const o of elements(run)) {
      if (!OBJ_TAGS.has(ln(o)) || o.getAttribute("textWrap") !== "TOP_AND_BOTTOM")
        continue;
      const pos = findChildByLocalName(o, "pos");
      if (pos?.getAttribute("treatAsChar") === "1" || pos?.getAttribute("vertRelTo") !== "PAGE" || (pos?.getAttribute("vertAlign") ?? "TOP") !== "TOP")
        continue;
      const om = findChildByLocalName(o, "outMargin"), sz = findChildByLocalName(o, "sz");
      const h = ln(o) === "tbl" ? Math.max(num(sz, "height"), measureTableHeight(o)) : num(sz, "height");
      const vo = Math.max(0, num(pos, "vertOffset"));
      top = Math.min(top, vo);
      bot = Math.max(bot, vo + num(om, "top") + h + num(om, "bottom"));
    }
  }
  return bot > 0 ? [top, bot] : [0, 0];
}
function drawTextHeight(el) {
  const dt = findChildByLocalName(el, "drawText");
  const sub = dt ? findChildByLocalName(dt, "subList") : null;
  if (!sub)
    return 0;
  let bottom = 0;
  for (const q of elements(sub)) {
    if (ln(q) !== "p")
      continue;
    const lsa = findChildByLocalName(q, "linesegarray");
    for (const seg of lsa ? elements(lsa) : [])
      if (ln(seg) === "lineseg")
        bottom = Math.max(bottom, num(seg, "vertpos") + num(seg, "vertsize"));
  }
  const tm = findChildByLocalName(dt, "textMargin");
  return bottom > 0 ? bottom + num(tm, "top") + num(tm, "bottom") : 0;
}
function footNoteSpacing(root) {
  const pr = root.getElementsByTagName("hp:footNotePr")[0];
  const sp = pr ? findChildByLocalName(pr, "noteSpacing") : null;
  return { above: num(sp, "aboveLine", 850), below: num(sp, "belowLine", 567), between: num(sp, "betweenNotes", 283) };
}
function footNoteBottom(fn) {
  const sub = findChildByLocalName(fn, "subList");
  let bottom = 0;
  for (const q of sub ? elements(sub) : []) {
    if (ln(q) !== "p")
      continue;
    const lsa = findChildByLocalName(q, "linesegarray");
    for (const seg of lsa ? elements(lsa) : [])
      if (ln(seg) === "lineseg")
        bottom = Math.max(bottom, num(seg, "vertpos") + num(seg, "vertsize"));
  }
  return bottom;
}
function footNoteRefs(p) {
  const m = buildPara(p);
  const out = [];
  m.chars.forEach((c, i) => {
    if (c.note && ln(c.note) === "footNote")
      out.push([footNoteBottom(c.note), i]);
  });
  for (const o of m.objs)
    for (const fn of Array.from(o.el.getElementsByTagName("hp:footNote")))
      out.push([footNoteBottom(fn), o.index]);
  return out;
}
function footNoteHeights(p, ownOnly = false) {
  const out = [];
  for (const fn of Array.from(p.getElementsByTagName("hp:footNote"))) {
    const sub = findChildByLocalName(fn, "subList");
    if (!sub)
      continue;
    if (ownOnly) {
      let a = fn.parentNode, inSplit = false;
      while (a && a !== p) {
        const e = a;
        if (ln(e) === "tbl" && (e.getAttribute("pageBreak") === "CELL" || e.getAttribute("pageBreak") === "TABLE") && findChildByLocalName(e, "pos")?.getAttribute("treatAsChar") !== "1")
          inSplit = true;
        a = a.parentNode;
      }
      if (inSplit)
        continue;
    }
    let bottom = 0;
    for (const q of elements(sub)) {
      if (ln(q) !== "p")
        continue;
      const lsa = findChildByLocalName(q, "linesegarray");
      for (const seg of lsa ? elements(lsa) : [])
        if (ln(seg) === "lineseg")
          bottom = Math.max(bottom, num(seg, "vertpos") + num(seg, "vertsize"));
    }
    out.push(bottom);
  }
  return out;
}
function reflowBlockFlow(container, doc, styles, areaW, mode, counter, bodyH) {
  let cursorV = 0;
  let prevSpaceAfter = 0;
  let floatFloor = 0;
  let pageNotes = 0, pageFoot = 0;
  let carryNotes = 0, carryFoot = 0;
  let contentBottom = 0;
  let splitPage = false;
  const footSp = footNoteSpacing(container);
  const zones = [];
  let pageLimit = bodyH;
  let prevPlaced;
  const bodyFlow = areaW === counter.bodyW && bodyH > 0;
  const vis = bodyH > 0 ? findFirst(container, "visibility") : null;
  const hideFirstEmpty = vis?.getAttribute("hideFirstEmptyLine") === "1";
  let hidPrev = 0;
  const cellW = areaW;
  let cellCols = 1, cellCol = 0;
  for (const p of elements(container)) {
    if (ln(p) !== "p")
      continue;
    if (bodyFlow) {
      const colW = columnWidthIn(p, counter.bodyW);
      if (colW !== void 0)
        areaW = colW;
    } else if (bodyH === 0) {
      const colW = columnWidthIn(p, cellW);
      if (colW !== void 0) {
        cellCols = colW === cellW ? 1 : Math.round((cellW + 1) / (colW + 1));
        areaW = colW;
      }
      if (cellCols > 1 && cellCol < cellCols - 1 && cursorV > 0 && p.getAttribute("columnBreak") === "1") {
        cellCol++;
        cursorV = 0;
        prevSpaceAfter = 0;
      }
    }
    reflowTablesIn(p, doc, styles, mode, counter, reflowBlockFlow);
    reflowSubListsIn(p, doc, styles, mode, counter, reflowBlockFlow, bodyFlow ? areaW : void 0);
    const g = styles.paraGeom.get(p.getAttribute("paraPrIDRef") ?? "");
    const cursorBefore = cursorV;
    let startV = Math.max(cursorV + prevSpaceAfter + (g?.spaceBefore ?? 0), floatFloor);
    floatFloor = 0;
    if (bodyH > 0) {
      const [top, bot] = pageTopBand(p);
      if (bot > 0 && top <= startV && startV < bot)
        startV = bot;
    }
    const numsBefore = new Map([...counter.nums ?? []].map(([k, v]) => [k, v.slice()]));
    const zonesBefore = zones.length;
    let res = reflowPara(p, doc, styles, areaW, startV, mode, zones, counter.nums, bodyH > 0, bodyH);
    if (res && bodyFlow) {
      const lsa0 = findChildByLocalName(p, "linesegarray"), s0 = lsa0 ? elements(lsa0).find((e) => ln(e) === "lineseg") : void 0;
      const v0 = s0 ? num(s0, "vertpos") : startV;
      const bandZ = v0 > startV ? zones.slice(0, zonesBefore).find((z) => z.left <= -1e8 && z.bottom === v0 && z.top < v0) : void 0;
      if (bandZ && hasTbFloat(p)) {
        p.removeChild(lsa0);
        zones.length = zonesBefore;
        res = reflowPara(p, doc, styles, areaW, v0, mode, zones, new Map([...numsBefore].map(([k, v]) => [k, v.slice()])), bodyH > 0, bodyH);
        startV = v0;
      }
    }
    if (!res) {
      const lsa = findChildByLocalName(p, "linesegarray");
      if (lsa) {
        const bottom = cachedParagraphBottom(lsa, bodyFlow);
        if (Number.isFinite(bottom)) {
          cursorV = bottom;
          prevSpaceAfter = g?.spaceAfter ?? 0;
        }
      }
      continue;
    }
    const paraH = res.paraBottom - startV;
    const explicitBreak = bodyH > 0 && startV > 0 && (p.getAttribute("pageBreak") === "1" || p.getAttribute("columnBreak") === "1" || !!g?.pageBreakBefore);
    const lines = bodyH > 0 ? elements(findChildByLocalName(p, "linesegarray") ?? p).filter((e) => ln(e) === "lineseg") : [];
    const reserve = bodyH > 0 ? pageBottomReserve(p) : 0;
    const fns = bodyH > 0 ? footNoteHeights(p) : [];
    const footArea = (n, sum) => n > 0 ? footSp.above + footSp.below + sum + footSp.between * (n - 1) : 0;
    const fnSum = fns.reduce((a, b) => a + b, 0);
    const limFoot = bodyH - footArea(pageNotes + fns.length, pageFoot + fnSum);
    const lim = Math.min(reserve > 0 ? Math.min(pageLimit, bodyH - reserve) : pageLimit, limFoot);
    const fnsOwn = fns.length ? footNoteHeights(p, true) : fns, ownSum = fnsOwn.reduce((a, b) => a + b, 0);
    const limOwn = fnsOwn.length < fns.length ? Math.min(reserve > 0 ? Math.min(pageLimit, bodyH - reserve) : pageLimit, bodyH - footArea(pageNotes + fnsOwn.length, pageFoot + ownSum)) : lim;
    const refs = bodyH > 0 && fns.length ? footNoteRefs(p) : [];
    const tpOf = (seg) => num(seg, "textpos");
    const limAt = (i) => {
      if (!refs.length)
        return lim;
      const end = i + 1 < lines.length ? tpOf(lines[i + 1]) : Number.POSITIVE_INFINITY;
      const inn = refs.filter(([, at]) => at < (i > 0 ? tpOf(lines[i]) : end));
      const base = reserve > 0 ? Math.min(pageLimit, bodyH - reserve) : pageLimit;
      return Math.min(base, bodyH - footArea(pageNotes + inn.length, pageFoot + inn.reduce((a, [h]) => a + h, 0)));
    };
    const lineBottom = (seg) => num(seg, "vertpos") + num(seg, "vertsize") + (reserve > 0 ? num(seg, "spacing") : 0) + 1;
    let firstOver = lines.length > 0 && startV > 0 && lineBottom(lines[0]) > (limOwn !== lim ? limOwn : limAt(0));
    const BUH = bodyH > 0 && bulletEmptyHost(p, g);
    if (firstOver && BUH)
      firstOver = false;
    let hidden = false;
    if (firstOver && hideFirstEmpty && lines.length === 1 && hidPrev < 2) {
      const pm = buildPara(p);
      if (pm.objs.length === 0 && !pm.chars.some((c) => c.ch.trim() !== "")) {
        firstOver = false;
        hidden = true;
      }
    }
    let off = 0;
    let cut = -1;
    if (!explicitBreak && !firstOver && lines.length > 1) {
      cut = lines.findIndex((seg, i) => i > 0 && lineBottom(seg) > limAt(i) && num(seg, "vertsize") <= bodyH);
      if (cut > 0 && g?.widowOrphan && lines.length >= 3 && cut === lines.length - 1)
        cut--;
    }
    const orphan = cut === 1 && !!g?.widowOrphan || cut > 0 && !!g?.keepLines;
    if (cut > 0 && !orphan) {
      for (let i = cut; i < lines.length; i++) {
        const seg = lines[i];
        let vp = num(seg, "vertpos") + off;
        const vs = num(seg, "vertsize");
        if (i === cut || vp > 0 && vp + vs > bodyH && vs <= bodyH) {
          off -= vp;
          vp = 0;
          carryZones(zones, bodyH, areaW === counter.bodyW);
        }
        seg.setAttribute("vertpos", String(vp));
      }
    }
    if (explicitBreak || firstOver || orphan || bodyH > 0 && startV > 0 && lines.length === 0 && res.paraBottom > bodyH && paraH <= bodyH) {
      const own = zones.length > zonesBefore;
      zones.length = zonesBefore;
      if (zones.length || own) {
        carryZones(zones, bodyH, areaW === counter.bodyW);
        const lsa = findChildByLocalName(p, "linesegarray");
        if (lsa)
          p.removeChild(lsa);
        const zb = zones.length;
        const sb0 = g?.spaceBefore ?? 0;
        let moveRes = reflowPara(p, doc, styles, areaW, sb0, mode, zones, new Map([...numsBefore].map(([k, v]) => [k, v.slice()])), true, bodyH);
        const lsaM = findChildByLocalName(p, "linesegarray"), sM = lsaM ? elements(lsaM).find((e) => ln(e) === "lineseg") : void 0;
        const vM = sM ? num(sM, "vertpos") : sb0;
        if (vM > sb0 && zones.slice(0, zb).some((z) => z.left <= -1e8 && z.bottom === vM && z.top < vM) && hasTbFloat(p)) {
          p.removeChild(lsaM);
          zones.length = zb;
          moveRes = reflowPara(p, doc, styles, areaW, vM, mode, zones, new Map([...numsBefore].map(([k, v]) => [k, v.slice()])), true, bodyH);
        }
        cursorV = moveRes.paraBottom;
        if (bodyH > 0 && squareTableOver(p, 0, bodyH)) {
          const split2 = splitFloatTableRemainder(p, 0, bodyH, bodyH, styles);
          if (split2 !== void 0) {
            cursorV = 0;
            floatFloor = split2;
            zones.length = 0;
            splitPage = true;
          }
        }
      } else {
        const top = g?.spaceBefore ?? 0;
        shiftParaVert(p, top - startV);
        cursorV = paraH + top;
        if (bodyH > 0 && (top + paraH > bodyH || squareTableOver(p, top, bodyH))) {
          const split2 = splitFloatTableRemainder(p, top, bodyH, bodyH, styles);
          if (split2 !== void 0) {
            cursorV = 0;
            floatFloor = split2;
            zones.length = 0;
            splitPage = true;
          }
        }
        if (prevPlaced?.keepWithNext && prevPlaced.startV > prevPlaced.top) {
          shiftParaVert(prevPlaced.p, prevPlaced.top - prevPlaced.startV);
          const base = prevPlaced.top + prevPlaced.h + prevPlaced.spaceAfter;
          shiftParaVert(p, base);
          cursorV += base;
        }
      }
    } else {
      cursorV = (res.floatFloor > 0 && off === 0 ? res.textBottom : res.paraBottom) + off;
      if (res.floatFloor > 0 && off === 0)
        floatFloor = res.floatFloor;
      const split = bodyH > 0 && off === 0 && (res.paraBottom > lim || squareTableOver(p, startV, lim)) ? splitFloatTableRemainder(p, startV - (g?.spaceBefore ?? 0), limOwn, bodyH, styles, false, { n0: pageNotes + fnsOwn.length, s0: pageFoot + ownSum, area: footArea }) : void 0;
      const tEl = split !== void 0 && splitWhole ? m0Objs(p) : void 0;
      const tVo = tEl ? num(findChildByLocalName(tEl, "pos"), "vertOffset") : 0;
      const tOm = tEl ? findChildByLocalName(tEl, "outMargin") : null;
      if (tEl && tVo > 0 && tVo < 2 ** 31 && num(tOm, "top") + measureTableHeight(tEl) + num(tOm, "bottom") <= bodyH) {
        const tTop = startV - (g?.spaceBefore ?? 0) + tVo;
        zones.push({ top: tTop, bottom: Math.max(bodyH + 1, tTop + 1), left: -1e9, right: 1e9, flow: "BOTH_SIDES", carry: split });
        floatFloor = 0;
        cursorV = res.textBottom;
      } else if (split !== void 0 && splitMovedLast) {
        cursorV = 0;
        floatFloor = split;
        zones.length = 0;
        splitPage = true;
        const own = BUH ? elements(findChildByLocalName(p, "linesegarray") ?? p).filter((e) => ln(e) === "lineseg") : [];
        if (own.length) {
          const d = split - num(own[0], "vertpos");
          for (const sg of own)
            sg.setAttribute("vertpos", String(num(sg, "vertpos") + d));
          cursorV = res.textBottom + d;
          floatFloor = 0;
        }
      } else if (bodyH > 0 && off === 0 && squareTableOver(p, startV, lim, true, areaW)) {
        const split3 = splitFloatTableRemainder(p, startV, lim, bodyH, styles, true);
        const lsa = findChildByLocalName(p, "linesegarray");
        const own = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
        const sq = m0Objs(p), sqPos = sq ? findChildByLocalName(sq, "pos") : null;
        const sqVo = num(sqPos, "vertOffset"), sqTop = startV + Math.max(0, sqVo >= 2 ** 31 ? sqVo - 2 ** 32 : sqVo) + num(sq ? findChildByLocalName(sq, "outMargin") : null, "top");
        if (split3 !== void 0 && sq && own.length && own.every((sg) => num(sg, "vertpos") + num(sg, "vertsize") <= sqTop)) {
          cursorV = 0;
          floatFloor = split3;
          zones.length = 0;
          splitPage = true;
        } else if (split3 !== void 0 && own.length) {
          const d = split3 - num(own[0], "vertpos");
          for (const sg of own)
            sg.setAttribute("vertpos", String(num(sg, "vertpos") + d));
          cursorV = res.textBottom + d;
          zones.length = 0;
          splitPage = true;
        }
      } else if (bodyH > 0 && off === 0 && bandTableOver(p, startV - (g?.spaceBefore ?? 0), lim)) {
        const BU = BUH;
        const split4 = splitFloatTableRemainder(p, startV - (g?.spaceBefore ?? 0), BU ? limOwn : lim, bodyH, styles, true, BU ? { n0: pageNotes + fnsOwn.length, s0: pageFoot + ownSum, area: footArea } : void 0);
        if (split4 !== void 0) {
          cursorV = 0;
          floatFloor = split4;
          zones.length = 0;
          splitPage = true;
          const own = BU && splitMovedLast ? elements(findChildByLocalName(p, "linesegarray") ?? p).filter((e) => ln(e) === "lineseg") : [];
          if (own.length) {
            const d = split4 - num(own[0], "vertpos");
            for (const sg of own)
              sg.setAttribute("vertpos", String(num(sg, "vertpos") + d));
            cursorV = res.textBottom + d;
            floatFloor = 0;
          }
        }
      }
    }
    const keepCursor = hidden && !explicitBreak;
    hidPrev = hidden ? hidPrev + 1 : 0;
    prevPlaced = off === 0 && !(explicitBreak || firstOver || orphan) ? { p, startV, top: g?.spaceBefore ?? 0, h: paraH, spaceAfter: res.spaceAfter, keepWithNext: !!g?.keepWithNext } : void 0;
    const moved = explicitBreak || firstOver || orphan || off !== 0;
    pageLimit = reserve > 0 ? bodyH - reserve : moved ? bodyH : Math.min(pageLimit, reserve > 0 ? bodyH - reserve : pageLimit);
    if (moved && refs.length && cut > 0 && !orphan && !explicitBreak && !firstOver) {
      const lastKept = lines[cut - 1], fromKept = tpOf(lastKept);
      const keptRefs = refs.filter(([, at]) => at >= fromKept && at < tpOf(lines[cut]));
      const before = refs.filter(([, at]) => at < fromKept);
      const pushed = keptRefs.length && cut > 1 && lineBottom(lastKept) > bodyH - footArea(pageNotes + before.length + keptRefs.length, pageFoot + [...before, ...keptRefs].reduce((a2, [h]) => a2 + h, 0));
      const from = pushed ? fromKept : tpOf(lines[cut]), mv = refs.filter(([, at]) => at >= from);
      pageNotes = mv.length;
      pageFoot = mv.reduce((a, [h]) => a + h, 0);
      pageNotes += carryNotes;
      pageFoot += carryFoot;
      carryNotes = 0;
      carryFoot = 0;
    } else if (moved) {
      {
        const prevBottom = off !== 0 && cut > 0 ? num(lines[cut - 1], "vertpos") + num(lines[cut - 1], "vertsize") : contentBottom;
        const excess = footArea(pageNotes, pageFoot) - (bodyH - prevBottom);
        if (excess > 0 && pageNotes > 0) {
          carryNotes += 1;
          carryFoot += excess;
        }
      }
      pageNotes = fns.length + carryNotes;
      pageFoot = fnSum + carryFoot;
      carryNotes = 0;
      carryFoot = 0;
    } else if (splitPage) {
      pageNotes = splitNotesLast.n;
      pageFoot = splitNotesLast.s;
      carryNotes = 0;
      carryFoot = 0;
    } else {
      const last = lines[lines.length - 1];
      const lastRefs = last && lines.length > 1 ? refs.filter(([, at]) => at >= tpOf(last)) : [];
      const lastSum = lastRefs.reduce((a, [h]) => a + h, 0);
      if (lastRefs.length && lineBottom(last) > bodyH - footArea(pageNotes + fns.length, pageFoot + fnSum)) {
        pageNotes += fns.length - lastRefs.length;
        pageFoot += fnSum - lastSum;
        carryNotes += lastRefs.length;
        carryFoot += lastSum;
      } else {
        pageNotes += fns.length;
        pageFoot += fnSum;
      }
    }
    {
      const lsa2 = findChildByLocalName(p, "linesegarray"), segs2 = lsa2 ? elements(lsa2).filter((e) => ln(e) === "lineseg") : [], lastSeg = segs2[segs2.length - 1];
      const lb = lastSeg ? num(lastSeg, "vertpos") + num(lastSeg, "vertsize") : 0;
      contentBottom = splitPage ? floatFloor : keepCursor ? contentBottom : Math.max(lb, res.floatFloor > 0 && off === 0 ? floatFloor : 0);
    }
    splitPage = false;
    if (keepCursor)
      cursorV = cursorBefore;
    else
      prevSpaceAfter = res.spaceAfter;
    counter.n++;
  }
}
function reflowSection(root, styles, geom, mode = "keep") {
  const doc = root.ownerDocument;
  let endNoteW;
  for (const p of elements(root))
    if (ln(p) === "p")
      endNoteW = columnWidthIn(p, geom.BODY_W) ?? endNoteW;
  const counter = { n: 0, bodyW: geom.BODY_W, endNoteW, nums: /* @__PURE__ */ new Map() };
  reflowBlockFlow(root, doc, styles, geom.BODY_W, mode, counter, geom.BODY_H);
  if (geom.BODY_H > 0)
    flowEndNotes(root, geom.BODY_H);
  return counter.n;
}
function flowEndNotes(root, bodyH) {
  const notes = [];
  let last;
  for (const p of elements(root)) {
    if (ln(p) !== "p")
      continue;
    const lsa = findChildByLocalName(p, "linesegarray"), segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
    if (segs.length)
      last = segs[segs.length - 1];
    for (const run of elements(p))
      if (ln(run) === "run") {
        for (const ctrl of elements(run))
          if (ln(ctrl) === "ctrl") {
            const en = findChildByLocalName(ctrl, "endNote"), sub = en && !isDeletedControl(en) ? findChildByLocalName(en, "subList") : null;
            if (sub)
              notes.push(sub);
          }
      }
  }
  if (!notes.length || !last)
    return;
  const pr = findFirst(root, "endNotePr"), sp = pr ? findChildByLocalName(pr, "noteSpacing") : null;
  let y = num(last, "vertpos") + num(last, "vertsize") + num(sp, "aboveLine", 0) + num(sp, "belowLine", 567);
  let pend = 0;
  notes.forEach((sub, ni) => {
    if (ni > 0)
      y += num(sp, "betweenNotes", 283);
    let base = y, off = y, shift = 0;
    let forced;
    const floats = subFloatBottoms(sub), done = /* @__PURE__ */ new Set();
    for (const q of elements(sub)) {
      if (ln(q) !== "p")
        continue;
      const lsa = findChildByLocalName(q, "linesegarray");
      for (const seg of lsa ? elements(lsa) : []) {
        if (ln(seg) !== "lineseg")
          continue;
        const raw0 = num(seg, "vertpos"), vs = num(seg, "vertsize");
        for (const f of floats) {
          if (done.has(f) || raw0 < f.bottom)
            continue;
          done.add(f);
          if (!(base + f.lineBottom - shift <= bodyH && base + f.bottom - shift > bodyH))
            continue;
          if (f.rows?.length && f.el?.getAttribute("pageBreak") === "CELL") {
            let yy = base + f.bottom - f.carry - shift + f.outT, k = 0;
            while (k < f.rows.length && yy + f.rows[k] <= bodyH)
              yy += f.rows[k++];
            if (k === f.rows.length)
              continue;
            forced = { at: f.bottom, rem: f.outT + f.rows.slice(k).reduce((a, b) => a + b, 0) + f.outB };
            continue;
          }
          shift += f.bottom - f.hostEnd;
          pend = Math.max(pend, f.carry);
        }
        const raw = raw0 - shift;
        let v = base + raw;
        if (forced && raw0 >= forced.at) {
          base = forced.rem - forced.at + shift;
          v = base + raw;
          off = 0;
          forced = void 0;
        } else if (v + vs > bodyH && v > 0) {
          base = pend - raw;
          v = pend;
          off = 0;
          pend = 0;
        }
        seg.setAttribute("vertpos", String(v - off));
        y = v + vs;
      }
    }
  });
}
export {
  glyphWidth,
  hancomLangOf,
  joinsJamo,
  reflowSection
};
