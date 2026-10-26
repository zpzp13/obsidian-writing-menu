// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/reflow-cache.ts. MIT; see LICENSE.
import { toInt32 } from "./layout.js";
function cachedParagraphBottom(lsa, bodyFlow) {
  let bottom = Number.NEGATIVE_INFINITY, previousV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < lsa.childNodes.length; i++) {
    const seg = lsa.childNodes[i];
    if (seg.nodeType !== 1 || seg.localName !== "lineseg")
      continue;
    const num = (name, fallback = 0) => toInt32(seg.getAttribute(name) ?? void 0, fallback);
    const v = num("vertpos");
    if (bodyFlow && v < previousV)
      bottom = Number.NEGATIVE_INFINITY;
    bottom = Math.max(bottom, v + Math.max(num("vertsize", 1e3), num("textheight", 1e3)) + num("spacing"));
    previousV = v;
  }
  return bottom;
}
export {
  cachedParagraphBottom
};
