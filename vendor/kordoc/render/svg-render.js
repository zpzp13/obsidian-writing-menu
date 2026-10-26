// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/svg-render.ts. MIT; see LICENSE.
function browserBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 4096) binary += String.fromCharCode(...bytes.subarray(index, index + 4096));
  return btoa(binary);
}
import JSZip from "jszip";
import { KordocError, compareSectionPaths, precheckZipSize } from "../utils.js";
import { createXmlParser, findChildByLocalName, MAX_DECOMPRESS_SIZE, MAX_ZIP_ENTRIES } from "../hwpx/parser-shared.js";
import { toInt32, tableColumnBoundaries } from "./layout.js";
import { measureTextWidth, faceClassOf } from "../hwpx/text-metrics.js";
import { parseRenderStyles, hwpxAppMajor, hwpxAppBuild, DEFAULT_CHAR } from "./head-styles.js";
import { reflowSection } from "./reflow.js";
import { hasKoPubSubst, kopubSubstituted } from "./font-env.js";
import { RegionCollector } from "./scene.js";
import { formatHeadNumber } from "./para-number.js";
import { ln, elements, num, findFirst, buildPara, prepareDeletedRanges, cellContentExtent, collectCells, measureTableHeight, measureTableRowHeights, cellColumns } from "./para-model.js";
import { endNoteLayout, footNoteStories, pageStories } from "./page-stories.js";
import { cellLineBoxes, planTableRows } from "./table-pages.js";
import { subFloatBottoms } from "./reflow-tables.js";
import { objectGeometry } from "./shape-geometry.js";
import { linePushedBy } from "./object-anchor.js";
import { readZipEntry } from "../hwpx/parser-shared.js";
import { escapeXml, pt, ptNum, pageNo, bboxOf, regionOpenTag, parentId, emit, warnOnce, drawPara, cellParaTop } from "./svg-content.js";
import { escapeXml as escapeXml2 } from "./svg-content.js";
import { buildPara as buildPara2, measureTableHeight as measureTableHeight2, tabAdvance as tabAdvance2 } from "./para-model.js";
function edgeLine(x1, y1, x2, y2, e) {
  const dash = /DASH|DOT/.test(e.type) ? ` stroke-dasharray="${e.type.includes("DOT") ? "1,1.5" : "3,1.5"}"` : "";
  return `<line x1="${pt(x1)}" y1="${pt(y1)}" x2="${pt(x2)}" y2="${pt(y2)}" stroke="${escapeXml(e.color)}" stroke-width="${e.widthPt.toFixed(2)}"${dash}/>`;
}
function tableContPages(tbl, ty, MT, BODY_H, memo, slack = 0, floatSpan, nested = false, contMT = MT) {
  const pcs = planTableRows(tbl, collectCells(tbl), measureTableRowHeights(tbl, memo), ty, MT, BODY_H, slack, floatSpan, nested, contMT).flat();
  const last = pcs.reduce((a, b) => b.page > a.page || b.page === a.page && b.y + b.h > a.y + a.h ? b : a, pcs[0] ?? { page: 0, y: ty, h: 0 });
  return { pages: last.page, endY: last.y + last.h };
}
function cellFloatSpan(MT, BODY_H, memo, slack) {
  return (seg, top, contMT) => {
    const lsa = seg.parentNode, p = lsa?.parentNode;
    if (!p || ln(p) !== "p")
      return void 0;
    const segs = elements(lsa).filter((e) => ln(e) === "lineseg"), k = segs.indexOf(seg);
    const m = buildPara(p);
    let best;
    for (const o of m.objs) {
      if (o.tag !== "tbl" || o.inline)
        continue;
      const pos = findChildByLocalName(o.el, "pos");
      if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
        continue;
      const segK = Math.max(0, m.segs.findIndex((sg, i) => sg.textpos <= o.index && (i === m.segs.length - 1 || m.segs[i + 1].textpos > o.index)));
      if (segK !== k)
        continue;
      const segV = num(seg, "vertpos"), pTop = cellParaTop(p, memo.paraGeom ?? /* @__PURE__ */ new Map());
      const start = linePushedBy(o, segV, pTop) ? top - (segV - (pTop ?? segV)) : top;
      const ty = start + num(findChildByLocalName(o.el, "outMargin"), "top") + Math.max(0, toInt32(pos?.getAttribute("vertOffset") ?? void 0, 0));
      const span = tableContPages(o.el, ty, MT, BODY_H, memo, slack, cellFloatSpan(MT, BODY_H, memo, slack), true, contMT);
      if (span.pages > 0 && (!best || span.pages > best.pages))
        best = { ...span, el: o.el };
    }
    return best;
  };
}
function drawTable(tbl, tx, ty, ctx, depth) {
  if (depth > 16) {
    warnOnce(ctx, "depth", "\uC911\uCCA9 \uAE4A\uC774 16 \uCD08\uACFC \u2014 \uC774\uD558 \uC0DD\uB7B5");
    return;
  }
  ctx.stats.tables++;
  const tblSz = findChildByLocalName(tbl, "sz");
  const cells = collectCells(tbl);
  if (cells.length === 0 || cells.length > 4096)
    return;
  const nCols = Math.max(...cells.map((c) => c.ca + c.cs));
  const nRows = Math.max(...cells.map((c) => c.ra + c.rs));
  const colCons = cells.map((c) => ({ a: c.ca, b: c.ca + c.cs, size: c.w }));
  const tblW = num(tblSz, "width");
  const rowSum = /* @__PURE__ */ new Map();
  for (const c of cells) {
    const r = rowSum.get(c.ra) ?? { cover: 0, w: 0 };
    r.cover += c.cs;
    r.w += c.w;
    rowSum.set(c.ra, r);
  }
  const noExactRow = ![...rowSum.values()].some((r) => r.cover === nCols && Math.abs(r.w - tblW) <= 2);
  const colX = tableColumnBoundaries(colCons, nCols, tblW || void 0, noExactRow);
  const rowH = measureTableRowHeights(tbl, ctx.extentMemo);
  const rowY = [0];
  for (let r = 0; r < nRows; r++)
    rowY.push(rowY[r] + rowH[r]);
  const tblH = rowY[nRows];
  if (ty + tblH > ctx.pageH + 100)
    warnOnce(ctx, "table-split", "\uD398\uC774\uC9C0\uC5D0 \uAC78\uCE5C \uD45C \u2014 \uBD84\uD560 \uC9C0\uC624\uBA54\uD2B8\uB9AC\uAC00 \uC5C6\uC5B4 \uC2DC\uC791 \uD398\uC774\uC9C0 \uC601\uC5ED\uB9CC region \uC73C\uB85C \uAE30\uB85D");
  const tblId = ctx.regions.add("table", bboxOf(ctx, tx, ty, colX[nCols], tblH), { sourceId: tbl.getAttribute("id") ?? void 0, parentId: parentId(ctx) });
  emit(ctx, regionOpenTag(tblId, "table", pageNo(ctx)));
  ctx.parentStack.push(tblId);
  const startPage = ctx.page;
  let hdrRows = 0;
  if (tbl.getAttribute("repeatHeader") === "1")
    while (hdrRows < nRows && cells.some((c) => c.ra === hdrRows) && cells.filter((c) => c.ra === hdrRows).every((c) => c.el.getAttribute("header") === "1"))
      hdrRows++;
  const slack = ctx.geom.PH - ctx.geom.MT - ctx.geom.BODY_H;
  const splitHere = depth === 1 || !!ctx.splitCell && findChildByLocalName(tbl, "pos")?.getAttribute("treatAsChar") !== "1";
  const plan = splitHere ? planTableRows(tbl, cells, rowH, ty, ctx.geom.MT, ctx.geom.BODY_H, slack, cellFloatSpan(ctx.geom.MT, ctx.geom.BODY_H, ctx.extentMemo, slack), depth !== 1, depth !== 1 && ctx.splitContMT !== void 0 ? ctx.splitContMT : ctx.geom.MT) : rowH.map((h, r) => [{ page: 0, y: ty + rowY[r], h }]);
  const splitSaved = ctx.splitCell;
  ctx.splitCell = false;
  for (const pc of plan.flat())
    for (const [el, py] of pc.place ?? [])
      (ctx.objPlace ?? (ctx.objPlace = /* @__PURE__ */ new Map())).set(el, { page: startPage + pc.page, y: py });
  const contPages = [...new Set(plan.flat().map((pc) => pc.page).filter((pg) => pg > 0))].map((pg) => startPage + pg);
  while (ctx.pages.length <= Math.max(startPage, ...contPages))
    ctx.pages.push([]);
  const xw = (c) => ({ x: tx + colX[c.ca], w: colX[Math.min(c.ca + c.cs, nCols)] - colX[c.ca] });
  const geom = [];
  for (const c of cells) {
    const pcs = plan[c.ra];
    if (c.rs === 1 && pcs.length > 1) {
      pcs.forEach((pc, k) => geom.push({ c, page: startPage + pc.page, ...xw(c), y: pc.y, h: pc.h, pieces: k === 0 ? pcs : [] }));
      continue;
    }
    if (c.rs > 1) {
      const span = plan.slice(c.ra, Math.min(c.ra + c.rs, nRows)).flat();
      const pages = [...new Set(span.map((pc) => pc.page))];
      if (pages.length > 1) {
        const bs = cellLineBoxes(c);
        const partTop = (k) => bs.find((b) => b.part === k);
        const groups = pages.map((pg, k) => {
          const on = span.filter((pc) => pc.page === pg);
          const y0 = Math.min(...on.map((pc) => pc.y)), y1 = Math.max(...on.map((pc) => pc.y + pc.h));
          const from = k === 0 ? 0 : partTop(k)?.origin ?? Number.POSITIVE_INFINITY;
          const to = k === pages.length - 1 ? Number.POSITIVE_INFINITY : partTop(k + 1)?.top ?? Number.POSITIVE_INFINITY;
          return { page: pg, y: y0, h: y1 - y0, range: /* @__PURE__ */ new Map([[c.el, [from, to]]]) };
        });
        groups.forEach((pc, k) => geom.push({ c, page: startPage + pc.page, ...xw(c), y: pc.y, h: pc.h, pieces: k === 0 ? groups : [] }));
        continue;
      }
    }
    const h = c.rs === 1 ? pcs[0].h : rowY[Math.min(c.ra + c.rs, nRows)] - rowY[c.ra];
    geom.push({ c, page: startPage + pcs[0].page, ...xw(c), y: pcs[0].y, h });
  }
  const contBase = depth !== 1 && ctx.splitContMT !== void 0 ? ctx.splitContMT : ctx.geom.MT;
  for (const page of contPages)
    for (const c of cells)
      if (c.ra < hdrRows)
        geom.push({ c, page, ...xw(c), y: contBase + num(findChildByLocalName(tbl, "outMargin"), "top") + rowY[c.ra], h: rowY[Math.min(c.ra + c.rs, nRows)] - rowY[c.ra] });
  for (const g of geom) {
    ctx.page = g.page;
    const bf = g.c.bfId != null ? ctx.styles.borderFill.get(g.c.bfId) : void 0;
    if (bf?.fill)
      emit(ctx, `<rect x="${pt(g.x)}" y="${pt(g.y)}" width="${pt(g.w)}" height="${pt(g.h)}" fill="${escapeXml(bf.fill)}"/>`);
  }
  for (const g of geom) {
    const { c } = g;
    if (!c.sub || g.pieces && g.pieces.length === 0)
      continue;
    ctx.page = g.page;
    if (g.pieces) {
      const base = g.pieces[0].y + c.marginT;
      const boxes = cellLineBoxes(c);
      const contV = new Map(boxes.map((b) => [b.seg, b.top]));
      const pieceOf = (v) => Math.max(0, g.pieces.findIndex((pc) => {
        const r = pc.range?.get(c.el);
        return !!r && v >= r[0] && v < r[1];
      }));
      const va2 = c.sub.getAttribute("vertAlign") ?? "TOP";
      const lastK = g.pieces.length - 1;
      const pieceOff = g.pieces.map((pc, k) => {
        if (va2 === "TOP" || k > 0 && k < lastK || pc.fill)
          return 0;
        const from = pc.range?.get(c.el)?.[0] ?? 0;
        const bottoms = boxes.filter((b) => pieceOf(b.top) === k).map((b) => b.bottom - from);
        if (k > 0)
          for (const f of subFloatBottoms(c.sub)) {
            const b = boxes.find((x) => x.seg === f.seg);
            if (b && pieceOf(b.top) === k)
              bottoms.push(b.top + f.bottom - f.v0 - from);
          }
        if (!bottoms.length)
          return 0;
        const free = pc.h - c.marginT - c.marginB - Math.max(...bottoms);
        return Math.max(0, va2 === "CENTER" ? free / 2 : free);
      });
      for (const p of elements(c.sub)) {
        if (ln(p) !== "p")
          continue;
        const lsa = findChildByLocalName(p, "linesegarray"), segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
        const saved = segs.map((sg) => sg.getAttribute("vertpos"));
        const pages = segs.map((sg) => {
          const v = contV.get(sg) ?? num(sg, "vertpos");
          const k = pieceOf(v);
          const pc = g.pieces[k], from = pc.range?.get(c.el)?.[0] ?? 0;
          sg.setAttribute("vertpos", String(v - from + pc.y + c.marginT + pieceOff[k] - base));
          return startPage + pc.page;
        });
        ctx.splitCell = splitHere;
        const contMTSaved = ctx.splitContMT;
        ctx.splitContMT = (depth > 1 && contMTSaved !== void 0 ? contMTSaved : ctx.geom.MT) + num(findChildByLocalName(tbl, "outMargin"), "top") + rowY[hdrRows] + c.marginT;
        drawPara(p, g.x + c.marginL, base, g.w - c.marginL - c.marginR, ctx, depth + 1, pages);
        ctx.splitContMT = contMTSaved;
        ctx.splitCell = false;
        segs.forEach((sg, i) => sg.setAttribute("vertpos", saved[i] ?? "0"));
      }
      continue;
    }
    const innerW = g.w - c.marginL - c.marginR;
    const overWide = elements(c.sub).some((q) => ln(q) === "p" && buildPara(q).objs.some((o) => o.inline && o.tag === "pic" && o.width > innerW + 50));
    if (overWide) {
      const cid = `cclip${ctx.defs.length}`;
      ctx.defs.push(`<clipPath id="${cid}"><rect x="${pt(g.x)}" y="${pt(g.y)}" width="${pt(g.w)}" height="${pt(g.h)}"/></clipPath>`);
      emit(ctx, `<g clip-path="url(#${cid})">`);
    }
    const innerH = g.h - c.marginT - c.marginB;
    const extent = cellContentExtent(c, ctx.extentMemo);
    const va = c.sub.getAttribute("vertAlign") ?? "TOP";
    let yoff = 0;
    if (va === "CENTER")
      yoff = Math.max(0, (innerH - extent) / 2);
    else if (va === "BOTTOM")
      yoff = Math.max(0, innerH - extent);
    const cols = cellColumns(c.sub);
    const moved = [];
    if (cols) {
      const colW = (innerW - cols.gap * (cols.n - 1)) / cols.n;
      let col = 0, prevV = Number.NEGATIVE_INFINITY;
      for (const p of elements(c.sub))
        if (ln(p) === "p") {
          const lsa = findChildByLocalName(p, "linesegarray");
          for (const sg of lsa ? elements(lsa) : [])
            if (ln(sg) === "lineseg") {
              const v = num(sg, "vertpos");
              if (v < prevV)
                col = Math.min(cols.n - 1, col + 1);
              prevV = v;
              if (col > 0) {
                moved.push([sg, sg.getAttribute("horzpos")]);
                sg.setAttribute("horzpos", String(num(sg, "horzpos") + Math.round(col * (colW + cols.gap))));
              }
            }
        }
    }
    for (const p of elements(c.sub)) {
      if (ln(p) !== "p")
        continue;
      drawPara(p, g.x + c.marginL, g.y + c.marginT + yoff, g.w - c.marginL - c.marginR, ctx, depth + 1);
    }
    for (const [sg, hp] of moved)
      sg.setAttribute("horzpos", hp ?? "0");
    if (overWide) {
      ctx.page = g.page;
      emit(ctx, "</g>");
    }
  }
  for (const g of geom) {
    ctx.page = g.page;
    const bf = g.c.bfId != null ? ctx.styles.borderFill.get(g.c.bfId) : void 0;
    if (!bf)
      continue;
    if (bf.top)
      emit(ctx, edgeLine(g.x, g.y, g.x + g.w, g.y, bf.top));
    if (bf.bottom)
      emit(ctx, edgeLine(g.x, g.y + g.h, g.x + g.w, g.y + g.h, bf.bottom));
    if (bf.left)
      emit(ctx, edgeLine(g.x, g.y, g.x, g.y + g.h, bf.left));
    if (bf.right)
      emit(ctx, edgeLine(g.x + g.w, g.y, g.x + g.w, g.y + g.h, bf.right));
  }
  ctx.page = startPage;
  ctx.splitCell = splitSaved;
  ctx.parentStack.pop();
  emit(ctx, "</g>");
}
function imageSymbol(loaded, ctx) {
  if (!loaded.symId) {
    loaded.symId = `bin${ctx.defs.length}`;
    ctx.defs.push(
      `<symbol id="${loaded.symId}" viewBox="0 0 100 100" preserveAspectRatio="none"><image width="100" height="100" preserveAspectRatio="none" href="${loaded.dataUri}"/></symbol>`
    );
  }
  return loaded.symId;
}
function drawPic(pic, x, y, ctx) {
  const sz = findChildByLocalName(pic, "sz");
  let w = num(sz, "width", 5669), h = num(sz, "height", 5669);
  const cur = findChildByLocalName(pic, "curSz");
  const rotated = objectGeometry(pic, x, y, num(cur, "width") || w, num(cur, "height") || h, w, h);
  if (rotated.rotation) {
    x = rotated.x;
    y = rotated.y;
    w = rotated.w;
    h = rotated.h;
    ctx.regionRotations.push(rotated.rotation);
  }
  drawPicFrame(pic, x, y, w, h, rotated.transform, ctx);
  if (rotated.rotation)
    ctx.regionRotations.pop();
}
function drawPicFrame(pic, x, y, w, h, transform, ctx) {
  const img = findFirst(pic, "img");
  const ref = img?.getAttribute("binaryItemIDRef");
  const loaded = ref != null ? ctx.images.get(ref) : void 0;
  const imgId = ctx.regions.add("image", bboxOf(ctx, x, y, w, h), { sourceId: ref ?? void 0, parentId: parentId(ctx) });
  emit(ctx, regionOpenTag(imgId, "image", pageNo(ctx)));
  const close = transform ? "</g></g>" : "</g>";
  if (transform)
    emit(ctx, `<g transform="${transform}">`);
  if (!loaded) {
    emit(ctx, `<rect x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}" fill="#eee" stroke="#c00" stroke-width="0.5"/>`);
    warnOnce(ctx, `img:${ref}`, `\uC774\uBBF8\uC9C0 \uBC14\uC774\uB108\uB9AC \uB204\uB77D: ${ref ?? "(ref \uC5C6\uC74C)"}`);
    emit(ctx, close);
    return;
  }
  ctx.stats.images++;
  const clip = findChildByLocalName(pic, "imgClip");
  const imgDim = findChildByLocalName(pic, "imgDim");
  const orgSz = findChildByLocalName(pic, "orgSz");
  const dimW = num(imgDim, "dimwidth"), dimH = num(imgDim, "dimheight");
  const refW = dimW > 0 ? dimW : num(orgSz, "width");
  const refH = dimH > 0 ? dimH : num(orgSz, "height");
  const cl = num(clip, "left"), ct = num(clip, "top");
  const cr = num(clip, "right", refW), cb = num(clip, "bottom", refH);
  const cropped = refW > 0 && refH > 0 && clip != null && (cl > 0 || ct > 0 || cr < refW || cb < refH) && cr > cl && cb > ct;
  const symId = imageSymbol(loaded, ctx);
  if (cropped) {
    emit(
      ctx,
      `<svg x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}" viewBox="${pt(cl)} ${pt(ct)} ${pt(cr - cl)} ${pt(cb - ct)}" preserveAspectRatio="none"><use href="#${symId}" x="0" y="0" width="${pt(refW)}" height="${pt(refH)}"/></svg>`
    );
  } else {
    emit(ctx, `<use href="#${symId}" x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}"/>`);
  }
  emit(ctx, close);
}
function sniffMime(name, bytes) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png") || bytes.length > 4 && bytes[0] === 137 && bytes[1] === 80)
    return "image/png";
  if (lower.endsWith(".bmp") || bytes.length > 2 && bytes[0] === 66 && bytes[1] === 77)
    return "image/bmp";
  if (lower.endsWith(".gif") || bytes.length > 3 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70)
    return "image/gif";
  if (lower.endsWith(".svg"))
    return "image/svg+xml";
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  return "image/jpeg";
}
function readSectionGeom(root) {
  const pagePr = findFirst(root, "pagePr");
  const margin = pagePr ? findChildByLocalName(pagePr, "margin") : null;
  let PW = num(pagePr, "width", 59528), PH = num(pagePr, "height", 84188);
  if (pagePr?.getAttribute("landscape") === "NARROWLY" && PW < PH) {
    const t = PW;
    PW = PH;
    PH = t;
  }
  const gutterType = pagePr?.getAttribute("gutterType") ?? "LEFT_ONLY", gutter = num(margin, "gutter", 0);
  const gL = gutterType === "TOP_BOTTOM" ? 0 : gutter, gT = gutterType === "TOP_BOTTOM" ? gutter : 0;
  const ML = num(margin, "left", 8504) + gL;
  const MT = num(margin, "top", 5668) + num(margin, "header", 0) + gT;
  const BODY_H = PH - MT - num(margin, "bottom", 4252) - num(margin, "footer", 0);
  const BODY_W = PW - ML - num(margin, "right", 8504);
  const mirrorDx = gutterType === "LEFT_RIGHT" ? num(margin, "right", 8504) - ML : 0;
  return { PW, PH, ML, MT, BODY_W, BODY_H, ...mirrorDx ? { mirrorDx } : {} };
}
function staleTopCache(root, BODY_H) {
  if (BODY_H <= 0)
    return false;
  let run = 0, sum = 0;
  for (const p of elements(root)) {
    if (ln(p) !== "p")
      continue;
    const lsa = findChildByLocalName(p, "linesegarray");
    const segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
    if (!segs.length)
      continue;
    const v = num(segs[0], "vertpos");
    if (v !== 0 || p.getAttribute("pageBreak") === "1" || p.getAttribute("columnBreak") === "1") {
      run = 0;
      sum = 0;
      continue;
    }
    if (run >= 2 && sum <= BODY_H / 2)
      return true;
    const last = segs[segs.length - 1];
    sum += num(last, "vertpos") + num(last, "vertsize") + num(last, "spacing");
    run++;
  }
  return false;
}
function absoluteTopCache(root, ML, BODY_W) {
  let tot = 0, over = 0;
  for (const p of elements(root)) {
    if (ln(p) !== "p")
      continue;
    const lsa = findChildByLocalName(p, "linesegarray");
    for (const sg of lsa ? elements(lsa) : []) {
      if (ln(sg) !== "lineseg" || num(sg, "horzsize") <= 0)
        continue;
      tot++;
      const hp = num(sg, "horzpos");
      if (hp >= ML - 500 && hp + num(sg, "horzsize") > BODY_W + 500)
        over++;
    }
  }
  return over >= 3 && over * 5 >= tot;
}
function renderSectionToPages(root, geom, ctxBase, doReflow, reflowMode, masters = [], hasDeletionMarkers = true, lastSection = true) {
  const { PW, PH, ML, MT, BODY_W, BODY_H } = geom;
  if (hasDeletionMarkers)
    prepareDeletedRanges(root);
  const degenerate = staleTopCache(root, BODY_H);
  if (degenerate) {
    for (const p of elements(root))
      if (ln(p) === "p") {
        const lsa = findChildByLocalName(p, "linesegarray");
        if (lsa)
          p.removeChild(lsa);
      }
    ctxBase.warnings.push("\uC870\uD310 \uCE90\uC2DC\uAC00 \uB9DE\uC9C0 \uC54A\uC544(\uCD5C\uC0C1\uC704 \uBB38\uB2E8\uC774 \uBAA8\uB450 \uAC19\uC740 \uC790\uB9AC) \uB2E4\uC2DC \uC870\uD310\uD574 \uB80C\uB354");
  }
  const absolute = !degenerate && absoluteTopCache(root, ML, BODY_W);
  if (absolute) {
    for (const lsa of Array.from(root.getElementsByTagName("*")).filter((e) => ln(e) === "linesegarray"))
      lsa.parentNode?.removeChild(lsa);
    ctxBase.warnings.push("\uC870\uD310 \uCE90\uC2DC\uAC00 \uCABD \uAE30\uC900 \uC88C\uD45C\uB85C \uC801\uD600 \uC788\uC5B4 \uB2E4\uC2DC \uC870\uD310\uD574 \uB80C\uB354");
  }
  const mixed = !doReflow && !degenerate && !absolute && Array.from(root.getElementsByTagName("*")).some((p) => ln(p) === "p" && !findChildByLocalName(p, "linesegarray"));
  if (doReflow || degenerate || absolute || mixed)
    reflowSection(root, ctxBase.styles, { BODY_W, BODY_H }, reflowMode);
  const colPr = findFirst(root, "colPr");
  const multiCol = num(colPr, "colCount", 1) > 1;
  const nCol = multiCol ? num(colPr, "colCount", 1) : 1, colGap = multiCol ? num(colPr, "sameGap", 0) : 0;
  const colW = (BODY_W - colGap * (nCol - 1)) / nCol;
  let localCols = multiCol;
  if (multiCol)
    for (const p of elements(root)) {
      if (ln(p) !== "p")
        continue;
      const lsa = findChildByLocalName(p, "linesegarray");
      for (const s of lsa ? elements(lsa) : [])
        if (ln(s) === "lineseg" && num(s, "horzpos") >= colW) {
          localCols = false;
          break;
        }
      if (!localCols)
        break;
    }
  const paraSegPages = /* @__PURE__ */ new Map();
  const paraTops = /* @__PURE__ */ new Map();
  const backPlace = /* @__PURE__ */ new Map();
  const geom0 = ctxBase.styles.paraGeom;
  let tableEndPage = -1;
  let nPages = 1;
  let maxTopV = 0;
  {
    let prevV = Number.NEGATIVE_INFINITY;
    let prevH = Number.NEGATIVE_INFINITY;
    let prevEnd = Number.NEGATIVE_INFINITY;
    let cur = 0, col = 0;
    let pendingEnd = 0, pendingEndY = 0;
    let lastEnd = 0, lastPage = -1;
    let lastSA = 0;
    let prevSeg;
    for (const p of elements(root)) {
      if (ln(p) !== "p")
        continue;
      const lsa = findChildByLocalName(p, "linesegarray");
      const segEls = lsa ? elements(lsa).filter((s) => ln(s) === "lineseg") : [];
      const pagesOf = [];
      let paraFirst = true;
      for (const s of segEls) {
        const v = num(s, "vertpos");
        const h = num(s, "horzpos");
        if (localCols) {
          if (v < prevV || paraFirst && v === prevV && h <= prevH && v === 0 && prevEnd > v) {
            if (paraFirst && p.getAttribute("pageBreak") === "1") {
              col = 0;
              cur++;
            } else if (++col >= nCol) {
              col = 0;
              cur++;
            }
          }
          if (col > 0)
            s.setAttribute("horzpos", String(h + Math.round(col * (colW + colGap))));
        } else {
          if (paraFirst && pendingEnd > cur) {
            cur = v < pendingEndY - 100 ? pendingEnd + 1 : pendingEnd;
            pendingEnd = 0;
          } else {
            const brk = v < prevV ? !multiCol || h <= prevH : v === prevV && h <= prevH && prevEnd > v && v < BODY_H / 2;
            const pbrk = !brk && paraFirst && prevV !== Number.NEGATIVE_INFINITY && p.getAttribute("pageBreak") === "1" && (v < BODY_H / 2 || buildPara(p).objs.some((o) => !o.inline && (o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM") === "TOP_AND_BOTTOM" && (findChildByLocalName(o.el, "pos")?.getAttribute("vertRelTo") ?? "PARA") === "PARA" && linePushedBy(o, v, 0)));
            const obrk = !brk && !pbrk && !multiCol && paraFirst && v > prevV && v < prevEnd - 100 && prevEnd + num(s, "vertsize") > BODY_H && v < BODY_H / 2;
            if (brk || pbrk || obrk)
              cur++;
            if (brk && prevSeg && prevV + prevSeg.vs > BODY_H && v === prevSeg.vs + prevSeg.sp && prevSeg.pages[prevSeg.idx] === cur - 1) {
              prevSeg.pages[prevSeg.idx] = cur;
              prevSeg.s.setAttribute("vertpos", "0");
              if (prevSeg.idx === 0)
                paraTops.set(prevSeg.p, 0);
              if (prevSeg.p !== p) {
                lastPage = cur;
                lastEnd = v;
                lastSA = 0;
              }
            }
          }
        }
        paraFirst = false;
        pagesOf.push(cur);
        prevSeg = { s, p, pages: pagesOf, idx: pagesOf.length - 1, vs: num(s, "vertsize"), sp: num(s, "spacing") };
        maxTopV = Math.max(maxTopV, v + num(s, "textheight", 1e3));
        prevV = v;
        prevH = h;
        prevEnd = v + num(s, "vertsize") + num(s, "spacing");
      }
      paraSegPages.set(p, pagesOf);
      const prevEnd0 = lastEnd, prevPage0 = lastPage;
      if (segEls.length)
        paraTops.set(p, pagesOf[0] === lastPage ? lastEnd + lastSA : 0);
      if (segEls.length) {
        const ls = segEls[segEls.length - 1];
        lastEnd = num(ls, "vertpos") + num(ls, "vertsize") + num(ls, "spacing");
        lastPage = pagesOf[pagesOf.length - 1];
        lastSA = geom0.get(p.getAttribute("paraPrIDRef") ?? "")?.spaceAfter ?? 0;
      }
      if (!localCols && segEls.length) {
        const m0 = buildPara(p);
        for (const o of m0.objs) {
          if (o.tag !== "tbl")
            continue;
          const pos = findChildByLocalName(o.el, "pos"), om = findChildByLocalName(o.el, "outMargin");
          if (!o.inline && (pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
            continue;
          const segK = Math.max(0, m0.segs.findIndex((sg, k) => sg.textpos <= o.index && (k === m0.segs.length - 1 || m0.segs[k + 1].textpos > o.index)));
          const segV = num(segEls[segK], "vertpos");
          const h = Math.max(o.height, measureTableHeight(o.el, ctxBase.extentMemo)), omT = num(om, "top"), omB = num(om, "bottom");
          const pushed = segV - (omT + h + omB);
          if (!o.inline && segK === 0 && pushed < -100 && prevPage0 >= 0 && pagesOf[0] === prevPage0 + 1 && (o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM") === "TOP_AND_BOTTOM") {
            const back = tableContPages(o.el, MT + prevEnd0 + omT, MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H, cellFloatSpan(MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H));
            if (back.pages === 1 && Math.abs(back.endY - MT + omB - segV) <= 300) {
              backPlace.set(o.el, { page: prevPage0, y: MT + prevEnd0 + omT });
              continue;
            }
          }
          const nTb = m0.objs.filter((q) => !q.inline && (q.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM") === "TOP_AND_BOTTOM").length;
          const wrapP = o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM";
          const pTop = paraTops.get(p), sbP = m0.paraPrId != null ? geom0.get(m0.paraPrId)?.spaceBefore ?? 0 : 0;
          const stay = nTb < 2 && !m0.objs.some((q) => q.inline) && !m0.chars.some((c) => c.ch !== "" && !c.nb && c.ch.trim() !== "") && !(!o.inline && wrapP === "TOP_AND_BOTTOM" && linePushedBy(o, segV, pTop));
          const nonPush = wrapP !== "TOP_AND_BOTTOM" && pTop !== void 0 && segV > pTop + sbP + 100 ? pTop + sbP : void 0;
          const voP = Math.max(0, toInt32(pos?.getAttribute("vertOffset") ?? void 0, 0));
          const paraStart = segK === 0 && pTop !== void 0 && pTop < segV ? pTop : segV;
          const below = !o.inline && wrapP === "TOP_AND_BOTTOM" && voP + omT >= num(segEls[segK], "textheight") && !linePushedBy(o, segV, pTop);
          const ty = o.inline ? MT + segV + omT : nonPush !== void 0 ? MT + nonPush + omT + voP : MT + (below ? segV - (segK === 0 ? sbP : 0) : stay ? segV - sbP : pushed - voP >= -100 ? pushed - voP : paraStart) + omT + voP;
          const span = tableContPages(o.el, ty, MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H, cellFloatSpan(MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H));
          const anchorPage = pagesOf[segK];
          const sp = !o.inline && !stay && nonPush === void 0 && segV - (omT + o.height + omB) >= -100 && pagesOf.some((pg, j) => j > segK && pg > anchorPage) ? tableContPages(o.el, MT + segV - o.height - omB, MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H, cellFloatSpan(MT, BODY_H, ctxBase.extentMemo, PH - MT - BODY_H)) : void 0;
          if (sp && sp.pages > 0) {
            for (let j = segK + 1; j < pagesOf.length; j++)
              if (pagesOf[j] > anchorPage)
                pagesOf[j] += sp.pages;
            cur += sp.pages;
            lastPage = pagesOf[pagesOf.length - 1];
            continue;
          }
          if (span.pages > 0 && (pagesOf[0] ?? cur) + span.pages > pendingEnd) {
            pendingEnd = (pagesOf[0] ?? cur) + span.pages;
            pendingEndY = span.endY - MT;
          }
        }
      }
      nPages = Math.max(nPages, cur + 1, pendingEnd + 1);
      tableEndPage = Math.max(tableEndPage, pendingEnd);
    }
  }
  if (lastSection) {
    let lastContent = -1;
    for (const p of elements(root)) {
      if (ln(p) !== "p")
        continue;
      const pg = paraSegPages.get(p);
      if (!pg?.length)
        continue;
      const pm = buildPara(p);
      if (pm.objs.length || pm.chars.some((c) => c.ch.trim() !== "" || !!c.ctrlText))
        lastContent = Math.max(lastContent, ...pg);
    }
    const contentOnly = lastContent;
    lastContent = Math.max(lastContent, tableEndPage);
    let keepTrail = false;
    if (lastContent >= 0 && nPages - 1 > lastContent && tableEndPage <= contentOnly) {
      let firstTrail;
      for (const p of elements(root))
        if (ln(p) === "p" && (paraSegPages.get(p) ?? []).some((x) => x > lastContent)) {
          firstTrail = p;
          break;
        }
      let fits = true;
      for (const p of elements(root)) {
        if (ln(p) !== "p")
          continue;
        const pg = paraSegPages.get(p);
        if (!pg?.includes(lastContent))
          continue;
        const pm = buildPara(p);
        pm.segs.forEach((sg, k) => {
          if (pg[k] !== lastContent)
            return;
          let h = sg.textheight;
          for (const o of pm.objs)
            if (o.inline)
              h = Math.max(h, o.height);
          if (sg.vertpos + h > BODY_H)
            fits = false;
        });
      }
      keepTrail = !!firstTrail && firstTrail.getAttribute("pageBreak") !== "1" && fits;
    }
    if (lastContent >= 0 && nPages - 1 > lastContent && !keepTrail) {
      for (const [p, pg] of paraSegPages)
        if (pg.some((x) => x > lastContent))
          paraSegPages.set(p, pg.map((x) => Math.min(x, lastContent)));
      nPages = lastContent + 1;
    }
  }
  const pageH = nPages === 1 ? Math.max(PH, MT + maxTopV + 2e3) : PH;
  const ens = endNoteLayout(root, paraSegPages, geom);
  const ctx = {
    ...ctxBase,
    pages: Array.from({ length: Math.max(nPages, ens?.pageCount ?? 0) }, () => []),
    page: 0,
    geom,
    pageH,
    paintJobs: [],
    regionRotations: []
  };
  const mirrorDx = (page) => geom.mirrorDx && (ctx.pageBase + page + 1) % 2 === 0 ? geom.mirrorDx : 0;
  for (const story of pageStories(root, masters, paraSegPages, ctx.pages.length, ctx.pageBase, geom)) {
    prepareDeletedRanges(story.sub);
    if (doReflow)
      reflowSection(story.sub, ctx.styles, { BODY_W: story.width, BODY_H: 0 }, reflowMode);
    const draw = () => {
      ctx.page = story.page;
      for (const p of elements(story.sub))
        if (ln(p) === "p")
          drawPara(p, story.x + mirrorDx(story.page), story.y, story.width, ctx, 0);
    };
    if (story.layer !== void 0)
      ctx.paintJobs.push({ page: story.page, layer: story.layer, z: 0, draw });
    else
      draw();
  }
  ctx.page = 0;
  const bodyStart = ctx.pages.map((b) => b.length);
  if (geom.mirrorDx)
    ctx.bodyDx = mirrorDx;
  ctx.cols = multiCol ? { w: colW, gap: colGap } : void 0;
  ctx.paraTops = paraTops;
  if (backPlace.size)
    ctx.objPlace = new Map([...ctx.objPlace ?? [], ...backPlace]);
  for (const p of elements(root)) {
    if (ln(p) !== "p")
      continue;
    drawPara(p, ML, MT, BODY_W, ctx, 0, paraSegPages.get(p));
  }
  ctx.cols = void 0;
  ctx.paraTops = void 0;
  const notes = footNoteStories(root, paraSegPages, geom);
  for (const r of notes.rules) {
    ctx.page = r.page;
    emit(ctx, `<line x1="${pt(r.x)}" y1="${pt(r.y)}" x2="${pt(r.x + r.length)}" y2="${pt(r.y)}" stroke="${escapeXml(r.color)}" stroke-width="${(r.widthMm * 2.834645).toFixed(2)}"/>`);
  }
  for (const story of notes.stories) {
    ctx.page = story.page;
    for (const p of elements(story.sub))
      if (ln(p) === "p")
        drawPara(p, story.x, story.y, story.width, ctx, 0);
  }
  if (ens) {
    for (const r of ens.rules) {
      ctx.page = r.page;
      emit(ctx, `<line x1="${pt(r.x)}" y1="${pt(r.y)}" x2="${pt(r.x + r.length)}" y2="${pt(r.y)}" stroke="${escapeXml(r.color)}" stroke-width="${(r.widthMm * 2.834645).toFixed(2)}"/>`);
    }
    ctx.cols = multiCol ? { w: colW, gap: colGap } : void 0;
    for (const e of ens.paras)
      drawPara(e.p, ML, MT, BODY_W, ctx, 0, e.pages);
    ctx.cols = void 0;
  }
  const wrapMirror = (bufs, from) => {
    for (let page = 0; page < bufs.length; page++) {
      const dx = mirrorDx(page), at = from(page);
      if (!dx || !bufs[page] || bufs[page].length <= at)
        continue;
      bufs[page].splice(at, 0, `<g transform="translate(${pt(dx)} 0)">`);
      bufs[page].push("</g>");
    }
  };
  ctx.bodyDx = void 0;
  wrapMirror(ctx.pages, (page) => bodyStart[page] ?? 0);
  const allPages = new Map(paraSegPages);
  for (const e of ens?.paras ?? [])
    allPages.set(e.p, e.pages);
  drawPageDecor(root, allPages, ctx, localCols ? nCol : 1, colW, colGap);
  drawPageNumbers(root, paraSegPages, ctx);
  ctx.page = 0;
  const normal = ctx.pages;
  const jobs = ctx.paintJobs;
  ctx.paintJobs = null;
  const behind = Array.from({ length: ctx.pages.length }, () => []);
  const front = Array.from({ length: ctx.pages.length }, () => []);
  for (const job of jobs.sort((a, b) => a.layer - b.layer || a.z - b.z)) {
    ctx.pages = job.layer < 0 ? behind : front;
    const before = ctx.pages.map((b) => b.length);
    ctx.bodyDx = job.body ? mirrorDx : void 0;
    job.draw();
    ctx.bodyDx = void 0;
    if (job.body && geom.mirrorDx)
      wrapMirror(ctx.pages, (page) => before[page] ?? 0);
  }
  const total = Math.max(normal.length, behind.length, front.length);
  ctx.pages = Array.from({ length: total }, (_, page) => [...behind[page] ?? [], ...normal[page] ?? [], ...front[page] ?? []]);
  return { pages: ctx.pages, pageH };
}
function drawPageDecor(root, paraPages, ctx, nCol, colW, colGap) {
  const { PW, PH, ML, MT } = ctx.geom;
  const secPr = findFirst(root, "secPr");
  const fills = secPr ? elements(secPr).filter((e) => ln(e) === "pageBorderFill") : [];
  const pageBottoms = /* @__PURE__ */ new Map();
  if (nCol > 1) {
    for (const p of elements(root))
      if (ln(p) === "p") {
        const lsa = findChildByLocalName(p, "linesegarray"), pages = paraPages.get(p) ?? [];
        elements(lsa ?? p).filter((e) => ln(e) === "lineseg").forEach((seg, k) => {
          const pg = pages[k] ?? pages[0] ?? 0;
          pageBottoms.set(pg, Math.max(pageBottoms.get(pg) ?? 0, num(seg, "vertpos") + num(seg, "vertsize")));
        });
      }
  }
  const colPr = findFirst(root, "colPr"), colLine = colPr ? findChildByLocalName(colPr, "colLine") : null;
  for (let page = 0; page < ctx.pages.length; page++) {
    const n = ctx.pageBase + page + 1;
    const visible = (f) => {
      const b = f ? ctx.styles.borderFill.get(f.getAttribute("borderFillIDRef") ?? "") : void 0;
      return b && (b.top || b.bottom || b.left || b.right || b.fill) ? b : void 0;
    };
    const both = fills.find((f) => (f.getAttribute("type") ?? "BOTH") === "BOTH"), parity = fills.find((f) => f.getAttribute("type") === (n % 2 ? "ODD" : "EVEN"));
    const pf = visible(both) ? both : parity;
    const bf = visible(pf);
    ctx.page = page;
    if (pf && bf && (bf.top || bf.bottom || bf.left || bf.right || bf.fill)) {
      const off = findChildByLocalName(pf, "offset");
      const x0 = num(off, "left"), y0 = num(off, "top"), x1 = PW - num(off, "right"), y1 = PH - num(off, "bottom");
      if (bf.fill && pf.getAttribute("fillArea") !== "NONE")
        ctx.pages[page].unshift(`<rect x="${pt(x0)}" y="${pt(y0)}" width="${pt(x1 - x0)}" height="${pt(y1 - y0)}" fill="${escapeXml(bf.fill)}"/>`);
      if (bf.top)
        emit(ctx, edgeLine(x0, y0, x1, y0, bf.top));
      if (bf.bottom)
        emit(ctx, edgeLine(x0, y1, x1, y1, bf.bottom));
      if (bf.left)
        emit(ctx, edgeLine(x0, y0, x0, y1, bf.left));
      if (bf.right)
        emit(ctx, edgeLine(x1, y0, x1, y1, bf.right));
    }
    const bottom = pageBottoms.get(page);
    if (colLine && (colLine.getAttribute("type") ?? "NONE") !== "NONE" && bottom) {
      const edge = { type: colLine.getAttribute("type") ?? "SOLID", widthPt: (Number.parseFloat(colLine.getAttribute("width") ?? "0.12") || 0.12) * 2.834645, color: colLine.getAttribute("color") ?? "#000000" };
      for (let c = 1; c < nCol; c++) {
        const x = ML + c * (colW + colGap) - colGap / 2;
        emit(ctx, edgeLine(x, MT, x, MT + bottom, edge));
      }
    }
  }
}
function drawPageNumbers(root, paraPages, ctx) {
  let decl;
  const hidden = /* @__PURE__ */ new Set();
  const restarts = [];
  for (const p of elements(root))
    if (ln(p) === "p") {
      const page = paraPages.get(p)?.[0] ?? 0;
      for (const run of elements(p))
        if (ln(run) === "run") {
          for (const ctrl of elements(run))
            if (ln(ctrl) === "ctrl") {
              const pn = findChildByLocalName(ctrl, "pageNum"), ph = findChildByLocalName(ctrl, "pageHiding"), nn = findChildByLocalName(ctrl, "newNum");
              if (pn && !decl)
                decl = { el: pn, page, prId: run.getAttribute("charPrIDRef") };
              if (ph && num(ph, "hidePageNum"))
                hidden.add(page);
              if (nn && (nn.getAttribute("numType") ?? "PAGE") === "PAGE")
                restarts.push({ page, num: num(nn, "num", 1) });
            }
        }
    }
  if (!decl)
    return;
  const pos = decl.el.getAttribute("pos") ?? "BOTTOM_CENTER";
  if (pos === "NONE")
    return;
  const side = decl.el.getAttribute("sideChar") ?? "";
  const pnId = ctx.styles.pageNumCharPr ?? decl.prId;
  const st = (pnId != null ? ctx.styles.charPr.get(pnId) : void 0) ?? DEFAULT_CHAR;
  const { PH, ML, BODY_W } = ctx.geom;
  const pagePr = findFirst(root, "pagePr"), margin = pagePr ? findChildByLocalName(pagePr, "margin") : null;
  const h = 1e3;
  for (let page = decl.page; page < ctx.pages.length; page++) {
    if (hidden.has(page))
      continue;
    const restart = restarts.filter((r) => r.page <= page).pop();
    const n = restart ? restart.num + page - restart.page : ctx.pageBase + page + 1;
    const text = side ? `${side} ${formatHeadNumber(n, decl.el.getAttribute("formatType") ?? "DIGIT")} ${side}` : formatHeadNumber(n, decl.el.getAttribute("formatType") ?? "DIGIT");
    const w = measureTextWidth(text, h, 100, { faceClass: faceClassOf(st.face) });
    const x = /LEFT/.test(pos) ? ML : /RIGHT/.test(pos) ? ML + BODY_W - w : ML + (BODY_W - w) / 2;
    const y = /^TOP/.test(pos) ? num(margin, "top", 5668) - 225 : num(margin, "footer", 0) > 0 ? PH - num(margin, "bottom", 4252) - 225 : PH - Math.round(num(margin, "bottom", 4252) / 2) - 243;
    const attrs = [`x="${pt(x)}"`, `y="${pt(y)}"`, `font-size="${pt(h)}"`];
    if (st.fontFamily)
      attrs.push(`font-family="${escapeXml(st.fontFamily)}"`);
    ctx.page = page;
    emit(ctx, `<text ${attrs.join(" ")}>${escapeXml(text)}</text>`);
  }
}
function renderSectionRoots(sections, input) {
  const ctxBase = {
    draw: { table: drawTable, pic: drawPic, picFrame: drawPicFrame },
    styles: input.styles,
    images: input.images,
    defs: [],
    highlights: (input.highlights ?? []).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
    warnings: input.warnings,
    warned: /* @__PURE__ */ new Set(),
    stats: { texts: 0, images: 0, tables: 0, shapes: 0 },
    extentMemo: { cell: /* @__PURE__ */ new WeakMap(), table: /* @__PURE__ */ new WeakMap(), paraGeom: input.styles.paraGeom },
    regions: new RegionCollector(),
    parentStack: [],
    pageBase: 0,
    nums: /* @__PURE__ */ new Map()
  };
  const rendered = [];
  const hasContent = (root) => elements(root).some((p) => {
    if (ln(p) !== "p")
      return false;
    const pm = buildPara(p);
    return pm.objs.length > 0 || pm.chars.some((c) => c.ch.trim() !== "" || !!c.ctrlText);
  });
  let lastIdx = sections.length - 1;
  while (lastIdx > 0 && !hasContent(sections[lastIdx].root))
    lastIdx--;
  for (const [k, { root, index, masterPages, hasDeletionMarkers }] of sections.entries()) {
    if (k > lastIdx)
      break;
    const geom = readSectionGeom(root);
    const { pages, pageH } = renderSectionToPages(root, geom, ctxBase, input.reflow, input.reflowMode, masterPages, hasDeletionMarkers, k === lastIdx);
    rendered.push({ pages, PW: geom.PW, pageH, clipId: `pgclip${index}` });
    ctxBase.pageBase += pages.length;
  }
  if (rendered.length === 0)
    throw new KordocError("\uB80C\uB354\uD560 \uAD6C\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4");
  return { sections: rendered, defs: ctxBase.defs, warnings: input.warnings, stats: ctxBase.stats, regions: ctxBase.regions.regions };
}
const SVG_FONT_FAMILY = `'HCR Batang','\uD568\uCD08\uB86C\uBC14\uD0D5','Hancom Batang',AppleMyungjo,'Noto Serif CJK KR',serif`;
async function renderHwpxInternal(input, options) {
  const maxImg = options?.maxImageBytes ?? 40 * 1024 * 1024;
  const ab = input instanceof Uint8Array ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input;
  precheckZipSize(ab, MAX_DECOMPRESS_SIZE, MAX_ZIP_ENTRIES);
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new KordocError("HWPX(ZIP) \uD615\uC2DD\uC774 \uC544\uB2D9\uB2C8\uB2E4 \u2014 \uB80C\uB354\uB294 HWPX\uB9CC \uC9C0\uC6D0");
  }
  const secFiles = zip.file(/Contents\/section\d+\.xml$/i).sort((a, b) => compareSectionPaths(a.name, b.name));
  if (secFiles.length === 0)
    throw new KordocError("Contents/section0.xml \uC5C6\uC74C \u2014 HWPX\uAC00 \uC544\uB2C8\uAC70\uB098 \uC190\uC0C1\uB428");
  const warnings = [];
  const headFile = zip.file("Contents/header.xml") ?? zip.file("Contents/head.xml");
  const verFile = zip.file("version.xml");
  const verXml = verFile ? await readZipEntry(verFile, "text") : void 0;
  const appMajor = hwpxAppMajor(verXml), appBuild = hwpxAppBuild(verXml);
  const headXml = headFile ? await readZipEntry(headFile, "text") : void 0;
  let styles = headXml ? parseRenderStyles(headXml, { appMajor, appBuild }) : { charPr: /* @__PURE__ */ new Map(), paraAlign: /* @__PURE__ */ new Map(), paraGeom: /* @__PURE__ */ new Map(), borderFill: /* @__PURE__ */ new Map() };
  if (!headFile)
    warnings.push("header.xml \uC5C6\uC74C \u2014 \uAE30\uBCF8 \uC2A4\uD0C0\uC77C\uB85C \uB80C\uB354");
  const secXmls = [];
  for (const f of secFiles) {
    const xml = await readZipEntry(f, "text");
    if (xml.length > MAX_DECOMPRESS_SIZE)
      throw new KordocError("\uC139\uC158 XML\uC774 \uD5C8\uC6A9 \uD06C\uAE30\uB97C \uCD08\uACFC");
    secXmls.push(xml);
  }
  if (headXml && hasKoPubSubst(headXml)) {
    const alt = parseRenderStyles(headXml, { appMajor, appBuild, substKoPub: true });
    if (kopubSubstituted(secXmls, styles, alt))
      styles = alt;
  }
  const masterPages = /* @__PURE__ */ new Map();
  const masterXmls = [];
  for (const file of zip.file(/Contents\/masterpage[^/]*\.xml$/i)) {
    const xml = await readZipEntry(file, "text");
    if (xml.length > MAX_DECOMPRESS_SIZE)
      throw new KordocError("\uBC14\uD0D5\uCABD XML\uC774 \uD5C8\uC6A9 \uD06C\uAE30\uB97C \uCD08\uACFC");
    const root = createXmlParser().parseFromString(xml, "text/xml").documentElement;
    if (root && ln(root) === "masterPage") {
      masterPages.set(root.getAttribute("id") || file.name.replace(/^.*\/|\.xml$/g, ""), root);
      masterXmls.push(xml);
    }
  }
  const binmap = /* @__PURE__ */ new Map();
  const hpf = zip.file(/content\.hpf$/i)[0];
  if (hpf) {
    const man = await readZipEntry(hpf, "text");
    for (const m of man.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bhref="(BinData\/[^"]+)"[^>]*>/g))
      binmap.set(m[1], m[2]);
    for (const m of man.matchAll(/<[^>]*\bhref="(BinData\/[^"]+)"[^>]*\bid="([^"]+)"[^>]*>/g))
      binmap.set(m[2], m[1]);
  }
  const MAX_IMAGE_REFS = 256;
  const MAX_TOTAL_IMAGE_BYTES = 128 * 1024 * 1024;
  const images = /* @__PURE__ */ new Map();
  const refs = /* @__PURE__ */ new Set();
  for (const xml of [...secXmls, ...masterXmls])
    for (const m of xml.matchAll(/binaryItemIDRef="([^"]+)"/g))
      refs.add(m[1]);
  let totalImgBytes = 0;
  for (const ref of refs) {
    if (images.size >= MAX_IMAGE_REFS) {
      warnings.push(`\uC774\uBBF8\uC9C0 ${refs.size}\uC885 \uC911 ${MAX_IMAGE_REFS}\uC885\uB9CC \uB85C\uB529 \u2014 \uAC1C\uC218 \uD55C\uB3C4 \uCD08\uACFC\uBD84 \uC0DD\uB7B5`);
      break;
    }
    let href = binmap.get(ref);
    if (!href) {
      const cand = zip.file(new RegExp(`BinData/.*${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"))[0];
      href = cand?.name;
    }
    if (!href)
      continue;
    const f = zip.file(href) ?? zip.file("Contents/" + href);
    if (!f)
      continue;
    const bytes = await readZipEntry(f, "uint8array");
    if (bytes.length > maxImg) {
      warnings.push(`\uC774\uBBF8\uC9C0 ${href} ${(bytes.length / 1048576).toFixed(1)}MB \u2014 \uD55C\uB3C4 \uCD08\uACFC\uB85C \uC0DD\uB7B5`);
      continue;
    }
    if (totalImgBytes + bytes.length > MAX_TOTAL_IMAGE_BYTES) {
      warnings.push(`\uC774\uBBF8\uC9C0 \uB204\uC801 ${Math.round(MAX_TOTAL_IMAGE_BYTES / 1048576)}MB \uD55C\uB3C4 \uCD08\uACFC \u2014 \uC774\uD6C4 \uC0DD\uB7B5`);
      break;
    }
    totalImgBytes += bytes.length;
    images.set(ref, { dataUri: `data:${sniffMime(href, bytes)};base64,${browserBase64(bytes)}` });
  }
  const roots = [];
  let noCacheSkipped = false;
  const lastParity = /* @__PURE__ */ new Map();
  for (let si = 0; si < secXmls.length; si++) {
    const secXml = secXmls[si];
    const hasCache = /<(?:[A-Za-z][\w.-]*:)?linesegarray[\s/>]/.test(secXml);
    if (!hasCache && !options?.reflow) {
      noCacheSkipped = true;
      warnings.push(`\uAD6C\uC5ED ${si}: \uC870\uD310 \uCE90\uC2DC \uC5C6\uC74C \u2014 reflow \uC635\uC158 \uD544\uC694, \uC0DD\uB7B5`);
      continue;
    }
    const doc = createXmlParser().parseFromString(secXml, "text/xml");
    const root = doc.documentElement;
    if (!root) {
      warnings.push(`\uAD6C\uC5ED ${si} XML \uD30C\uC2F1 \uC2E4\uD328 \u2014 \uC0DD\uB7B5`);
      continue;
    }
    const secPr = findFirst(root, "secPr");
    const referenced = secPr ? elements(secPr).filter((el) => ln(el) === "masterPage").map((el) => masterPages.get(el.getAttribute("idRef") || "")).filter((el) => !!el) : [];
    const typeOf = (m) => m.getAttribute("type") || "BOTH";
    const has = (t) => referenced.some((m) => typeOf(m) === t);
    if (!has("BOTH"))
      for (const [t, other] of [["EVEN", "ODD"], ["ODD", "EVEN"]]) {
        const prev = lastParity.get(t);
        if (prev && !has(t) && has(other))
          referenced.unshift(prev);
      }
    for (const m of referenced)
      if (typeOf(m) === "EVEN" || typeOf(m) === "ODD")
        lastParity.set(typeOf(m), m);
    if (has("BOTH"))
      lastParity.clear();
    roots.push({ root, index: si, masterPages: referenced, hasDeletionMarkers: secXml.includes("deleteBegin") || secXml.includes("deleteEnd") });
  }
  if (roots.length === 0) {
    if (noCacheSkipped) {
      throw new KordocError("\uC870\uD310 \uCE90\uC2DC(linesegarray) \uC5C6\uC74C \u2014 \uD55C\uCEF4\uC5D0\uC11C \uC800\uC7A5\uD55C HWPX\uB9CC \uB80C\uB354 \uAC00\uB2A5 (reflow \uC635\uC158\uC73C\uB85C \uD569\uC131 \uB80C\uB354 \uAC00\uB2A5)");
    }
    throw new KordocError("\uB80C\uB354\uD560 \uAD6C\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 HWPX\uAC00 \uC190\uC0C1\uB418\uC5C8\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4");
  }
  return renderSectionRoots(roots, { styles, images, warnings, reflow: !!options?.reflow, reflowMode: options?.reflowMode ?? "keep", highlights: options?.highlights });
}
async function renderHwpxToSvg(input, options) {
  const r = await renderHwpxInternal(input, options);
  const GAP = 2400;
  const clipDefs = [];
  const groups = [];
  let y = 0;
  let maxPW = 0;
  let pageNo2 = 0;
  for (const rs of r.sections) {
    maxPW = Math.max(maxPW, rs.PW);
    clipDefs.push(`<clipPath id="${rs.clipId}"><rect x="0" y="0" width="${pt(rs.PW)}" height="${pt(rs.pageH)}"/></clipPath>`);
    for (const buf of rs.pages) {
      pageNo2++;
      groups.push(
        `<g data-page="${pageNo2}" transform="translate(0 ${pt(y)})"><rect width="${pt(rs.PW)}" height="${pt(rs.pageH)}" fill="white" stroke="#c9c7c4" stroke-width="0.75"/><g clip-path="url(#${rs.clipId})">
${buf.join("\n")}
</g></g>`
      );
      y += rs.pageH + GAP;
    }
  }
  const totalH = Math.max(0, y - GAP);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pt(maxPW)} ${pt(totalH)}" width="${pt(maxPW)}pt" height="${pt(totalH)}pt" font-family="${SVG_FONT_FAMILY}" xml:space="preserve">
<defs>${clipDefs.join("")}${r.defs.join("")}</defs>
${groups.join("\n")}
</svg>`;
  return { svg, width: Math.round(maxPW) / 100, height: Math.round(totalH) / 100, pageCount: pageNo2, warnings: r.warnings, stats: r.stats, regions: r.regions };
}
function assemblePageSvgs(r, format, select) {
  const pages = [];
  const pageSvgs = /* @__PURE__ */ new Map();
  const pageCount = r.sections.reduce((n, rs) => n + rs.pages.length, 0);
  const chosen = typeof select === "function" ? select(pageCount) : select;
  let pageNo2 = 0;
  for (const rs of r.sections) {
    for (const buf of rs.pages) {
      pageNo2++;
      pages.push({ page: pageNo2, width: ptNum(rs.PW), height: ptNum(rs.pageH) });
      if (chosen && !chosen.has(pageNo2))
        continue;
      const body = buf.join("\n");
      const used = /* @__PURE__ */ new Set();
      for (const m of body.matchAll(/href="#(bin\d+)"/g))
        used.add(m[1]);
      const defs = r.defs.filter((d) => {
        const m = /<symbol id="(bin\d+)"/.exec(d);
        return m ? used.has(m[1]) : true;
      });
      const clipId = `pgclip${pageNo2}`;
      pageSvgs.set(
        pageNo2,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pt(rs.PW)} ${pt(rs.pageH)}" width="${pt(rs.PW)}pt" height="${pt(rs.pageH)}pt" font-family="${SVG_FONT_FAMILY}" xml:space="preserve" data-page="${pageNo2}">
<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${pt(rs.PW)}" height="${pt(rs.pageH)}"/></clipPath>${defs.join("")}</defs>
<rect width="${pt(rs.PW)}" height="${pt(rs.pageH)}" fill="white"/>
<g clip-path="url(#${clipId})">
${body}
</g>
</svg>`
      );
    }
  }
  const scene = { format, pages, regions: r.regions, warnings: r.warnings, stats: { texts: r.stats.texts, tables: r.stats.tables, images: r.stats.images, shapes: r.stats.shapes } };
  return { scene, pageSvgs };
}
async function renderHwpxPages(input, options, select) {
  const r = await renderHwpxInternal(input, options);
  return assemblePageSvgs(r, "hwpx", select);
}
export {
  assemblePageSvgs,
  buildPara2 as buildPara,
  escapeXml2 as escapeXml,
  measureTableHeight2 as measureTableHeight,
  renderHwpxPages,
  renderHwpxToSvg,
  renderSectionRoots,
  tabAdvance2 as tabAdvance
};
