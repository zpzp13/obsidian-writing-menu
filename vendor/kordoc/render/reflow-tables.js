// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/reflow-tables.ts. MIT; see LICENSE.
import { buildPara, collectCells, measureTableHeight, measureTableRowHeights, captionExtra, captionOf, cellContentExtent, cellMarginOf, OBJ_TAGS, elements, ln, num } from "./para-model.js";
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { solveRowHeights } from "./layout.js";
function squareTableOver(p, startV, lim, withText = false, areaW = 0) {
  const m = buildPara(p);
  if (!withText && m.chars.some((c) => c.ch !== ""))
    return false;
  return m.objs.some((o) => {
    if (o.inline || o.tag !== "tbl" || o.el.getAttribute("textWrap") !== "SQUARE")
      return false;
    const pb = o.el.getAttribute("pageBreak");
    if (pb !== "CELL" && pb !== "TABLE")
      return false;
    const pos = findChildByLocalName(o.el, "pos"), om = findChildByLocalName(o.el, "outMargin");
    if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
      return false;
    const vo = num(pos, "vertOffset"), voS = Math.max(0, vo >= 2 ** 31 ? vo - 2 ** 32 : vo);
    if (withText && Math.max(0, num(pos, "horzOffset")) + num(om, "left") + o.width + num(om, "right") < areaW - 1440)
      return false;
    return startV + voS + num(om, "top") + (withText ? measureTableHeight(o.el) : Math.max(o.height, measureTableHeight(o.el))) + num(om, "bottom") > lim;
  });
}
function bulletEmptyHost(p, g) {
  if (!g?.bullet)
    return false;
  const m = buildPara(p);
  return m.objs.length > 0 && !m.chars.some((c) => c.ch !== "" && c.ch.trim() !== "") && m.objs.every((o) => !o.inline && o.tag === "tbl" && o.el.getAttribute("textWrap") === "TOP_AND_BOTTOM");
}
function hasTbFloat(p) {
  return buildPara(p).objs.some((o) => !o.inline && o.el.getAttribute("textWrap") === "TOP_AND_BOTTOM" && (findChildByLocalName(o.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA");
}
function m0Objs(p) {
  return buildPara(p).objs.find((o) => !o.inline && o.tag === "tbl")?.el;
}
function contentTableHeight(tbl) {
  const cells = collectCells(tbl);
  if (!cells.length)
    return 0;
  const n = Math.max(...cells.map((c) => c.ra + c.rs));
  return solveRowHeights(cells.map((c) => ({ rowAddr: c.ra, rowSpan: c.rs, height: c.rs === 1 ? cellContentExtent(c) + c.marginT + c.marginB : 0, contentH: c.rs === 1 ? void 0 : cellContentExtent(c) + c.marginT + c.marginB })), n).reduce((a, b) => a + b, 0);
}
function bandTableOver(p, top, lim) {
  const m = buildPara(p);
  if (!m.chars.some((c) => c.ch !== "" && c.ch.trim() !== ""))
    return false;
  return m.objs.some((o) => {
    if (o.inline || o.tag !== "tbl" || o.el.getAttribute("textWrap") !== "TOP_AND_BOTTOM")
      return false;
    const pb = o.el.getAttribute("pageBreak");
    if (pb !== "CELL" && pb !== "TABLE")
      return false;
    const pos = findChildByLocalName(o.el, "pos"), om = findChildByLocalName(o.el, "outMargin");
    if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
      return false;
    const vo = num(pos, "vertOffset");
    if (vo <= 0 || vo >= 2 ** 31)
      return false;
    return top + vo + num(om, "top") + contentTableHeight(o.el) + num(om, "bottom") > lim;
  });
}
function splitFloatTableRemainder(p, startV, lim, bodyH, styles, withText = false, notes) {
  const m = buildPara(p);
  if (!withText && m.chars.some((c) => c.ch !== ""))
    return void 0;
  let best, whole = true;
  for (const o of m.objs) {
    if (o.inline || o.tag !== "tbl" || !(o.el.getAttribute("textWrap") === "TOP_AND_BOTTOM" || o.el.getAttribute("textWrap") === "SQUARE"))
      continue;
    const pos = findChildByLocalName(o.el, "pos");
    if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
      continue;
    const b = splitTableRows(o.el, startV + Math.max(0, num(pos, "vertOffset")), lim, bodyH, styles, notes);
    if (b !== void 0) {
      best = Math.max(best ?? 0, b);
      whole && (whole = splitWhole);
    }
  }
  splitWhole = best !== void 0 && whole;
  return best;
}
let splitWhole = false;
let splitNotesLast = { n: 0, s: 0 };
let splitMovedLast = false;
function noteBottom(fn) {
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
function splitTableRows(tbl, top, lim, bodyH, styles, notes) {
  splitWhole = false;
  splitNotesLast = { n: 0, s: 0 };
  const mode = tbl.getAttribute("pageBreak");
  if (mode !== "TABLE" && mode !== "CELL")
    return void 0;
  const om = findChildByLocalName(tbl, "outMargin");
  const outB = num(om, "bottom");
  const rows = measureTableRowHeights(tbl);
  if (rows.length === 0)
    return void 0;
  const outT = num(om, "top");
  const cap = captionOf(tbl);
  const capTop = cap?.side === "TOP" ? cap.h + cap.gap : 0, capBottom = cap?.side === "BOTTOM" ? cap.h + cap.gap : 0;
  let headH = 0;
  if (tbl.getAttribute("repeatHeader") === "1") {
    const heads = /* @__PURE__ */ new Set();
    for (const c of collectCells(tbl))
      if (c.el.getAttribute("header") === "1")
        for (let r = c.ra; r < c.ra + c.rs; r++)
          heads.add(r);
    for (let r = 0; heads.has(r) && r < rows.length; r++)
      headH += rows[r];
  }
  let y = top + outT + capTop, floor = lim, moved = false;
  const rowNoteLines = rows.map(() => []);
  let allN = 0, allS = 0;
  if (notes)
    for (const c of collectCells(tbl))
      for (const fn of Array.from(c.el.getElementsByTagName("hp:footNote"))) {
        rowNoteLines[Math.min(c.ra, rows.length - 1)].push(Array.from(fn.getElementsByTagName("hp:lineseg")).map((sg) => num(sg, "vertpos") + num(sg, "vertsize")));
        allN++;
        allS += noteBottom(fn);
      }
  let nN = 0, nS = 0, placed = 0;
  const fl = () => notes && nN > 0 ? Math.min(floor, bodyH - notes.area((moved ? 0 : notes.n0) + nN, (moved ? 0 : notes.s0) + nS)) : floor;
  const sp = num(tbl, "cellSpacing");
  const cells = mode === "CELL" ? collectCells(tbl) : [];
  const tableCells = mode === "TABLE" ? collectCells(tbl) : [];
  const record = mode === "CELL" ? /* @__PURE__ */ new Map() : void 0;
  const carries = /* @__PURE__ */ new Map();
  for (let r = 0; r < rows.length; r++) {
    let h = rows[r];
    for (const ls of rowNoteLines[r])
      if (nN === 0 && ls.length) {
        nN = 1;
        nS = ls[Math.min(1, ls.length - 1)];
      }
    if (mode === "CELL") {
      const from = /* @__PURE__ */ new Map(), bases = /* @__PURE__ */ new Map();
      while (y + h + outB > fl() && bodyH - outT - outB > 0) {
        const fixedRows = tbl.getAttribute("noAdjust") === "1";
        const rem = cellRowRemainder(cells, r, fl() - outB - y - (moved ? 100 : 20) - 2 * sp, from, record, bases, carries, styles, bodyH - outT - outB, fl() - outB - y - (fixedRows ? 2 : 101) - 2 * sp, fixedRows);
        if (rem === 0 && r === rows.length - 1)
          break;
        if (rem === void 0 || rem + sp + (r === rows.length - 1 ? sp : 0) >= h) {
          if (moved && y === outT + headH)
            break;
          if (!moved && r === 0)
            splitWhole = true;
        } else
          h = rem + sp + (r === rows.length - 1 ? sp : 0);
        y = outT + headH;
        floor = bodyH;
        moved = true;
        placed += nS;
        nN = 0;
        nS = 0;
      }
      y += h;
      continue;
    }
    let need = h;
    if (!tableCells.some((c) => c.ra < r && c.ra + c.rs > r)) {
      let end = r + 1;
      for (let grown = true; grown; ) {
        grown = false;
        for (const c of tableCells)
          if (c.ra >= r && c.ra < end && c.ra + c.rs > end) {
            end = c.ra + c.rs;
            grown = true;
          }
      }
      const groupH = rows.slice(r, end).reduce((a, b) => a + b, 0);
      if (end > r + 1 && groupH <= bodyH - outT - outB - headH)
        need = groupH;
    }
    if (y + need + outB > fl() && !(moved && y === outT + headH)) {
      if (!moved && r === 0)
        splitWhole = true;
      y = outT + headH;
      floor = bodyH;
      moved = true;
      placed += nS;
      nN = 0;
      nS = 0;
    }
    y += h;
  }
  if (record)
    rebaseSplitCells(record, carries, styles);
  if (moved)
    splitNotesLast = { n: allN, s: Math.max(0, allS - placed) };
  splitMovedLast = moved;
  return y + capBottom + outB;
}
function cellRowRemainder(cells, row, avail, from, record, bases, carries, styles, contH = 0, piece = Infinity, fixedRows = false) {
  let rem = 0, any = false, placed = false;
  const cuts = [];
  for (const c of cells) {
    if (c.ra !== row || c.rs !== 1 || !c.sub)
      continue;
    const off = from.get(c.el) ?? 0, base = bases?.get(c.el) ?? 0;
    const limAbs = base + avail - c.marginB - c.marginT;
    let carry = 0, carryFrom = Infinity;
    let splitAt;
    for (let guard = 0; guard < 16; guard++) {
      const f = subFloatBottoms(c.sub).find((f2) => f2.v0 >= off && f2.lineBottom <= limAbs && f2.bottom > limAbs && f2.v0 < carryFrom);
      if (!f)
        break;
      if (f.rows?.length) {
        let y = f.bottom - f.carry + f.outT, k2 = 0;
        while (k2 < f.rows.length && y + f.rows[k2] <= limAbs)
          y += f.rows[k2++];
        if (k2 === f.rows.length)
          break;
        if ((k2 > 0 || f.el?.getAttribute("pageBreak") === "CELL") && contH > 0 && f.el) {
          const nested = splitTableRows(f.el, f.bottom - f.carry - base, avail - c.marginB - c.marginT, contH - c.marginT - c.marginB, styles);
          const rem2 = nested ?? (k2 > 0 ? f.outT + f.rows.slice(k2).reduce((a, b) => a + b, 0) + f.outB : void 0);
          if (rem2 !== void 0) {
            splitAt = { bottom: f.bottom, rem: rem2 };
            carryFrom = f.v0;
            break;
          }
        }
      }
      const delta = f.bottom - f.hostEnd;
      if (delta > 0) {
        for (const p of elements(c.sub))
          if (ln(p) === "p") {
            const lsa = findChildByLocalName(p, "linesegarray");
            for (const sg of lsa ? elements(lsa) : [])
              if (ln(sg) === "lineseg" && num(sg, "vertpos") >= f.bottom)
                sg.setAttribute("vertpos", String(num(sg, "vertpos") - delta));
          }
      }
      carry = Math.max(carry, f.carry);
      carryFrom = f.v0;
    }
    const segs = [];
    for (const p of elements(c.sub))
      if (ln(p) === "p") {
        const lsa = findChildByLocalName(p, "linesegarray");
        for (const sg of lsa ? elements(lsa) : [])
          if (ln(sg) === "lineseg" && num(sg, "vertpos") >= off)
            segs.push(sg);
      }
    if (segs.length === 0)
      continue;
    any = true;
    const lines = segs.map((sg) => [num(sg, "vertpos") - base, num(sg, "vertpos") + num(sg, "vertsize") - base]);
    const end = Math.max(...lines.map((l) => l[1]));
    const k = lines.findIndex((l) => c.marginT + l[1] > avail - c.marginB);
    if (k < 0) {
      placed = true;
      if (carry > 0)
        rem = Math.max(rem, c.marginT + carry + c.marginB);
      cuts.push([c.el, base + end + 1, base]);
      continue;
    }
    if (k > 0)
      placed = true;
    let nb = k > 0 ? num(segs[k - 1], "vertpos") + num(segs[k - 1], "vertsize") + num(segs[k - 1], "spacing") + spaceAfterAt(segs[k - 1], styles) : base;
    const cutV = num(segs[k], "vertpos");
    for (const f of subFloatBottoms(c.sub))
      if (f.v0 >= off && f.v0 < cutV && f.bottom <= cutV)
        nb = Math.max(nb, f.bottom);
    if (splitAt && cutV >= splitAt.bottom) {
      nb = Math.max(nb, splitAt.bottom);
      carry = splitAt.rem - (cutV - splitAt.bottom);
    }
    if (carry > 0 && cutV > carryFrom) {
      nb -= carry;
      const m = carries?.get(c.sub) ?? /* @__PURE__ */ new Map();
      m.set(cutV, carry);
      carries?.set(c.sub, m);
    }
    cuts.push([c.el, base + lines[k][0], nb]);
    rem = Math.max(rem, end + base - nb + c.marginT + c.marginB);
    if (off === 0 && (fixedRows || /^(CENTER|BOTTOM)$/.test(c.sub.getAttribute("vertAlign") ?? "")))
      rem = Math.max(rem, c.h - piece);
  }
  if (!(any && placed))
    return void 0;
  for (const [el, v, nb] of cuts) {
    from.set(el, v);
    bases?.set(el, nb);
  }
  if (record)
    for (const c of cells) {
      if (c.ra !== row || c.rs !== 1 || !c.sub)
        continue;
      const v = from.get(c.el);
      if (v === void 0)
        continue;
      const list = record.get(c.sub) ?? [];
      let last = 0;
      for (const p of elements(c.sub))
        if (ln(p) === "p") {
          const lsa = findChildByLocalName(p, "linesegarray");
          for (const sg of lsa ? elements(lsa) : [])
            if (ln(sg) === "lineseg")
              last = Math.max(last, num(sg, "vertpos") + num(sg, "vertsize"));
        }
      if (v <= last && !list.includes(v)) {
        list.push(v);
        record.set(c.sub, list);
      }
    }
  return rem;
}
function spacesHost(p) {
  const m = buildPara(p);
  return m.chars.some((c) => c.ch === " ") && m.chars.every((c) => c.ch === "" || c.ch === " ") && !m.objs.some((o) => o.inline);
}
function subFloatBottoms(sub) {
  const out = [];
  for (const p of elements(sub)) {
    if (ln(p) !== "p")
      continue;
    const lsa = findChildByLocalName(p, "linesegarray"), segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [], seg = segs[0];
    if (!seg)
      continue;
    const last = segs[segs.length - 1], hostEnd = num(last, "vertpos") + num(last, "vertsize") + num(last, "spacing");
    for (const run of elements(p)) {
      if (ln(run) !== "run")
        continue;
      for (const o of elements(run)) {
        if (!OBJ_TAGS.has(ln(o)) || o.getAttribute("textWrap") !== "TOP_AND_BOTTOM")
          continue;
        const pos = findChildByLocalName(o, "pos");
        if (pos?.getAttribute("treatAsChar") === "1" || (pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
          continue;
        const om = findChildByLocalName(o, "outMargin"), sz = findChildByLocalName(o, "sz");
        const h = (ln(o) === "tbl" ? Math.max(num(sz, "height"), measureTableHeight(o)) : num(sz, "height")) + captionExtra(o);
        const vo = num(pos, "vertOffset"), v0 = num(seg, "vertpos"), carry = num(om, "top") + h + num(om, "bottom");
        const voS = Math.max(0, vo >= 2 ** 31 ? vo - 2 ** 32 : vo);
        const split = ln(o) === "tbl" && (o.getAttribute("pageBreak") === "CELL" || o.getAttribute("pageBreak") === "TABLE");
        const rowInfo = split ? { rows: measureTableRowHeights(o), outT: num(om, "top"), outB: num(om, "bottom"), el: o } : {};
        if (spacesHost(p)) {
          const top0 = v0 - voS - carry;
          out.push({ v0: top0, bottom: v0, carry, hostEnd: top0, lineBottom: top0 + num(seg, "vertsize"), ...rowInfo, seg });
          continue;
        }
        out.push({ v0, bottom: v0 + voS + carry, carry, hostEnd, lineBottom: v0 + num(seg, "vertsize"), ...rowInfo, seg });
      }
    }
  }
  return out;
}
function spaceAfterAt(sg, styles) {
  if (!styles)
    return 0;
  const lsa = sg.parentNode, p = lsa?.parentNode;
  if (!lsa || !p)
    return 0;
  const segs = elements(lsa).filter((e) => ln(e) === "lineseg");
  if (segs[segs.length - 1] !== sg)
    return 0;
  return styles.paraGeom.get(p.getAttribute("paraPrIDRef") ?? "")?.spaceAfter ?? 0;
}
function rebaseSplitCells(record, carries, styles) {
  for (const [sub, cuts] of record) {
    const segs = [];
    for (const p of elements(sub))
      if (ln(p) === "p") {
        const lsa = findChildByLocalName(p, "linesegarray");
        for (const sg of lsa ? elements(lsa) : [])
          if (ln(sg) === "lineseg")
            segs.push(sg);
      }
    const old = segs.map((sg) => num(sg, "vertpos"));
    const floats = subFloatBottoms(sub);
    const sorted = [...cuts].sort((a, b) => a - b);
    const bases = sorted.map((c) => {
      let base = 0;
      segs.forEach((sg, i) => {
        if (old[i] < c)
          base = Math.max(base, old[i] + num(sg, "vertsize") + num(sg, "spacing") + spaceAfterAt(sg, styles));
      });
      for (const f of floats)
        if (f.v0 < c && f.bottom <= c)
          base = Math.max(base, f.bottom);
      return base - (carries?.get(sub)?.get(c) ?? 0);
    });
    segs.forEach((sg, i) => {
      let j = -1;
      for (let k = 0; k < sorted.length; k++)
        if (old[i] >= sorted[k])
          j = k;
      if (j >= 0)
        sg.setAttribute("vertpos", String(old[i] - bases[j]));
    });
  }
}
function pageBottomReserve(p) {
  let r = 0;
  for (const run of elements(p)) {
    if (ln(run) !== "run")
      continue;
    for (const o of elements(run)) {
      if (!OBJ_TAGS.has(ln(o)) || o.getAttribute("textWrap") !== "TOP_AND_BOTTOM")
        continue;
      const pos = findChildByLocalName(o, "pos");
      if (pos?.getAttribute("treatAsChar") === "1" || pos?.getAttribute("vertRelTo") !== "PAGE" || pos?.getAttribute("vertAlign") !== "BOTTOM")
        continue;
      const om = findChildByLocalName(o, "outMargin"), sz = findChildByLocalName(o, "sz");
      const h = ln(o) === "tbl" ? Math.max(num(sz, "height"), measureTableHeight(o)) : num(sz, "height");
      r = Math.max(r, num(pos, "vertOffset") + num(om, "top") + h + num(om, "bottom"));
    }
  }
  return r;
}
function columnWidthIn(p, bodyW) {
  for (const run of elements(p)) {
    if (ln(run) !== "run")
      continue;
    for (const ch of elements(run)) {
      if (ln(ch) !== "ctrl")
        continue;
      const col = findChildByLocalName(ch, "colPr");
      if (!col)
        continue;
      const n = Math.max(1, num(col, "colCount", 1));
      if (n === 1)
        return bodyW;
      if (col.getAttribute("sameSz") !== "0")
        return Math.trunc((bodyW - num(col, "sameGap") * (n - 1)) / n);
      const first = findChildByLocalName(col, "colSz");
      return first ? num(first, "width", bodyW) : bodyW;
    }
  }
  return void 0;
}
function reflowSubListsIn(p, doc, styles, mode, counter, flow, noteW = counter.bodyW) {
  const visit = (el) => {
    for (const ch of elements(el)) {
      const t = ln(ch);
      if (t === "footNote" || t === "endNote" || t === "header" || t === "footer") {
        const sub = findChildByLocalName(ch, "subList"), w = t === "endNote" ? counter.endNoteW ?? noteW : t === "footNote" ? noteW : counter.bodyW;
        if (sub && w)
          flow(sub, doc, styles, w, mode, counter, 0);
        continue;
      }
      if (t === "drawText" || t === "caption") {
        const sub = findChildByLocalName(ch, "subList"), tm = findChildByLocalName(ch, "textMargin");
        const textW = num(ch, "lastWidth") || (t === "caption" ? num(ch, "width") : num(findChildByLocalName(el, "sz"), "width"));
        const w = textW - num(tm, "left") - num(tm, "right");
        if (sub && w > 0)
          flow(sub, doc, styles, w, mode, counter, 0);
        continue;
      }
      if (t === "tr" || t === "subList" || t === "linesegarray")
        continue;
      visit(ch);
    }
  };
  for (const run of elements(p))
    if (ln(run) === "run")
      visit(run);
}
function reflowTablesIn(p, doc, styles, mode, counter, flow) {
  for (const run of elements(p)) {
    if (ln(run) !== "run")
      continue;
    for (const obj of elements(run)) {
      if (ln(obj) !== "tbl")
        continue;
      const inM = findChildByLocalName(obj, "inMargin");
      const colMax = /* @__PURE__ */ new Map();
      for (const tr of elements(obj))
        for (const tc of elements(tr)) {
          if (ln(tc) !== "tc" || num(findChildByLocalName(tc, "cellSpan"), "colSpan", 1) !== 1)
            continue;
          const c = num(findChildByLocalName(tc, "cellAddr"), "colAddr"), w = num(findChildByLocalName(tc, "cellSz"), "width");
          colMax.set(c, Math.max(colMax.get(c) ?? 0, w));
        }
      const xs = [];
      {
        const cl = [];
        for (const tr of elements(obj))
          for (const tc of elements(tr))
            if (ln(tc) === "tc")
              cl.push([num(findChildByLocalName(tc, "cellAddr"), "colAddr"), num(findChildByLocalName(tc, "cellSpan"), "colSpan", 1), num(findChildByLocalName(tc, "cellSz"), "width")]);
        cl.sort((p2, q) => p2[0] - q[0]);
        xs[0] = 0;
        for (const [c, sp, w] of cl)
          xs[c + sp] = Math.max(xs[c + sp] ?? 0, (xs[c] ?? 0) + w);
      }
      for (const tr of elements(obj)) {
        if (ln(tr) !== "tr")
          continue;
        for (const tc of elements(tr)) {
          if (ln(tc) !== "tc")
            continue;
          const csz = findChildByLocalName(tc, "cellSz");
          const cm = tc.getAttribute("hasMargin") === "0" ? null : findChildByLocalName(tc, "cellMargin");
          const span = num(findChildByLocalName(tc, "cellSpan"), "colSpan", 1);
          let cellW = span === 1 ? colMax.get(num(findChildByLocalName(tc, "cellAddr"), "colAddr")) ?? num(csz, "width") : span === num(obj, "colCnt") ? num(findChildByLocalName(obj, "sz"), "width") || num(csz, "width") : num(csz, "width");
          const ca = num(findChildByLocalName(tc, "cellAddr"), "colAddr");
          const gw = xs[ca + span] !== void 0 && xs[ca] !== void 0 ? xs[ca + span] - xs[ca] : 0;
          if (gw > cellW)
            cellW = gw;
          const mL = cellMarginOf(cm, "left", num(inM, "left", 141));
          const mR = cellMarginOf(cm, "right", num(inM, "right", 141));
          const areaW = Math.max(500, cellW - mL - mR);
          const sub = findChildByLocalName(tc, "subList");
          if (sub)
            flow(sub, doc, styles, areaW, mode, counter, 0);
        }
      }
    }
  }
}
export {
  bandTableOver,
  bulletEmptyHost,
  columnWidthIn,
  hasTbFloat,
  m0Objs,
  pageBottomReserve,
  reflowSubListsIn,
  reflowTablesIn,
  spacesHost,
  splitFloatTableRemainder,
  splitMovedLast,
  splitNotesLast,
  splitWhole,
  squareTableOver,
  subFloatBottoms
};
