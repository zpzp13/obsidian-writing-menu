// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/table-pages.ts. MIT; see LICENSE.
import { elements, ln, num, cellColumns, cellContentExtent } from "./para-model.js";
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { subFloatBottoms } from "./reflow-tables.js";
function stackedFloats(c) {
  const out = [];
  for (const p of c.sub ? elements(c.sub) : [])
    if (ln(p) === "p") {
      for (const run of elements(p))
        if (ln(run) === "run")
          for (const o of elements(run)) {
            if (ln(o) !== "pic")
              continue;
            const pos = findChildByLocalName(o, "pos");
            if (!pos || pos.getAttribute("treatAsChar") === "1" || (pos.getAttribute("vertRelTo") ?? "PARA") !== "PARA" || pos.getAttribute("allowOverlap") !== "0")
              continue;
            const wrap = o.getAttribute("textWrap") ?? "TOP_AND_BOTTOM";
            if (wrap !== "SQUARE" && wrap !== "TOP_AND_BOTTOM")
              continue;
            const om = findChildByLocalName(o, "outMargin"), raw = num(pos, "vertOffset");
            out.push({ el: o, vo: Math.max(0, raw >= 2 ** 31 ? raw - 2 ** 32 : raw), h: num(findChildByLocalName(o, "sz"), "height") + num(om, "top") + num(om, "bottom"), omT: num(om, "top") });
          }
    }
  return out;
}
function cellLineBoxes(c) {
  const out = [];
  let shift = 0, prevV = Number.NEGATIVE_INFINITY, prevH = 0, prevSavedEnd = 0, prevEnd = 0, part = 0;
  const cols = cellColumns(c.sub);
  for (const p of c.sub ? elements(c.sub) : [])
    if (ln(p) === "p") {
      const lsa = findChildByLocalName(p, "linesegarray");
      for (const sg of lsa ? elements(lsa) : [])
        if (ln(sg) === "lineseg") {
          const v = num(sg, "vertpos"), hz = num(sg, "horzpos");
          if ((v < prevV || v === prevV && hz <= prevH && prevSavedEnd > v) && !cols) {
            shift = prevEnd - v;
            part++;
          }
          prevV = v;
          prevH = hz;
          prevSavedEnd = v + num(sg, "vertsize") + num(sg, "spacing");
          const top = v + shift, bottom = top + num(sg, "vertsize");
          prevEnd = bottom + num(sg, "spacing");
          out.push({ seg: sg, top, bottom, part, origin: shift });
        }
    }
  return out;
}
function cellLines(c) {
  return cellLineBoxes(c).map((b) => [b.top, b.bottom]);
}
function spanPartRows(cells, rowY) {
  const out = /* @__PURE__ */ new Set();
  for (const c of cells) {
    if (c.rs < 2)
      continue;
    const bs = cellLineBoxes(c);
    const parts = bs.length ? bs[bs.length - 1].part : 0;
    let s = c.ra;
    for (let k = 0; k < parts; k++) {
      const inK = bs.filter((b) => b.part === k);
      if (!inK.length)
        break;
      const ext = Math.max(...inK.map((b) => b.bottom)) - inK[0].origin + c.marginT + c.marginB;
      let r = s + 1;
      while (r < c.ra + c.rs && rowY[r] - rowY[s] < ext - 100)
        r++;
      if (r >= c.ra + c.rs)
        break;
      out.add(r);
      s = r;
    }
  }
  return out;
}
function planTableRows(tbl, cells, rowH, ty, MT, BODY_H, slack = 0, floatSpan, nested = false, contMT = MT) {
  if (nested)
    slack = 0;
  const nRows = rowH.length;
  const rowY = [0];
  for (const h of rowH)
    rowY.push(rowY[rowY.length - 1] + h);
  const plain = () => rowH.map((h, r) => [{ page: 0, y: ty + rowY[r], h }]);
  const pageBottom = MT + BODY_H;
  const stackOver = tbl.getAttribute("pageBreak") === "CELL" && rowH.some((h, r) => {
    const rc = cells.filter((c) => c.ra === r && c.rs === 1);
    if (rc.length !== 1)
      return false;
    const st = stackedFloats(rc[0]);
    return st.length >= 2 && st.reduce((a, f) => a + f.h, 0) > h;
  });
  if (slack > 0 && ty + rowY[nRows] > pageBottom && ty + rowY[nRows] <= pageBottom + slack && cells.some((c) => cellLineBoxes(c).some((b) => b.part > 0)))
    slack = 0;
  if (slack > 0 && ty + rowY[nRows] > pageBottom && ty + rowY[nRows] <= pageBottom + slack) {
    const declared = num(findChildByLocalName(tbl, "sz"), "height");
    if (rowY.some((v, k) => k > 0 && k < nRows && Math.abs(v - declared) <= 2))
      slack = 0;
  }
  if (BODY_H <= 0 || ty + rowY[nRows] <= pageBottom + slack && !stackOver)
    return plain();
  if (findChildByLocalName(tbl, "pos")?.getAttribute("treatAsChar") === "1") {
    const declared = num(findChildByLocalName(tbl, "sz"), "height") || rowY[nRows];
    if (ty - MT < 2e3 || ty + declared <= pageBottom + slack)
      return plain();
    return rowH.map((h, r) => [{ page: 1, y: MT + rowY[r], h }]);
  }
  let hdrRows = 0;
  if (tbl.getAttribute("repeatHeader") === "1")
    while (hdrRows < nRows && cells.some((c) => c.ra === hdrRows) && cells.filter((c) => c.ra === hdrRows).every((c) => c.el.getAttribute("header") === "1"))
      hdrRows++;
  const contTop = contMT + num(findChildByLocalName(tbl, "outMargin"), "top") + rowY[hdrRows];
  const outB = num(findChildByLocalName(tbl, "outMargin"), "bottom");
  const cellSplit = tbl.getAttribute("pageBreak") === "CELL";
  const out = [];
  const flows = (findChildByLocalName(tbl, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA";
  let page = 0, y = ty, first = !flows || ty - MT < 2e3;
  const spanStarts = cellSplit ? spanPartRows(cells, rowY) : /* @__PURE__ */ new Set();
  for (let r = 0; r < nRows; r++) {
    let h = rowH[r];
    const pieces = [];
    if (!first && r >= hdrRows && spanStarts.has(r)) {
      page++;
      y = contTop;
      first = true;
    }
    const rowCells = cells.filter((c) => c.ra === r && c.rs === 1);
    const splittable = cellSplit && r >= hdrRows && rowCells.length > 0;
    const stack = splittable && rowCells.length === 1 ? stackedFloats(rowCells[0]) : [];
    if (stack.length >= 2) {
      const c = rowCells[0];
      let top = y, bottom = y + c.marginT, k = 0;
      const pcs = [];
      let place = /* @__PURE__ */ new Map();
      for (const f of stack) {
        let at = k === 0 ? top + c.marginT + f.vo : bottom;
        if (k > 0 && at + f.h > pageBottom - c.marginB) {
          pcs.push({ page, y: top, h: bottom - top + c.marginB, range: /* @__PURE__ */ new Map([[c.el, pcs.length ? [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] : [0, Number.POSITIVE_INFINITY]]]), place });
          page++;
          top = contTop;
          place = /* @__PURE__ */ new Map();
          at = top + c.marginT;
          bottom = at;
        }
        place.set(f.el, at + f.omT);
        bottom = Math.max(bottom, at + f.h);
        k++;
      }
      if (pcs.length) {
        pcs.push({ page, y: top, h: bottom - top + c.marginB, range: /* @__PURE__ */ new Map([[c.el, [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]]]), place });
        out.push(pcs);
        y = bottom + c.marginB;
        first = false;
        continue;
      }
    }
    const boxes = splittable ? new Map(rowCells.map((c) => [c.el, cellLineBoxes(c)])) : void 0;
    const hParts = boxes ? Math.max(0, ...[...boxes.values()].flatMap((bs) => bs.map((b) => b.part))) : 0;
    if (boxes && hParts > 0) {
      if (!first && rowCells.some((c) => {
        const b = (boxes.get(c.el) ?? []).find((x) => x.part === 0);
        return !!b && c.marginT + b.bottom - b.origin > pageBottom - y - c.marginB;
      })) {
        page++;
        y = contTop;
        first = true;
      }
      const declared = num(findChildByLocalName(tbl, "sz"), "height");
      const led = /* @__PURE__ */ new Set();
      let firstPh = 0;
      for (let k = 0; k <= hParts; k++) {
        if (k > 0 && floatSpan) {
          let lead = 0, place;
          for (const c of rowCells) {
            const b = (boxes.get(c.el) ?? []).find((x) => x.part === k);
            if (!b)
              continue;
            const f = floatSpan(b.seg, y + c.marginT, contTop + c.marginT);
            if (f?.el && f.pages > 0 && f.pages > lead && Math.abs(contTop + c.marginT + b.top - b.origin - f.endY) < 3e3) {
              lead = f.pages;
              place = /* @__PURE__ */ new Map([[f.el, y + c.marginT]]);
              led.add(b.seg);
            }
          }
          if (lead > 0) {
            const none = new Map(rowCells.map((c) => [c.el, [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]]));
            for (let e = 0; e < lead; e++)
              pieces.push({ page: page + e, y: contTop, h: pageBottom - contTop, range: none, place: e === 0 ? place : void 0 });
            page += lead;
          }
        }
        const range = /* @__PURE__ */ new Map();
        let ext = 0, toNext = 0;
        for (const c of rowCells) {
          const bs = boxes.get(c.el) ?? [];
          const inK = bs.filter((b) => b.part === k), next = bs.find((b) => b.part > k);
          const from = inK[0]?.origin ?? next?.origin ?? Number.POSITIVE_INFINITY;
          range.set(c.el, [from, next?.top ?? Number.POSITIVE_INFINITY]);
          if (inK.length)
            ext = Math.max(ext, inK[inK.length - 1].bottom - from + c.marginT + c.marginB);
          if (k === hParts && inK.length && c.sub)
            for (const f of subFloatBottoms(c.sub)) {
              const b = bs.find((x) => x.seg === f.seg);
              if (b && b.part === k)
                ext = Math.max(ext, b.top + f.bottom - f.v0 - from + c.marginT + c.marginB);
            }
          if (inK.length && next)
            toNext = Math.max(toNext, next.top - from + c.marginT + c.marginB);
        }
        const last = k === hParts;
        const cellH = Math.max(0, ...rowCells.map((c) => num(findChildByLocalName(c.el, "cellSz"), "height")));
        const firstH = Math.min(declared > 0 && ty + declared - y >= ext ? Math.min(pageBottom - y, ty + declared - y) : pageBottom - y, Math.max(ext, cellH));
        const share = last && k === 1 ? Math.max(0, ...rowCells.filter((c) => tbl.getAttribute("noAdjust") === "1" || /^(CENTER|BOTTOM)$/.test(c.sub?.getAttribute("vertAlign") ?? "")).map((c) => c.h - firstPh).filter((v) => v <= pageBottom - contTop)) : 0;
        const ph = last ? Math.max(ext, share) : k === 0 ? firstH : toNext > 0 ? Math.min(pageBottom - contTop, toNext) : pageBottom - contTop;
        if (k === 0)
          firstPh = ph;
        pieces.push({ page, y, h: ph, range });
        if (!last) {
          let span = 0, spanEnd = 0;
          if (floatSpan)
            for (const c of rowCells) {
              const bs = (boxes.get(c.el) ?? []).filter((b) => b.part === k), from = bs[0]?.origin ?? 0;
              for (const b of bs) {
                if (led.has(b.seg))
                  continue;
                const f = floatSpan(b.seg, y + c.marginT + b.top - from, contTop + c.marginT);
                if (f && f.pages > span) {
                  span = f.pages;
                  spanEnd = f.endY;
                }
              }
            }
          if (span > 0) {
            const nextTop = Math.min(...rowCells.map((c) => {
              const b = (boxes.get(c.el) ?? []).find((x) => x.part === k + 1);
              return b ? contTop + c.marginT + b.top - b.origin : Number.POSITIVE_INFINITY;
            }));
            const skip = nextTop < spanEnd - 100 ? span + 1 : span;
            for (let e = 1; e < skip; e++)
              pieces.push({ page: page + e, y: contTop, h: pageBottom - contTop, range: new Map(rowCells.map((c) => [c.el, [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]])) });
            page += skip;
          } else
            page++;
          y = contTop;
          first = true;
        } else
          h = ph;
      }
      out.push(pieces);
      y += h;
      first = false;
      continue;
    }
    if (boxes && floatSpan) {
      let span = 0, spanEnd = 0, mB = 0;
      for (const c of rowCells)
        for (const b of boxes.get(c.el) ?? []) {
          const f = floatSpan(b.seg, y + c.marginT + b.top, contTop + c.marginT);
          if (f && f.pages > span) {
            span = f.pages;
            spanEnd = f.endY;
            mB = c.marginB;
          }
        }
      if (span > 0) {
        const none = new Map(rowCells.map((c) => [c.el, [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]]));
        pieces.push({ page, y, h: pageBottom - y, range: new Map(rowCells.map((c) => [c.el, [0, Number.POSITIVE_INFINITY]])), fill: true });
        for (let e = 1; e < span; e++)
          pieces.push({ page: page + e, y: contTop, h: pageBottom - contTop, range: none, fill: true });
        page += span;
        const endH = Math.max(0, spanEnd - contTop) + mB;
        pieces.push({ page, y: contTop, h: endH, range: none });
        out.push(pieces);
        y = contTop + endH;
        first = false;
        continue;
      }
    }
    if (splittable && y + h + outB > pageBottom) {
      const from = /* @__PURE__ */ new Map();
      const lines = new Map(rowCells.map((c) => [c.el, cellLines(c)]));
      while (y + h + outB > pageBottom && BODY_H > rowY[hdrRows]) {
        const avail = pageBottom - y - outB;
        let rem = 0, placed = false, allFit = true, blocked = false;
        const cuts = [];
        for (const c of rowCells) {
          const off = from.get(c.el) ?? 0;
          const ls = (lines.get(c.el) ?? []).filter((l) => l[0] >= off);
          if (!ls.length) {
            cuts.push([c.el, off, off]);
            continue;
          }
          const end = Math.max(...ls.map((l) => l[1]));
          const k = ls.findIndex((l) => c.marginT + (l[1] - off) > avail - c.marginB);
          if (k < 0) {
            cuts.push([c.el, off, end + 1]);
            continue;
          }
          allFit = false;
          if (k > 0)
            placed = true;
          else if (off === 0)
            blocked = true;
          cuts.push([c.el, off, ls[k][0]]);
          rem = Math.max(rem, end - ls[k][0] + c.marginT + c.marginB);
        }
        if (allFit) {
          const spanCells = cells.filter((c) => c.ra === r && c.rs > 1);
          if (!first && h <= pageBottom - contTop && [...rowCells, ...spanCells].some((c) => cellContentExtent(c) + c.marginT + c.marginB > avail)) {
            page++;
            y = contTop;
            first = true;
            break;
          }
          if (nested && avail > 0) {
            pieces.push({ page, y, h: avail, range: new Map(rowCells.map((c) => [c.el, [from.get(c.el) ?? 0, Number.POSITIVE_INFINITY]])) });
            for (const c of rowCells)
              from.set(c.el, Number.POSITIVE_INFINITY);
            page++;
            y = contTop;
            first = true;
            h -= avail;
            continue;
          }
          h = avail;
          break;
        }
        if (blocked && !first) {
          page++;
          y = contTop;
          first = true;
          continue;
        }
        if (!placed) {
          if (first)
            break;
          page++;
          y = contTop;
          first = true;
          continue;
        }
        pieces.push({ page, y, h: avail, range: new Map(cuts.map(([el, a, b]) => [el, [a, b]])) });
        for (const [el, , b] of cuts)
          from.set(el, b);
        page++;
        y = contTop;
        first = true;
        h = rem;
      }
      pieces.push({ page, y, h, range: new Map(rowCells.map((c) => [c.el, [from.get(c.el) ?? 0, Number.POSITIVE_INFINITY]])) });
      out.push(pieces);
      y += h;
      first = false;
      continue;
    }
    if (!first && y + h + (cellSplit ? 0 : outB) > pageBottom && r >= hdrRows) {
      page++;
      y = contTop;
      first = true;
    } else if (!first && tbl.getAttribute("pageBreak") === "TABLE" && r >= hdrRows && !cells.some((c) => c.ra < r && c.ra + c.rs > r)) {
      let end = r + 1;
      for (let grown = true; grown; ) {
        grown = false;
        for (const c of cells)
          if (c.ra >= r && c.ra < end && c.ra + c.rs > end) {
            end = c.ra + c.rs;
            grown = true;
          }
      }
      const groupH = rowY[Math.min(end, nRows)] - rowY[r];
      if (end > r + 1 && y + groupH + outB > pageBottom && groupH <= pageBottom - contTop) {
        page++;
        y = contTop;
        first = true;
      }
    }
    out.push([{ page, y, h }]);
    y += h;
    first = false;
  }
  return out;
}
export {
  cellLineBoxes,
  planTableRows,
  spanPartRows
};
