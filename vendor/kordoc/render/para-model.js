// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/para-model.ts. MIT; see LICENSE.
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { noteAttrsOf, noteAutoNumOf, noteRefMark, readSectionNoteFormats } from "../hwpx/notes.js";
import { toInt32, solveRowHeights } from "./layout.js";
function ln(el) {
  return (el.tagName || "").replace(/^[^:]+:/, "");
}
function elements(el) {
  const out = [];
  const children = el.childNodes;
  if (!children)
    return out;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeType === 1)
      out.push(children[i]);
  }
  return out;
}
function num(el, attr, fallback = 0) {
  return el ? toInt32(el.getAttribute(attr) ?? void 0, fallback) : fallback;
}
function findFirst(el, name, depth = 0) {
  if (depth > 64)
    return null;
  for (const ch of elements(el)) {
    if (ln(ch) === name)
      return ch;
    const found = findFirst(ch, name, depth + 1);
    if (found)
      return found;
  }
  return null;
}
const FORM_TAGS = /* @__PURE__ */ new Set(["checkBtn", "radioBtn", "btn", "comboBox", "listBox", "edit", "scrollBar"]);
const OBJ_TAGS = /* @__PURE__ */ new Set(["tbl", "pic", "container", "equation", "rect", "ellipse", "polygon", "curv", "curve", "line", "arc", "ole", "textart", ...FORM_TAGS]);
const CHAR_CTRL_1SLOT = /* @__PURE__ */ new Set(["lineBreak", "hyphen", "hypen", "nbSpace", "fwSpace"]);
const noteFmtCache = /* @__PURE__ */ new WeakMap();
function sectionNoteFormats(p) {
  const root = p.ownerDocument?.documentElement;
  if (!root)
    return {};
  let f = noteFmtCache.get(root);
  if (!f) {
    f = readSectionNoteFormats(root);
    noteFmtCache.set(root, f);
  }
  return f;
}
function pushFillers(chars, n, prId) {
  for (let i = 0; i < n; i++)
    chars.push({ ch: "", prId });
}
function pushTextSlots(t, chars, prId, depth, del = { deleted: 0 }) {
  if (depth > 32)
    return;
  const kids = t.childNodes;
  if (!kids)
    return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.nodeType === 3 || c.nodeType === 4) {
      for (const cp of c.textContent ?? "") {
        chars.push({ ch: del.deleted ? "" : cp, prId });
        if (cp.length === 2)
          chars.push({ ch: "", prId });
      }
    } else if (c.nodeType === 1) {
      const el = c;
      const tag = ln(el);
      if (tag === "deleteBegin" || tag === "deleteEnd") {
        del.deleted = deletionDelta(el, del.deleted);
      } else if (tag === "tab") {
        if (del.deleted)
          pushFillers(chars, 8, prId);
        else {
          const width = num(el, "width", -1);
          chars.push({ ch: "", prId, tab: true, ...width >= 0 ? { tabW: width } : {}, ...el.getAttribute("type") === "2" ? { tabRight: true } : {} });
          pushFillers(chars, 7, prId);
        }
      } else if (tag === "titleMark") {
        pushFillers(chars, 8, prId);
      } else if (CHAR_CTRL_1SLOT.has(tag)) {
        chars.push(del.deleted ? { ch: "", prId } : tag === "nbSpace" ? { ch: " ", prId, nb: true } : tag === "lineBreak" ? { ch: "", prId, br: true } : { ch: tag === "fwSpace" ? "\u2005" : "", prId });
      } else {
        pushTextSlots(el, chars, prId, depth + 1, del);
      }
    }
  }
}
const deletedStarts = /* @__PURE__ */ new WeakMap();
const deletedControls = /* @__PURE__ */ new WeakMap();
function isDeletedControl(el) {
  return deletedControls.get(el) === true;
}
function deletionDelta(ctrl, depth, xmlDepth = 0) {
  if (xmlDepth > 64)
    return depth;
  if (ln(ctrl) === "deleteBegin")
    return depth + 1;
  if (ln(ctrl) === "deleteEnd")
    return Math.max(0, depth - 1);
  if (ln(ctrl) === "ctrl")
    for (const ch of elements(ctrl))
      depth = deletionDelta(ch, depth, xmlDepth + 1);
  return depth;
}
function prepareDeletedRanges(root, depth = 0) {
  if (depth > 64)
    return;
  let deleted = 0;
  for (const p of elements(root)) {
    if (ln(p) !== "p")
      continue;
    deletedStarts.set(p, deleted);
    const scan = (el, xmlDepth) => {
      if (xmlDepth > 64)
        return;
      if (ln(el) === "ctrl" || ln(el) === "t")
        for (const ch of elements(el))
          scan(ch, xmlDepth + 1);
      else {
        if (ln(el) === "deleteBegin" || ln(el) === "deleteEnd")
          deleted = deletionDelta(el, deleted);
        deletedControls.set(el, deleted > 0);
      }
    };
    for (const ch of elements(p)) {
      if (ln(ch) === "run")
        for (const el of elements(ch))
          scan(el, depth + 2);
      else if (ln(ch) === "deleteBegin" || ln(ch) === "deleteEnd")
        scan(ch, depth + 1);
    }
  }
  function nested(el, depth2) {
    if (depth2 > 64)
      return;
    for (const ch of elements(el)) {
      if (ln(ch) === "subList")
        prepareDeletedRanges(ch, depth2 + 1);
      else
        nested(ch, depth2 + 1);
    }
  }
  nested(root, depth);
}
function buildPara(p) {
  const chars = [];
  const objs = [];
  let segs = [];
  const runs = [];
  let deleted = deletedStarts.get(p) ?? 0;
  let secSlots = 0;
  for (const runEl of elements(p)) {
    const tag = ln(runEl);
    if (tag === "run") {
      const prId = runEl.getAttribute("charPrIDRef");
      runs.push({ at: chars.length, prId });
      for (const ch of elements(runEl)) {
        const cn = ln(ch);
        if (cn === "t") {
          const del = { deleted };
          pushTextSlots(ch, chars, prId, 0, del);
          deleted = del.deleted;
        } else if (OBJ_TAGS.has(cn)) {
          const sz = findChildByLocalName(ch, "sz");
          const pos = findChildByLocalName(ch, "pos");
          const cur = findChildByLocalName(ch, "curSz");
          const rot = num(findChildByLocalName(ch, "rotationInfo"), "angle") % 360;
          const box = findChildByLocalName(ch, "drawText") && !rot && num(cur, "width") > 0 && num(cur, "height") > 0 && num(cur, "height") < 2 ** 31;
          const w = box ? num(cur, "width") : num(sz, "width") || num(cur, "width") || num(findChildByLocalName(ch, "orgSz"), "width");
          const h = box ? num(cur, "height") : num(sz, "height") || num(cur, "height") || num(findChildByLocalName(ch, "orgSz"), "height");
          const inline = pos?.getAttribute("treatAsChar") === "1";
          const om = inline ? findChildByLocalName(ch, "outMargin") : null;
          if (!deleted)
            objs.push({
              el: ch,
              tag: cn,
              index: chars.length,
              inline,
              width: w,
              height: h,
              omL: num(om, "left"),
              omR: num(om, "right")
            });
          pushFillers(chars, 8, prId);
          if (!inline)
            chars[chars.length - 8].ctrl = true;
        } else {
          if (cn === "ctrl" || cn === "deleteBegin" || cn === "deleteEnd")
            deleted = deletionDelta(ch, deleted);
          pushFillers(chars, 8, prId);
          if (cn === "secPr" || cn === "ctrl" && findChildByLocalName(ch, "colPr"))
            secSlots += 8;
          else {
            const slot = chars[chars.length - 8];
            slot.ctrl = true;
            const an = cn === "ctrl" ? findChildByLocalName(ch, "autoNum") : null;
            const note = cn === "ctrl" ? findChildByLocalName(ch, "footNote") ?? findChildByLocalName(ch, "endNote") : null;
            const t = an ? noteAutoNumOf(an) : note ? noteRefMark(noteAttrsOf(note), sectionNoteFormats(p)[ln(note) === "endNote" ? "endnote" : "footnote"]) : "";
            if (t)
              slot.ctrlText = t;
            if (note) {
              slot.ctrlSup = true;
              slot.note = note;
            }
            if (cn === "ctrl" && findChildByLocalName(ch, "fieldEnd"))
              slot.fieldEnd = true;
            if (cn === "compose" && ch.getAttribute("composeText"))
              slot.ctrlText = "\u3000";
          }
        }
      }
    } else if (tag === "deleteBegin" || tag === "deleteEnd") {
      deleted = deletionDelta(runEl, deleted);
    } else if (tag === "linesegarray") {
      segs = elements(runEl).filter((s) => ln(s) === "lineseg").map((s) => {
        const th = num(s, "textheight", 1e3), bl = num(s, "baseline", 850);
        return { textpos: num(s, "textpos"), vertpos: num(s, "vertpos"), horzpos: num(s, "horzpos"), horzsize: num(s, "horzsize"), textheight: th, baseline: bl === 0 && th > 0 ? Math.round(th * 0.85) : bl, spacing: num(s, "spacing") };
      });
    }
  }
  if (secSlots > 0 && segs.length > 1) {
    let lead = 0;
    while (lead < chars.length && chars[lead].ch === "" && !chars[lead].ctrl && !objs.some((o) => o.index === lead))
      lead++;
    if (segs.slice(1).some((s) => s.textpos < lead))
      segs = segs.map((s, k) => k > 0 ? { ...s, textpos: s.textpos + secSlots } : s);
  }
  return { chars, segs, objs, paraPrId: p.getAttribute("paraPrIDRef"), runs };
}
function captionOf(el) {
  const cap = findChildByLocalName(el, "caption");
  const sub = cap ? findChildByLocalName(cap, "subList") : null;
  if (!cap || !sub)
    return null;
  let h = 0;
  for (const p of elements(sub)) {
    if (ln(p) !== "p")
      continue;
    const lsa = findChildByLocalName(p, "linesegarray");
    if (lsa) {
      for (const sg of elements(lsa))
        if (ln(sg) === "lineseg")
          h = Math.max(h, num(sg, "vertpos") + num(sg, "vertsize"));
    }
  }
  const side = cap.getAttribute("side") ?? "BOTTOM";
  return { side, h, gap: num(cap, "gap"), width: num(cap, side === "LEFT" || side === "RIGHT" ? "width" : "lastWidth") || num(cap, "width"), sub };
}
function captionExtra(el) {
  const c = captionOf(el);
  return c && (c.side === "TOP" || c.side === "BOTTOM") ? c.h + c.gap : 0;
}
const DEFAULT_TAB_HU = 4e3;
function paraHeadAdvance(head, offsetHeight, width) {
  return width + (head.offsetPct ? Math.trunc(offsetHeight * head.offset / 100) : head.offset);
}
function tabAdvance(x, firstLine, geom, saved) {
  const hang = geom && geom.marginIntent < 0 ? -geom.marginIntent : 0;
  if (firstLine && geom?.autoTabLeft && hang > 0 && x < hang - 0.5)
    return hang - x;
  if (saved != null && saved >= 0)
    return saved;
  return (Math.floor(x / DEFAULT_TAB_HU) + 1) * DEFAULT_TAB_HU - x;
}
function cellColumns(sub) {
  const p0 = sub ? elements(sub).find((q) => ln(q) === "p") : void 0;
  const cp = p0 ? findFirst(p0, "colPr") : null;
  const n = cp ? Number(cp.getAttribute("colCount")) || 1 : 1;
  return n > 1 ? { n, gap: num(cp, "sameGap") } : null;
}
function cellContentExtent(cell, memo) {
  if (!cell.sub)
    return 0;
  const hit = memo?.cell.get(cell.el);
  if (hit !== void 0)
    return hit;
  const cols = cellColumns(cell.sub);
  let ext = 0;
  let shift = 0, prevV = Number.NEGATIVE_INFINITY, prevH = 0, prevEnd = 0;
  for (const p of elements(cell.sub)) {
    if (ln(p) !== "p")
      continue;
    const m = buildPara(p);
    const paraStart = prevEnd;
    let firstShift = shift;
    const lineTops = [];
    m.segs.forEach((s, k) => {
      if ((s.vertpos < prevV || s.vertpos === prevV && s.horzpos <= prevH && prevEnd - shift > s.vertpos) && !cols)
        shift = prevEnd - s.vertpos;
      if (k === 0)
        firstShift = shift;
      lineTops.push(s.vertpos + shift);
      prevV = s.vertpos;
      prevH = s.horzpos;
      prevEnd = s.vertpos + shift + s.textheight + (s.spacing ?? 0);
      ext = Math.max(ext, s.vertpos + s.textheight + shift);
    });
    const baseV = (m.segs[0]?.vertpos ?? 0) + firstShift;
    for (const o of m.objs) {
      if (o.inline) {
        const h = o.tag === "tbl" ? Math.max(o.height, measureTableHeight(o.el, memo)) : o.height;
        let line = 0;
        while (line + 1 < m.segs.length && m.segs[line + 1].textpos <= o.index)
          line++;
        ext = Math.max(ext, (lineTops[line] ?? baseV) + h);
        continue;
      }
      const pos = findChildByLocalName(o.el, "pos");
      if ((pos?.getAttribute("vertRelTo") ?? "PARA") !== "PARA")
        continue;
      const om = findChildByLocalName(o.el, "outMargin");
      const vo = num(pos, "vertOffset");
      const pushed = baseV - (Math.max(0, vo) + num(om, "top") + o.height + num(om, "bottom"));
      const anchor = pushed >= (paraStart > 0 ? paraStart - 100 : -100) ? pushed : baseV - (memo?.paraGeom?.get(p.getAttribute("paraPrIDRef") ?? "")?.spaceBefore ?? 0);
      const oh = o.tag === "tbl" ? Math.max(o.height, measureTableHeight(o.el, memo)) : o.height;
      ext = Math.max(ext, anchor + num(om, "top") + Math.max(0, vo) + oh + num(om, "bottom"));
    }
  }
  memo?.cell.set(cell.el, ext);
  return ext;
}
function cellMarginOf(cm, side, def) {
  const v = cm ? num(cm, side, def) : def;
  return v >= 32768 ? def : v;
}
function collectCells(tbl) {
  const inMargin = findChildByLocalName(tbl, "inMargin");
  const defL = num(inMargin, "left", 141), defR = num(inMargin, "right", 141);
  const defT = num(inMargin, "top", 141), defB = num(inMargin, "bottom", 141);
  const cells = [];
  for (const tr of elements(tbl)) {
    if (ln(tr) !== "tr")
      continue;
    for (const tc of elements(tr)) {
      if (ln(tc) !== "tc")
        continue;
      const addr = findChildByLocalName(tc, "cellAddr");
      const span = findChildByLocalName(tc, "cellSpan");
      const csz = findChildByLocalName(tc, "cellSz");
      const cm = tc.getAttribute("hasMargin") === "0" ? null : findChildByLocalName(tc, "cellMargin");
      if (!addr || !csz)
        continue;
      cells.push({
        el: tc,
        // 음수 주소(uint32 역변환·손상 입력) 방어 — colX/rowY 인덱스 이탈로 NaN 좌표 방지
        ca: Math.max(0, num(addr, "colAddr")),
        ra: Math.max(0, num(addr, "rowAddr")),
        cs: Math.max(1, num(span, "colSpan", 1)),
        rs: Math.max(1, num(span, "rowSpan", 1)),
        w: num(csz, "width"),
        h: num(csz, "height"),
        bfId: tc.getAttribute("borderFillIDRef"),
        sub: findChildByLocalName(tc, "subList"),
        marginL: cellMarginOf(cm, "left", defL),
        marginR: cellMarginOf(cm, "right", defR),
        marginT: cellMarginOf(cm, "top", defT),
        marginB: cellMarginOf(cm, "bottom", defB)
      });
    }
  }
  return cells;
}
function inCell(el) {
  for (let n = el.parentNode; n; n = n.parentNode)
    if (ln(n) === "tc")
      return true;
  return false;
}
function splitSaved(c) {
  let prev = Number.NEGATIVE_INFINITY;
  for (const p of c.sub ? elements(c.sub) : []) {
    if (ln(p) !== "p")
      continue;
    for (const s of buildPara(p).segs) {
      if (s.vertpos < prev)
        return true;
      prev = s.vertpos;
    }
  }
  return false;
}
function measureTableRowHeights(tbl, memo) {
  const cells = collectCells(tbl);
  if (cells.length === 0 || cells.length > 4096)
    return [];
  const nRows = Math.max(...cells.map((c) => c.ra + c.rs));
  const sp = num(tbl, "cellSpacing");
  const rows = solveRowHeights(
    // 여러 행 칸은 내용(+ 칸 여백)이 저장 높이보다 크면 내용 높이로 — 솔버가 모자란 만큼 그 칸 마지막 행을 키운다
    // (같은 판 PDF: 두 줄 든 2행 병합 칸 내용 2882 > 저장 2564 → 둘째 행이 318 자라고 첫 행은 그대로)
    cells.map((c) => ({ rowAddr: c.ra, rowSpan: c.rs, height: (c.rs > 1 ? Math.max(c.h, cellContentExtent(c, memo) + c.marginT + c.marginB) : c.h) - sp * (c.rs - 1), contentH: cellContentExtent(c, memo) + c.marginT + c.marginB })),
    nRows,
    num(findChildByLocalName(tbl, "sz"), "height") - (sp > 0 ? sp * (nRows + 1) : 0) || Number.POSITIVE_INFINITY,
    !inCell(tbl) && !cells.some((c) => c.ra + c.rs === nRows && splitSaved(c))
  );
  if (sp > 0) {
    for (let r = 0; r < rows.length; r++)
      rows[r] += sp;
    rows[rows.length - 1] += sp;
  }
  return rows;
}
function measureTableHeight(tbl, memo) {
  const hit = memo?.table.get(tbl);
  if (hit !== void 0)
    return hit;
  const rowH = measureTableRowHeights(tbl, memo);
  let sum = 0;
  for (const h of rowH)
    sum += h;
  memo?.table.set(tbl, sum);
  return sum;
}
export {
  CHAR_CTRL_1SLOT,
  DEFAULT_TAB_HU,
  FORM_TAGS,
  OBJ_TAGS,
  buildPara,
  captionExtra,
  captionOf,
  cellColumns,
  cellContentExtent,
  cellMarginOf,
  collectCells,
  elements,
  findFirst,
  isDeletedControl,
  ln,
  measureTableHeight,
  measureTableRowHeights,
  num,
  paraHeadAdvance,
  prepareDeletedRanges,
  pushFillers,
  pushTextSlots,
  tabAdvance
};
