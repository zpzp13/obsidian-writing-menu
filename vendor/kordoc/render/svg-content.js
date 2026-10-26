// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/svg-content.ts. MIT; see LICENSE.
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { measureTextWidth, faceClassOf } from "../hwpx/text-metrics.js";
import { DEFAULT_CHAR } from "./head-styles.js";
import { glyphWidth, joinsJamo } from "./reflow.js";
import { mapPuaText } from "../shared/pua.js";
import { latexToPlain } from "./equation-text.js";
import { hwpEquationToLatex } from "../hwp5/equation.js";
import { nextParaNumber } from "./para-number.js";
import { ln, elements, num, OBJ_TAGS, FORM_TAGS, buildPara, tabAdvance, paraHeadAdvance, cellContentExtent, measureTableHeight, captionOf, captionExtra } from "./para-model.js";
import { mulAffine, renderingMatrix, shapeGeometry, rotatedBounds, SHAPE_TAGS } from "./shape-geometry.js";
import { anchorObject, linePushedBy } from "./object-anchor.js";
function escapeXml(s) {
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const pt = (u) => String(Math.round(u) / 100);
const ptNum = (u) => Math.round(u) / 100;
function pageNo(ctx) {
  return ctx.pageBase + ctx.page + 1;
}
function bboxOf(ctx, x, y, w, h) {
  const b = rotatedBounds({ x, y, w, h }, ctx.regionRotations);
  if (ctx.bodyDx)
    b.x += ctx.bodyDx(ctx.page);
  const clippedH = Math.max(0, Math.min(b.h, ctx.pageH - b.y));
  return { page: pageNo(ctx), x: ptNum(b.x), y: ptNum(b.y), width: ptNum(Math.max(0, b.w)), height: ptNum(clippedH) };
}
function regionOpenTag(id, type, page) {
  return `<g data-kordoc-id="${id}" data-kordoc-type="${type}" data-kordoc-page="${page}">`;
}
function parentId(ctx) {
  return ctx.parentStack.length ? ctx.parentStack[ctx.parentStack.length - 1] : void 0;
}
function emit(ctx, s) {
  ctx.pages[ctx.page].push(s);
}
function warnOnce(ctx, key, msg) {
  if (ctx.warned.has(key))
    return;
  ctx.warned.add(key);
  ctx.warnings.push(msg);
}
function charW(c, styles, prev) {
  const st = (c.prId != null ? styles.charPr.get(c.prId) : void 0) ?? DEFAULT_CHAR;
  if (c.ch === "" && c.ctrlText)
    return measureTextWidth(c.ctrlText, c.ctrlSup ? Math.round(st.height * 3 / 4) : st.height, st.ratio, { spacingPct: st.spacing, faceClass: faceClassOf(st.face) });
  let w = 0, last = prev?.ch ? prev.ch.codePointAt(prev.ch.length - 1) ?? 0 : 0;
  for (const ch of c.ch) {
    const cp = ch.codePointAt(0);
    if (!joinsJamo(last, cp))
      w += glyphWidth(ch, st).w;
    last = cp;
  }
  return w;
}
function lineNaturalWidth(m, styles, start, end) {
  let text = 0;
  for (let i = start; i < end && i < m.chars.length; i++)
    text += charW(m.chars[i], styles, m.chars[i - 1]);
  let obj = 0;
  for (const o of m.objs)
    if (o.inline && o.index >= start && o.index < end)
      obj += o.omL + o.width + o.omR;
  return { text, obj };
}
function planLines(m, styles, numText = "") {
  const align = (m.paraPrId != null ? styles.paraAlign.get(m.paraPrId) : void 0) ?? "JUSTIFY";
  const geom = m.paraPrId != null ? styles.paraGeom.get(m.paraPrId) : void 0;
  const hang = geom && geom.marginIntent < 0 ? -geom.marginIntent : 0;
  const bu = geom?.bullet ?? (numText && geom?.number ? { ch: numText, ...geom.number } : void 0);
  const firstPr = m.chars.find((c) => c.ch !== "")?.prId ?? null;
  const bst = (bu?.charPrId != null ? styles.charPr.get(bu.charPrId) : firstPr != null ? styles.charPr.get(firstPr) : void 0) ?? DEFAULT_CHAR;
  const headW = bu?.useInstWidth === false ? [...bu.ch].reduce((w, ch) => w + glyphWidth(ch, bst, false).w, 0) : bu ? measureTextWidth(bu.ch, bst.height, bst.ratio, { spacingPct: bst.spacing, faceClass: faceClassOf(bst.face) }) : 0;
  const bulletW = bu ? paraHeadAdvance(bu, bst.height, headW) : 0;
  const plans = [];
  const inlineW = /* @__PURE__ */ new Map();
  for (const o of m.objs)
    if (o.inline)
      inlineW.set(o.index, o.omL + o.width + o.omR);
  for (let i = 0; i < m.segs.length; i++) {
    const seg = m.segs[i];
    const start = seg.textpos;
    const end = i + 1 < m.segs.length ? m.segs[i + 1].textpos : Math.max(m.chars.length, start);
    const tabs = /* @__PURE__ */ new Map();
    const lead = i === 0 ? Math.max(geom?.marginIntent ?? 0, 0) + bulletW : hang + (bu?.autoIndent ? bulletW : 0);
    let x = (i === 0 ? Math.max(geom?.marginIntent ?? 0, 0) : hang) + (i === 0 || bu?.autoIndent ? bulletW : 0);
    let fixedTo = start;
    let fixedW = 0;
    for (let k = start; k < end && k < m.chars.length; k++) {
      const c = m.chars[k];
      const ow = inlineW.get(k);
      if (ow !== void 0) {
        x += ow;
        continue;
      }
      if (!c.tab) {
        x += charW(c, styles, m.chars[k - 1]);
        continue;
      }
      const adv = tabAdvance(x, i === 0, geom, c.tabW);
      tabs.set(k, adv);
      x += adv;
      fixedTo = k + 1;
    }
    if (fixedTo > start)
      fixedW = lineNaturalWidth(m, styles, start, fixedTo).text + [...tabs.values()].reduce((a, b) => a + b, 0);
    let textEnd = Math.min(end, m.chars.length);
    while (textEnd > fixedTo && m.chars[textEnd - 1].br)
      textEnd--;
    while (textEnd > fixedTo && m.chars[textEnd - 1].ch === " ")
      textEnd--;
    const nat = lineNaturalWidth(m, styles, fixedTo, textEnd);
    for (const o of m.objs)
      if (o.inline && o.index >= textEnd && o.index < end)
        nat.obj += o.omL + o.width + o.omR;
    nat.obj += fixedW;
    for (const o of m.objs)
      if (o.inline && o.index >= start && o.index < fixedTo)
        nat.obj += o.omL + o.width + o.omR;
    let brEnd = false;
    for (let k = start; k < end && k < m.chars.length; k++)
      if (m.chars[k].br)
        brEnd = true;
    const isLast = i === m.segs.length - 1 || brEnd;
    let xoff = 0;
    let scale = 1;
    const lineW = seg.horzsize - lead;
    const avail = lineW - nat.obj;
    let lastSp = 0;
    if (fixedTo === start) {
      let k = textEnd - 1;
      while (k >= start && m.chars[k].ch === "")
        k--;
      if (k >= start) {
        const c = m.chars[k], st = (c.prId != null ? styles.charPr.get(c.prId) : void 0) ?? DEFAULT_CHAR;
        const cps = [...c.ch];
        lastSp = glyphWidth(cps[cps.length - 1], st).sp;
      }
    }
    const stretch = align === "JUSTIFY" || align === "DISTRIBUTE" || align === "DISTRIBUTE_SPACE";
    let spaceAdd = 0, spaceFrom = fixedTo, charAdd = 0;
    const squeeze = (spFrom) => {
      const short = nat.text - lastSp - avail;
      let nSp = 0, cap = 0, nG = 0;
      for (let k = spFrom; k < textEnd; k++) {
        const c = m.chars[k];
        if (c.ch === " ") {
          nSp++;
          cap += charW(c, styles, m.chars[k - 1]) * 0.2;
        } else if (c.ch && !c.tab)
          nG++;
      }
      if (nSp > 0) {
        spaceAdd = -Math.min(short, cap) / nSp;
        spaceFrom = spFrom;
      }
      if (short > cap && nG > 0)
        charAdd = -(short - (nSp > 0 ? cap : 0)) / nG;
    };
    if (nat.text > 0 && stretch && (!isLast || align === "DISTRIBUTE" || align === "DISTRIBUTE_SPACE")) {
      let nSp = 0, spFrom = fixedTo;
      while (spFrom < textEnd && (m.chars[spFrom].ch === " " || m.chars[spFrom].ch === "") && !m.chars[spFrom].ctrl)
        spFrom++;
      for (let k = spFrom; k < textEnd; k++)
        if (m.chars[k].ch === " ")
          nSp++;
      if (nSp > 0 && align !== "DISTRIBUTE") {
        spaceAdd = (avail - nat.text + lastSp) / nSp;
        spaceFrom = spFrom;
        if (spaceAdd < 0)
          squeeze(spFrom);
      } else
        scale = avail > 0 ? avail / nat.text : 1;
    } else if (nat.text + nat.obj > 0 && (isLast || !stretch)) {
      const w = nat.text + nat.obj - lastSp;
      if (align === "CENTER")
        xoff = Math.max(0, (lineW - w) / 2);
      else if (align === "RIGHT")
        xoff = Math.max(0, lineW - w);
    }
    if (spaceAdd === 0 && charAdd === 0 && scale === 1 && nat.text - lastSp > avail) {
      let spFrom = fixedTo;
      while (spFrom < textEnd && (m.chars[spFrom].ch === " " || m.chars[spFrom].ch === "") && !m.chars[spFrom].ctrl)
        spFrom++;
      squeeze(spFrom);
    }
    if (!Number.isFinite(scale) || scale <= 0)
      scale = 1;
    scale = Math.min(4, Math.max(0.25, scale));
    plans.push({ seg, xoff: xoff + lead, scale, spaceAdd, spFrom: spaceFrom, ...charAdd ? { charAdd } : {}, start, end, tabs, fixedTo, textEnd, ...i === 0 && bu ? { bullet: { ch: bu.ch, w: bulletW, prId: bu.charPrId ?? firstPr } } : {} });
  }
  return plans;
}
function advanceTo(m, styles, plan, upto) {
  let x = 0;
  for (let i = plan.start; i < upto && i < m.chars.length; i++) {
    const c = m.chars[i], inStretch = i >= plan.spFrom && i < plan.textEnd;
    x += c.tab ? plan.tabs.get(i) ?? 0 : charW(c, styles, m.chars[i - 1]) * (i < plan.fixedTo ? 1 : plan.scale) + (inStretch && c.ch === " " ? plan.spaceAdd : 0) + (inStretch && plan.charAdd && c.ch && c.ch !== " " ? plan.charAdd : 0);
  }
  for (const o of m.objs)
    if (o.inline && o.index >= plan.start && o.index < upto)
      x += o.omL + o.width + o.omR;
  return x;
}
function drawPara(p, ox, oy, areaW, ctx, depth, segPages) {
  if (depth > 16) {
    warnOnce(ctx, "depth", "\uC911\uCCA9 \uAE4A\uC774 16 \uCD08\uACFC \u2014 \uC774\uD558 \uC0DD\uB7B5");
    return;
  }
  const m = buildPara(p);
  const numText = nextParaNumber(ctx.nums, m.paraPrId != null ? ctx.styles.paraGeom.get(m.paraPrId) : void 0);
  if (m.segs.length === 0) {
    if (m.chars.some((c) => c.ch !== "")) {
      warnOnce(ctx, "no-lineseg", "\uC870\uD310 \uCE90\uC2DC \uC5C6\uB294 \uBB38\uB2E8 \uD14D\uC2A4\uD2B8 \uC0DD\uB7B5 \u2014 reflow \uC635\uC158\uC73C\uB85C \uD569\uC131 \uAC00\uB2A5");
    }
    for (const o of m.objs) {
      const { x, y } = o.inline ? { x: ox, y: oy } : anchorObject(o, ox, oy, 0, areaW, ctx);
      drawObject(o, x, y, 0, areaW, ctx, depth);
    }
    return;
  }
  const plans = planLines(m, ctx.styles, numText);
  const baseV = m.segs[0].vertpos;
  const hasText = m.chars.some((c) => c.ch !== "" && c.ch.trim() !== "");
  let paraRegionId = null;
  let gOpenOn = -1;
  for (let li = 0; li < plans.length; li++) {
    const plan = plans[li];
    if (segPages && segPages[li] !== void 0)
      ctx.page = segPages[li];
    const { seg } = plan;
    if (hasText) {
      const lineBox = bboxOf(ctx, ox + seg.horzpos, oy + seg.vertpos, seg.horzsize, seg.textheight);
      if (paraRegionId === null)
        paraRegionId = ctx.regions.add("paragraph", lineBox, { parentId: parentId(ctx) });
      else
        ctx.regions.addFragment(paraRegionId, lineBox);
      if (gOpenOn !== ctx.page) {
        if (gOpenOn >= 0)
          ctx.pages[gOpenOn].push("</g>");
        emit(ctx, regionOpenTag(paraRegionId, "paragraph", pageNo(ctx)));
        gOpenOn = ctx.page;
      }
    }
    let i = plan.start;
    let cursor = ox + seg.horzpos + plan.xoff;
    const y = oy + seg.vertpos + seg.baseline;
    const pva = m.paraPrId != null ? ctx.styles.paraGeom.get(m.paraPrId)?.vertAlign : void 0;
    const glyphY = (h) => y + (pva === "CENTER" ? Math.round(h * 0.35) : pva === "BOTTOM" ? -Math.round(h * 0.15) : 0);
    if (plan.bullet) {
      const bs = (plan.bullet.prId != null ? ctx.styles.charPr.get(plan.bullet.prId) : void 0) ?? DEFAULT_CHAR;
      const attrs = [`x="${pt(cursor - plan.bullet.w)}"`, `y="${pt(glyphY(bs.height))}"`, `font-size="${pt(bs.height)}"`];
      if (bs.fontFamily)
        attrs.push(`font-family="${escapeXml(bs.fontFamily)}"`);
      if (bs.color)
        attrs.push(`fill="${escapeXml(bs.color)}"`);
      emit(ctx, `<text ${attrs.join(" ")}>${escapeXml(plan.bullet.ch)}</text>`);
      ctx.stats.texts++;
    }
    while (i < plan.end && i < m.chars.length) {
      if (i >= plan.textEnd && m.chars[i].ch === " ") {
        i++;
        continue;
      }
      if (m.chars[i].ch === "") {
        const ct = m.chars[i].ctrlText;
        if (ct) {
          const cs0 = (m.chars[i].prId != null ? ctx.styles.charPr.get(m.chars[i].prId) : void 0) ?? DEFAULT_CHAR;
          const sup = !!m.chars[i].ctrlSup, fh2 = sup ? Math.round(cs0.height * 16 / 25) : cs0.height;
          const cw = measureTextWidth(ct, sup ? Math.round(cs0.height * 3 / 4) : fh2, cs0.ratio, { spacingPct: cs0.spacing, faceClass: faceClassOf(cs0.face) });
          const attrs = [`x="${pt(cursor)}"`, `y="${pt(glyphY(cs0.height) - (sup ? Math.round(cs0.height * 0.35) : 0))}"`, `font-size="${pt(fh2)}"`];
          if (cs0.fontFamily)
            attrs.push(`font-family="${escapeXml(cs0.fontFamily)}"`);
          if (cs0.color)
            attrs.push(`fill="${escapeXml(cs0.color)}"`);
          emit(ctx, `<text ${attrs.join(" ")}>${escapeXml(ct)}</text>`);
          ctx.stats.texts++;
          cursor += cw * plan.scale;
        }
        if (m.chars[i].tab)
          cursor += plan.tabs.get(i) ?? 0;
        for (const o of m.objs)
          if (o.inline && o.index === i)
            cursor += o.omL + o.width + o.omR;
        i++;
        continue;
      }
      const scale = i < plan.fixedTo ? 1 : plan.scale;
      const prId = m.chars[i].prId;
      let j = i;
      let piece = "";
      while (j < plan.end && j < m.chars.length && m.chars[j].prId === prId && m.chars[j].ch !== "" && !(j >= plan.textEnd && m.chars[j].ch === " ")) {
        piece += m.chars[j].ch;
        j++;
      }
      {
        const cut = piece.search(/ {2,}/);
        if (cut > 0) {
          piece = piece.slice(0, cut);
          j = i + cut;
        } else if (cut === 0) {
          const runEnd = piece.match(/^ +/)[0].length;
          piece = piece.slice(0, runEnd);
          j = i + runEnd;
        }
      }
      const st = (prId != null ? ctx.styles.charPr.get(prId) : void 0) ?? DEFAULT_CHAR;
      const fh = st.script ? Math.round(st.height * 16 / 25) : st.height;
      const raise = st.script === "sup" ? Math.round(st.height * 0.44) : 0;
      const measure = (text) => {
        let w = 0, last = 0;
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          if (!joinsJamo(last, cp))
            w += glyphWidth(ch, st).w;
          last = cp;
        }
        return w;
      };
      const skipLead = Math.max(0, plan.spFrom - i);
      const spacesIn = (text) => {
        let n = 0, k = 0;
        for (const c of text) {
          if (c === " " && !(k < skipLead && text === piece))
            n++;
          k++;
        }
        return n;
      };
      const renderSeg = (text, cx, hit) => {
        const sw = measure(text) * scale + (plan.spaceAdd && i >= plan.fixedTo ? plan.spaceAdd * spacesIn(text) : 0) + (plan.charAdd && i >= plan.fixedTo ? plan.charAdd * [...text].filter((ch) => ch !== " ").length : 0);
        if (st.shade)
          emit(ctx, `<rect x="${pt(cx)}" y="${pt(glyphY(st.height) - Math.round(st.height * 0.85))}" width="${pt(sw)}" height="${pt(st.height)}" fill="${escapeXml(st.shade)}"/>`);
        if (hit) {
          emit(ctx, `<rect x="${pt(cx)}" y="${pt(oy + seg.vertpos)}" width="${pt(sw)}" height="${pt(seg.textheight)}" fill="#ffd54f" fill-opacity="0.45"/>`);
        }
        if (text.trim().length > 0) {
          const attrs = [`x="${pt(cx)}"`, `y="${pt(glyphY(st.height) - raise)}"`, `font-size="${pt(fh)}"`];
          if (st.fontFamily)
            attrs.push(`font-family="${escapeXml(st.fontFamily)}"`);
          if ([...text].length > 1 && sw > 50) {
            attrs.push(`textLength="${pt(sw)}"`, `lengthAdjust="${scale < 1 ? "spacingAndGlyphs" : "spacing"}"`);
          }
          if (st.bold)
            attrs.push(`font-weight="bold"`);
          if (st.italic)
            attrs.push(`font-style="italic"`);
          if (st.underline)
            attrs.push(`text-decoration="underline"`);
          if (st.color)
            attrs.push(`fill="${escapeXml(st.color)}"`);
          emit(ctx, `<text ${attrs.join(" ")}>${escapeXml(mapPuaText(text))}</text>`);
          ctx.stats.texts++;
        }
        return sw;
      };
      const merged = [];
      if (ctx.highlights.length > 0 && piece.trim().length > 0) {
        const found = [];
        const lower = piece.toLowerCase();
        for (const term of ctx.highlights) {
          for (let f = lower.indexOf(term); f !== -1; f = lower.indexOf(term, f + term.length)) {
            found.push([f, f + term.length]);
          }
        }
        found.sort((a, b) => a[0] - b[0]);
        for (const [s, e] of found) {
          const tail = merged[merged.length - 1];
          if (tail && s <= tail[1])
            tail[1] = Math.max(tail[1], e);
          else
            merged.push([s, e]);
        }
      }
      if (merged.length === 0) {
        cursor += renderSeg(piece, cursor, false);
      } else {
        let segCur = cursor;
        let last = 0;
        for (const [s, e] of merged) {
          segCur += renderSeg(piece.slice(last, s), segCur, false);
          segCur += renderSeg(piece.slice(s, e), segCur, true);
          last = e;
        }
        segCur += renderSeg(piece.slice(last), segCur, false);
        cursor = segCur;
      }
      i = j;
    }
  }
  if (gOpenOn >= 0)
    ctx.pages[gOpenOn].push("</g>");
  if (paraRegionId)
    ctx.parentStack.push(paraRegionId);
  let tbStack;
  let tbStackTop;
  for (const o of m.objs) {
    if (o.inline) {
      let planIdx = 0;
      for (let k = 0; k < plans.length; k++) {
        const pl = plans[k];
        if (pl.start <= o.index && (o.index < pl.end || k === plans.length - 1))
          planIdx = k;
      }
      const plan = plans[planIdx];
      if (segPages && segPages[planIdx] !== void 0)
        ctx.page = segPages[planIdx];
      const x = ox + plan.seg.horzpos + plan.xoff + advanceTo(m, ctx.styles, plan, o.index) + o.omL;
      const shadowed = o.tag === "pic" && !!findChildByLocalName(findChildByLocalName(o.el, "effects") ?? o.el, "shadow") && plan.seg.textheight > o.height && Math.abs(plan.seg.baseline - Math.round(plan.seg.textheight * 0.85)) <= 2;
      const eqAsc = o.tag === "equation" && Number(o.el.getAttribute("baseLine")) > 0 ? Math.round(o.height * Number(o.el.getAttribute("baseLine")) / 100) : shadowed ? Math.round(plan.seg.textheight * 0.85) : o.tag === "pic" ? Math.round(o.height * 0.85) : o.height;
      const iom = findChildByLocalName(o.el, "outMargin"), iomT = num(iom, "top"), iomB = num(iom, "bottom");
      const yTop = oy + plan.seg.vertpos + Math.max(iomT, plan.seg.baseline - eqAsc - iomB - captionExtra(o.el));
      drawObject(o, x, yTop, baseV, areaW, ctx, depth);
    } else {
      if (segPages && segPages[0] !== void 0)
        ctx.page = segPages[0];
      let ax = ox, aw = areaW;
      if (depth === 0 && ctx.cols && plans[0]) {
        const col = Math.floor((plans[0].seg.horzpos + 1) / (ctx.cols.w + ctx.cols.gap));
        ax = ox + col * (ctx.cols.w + ctx.cols.gap);
        aw = ctx.cols.w;
      }
      let anchorLineV;
      let anchorLineH = 0;
      let anchorSeg;
      let anchorK = -1;
      plans.forEach((pl, k) => {
        if (pl.start <= o.index) {
          anchorLineV = pl.seg.vertpos;
          anchorLineH = pl.seg.textheight;
          anchorSeg = pl.seg;
          anchorK = k;
        }
      });
      let objBaseV = baseV;
      const pTop = depth === 0 ? ctx.paraTops?.get(p) : void 0;
      const wrapA = o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM";
      const top0 = pTop ?? (depth > 0 && wrapA !== "TOP_AND_BOTTOM" ? cellParaTop(p, ctx.styles.paraGeom) : void 0);
      if (top0 !== void 0 && wrapA !== "TOP_AND_BOTTOM") {
        const start = top0 + (m.paraPrId != null ? ctx.styles.paraGeom.get(m.paraPrId)?.spaceBefore ?? 0 : 0);
        if (baseV > start + 100) {
          objBaseV = start;
          if (anchorLineV === baseV)
            anchorLineV = start;
        } else if (depth > 0 && start > top0 && Math.abs(baseV - start) <= 100) {
          objBaseV = top0;
          if (anchorLineV === baseV)
            anchorLineV = top0;
        }
      }
      const tbFloats = m.objs.filter((q) => !q.inline && (q.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM") === "TOP_AND_BOTTOM" && (findChildByLocalName(q.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA").length;
      let stay = tbFloats < 2 && !m.objs.some((q) => q.inline) && !m.chars.some((c) => c.ch !== "" && !c.nb && c.ch.trim() !== "");
      const sbA = m.paraPrId != null ? ctx.styles.paraGeom.get(m.paraPrId)?.spaceBefore ?? 0 : 0;
      if (stay && wrapA === "TOP_AND_BOTTOM" && linePushedBy(o, anchorLineV ?? baseV, pTop ?? (depth > 0 ? cellParaTop(p, ctx.styles.paraGeom) : void 0)))
        stay = false;
      let carried;
      if (segPages && anchorK > 0 && segPages[anchorK] !== segPages[0] && segPages[anchorK - 1] === segPages[0] && wrapA === "TOP_AND_BOTTOM" && (findChildByLocalName(o.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA") {
        const s0 = plans[anchorK - 1].seg;
        carried = s0.vertpos + s0.textheight + (s0.spacing ?? 0);
      }
      const firstLine = anchorLineV === void 0 || anchorLineV === baseV;
      let { x, y } = anchorObject(
        o,
        ax,
        oy,
        objBaseV,
        aw,
        ctx,
        anchorLineV,
        stay ? sbA : false,
        (firstLine || wrapA === "SQUARE") && pTop !== void 0 && pTop < baseV ? pTop : void 0,
        anchorLineH,
        firstLine ? sbA : 0,
        // 문단 중간 글자 앵커인데 첫 줄부터 앵커 줄만큼 좁게 저장됐으면 개체는 문단 위에 있다(같은 판 한컴 PDF: 둘째 줄 앵커 사진, 네 줄 모두 34602)
        m.chars.slice(o.index).some((c) => c.ch.trim() !== "") && !!anchorSeg && plans.length > 0 && plans[0].seg !== anchorSeg && Math.abs(plans[0].seg.horzsize - anchorSeg.horzsize) <= 100 && anchorSeg.horzpos + anchorSeg.horzsize < aw - 1e3 ? "top" : m.chars.slice(o.index).some((c) => c.ch.trim() !== "") ? "mid" : "end"
      );
      if (carried !== void 0) {
        const posC = findChildByLocalName(o.el, "pos"), rawC = num(posC, "vertOffset");
        y = oy + carried + num(findChildByLocalName(o.el, "outMargin"), "top") + Math.max(0, rawC >= 2 ** 31 ? rawC - 2 ** 32 : rawC);
      }
      let stackTop = depth === 0 ? pTop ?? 0 : cellParaTop(p, ctx.styles.paraGeom);
      if (tbFloats >= 2 && wrapA === "TOP_AND_BOTTOM" && stackTop !== void 0) {
        if (!tbStack) {
          tbStack = /* @__PURE__ */ new Map();
          const placed = [];
          const stackable = m.objs.filter((q) => !q.inline && (q.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM") === "TOP_AND_BOTTOM" && (findChildByLocalName(q.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA" && findChildByLocalName(q.el, "pos")?.getAttribute("allowOverlap") !== "1");
          for (const q of stackable.length >= 2 ? stackable.sort((a, b) => a.index - b.index) : []) {
            const posQ = findChildByLocalName(q.el, "pos"), omQ = findChildByLocalName(q.el, "outMargin"), raw = num(posQ, "vertOffset");
            const x0 = num(posQ, "horzOffset"), x1 = x0 + num(omQ, "left") + q.width + num(omQ, "right");
            const below = Math.max(0, ...placed.filter((r) => r.x0 < x1 && x0 < r.x1).map((r) => r.bottom));
            const top = Math.max(below, depth > 0 ? Math.max(0, raw) : raw);
            tbStack.set(q.el, top + num(omQ, "top"));
            placed.push({ x0, x1, bottom: top + num(omQ, "top") + (q.tag === "tbl" ? Math.max(q.height, measureTableHeight(q.el, ctx.extentMemo)) : q.height) + num(omQ, "bottom") });
          }
          if (depth > 0 && placed.length)
            tbStackTop = Math.max(stackTop, baseV - Math.max(...placed.map((r) => r.bottom)));
        }
        if (depth > 0 && tbStackTop !== void 0)
          stackTop = tbStackTop;
        const st = tbStack.get(o.el);
        if (st !== void 0)
          y = oy + stackTop + st;
      }
      const moved = ctx.objPlace?.get(o.el);
      if (moved) {
        const pg = ctx.page;
        ctx.page = moved.page;
        drawObject(o, x, moved.y, baseV, areaW, ctx, depth);
        ctx.page = pg;
      } else
        drawObject(o, x, y, baseV, areaW, ctx, depth);
    }
  }
  if (paraRegionId)
    ctx.parentStack.pop();
}
function cellParaTop(p, geom) {
  let prev = p.previousSibling;
  while (prev && ln(prev) !== "p")
    prev = prev.previousSibling;
  if (!prev)
    return 0;
  const lsa = findChildByLocalName(prev, "linesegarray");
  const segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
  if (!segs.length)
    return void 0;
  const last = segs[segs.length - 1];
  return num(last, "vertpos") + num(last, "vertsize") + num(last, "spacing") + (geom.get(prev.getAttribute("paraPrIDRef") ?? "")?.spaceAfter ?? 0);
}
function drawObject(o, x, y, baseV, areaW, ctx, depth) {
  if (!o.inline && depth === 0 && ctx.paintJobs) {
    const wrap = o.el.getAttribute("textWrap");
    const layer = wrap === "BEHIND_TEXT" ? -1 : wrap === "IN_FRONT_OF_TEXT" ? 1 : 0;
    const page = ctx.page, parents = [...ctx.parentStack];
    ctx.paintJobs.push({ page, layer, z: num(o.el, "zOrder"), body: !!ctx.bodyDx, draw: () => {
      ctx.page = page;
      const saved = ctx.parentStack;
      ctx.parentStack = parents;
      drawObject(o, x, y, baseV, areaW, ctx, depth);
      ctx.parentStack = saved;
    } });
    return;
  }
  const cap = o.tag === "tbl" || o.tag === "pic" ? captionOf(o.el) : null;
  if (cap) {
    const objH = o.tag === "tbl" ? Math.max(o.height, measureTableHeight(o.el, ctx.extentMemo)) : o.height;
    let ox = x, oy = y, cx = x, cy = y;
    if (cap.side === "TOP")
      oy = y + cap.h + cap.gap;
    else if (cap.side === "LEFT")
      ox = x + cap.width + cap.gap;
    else if (cap.side === "RIGHT")
      cx = x + o.width + cap.gap;
    else
      cy = y + objH + cap.gap;
    for (const cp of elements(cap.sub))
      if (ln(cp) === "p")
        drawPara(cp, cx, cy, cap.width, ctx, depth + 1);
    x = ox;
    y = oy;
  }
  if (o.tag === "tbl")
    ctx.draw.table(o.el, x, y, ctx, depth + 1);
  else if (o.tag === "pic")
    ctx.draw.pic(o.el, x, y, ctx);
  else if (o.tag === "container") {
    if (drawGroupByMatrix(o, x, y, baseV, areaW, ctx, depth))
      return;
    for (const ch of elements(o.el)) {
      const tag = ln(ch);
      if (!OBJ_TAGS.has(tag))
        continue;
      const sz = findChildByLocalName(ch, "sz");
      const off = findChildByLocalName(ch, "offset");
      const sub = { el: ch, tag, index: 0, inline: true, width: num(sz, "width"), height: num(sz, "height"), omL: 0, omR: 0 };
      drawObject(sub, x + num(off, "x"), y + num(off, "y"), baseV, areaW, ctx, depth + 1);
    }
  } else if (o.tag === "equation") {
    const script = findChildByLocalName(o.el, "script")?.textContent ?? "";
    const text = script ? latexToPlain(hwpEquationToLatex(script)) : "";
    if (text && o.width > 0) {
      const bl = Number(o.el.getAttribute("baseLine")), size = num(o.el, "baseUnit", 1e3);
      const by = y + Math.round(o.height * (Number.isFinite(bl) && bl > 0 ? bl / 100 : 0.85));
      const color = o.el.getAttribute("textColor");
      const attrs = [`x="${pt(x)}"`, `y="${pt(by)}"`, `font-size="${pt(size)}"`, `font-family="'Times New Roman','HCR Batang','Noto Serif KR',serif"`];
      if ([...text].length > 1)
        attrs.push(`textLength="${pt(o.width)}"`, `lengthAdjust="spacingAndGlyphs"`);
      if (color && color !== "#000000")
        attrs.push(`fill="${escapeXml(color)}"`);
      emit(ctx, `<text ${attrs.join(" ")}>${escapeXml(text)}</text>`);
      ctx.stats.texts++;
    }
  } else if (SHAPE_TAGS.has(o.tag)) {
    drawShape(o, x, y, ctx, depth);
  } else if (!FORM_TAGS.has(o.tag)) {
    warnOnce(ctx, `shape:${o.tag}`, `\uAC1C\uCCB4(${o.tag}) \uB80C\uB354 \uBBF8\uC9C0\uC6D0 \u2014 \uC0DD\uB7B5`);
  }
}
function drawGroupByMatrix(o, x, y, baseV, areaW, ctx, depth) {
  const top = renderingMatrix(o.el);
  const leaves = [];
  const collect = (el) => {
    for (const ch of elements(el)) {
      const tag = ln(ch);
      if (!OBJ_TAGS.has(tag))
        continue;
      if (tag === "container") {
        if (!collect(ch))
          return false;
      } else if (renderingMatrix(ch))
        leaves.push(ch);
      else
        return false;
    }
    return true;
  };
  if (!top || !collect(o.el))
    return false;
  const org = findChildByLocalName(o.el, "orgSz");
  const box = rotatedBounds({ x: 0, y: 0, w: num(org, "width"), h: num(org, "height") }, [top]);
  const base = [1, 0, 0, 1, x - box.x, y - box.y];
  for (const leaf of leaves) {
    const m = mulAffine(base, renderingMatrix(leaf));
    const tag = ln(leaf), lorg = findChildByLocalName(leaf, "orgSz");
    const w = num(lorg, "width") || num(findChildByLocalName(leaf, "curSz"), "width");
    const h = num(lorg, "height") || num(findChildByLocalName(leaf, "curSz"), "height");
    ctx.regionRotations.push(m);
    emit(ctx, `<g transform="matrix(${m.slice(0, 4).map((v) => Math.round(v * 1e6) / 1e6).join(" ")} ${pt(m[4])} ${pt(m[5])})">`);
    const sub = { el: leaf, tag, index: 0, inline: true, width: w, height: h, omL: 0, omR: 0 };
    if (tag === "pic")
      ctx.draw.picFrame(leaf, 0, 0, w, h, "", ctx);
    else if (SHAPE_TAGS.has(tag))
      drawShape(sub, 0, 0, ctx, depth + 1, [Math.hypot(m[0], m[1]) || 1, Math.hypot(m[2], m[3]) || 1]);
    else
      drawObject(sub, 0, 0, baseV, areaW, ctx, depth + 1);
    emit(ctx, "</g>");
    ctx.regionRotations.pop();
  }
  return true;
}
function drawShape(o, x, y, ctx, depth, groupScale) {
  const geometry = shapeGeometry(o, x, y, ctx.defs, ctx.images, (key, msg) => warnOnce(ctx, key, msg), !!groupScale);
  const b = geometry;
  if (geometry.rotation)
    ctx.regionRotations.push(geometry.rotation);
  ctx.stats.shapes++;
  const shapeId = ctx.regions.add("shape", bboxOf(ctx, b.x, b.y, b.w, b.h), { parentId: parentId(ctx) });
  emit(ctx, regionOpenTag(shapeId, "shape", pageNo(ctx)));
  ctx.parentStack.push(shapeId);
  if (geometry.transform)
    emit(ctx, `<g transform="${geometry.transform}">`);
  emit(ctx, geometry.svg);
  const dt = findChildByLocalName(o.el, "drawText");
  const sub = dt ? findChildByLocalName(dt, "subList") : null;
  if (sub) {
    const [sx, sy] = groupScale ?? [1, 1];
    const unscale = sx !== 1 || sy !== 1;
    if (unscale) {
      emit(ctx, `<g transform="scale(${1 / sx} ${1 / sy})">`);
      ctx.regionRotations.push([1 / sx, 0, 0, 1 / sy, 0, 0]);
    }
    const tm = dt ? findChildByLocalName(dt, "textMargin") : null;
    const mL = num(tm, "left"), mR = num(tm, "right"), mT = num(tm, "top"), mB = num(tm, "bottom");
    const va = sub.getAttribute("vertAlign") ?? "TOP";
    let yoff = 0;
    const floats = elements(sub).some((q) => ln(q) === "p" && buildPara(q).objs.some((ob) => !ob.inline));
    if (!floats && (va === "CENTER" || va === "BOTTOM")) {
      const extent = cellContentExtent({ el: dt, ca: 0, ra: 0, cs: 1, rs: 1, w: 0, h: 0, bfId: null, sub, marginL: 0, marginR: 0, marginT: 0, marginB: 0 }, ctx.extentMemo);
      const free = geometry.h * sy - mT - mB - extent;
      yoff = Math.max(0, va === "CENTER" ? free / 2 : free);
    }
    for (const p of elements(sub))
      if (ln(p) === "p")
        drawPara(p, geometry.x * sx + mL, geometry.y * sy + mT + yoff, geometry.w * sx - mL - mR, ctx, depth + 1);
    if (unscale) {
      ctx.regionRotations.pop();
      emit(ctx, "</g>");
    }
  }
  if (geometry.rotation)
    ctx.regionRotations.pop();
  if (geometry.transform)
    emit(ctx, "</g>");
  ctx.parentStack.pop();
  emit(ctx, "</g>");
}
export {
  bboxOf,
  cellParaTop,
  drawPara,
  emit,
  escapeXml,
  pageNo,
  parentId,
  pt,
  ptNum,
  regionOpenTag,
  warnOnce
};
