// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/reflow-fragments.ts. MIT; see LICENSE.
function appendNarrowLineFragments(parent, seg, free, box, flow) {
  if (!free || !box)
    return false;
  const parts = free.filter(([a, b]) => b - a >= 1440);
  if (parts.length < 2 || parts.at(-1)[0] !== box[0] || parts.at(-1)[1] - box[0] !== box[1])
    return false;
  const { text, widths, spacings, slots, start, end } = flow;
  if (/[\t\n\u00a0\u2005\ufdd0\ufffc]/.test(text.slice(start, end)))
    return false;
  let ink = start;
  while (ink < end && (text[ink] === " " || text[ink] === "\u2060" && widths[ink] === 0))
    ink++;
  if (text.slice(ink, end).includes("\u2060"))
    return false;
  if (ink === end || parts.slice(0, -1).some(([a, b]) => (widths[ink] ?? 0) - (spacings[ink] ?? 0) <= b - a))
    return false;
  const fragments = [];
  let cursor = start;
  for (const [a, b] of parts.slice(0, -1)) {
    const offset = cursor;
    let w = 0;
    while (cursor < ink && w + widths[cursor] <= b - a)
      w += widths[cursor++];
    fragments.push({ offset, x: a, width: b - a });
  }
  let rest = 0;
  for (let i = cursor; i < end; i++)
    rest += widths[i];
  let last = end - 1;
  if (last > cursor && /[\uDC00-\uDFFF]/.test(text[last]))
    last--;
  rest -= spacings[last] ?? 0;
  if (rest > box[1] + 0.5)
    return false;
  let next = end;
  while (next < text.length && text[next] === " ")
    next++;
  if (next < text.length && rest + (widths[next] ?? 0) - (spacings[next] ?? 0) <= box[1] + 0.5)
    return false;
  fragments.push({ offset: cursor, x: box[0], width: box[1] });
  fragments.forEach((f, i) => {
    const part = seg.cloneNode(false);
    if (i > 0)
      part.setAttribute("textpos", String(slots[f.offset]));
    part.setAttribute("horzpos", String(f.x));
    part.setAttribute("horzsize", String(f.width));
    parent.appendChild(part);
  });
  return true;
}
export {
  appendNarrowLineFragments
};
