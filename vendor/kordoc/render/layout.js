// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/layout.ts. MIT; see LICENSE.
function toInt32(v, fallback = 0) {
  if (v == null || v === "")
    return fallback;
  const n = Number(v);
  if (!Number.isFinite(n))
    return fallback;
  return n > 2147483647 ? n - 4294967296 : n;
}
function solveBoundaries(constraints, count, total) {
  const x = new Array(count + 1).fill(void 0);
  x[0] = 0;
  if (total != null && total > 0)
    x[count] = total;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < count + 8) {
    changed = false;
    for (const c of constraints) {
      if (c.a < 0 || c.b > count || c.a >= c.b)
        continue;
      const xa = x[c.a];
      const xb = x[c.b];
      if (xa != null && xb == null) {
        x[c.b] = xa + c.size;
        changed = true;
      } else if (xb != null && xa == null) {
        x[c.a] = xb - c.size;
        changed = true;
      }
    }
  }
  let i = 0;
  while (i <= count) {
    if (x[i] != null) {
      i++;
      continue;
    }
    let lo = i - 1;
    let hi = i;
    while (hi <= count && x[hi] == null)
      hi++;
    const loV = x[lo];
    const hiV = hi <= count ? x[hi] : loV + (hi - lo) * 1e3;
    const n = hi - lo;
    for (let k = 1; k < n; k++)
      x[lo + k] = loV + (hiV - loV) * k / n;
    if (hi > count)
      x[count] = hiV;
    i = hi;
  }
  const out = x;
  for (let k = 1; k <= count; k++)
    if (out[k] < out[k - 1])
      out[k] = out[k - 1];
  return out;
}
function longestPathBoundaries(constraints, count) {
  const inner = constraints.filter((c) => c.a >= 0 && c.b <= count && c.a < c.b && !(c.a === 0 && c.b === count));
  const x = new Array(count + 1).fill(Number.NEGATIVE_INFINITY);
  x[0] = 0;
  for (let k = 1; k <= count; k++) {
    for (const c of inner)
      if (c.b === k && x[c.a] > Number.NEGATIVE_INFINITY)
        x[k] = Math.max(x[k], x[c.a] + c.size);
    if (x[k] === Number.NEGATIVE_INFINITY)
      return null;
    x[k] = Math.max(x[k], x[k - 1]);
  }
  const y = new Array(count + 1).fill(Number.NEGATIVE_INFINITY);
  y[count] = 0;
  for (let k = count - 1; k >= 0; k--) {
    y[k] = y[k + 1];
    for (const c of inner)
      if (c.a === k && y[c.b] > Number.NEGATIVE_INFINITY)
        y[k] = Math.max(y[k], c.size + y[c.b]);
  }
  return { x, tight: x.map((v, k) => Math.abs(v + y[k] - x[count]) <= 2) };
}
function tableColumnBoundaries(constraints, count, total, noExactRow = false) {
  const prop = solveBoundaries(constraints, count, total);
  if (!total || total <= 0)
    return prop;
  const lp = longestPathBoundaries(constraints, count);
  return lp && Math.abs(lp.x[count] - total) <= 2 && (noExactRow || lp.x.every((v, k) => Math.abs(v - prop[k]) <= 2 || lp.tight[k])) ? lp.x : prop;
}
function solveRowHeights(cells, rowCount, maxTotal = Number.POSITIVE_INFINITY, shrinkLast = false) {
  const h = new Array(rowCount).fill(0);
  for (const c of cells) {
    if (c.rowSpan === 1 && c.rowAddr >= 0 && c.rowAddr < rowCount) {
      h[c.rowAddr] = Math.max(h[c.rowAddr], c.height);
    }
  }
  for (const c of cells) {
    if (c.rowSpan === 1 && c.contentH != null && c.rowAddr >= 0 && c.rowAddr < rowCount) {
      if (c.contentH > h[c.rowAddr])
        h[c.rowAddr] = c.contentH;
    }
  }
  const spans = cells.filter((c) => c.rowSpan > 1).map((c) => {
    const rows = [];
    for (let r = c.rowAddr; r < Math.min(c.rowAddr + c.rowSpan, rowCount); r++)
      rows.push(r);
    return { c, rows };
  });
  const done = /* @__PURE__ */ new Set();
  const solve = (k, evenOnly) => {
    const { c, rows } = spans[k];
    const known = rows.reduce((s, r) => s + h[r], 0);
    const missing = rows.filter((r) => h[r] === 0);
    if (missing.length === 0) {
      done.add(k);
      return false;
    }
    if (evenOnly && missing.length !== 1)
      return false;
    done.add(k);
    if (c.height <= known)
      return false;
    const each = (c.height - known) / missing.length;
    for (const r of missing)
      h[r] = each;
    return true;
  };
  for (let r = 0; r < rowCount; r++) {
    if (h[r] !== 0)
      continue;
    let need = 0;
    for (const { c, rows } of spans)
      if (rows[rows.length - 1] === r && rows.slice(0, -1).every((q) => h[q] > 0))
        need = Math.max(need, c.height - rows.slice(0, -1).reduce((t, q) => t + h[q], 0));
    if (need > 0)
      h[r] = need;
  }
  for (let again = true; again; ) {
    again = false;
    for (let k = 0; k < spans.length; k++)
      if (!done.has(k) && solve(k, true))
        again = true;
  }
  for (let k = 0; k < spans.length; k++)
    if (!done.has(k))
      solve(k, false);
  let total = h.reduce((s, x) => s + x, 0);
  for (const { c, rows } of [...spans].sort((a, b) => a.rows[a.rows.length - 1] - b.rows[b.rows.length - 1] || b.rows[0] - a.rows[0])) {
    const known = rows.reduce((s, r) => s + h[r], 0);
    const add = Math.min(c.height - known, maxTotal - total);
    if (rows.length && add > 0) {
      h[rows[rows.length - 1]] += add;
      total += add;
    }
  }
  const last = rowCount - 1, over = total - maxTotal;
  const lastCells = cells.filter((c) => c.rowAddr + c.rowSpan - 1 === last);
  const spanH = (c) => h.slice(c.rowAddr, c.rowAddr + c.rowSpan).reduce((t, x) => t + x, 0);
  if (shrinkLast && over > 0 && last >= 0 && lastCells.length && lastCells.every((c) => c.contentH != null && c.contentH <= (c.rowSpan === 1 ? h[last] : spanH(c)) - over))
    h[last] -= over;
  return h;
}
export {
  longestPathBoundaries,
  solveBoundaries,
  solveRowHeights,
  tableColumnBoundaries,
  toInt32
};
