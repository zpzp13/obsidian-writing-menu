// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/render/object-anchor.ts. MIT; see LICENSE.
import { findChildByLocalName } from "../hwpx/parser-shared.js";
import { num, measureTableHeight } from "./para-model.js";
function linePushedBy(o, lineV, paraTop) {
  if (paraTop === void 0)
    return false;
  const om = findChildByLocalName(o.el, "outMargin");
  const pos = findChildByLocalName(o.el, "pos");
  const raw = num(pos, "vertOffset"), vo = (pos?.getAttribute("vertRelTo") ?? "PARA") === "PARA" ? Math.max(0, raw >= 2 ** 31 ? raw - 2 ** 32 : raw) : 0;
  return Math.abs(lineV - (vo + num(om, "top") + o.height + num(om, "bottom")) - paraTop) <= 10;
}
function anchorObject(o, ox, oy, baseV, areaW, ctx, anchorLineV, stayLine = false, paraStartV, lineH, lineSB = 0, anchorAt = "end") {
  const { PW, PH, ML, MT, BODY_W, BODY_H } = ctx.geom;
  const pos = findChildByLocalName(o.el, "pos");
  const om = findChildByLocalName(o.el, "outMargin");
  const omT = num(om, "top"), omB = num(om, "bottom");
  const w = o.width, h = o.tag === "tbl" ? Math.max(o.height, measureTableHeight(o.el, ctx.extentMemo)) : o.height;
  if (!pos)
    return { x: ox, y: oy + baseV };
  const voRaw = num(pos, "vertOffset"), voS = voRaw >= 2 ** 31 ? voRaw - 2 ** 32 : voRaw;
  const vo = (pos.getAttribute("vertRelTo") ?? "PARA") === "PARA" ? Math.max(0, voS) : voS;
  const ho = num(pos, "horzOffset");
  const vrel = pos.getAttribute("vertRelTo") ?? "PARA";
  const hrel = pos.getAttribute("horzRelTo") ?? "PARA";
  const va = pos.getAttribute("vertAlign") ?? "TOP";
  const ha = pos.getAttribute("horzAlign") ?? "LEFT";
  const wrap = o.el.getAttribute("textWrap") ?? "TOP_AND_BOTTOM";
  let y;
  if (vrel === "PAPER") {
    y = va === "BOTTOM" ? PH - h - vo - omB : va === "CENTER" ? (PH - h) / 2 + vo : vo + omT;
  } else if (vrel === "PAGE") {
    y = va === "BOTTOM" ? MT + BODY_H - h - vo : va === "CENTER" ? MT + (BODY_H - h) / 2 + vo : MT + vo;
  } else if (wrap === "TOP_AND_BOTTOM") {
    const lineV = anchorLineV ?? baseV;
    const pushed = lineV - (vo + omT + h + omB);
    const below = lineH !== void 0 && vo + omT >= lineH && !(paraStartV !== void 0 && Math.abs(pushed - paraStartV) <= 10);
    const anchor = below ? lineV - lineSB : stayLine !== false ? lineV - stayLine : pushed >= -100 ? pushed : paraStartV !== void 0 ? paraStartV : lineV;
    y = oy + anchor + omT + vo;
  } else {
    const origin = vrel === "PARA" && wrap === "SQUARE" ? paraStartV ?? baseV : baseV;
    const later = vrel === "PARA" && wrap === "SQUARE" && anchorAt === "end" && anchorLineV !== void 0 && anchorLineV > baseV;
    const midLater = vrel === "PARA" && wrap === "SQUARE" && anchorAt === "top" && anchorLineV !== void 0 && anchorLineV > baseV;
    y = later ? oy + anchorLineV + vo + omT : oy + Math.max(origin + vo, wrap === "SQUARE" && !midLater && anchorLineV !== void 0 ? anchorLineV : -Infinity) + omT;
  }
  let x;
  const omL = num(om, "left"), omR = num(om, "right");
  if (hrel === "PAGE") {
    x = ha === "RIGHT" ? ML + BODY_W - w - ho - omR : ha === "CENTER" ? ML + (BODY_W - w) / 2 + ho : ML + ho + omL;
  } else if (hrel === "PAPER") {
    x = (ha === "RIGHT" ? PW - w - ho - omR : ha === "CENTER" ? (PW - w) / 2 + ho : ho + omL) - (ctx.bodyDx?.(ctx.page) ?? 0);
  } else {
    x = ha === "RIGHT" ? ox + areaW - w - ho - omR : ha === "CENTER" ? ox + (areaW - w) / 2 + ho : ox + ho + omL;
  }
  return { x, y };
}
export {
  anchorObject,
  linePushedBy
};
