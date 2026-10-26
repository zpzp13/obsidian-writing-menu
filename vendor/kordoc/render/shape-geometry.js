// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/shape-geometry.ts. MIT; see LICENSE.
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { elements, ln, num } from "./para-model.js";
import { docColor } from "./head-styles.js";
const pt = (u) => String(Math.round(u) / 100);
const esc = (s) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SHAPE_TAGS = /* @__PURE__ */ new Set(["rect", "ellipse", "line", "polygon", "curv", "curve", "arc"]);
function rotatedBounds(box, rotations) {
  if (!rotations.length)
    return box;
  let points = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
  for (let i = rotations.length - 1; i >= 0; i--) {
    const r = rotations[i];
    if (Array.isArray(r)) {
      points = points.map(([x2, y2]) => [r[0] * x2 + r[2] * y2 + r[4], r[1] * x2 + r[3] * y2 + r[5]]);
      continue;
    }
    const { angle, cx, cy } = r;
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    points = points.map(([x2, y2]) => [cx + c * (x2 - cx) - s * (y2 - cy), cy + s * (x2 - cx) + c * (y2 - cy)]);
  }
  const x = Math.min(...points.map((p) => p[0])), y = Math.min(...points.map((p) => p[1]));
  return { x, y, w: Math.max(...points.map((p) => p[0])) - x, h: Math.max(...points.map((p) => p[1])) - y };
}
function mulAffine(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}
function renderingMatrix(el) {
  const info = findChildByLocalName(el, "renderingInfo");
  if (!info)
    return null;
  let m = null;
  let pendingS = null;
  const apply = (n) => {
    m = m ? mulAffine(m, n) : n;
  };
  for (const c of elements(info)) {
    const tag = ln(c);
    if (tag !== "transMatrix" && tag !== "scaMatrix" && tag !== "rotMatrix")
      continue;
    const n = [num(c, "e1", 1), num(c, "e4"), num(c, "e2"), num(c, "e5", 1), num(c, "e3"), num(c, "e6")];
    if (tag === "scaMatrix") {
      if (pendingS)
        apply(pendingS);
      pendingS = n;
      continue;
    }
    if (tag === "rotMatrix" && pendingS) {
      apply(mulAffine(n, pendingS));
      pendingS = null;
      continue;
    }
    apply(n);
  }
  if (pendingS)
    apply(pendingS);
  return m;
}
function objectGeometry(el, x, y, w, h, boxW = w, boxH = h) {
  const rot = findChildByLocalName(el, "rotationInfo");
  const angle = num(rot, "angle") % 360;
  if (!angle)
    return { x, y, w, h, bbox: { x, y, w, h }, transform: "" };
  const cx = x + boxW / 2, cy = y + boxH / 2;
  const fx = cx - w / 2, fy = cy - h / 2;
  const rotation = { angle, cx: Math.round(cx), cy: Math.round(cy) };
  return { x: fx, y: fy, w, h, bbox: rotatedBounds({ x: fx, y: fy, w, h }, [rotation]), rotation, transform: `rotate(${angle} ${pt(cx)} ${pt(cy)})` };
}
function shapeFill(el, defs, images, warn) {
  const brush = findChildByLocalName(el, "fillBrush");
  const win = brush && findChildByLocalName(brush, "winBrush");
  const face = win?.getAttribute("faceColor");
  if (docColor(face))
    return esc(face);
  const grad = brush && findChildByLocalName(brush, "gradation");
  if (grad) {
    const colors = elements(grad).filter((c) => ln(c) === "color").map((c) => docColor(c.getAttribute("value"), "#000000"));
    if (!colors.length)
      return "none";
    const type = grad.getAttribute("type") ?? "LINEAR";
    if (type !== "LINEAR" && type !== "RADIAL") {
      warn(`gradient:${type}`, `\uADF8\uB77C\uB370\uC774\uC158(${type}) \uBBF8\uC9C0\uC6D0 \u2014 \uCCAB \uC0C9\uC73C\uB85C \uCC44\uC6C0`);
      return esc(colors[0]);
    }
    const id = `paint${defs.length}`;
    const opacity = Math.max(0, Math.min(1, 1 - num(grad, "alpha") / 255));
    const stops = colors.map((color, i) => `<stop offset="${colors.length === 1 ? 0 : i / (colors.length - 1)}" stop-color="${esc(color)}" stop-opacity="${opacity}"/>`).join("");
    if (type === "RADIAL")
      defs.push(`<radialGradient id="${id}" cx="${num(grad, "centerX", 50)}%" cy="${num(grad, "centerY", 50)}%">${stops}</radialGradient>`);
    else {
      const a = num(grad, "angle") * Math.PI / 180, dx = Math.cos(a) / 2, dy = -Math.sin(a) / 2;
      defs.push(`<linearGradient id="${id}" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  }
  const imgBrush = brush && findChildByLocalName(brush, "imgBrush");
  const img = imgBrush && findChildByLocalName(imgBrush, "img");
  if (imgBrush && img) {
    const ref = img.getAttribute("binaryItemIDRef") ?? "";
    const loaded = images.get(ref);
    if (!loaded) {
      warn(`brush-image:${ref}`, `\uADF8\uB9BC \uCC44\uC6C0 \uC774\uBBF8\uC9C0(${ref}) \uC5C6\uC74C \u2014 \uCC44\uC6C0 \uC0DD\uB7B5`);
      return "none";
    }
    const mode = imgBrush.getAttribute("mode") ?? "TOTAL";
    if (mode !== "TOTAL") {
      warn(`brush-mode:${mode}`, `\uADF8\uB9BC \uCC44\uC6C0(${mode}) \uBBF8\uC9C0\uC6D0 \u2014 \uCC44\uC6C0 \uC0DD\uB7B5`);
      return "none";
    }
    if (loaded.paintId)
      return `url(#${loaded.paintId})`;
    const id = `paint${defs.length}`;
    defs.push(`<pattern id="${id}" width="1" height="1" patternContentUnits="objectBoundingBox"><image href="${esc(loaded.dataUri)}" width="1" height="1" preserveAspectRatio="none"/></pattern>`);
    loaded.paintId = id;
    return `url(#${id})`;
  }
  return "none";
}
function shapeGeometry(o, boxX, boxY, defs, images, warn, local = false) {
  const el = o.el, org = findChildByLocalName(el, "orgSz"), cur = findChildByLocalName(el, "curSz");
  const ow = num(org, "width"), oh = num(org, "height");
  const w = (local ? ow : num(cur, "width")) || ow || num(cur, "width") || o.width;
  const h = (local ? oh : num(cur, "height")) || oh || num(cur, "height") || o.height;
  const geometry = local ? { x: boxX, y: boxY, w, h, bbox: { x: boxX, y: boxY, w, h }, transform: "" } : objectGeometry(el, boxX, boxY, w, h, o.width || w, o.height || h);
  const { x, y } = geometry;
  const sx = ow > 0 ? w / ow : 1, sy = oh > 0 ? h / oh : 1;
  const line = findChildByLocalName(el, "lineShape"), style = line?.getAttribute("style") ?? "SOLID";
  const color = esc(docColor(line?.getAttribute("color"), "#000000"));
  const strokeW = style === "NONE" ? 0 : Math.max(0.2, num(line, "width", 33) / 100 * 2.834645);
  const dash = /DASH|DOT/.test(style) ? ` stroke-dasharray="${style.includes("DOT") ? "1,1.5" : "3,1.5"}"` : "";
  const keepWidth = local ? ` vector-effect="non-scaling-stroke"` : "";
  const stroke = strokeW ? ` stroke="${color}" stroke-width="${strokeW.toFixed(2)}"${dash}${keepWidth}` : "";
  const fill = ` fill="${shapeFill(el, defs, images, warn)}"`;
  let svg = "";
  if (o.tag === "rect")
    svg = `<rect x="${pt(x)}" y="${pt(y)}" width="${pt(w)}" height="${pt(h)}"${fill}${stroke}/>`;
  else if (o.tag === "ellipse")
    svg = `<ellipse cx="${pt(x + w / 2)}" cy="${pt(y + h / 2)}" rx="${pt(w / 2)}" ry="${pt(h / 2)}"${fill}${stroke}/>`;
  else if (o.tag === "line") {
    const s = findChildByLocalName(el, "startPt"), e = findChildByLocalName(el, "endPt");
    svg = `<line x1="${pt(x + num(s, "x") * sx)}" y1="${pt(y + num(s, "y") * sy)}" x2="${pt(x + num(e, "x") * sx)}" y2="${pt(y + num(e, "y") * sy)}" stroke="${color}" stroke-width="${(strokeW || 0.3).toFixed(2)}"${dash}${keepWidth}/>`;
  } else if (o.tag === "polygon" || o.tag === "curv") {
    const pts = elements(el).filter((c) => ln(c) === "pt").map((c) => `${pt(x + num(c, "x") * sx)},${pt(y + num(c, "y") * sy)}`);
    if (pts.length >= 2)
      svg = `<polygon points="${pts.join(" ")}"${fill}${stroke}/>`;
  } else if (o.tag === "curve") {
    const segs = elements(el).filter((c) => ln(c) === "seg");
    if (segs.length) {
      let path = "", lastX, lastY;
      for (const s of segs) {
        const x1 = num(s, "x1"), y1 = num(s, "y1"), x2 = num(s, "x2"), y2 = num(s, "y2");
        if (x1 !== lastX || y1 !== lastY)
          path += `M${pt(x + x1 * sx)} ${pt(y + y1 * sy)}`;
        path += `L${pt(x + x2 * sx)} ${pt(y + y2 * sy)}`;
        lastX = x2;
        lastY = y2;
      }
      svg = `<path d="${path}"${fill}${stroke}/>`;
    }
  } else if (o.tag === "arc")
    svg = `<ellipse cx="${pt(x + w / 2)}" cy="${pt(y + h / 2)}" rx="${pt(w / 2)}" ry="${pt(h / 2)}" fill="none"${stroke || ` stroke="${color}" stroke-width="0.3"`}/>`;
  return { ...geometry, svg };
}
export {
  SHAPE_TAGS,
  mulAffine,
  objectGeometry,
  renderingMatrix,
  rotatedBounds,
  shapeGeometry
};
