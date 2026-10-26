// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/scene.ts. MIT; see LICENSE.
function regionId(type, seq) {
  return `${type}-${String(seq).padStart(6, "0")}`;
}
function unionBBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { page: a.page, x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
class RegionCollector {
  constructor() {
    this.regions = [];
    this.counters = /* @__PURE__ */ new Map();
  }
  add(type, bbox, extra = {}) {
    const seq = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, seq);
    const id = regionId(type, seq);
    const region = { id, type, page: bbox.page, regions: [bbox] };
    if (extra.sourceId)
      region.sourceId = extra.sourceId;
    if (extra.parentId)
      region.parentId = extra.parentId;
    this.regions.push(region);
    return id;
  }
  addFragment(id, bbox) {
    const r = this.regions.find((x) => x.id === id);
    if (!r)
      return;
    const same = r.regions.find((f) => f.page === bbox.page);
    if (same)
      Object.assign(same, unionBBox(same, bbox));
    else
      r.regions.push(bbox);
  }
}
export {
  RegionCollector,
  regionId,
  unionBBox
};
