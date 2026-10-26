// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/reflow-borders.ts. MIT; see LICENSE.
function lineBorderBox(model, styles, start, end) {
  const empty = model.chars.length === 0 && model.objs.length === 0;
  let top = 0, all = 0;
  const include = (prId) => {
    const st = prId != null ? styles.charPr.get(prId) : void 0;
    const f = st?.borderFill != null ? styles.borderFill.get(st.borderFill) : void 0;
    if (!f || !f.top && !f.bottom)
      return;
    const width = (pt) => empty ? 2 * Math.trunc(pt * 50) : Math.trunc(pt * 100);
    const t = f.top ? width(f.top.widthPt) : 0, b = f.bottom ? width(f.bottom.widthPt) : 0;
    top = Math.max(top, st.height + t);
    all = Math.max(all, st.height + t + b);
  };
  if (empty)
    for (const run of model.runs)
      include(run.prId);
  else
    for (let i = start; i < end; i++)
      if (model.chars[i].ch)
        include(model.chars[i].prId);
  return [top, all, empty && all > 0];
}
export {
  lineBorderBox
};
