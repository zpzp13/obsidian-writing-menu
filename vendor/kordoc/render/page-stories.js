// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/page-stories.ts. MIT; see LICENSE.
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { elements, findFirst, isDeletedControl, ln, num } from "./para-model.js";
function pageStories(root, masters, paraPages, pageCount, pageBase, geom) {
  const secPr = findFirst(root, "secPr"), visibility = secPr && findChildByLocalName(secPr, "visibility");
  const pagePr = secPr && findChildByLocalName(secPr, "pagePr"), margin = pagePr && findChildByLocalName(pagePr, "margin");
  const declarations = [];
  const hidden = /* @__PURE__ */ new Map();
  for (const p of elements(root))
    if (ln(p) === "p") {
      const page = paraPages.get(p)?.[0] ?? 0;
      for (const run of elements(p))
        if (ln(run) === "run") {
          for (const ctrl of elements(run))
            if (ln(ctrl) === "ctrl") {
              for (const el of elements(ctrl)) {
                if (isDeletedControl(el))
                  continue;
                const kind = ln(el);
                if (kind === "header" || kind === "footer")
                  declarations.push({ el, page, kind });
                else if (kind === "pageHiding") {
                  const kinds = hidden.get(page) ?? /* @__PURE__ */ new Set();
                  for (const name of ["Header", "Footer", "MasterPage"])
                    if (num(el, `hide${name}`))
                      kinds.add(name);
                  hidden.set(page, kinds);
                }
              }
            }
        }
    }
  const parity = (type, n) => type === "BOTH" || type === "ODD" && n % 2 === 1 || type === "EVEN" && n % 2 === 0;
  const out = [];
  for (let page = 0; page < pageCount; page++) {
    const n = pageBase + page + 1;
    const hides = (name) => hidden.get(page)?.has(name) === true || page === 0 && num(visibility, `hideFirst${name}`) !== 0;
    if (!hides("MasterPage")) {
      const matching = masters.filter((m) => m.getAttribute("type") === (n % 2 ? "ODD" : "EVEN"));
      const both = masters.filter((m) => (m.getAttribute("type") || "BOTH") === "BOTH");
      const normal = (matching.length ? matching : both).slice(-1);
      const specific = masters.filter((m) => m.getAttribute("type") === "LAST_PAGE" ? page === pageCount - 1 : m.getAttribute("type") === "OPTIONAL_PAGE" && num(m, "pageNumber") === page + 1);
      const special = specific.slice(-1);
      const selected = special.length && !num(special[0], "pageDuplicate") ? special : [...normal, ...special];
      for (const master of selected) {
        const sub = findChildByLocalName(master, "subList");
        if (sub)
          out.push({ sub, page, x: geom.ML, y: geom.MT, width: geom.BODY_W, layer: num(master, "pageFront") ? 2 : -2 });
      }
    }
    for (const kind of ["header", "footer"]) {
      if (hides(kind === "header" ? "Header" : "Footer"))
        continue;
      const eligible = declarations.filter((d) => d.kind === kind && d.page <= page && parity(d.el.getAttribute("applyPageType") || "BOTH", n));
      const decl = eligible[eligible.length - 1];
      const sub = decl && findChildByLocalName(decl.el, "subList");
      if (sub)
        out.push({ sub, page, x: geom.ML, y: kind === "header" ? num(margin, "top", 5668) : geom.PH - num(margin, "bottom", 4252) - num(margin, "footer"), width: geom.BODY_W });
    }
  }
  return out;
}
function footNoteStories(root, paraPages, geom) {
  const pr = findFirst(root, "footNotePr");
  const sp = pr ? findChildByLocalName(pr, "noteSpacing") : null, line = pr ? findChildByLocalName(pr, "noteLine") : null;
  const above = num(sp, "aboveLine", 850), below = num(sp, "belowLine", 567), between = num(sp, "betweenNotes", 283);
  const byPage = /* @__PURE__ */ new Map();
  for (const p of elements(root))
    if (ln(p) === "p") {
      const page = paraPages.get(p)?.[0] ?? 0;
      for (const run of elements(p))
        if (ln(run) === "run") {
          for (const ctrl of elements(run))
            if (ln(ctrl) === "ctrl") {
              const fn = findChildByLocalName(ctrl, "footNote");
              const sub = fn && !isDeletedControl(fn) ? findChildByLocalName(fn, "subList") : null;
              if (!sub)
                continue;
              let h = 0;
              for (const q of elements(sub))
                if (ln(q) === "p") {
                  const lsa = findChildByLocalName(q, "linesegarray");
                  for (const seg of lsa ? elements(lsa) : [])
                    if (ln(seg) === "lineseg")
                      h = Math.max(h, num(seg, "vertpos") + num(seg, "vertsize"));
                }
              const list = byPage.get(page) ?? [];
              list.push({ sub, h });
              byPage.set(page, list);
            }
        }
    }
  const stories = [], rules = [];
  const lenAttr = num(line, "length", -1), widthMm = Number.parseFloat(line?.getAttribute("width") ?? "0.12") || 0.12;
  const lineType = line?.getAttribute("type") ?? "SOLID";
  for (const [page, notes] of byPage) {
    const area = above + below + notes.reduce((a, n) => a + n.h, 0) + between * (notes.length - 1);
    const top = geom.MT + geom.BODY_H - area;
    if (lineType !== "NONE")
      rules.push({ page, x: geom.ML, y: top + above, length: lenAttr > 0 ? lenAttr : 14173, widthMm, color: line?.getAttribute("color") ?? "#000000" });
    let y = top + above + below;
    for (const n of notes) {
      stories.push({ sub: n.sub, page, x: geom.ML, y, width: geom.BODY_W });
      y += n.h + between;
    }
  }
  return { stories, rules };
}
function endNoteLayout(root, paraPages, geom) {
  const notes = [];
  let last = null;
  let endColPr = null;
  for (const p of elements(root))
    if (ln(p) === "p") {
      const lsa = findChildByLocalName(p, "linesegarray"), segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
      const pages = paraPages.get(p) ?? [];
      if (segs.length)
        last = { seg: segs[segs.length - 1], page: pages[segs.length - 1] ?? pages[0] ?? 0 };
      for (const run of elements(p))
        if (ln(run) === "run") {
          for (const ctrl of elements(run))
            if (ln(ctrl) === "ctrl") {
              endColPr = findChildByLocalName(ctrl, "colPr") ?? endColPr;
              const en = findChildByLocalName(ctrl, "endNote");
              const sub = en && !isDeletedControl(en) ? findChildByLocalName(en, "subList") : null;
              if (sub)
                notes.push(sub);
            }
        }
    }
  if (!notes.length || !last)
    return null;
  const pr = findFirst(root, "endNotePr");
  const sp = pr ? findChildByLocalName(pr, "noteSpacing") : null, line = pr ? findChildByLocalName(pr, "noteLine") : null;
  const above = num(sp, "aboveLine", 0), below = num(sp, "belowLine", 567), between = num(sp, "betweenNotes", 283);
  const colPr = endColPr ?? findFirst(root, "colPr"), nCol = Math.max(1, num(colPr, "colCount", 1)), gap = nCol > 1 ? num(colPr, "sameGap", 0) : 0;
  const colW = (geom.BODY_W - gap * (nCol - 1)) / nCol;
  let page = last.page;
  let col = nCol > 1 ? Math.min(nCol - 1, Math.max(0, Math.round(num(last.seg, "horzpos") / (colW + gap)))) : 0;
  let y = num(last.seg, "vertpos") + num(last.seg, "vertsize") + above;
  const rules = [];
  const lenAttr = num(line, "length", -1), widthMm = Number.parseFloat(line?.getAttribute("width") ?? "0.12") || 0.12;
  if ((line?.getAttribute("type") ?? "SOLID") !== "NONE")
    rules.push({ page, x: geom.ML + col * (colW + gap), y: geom.MT + y, length: lenAttr > 0 ? lenAttr : 14173, widthMm, color: line?.getAttribute("color") ?? "#000000" });
  y += below;
  const next = () => {
    if (++col >= nCol) {
      col = 0;
      page++;
    }
    y = 0;
  };
  const out = [];
  notes.forEach((sub, ni) => {
    if (ni > 0)
      y += between;
    let base = y;
    let prevRaw = Number.NEGATIVE_INFINITY, flowEnd = y;
    for (const q of elements(sub))
      if (ln(q) === "p") {
        const lsa = findChildByLocalName(q, "linesegarray"), segs = lsa ? elements(lsa).filter((e) => ln(e) === "lineseg") : [];
        const pages = [];
        for (const seg of segs) {
          const raw = num(seg, "vertpos");
          if (raw < prevRaw)
            base = flowEnd - raw;
          prevRaw = raw;
          let v = base + raw;
          const vs = num(seg, "vertsize");
          if (v + vs > geom.BODY_H && v > 0) {
            const shift = v;
            next();
            base -= shift;
            v = 0;
          }
          seg.setAttribute("vertpos", String(v));
          seg.setAttribute("horzpos", String(num(seg, "horzpos") + col * (colW + gap)));
          pages.push(page);
          y = v + vs;
          flowEnd = y + num(seg, "spacing");
        }
        out.push({ p: q, pages });
      }
  });
  return { paras: out, rules, pageCount: page + 1 };
}
export {
  endNoteLayout,
  footNoteStories,
  pageStories
};
