// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwpx/notes.ts. MIT; see LICENSE.
import { formatHeadNumber } from "./para-heading.js";
import { findChildByLocalName } from "../shared/xml.js";
function codePointAttr(v) {
  if (v == null || v === "")
    return void 0;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || n > 1114111)
    return void 0;
  return n === 0 ? "" : String.fromCodePoint(n);
}
function noteFormatFrom(get) {
  return {
    type: get("type") || "DIGIT",
    userChar: get("userChar") ?? "",
    prefixChar: get("prefixChar") ?? "",
    suffixChar: get("suffixChar") ?? ""
  };
}
function noteCore(num, fmt, userChar) {
  if (fmt.type === "USER_CHAR")
    return userChar ?? fmt.userChar;
  return formatHeadNumber(num, fmt.type);
}
function noteRefMark(attrs, fmt) {
  const f = fmt ?? { type: "DIGIT", userChar: "", prefixChar: "", suffixChar: ")" };
  const n = parseInt(attrs.number ?? "", 10);
  const prefix = codePointAttr(attrs.prefixChar) ?? f.prefixChar;
  const suffix = codePointAttr(attrs.suffixChar) ?? f.suffixChar;
  return prefix + noteCore(Number.isFinite(n) ? n : 1, f, codePointAttr(attrs.userChar)) + suffix;
}
function noteAutoNumText(num, fmt) {
  const n = parseInt(num ?? "", 10);
  return fmt.prefixChar + noteCore(Number.isFinite(n) ? n : 1, fmt) + fmt.suffixChar;
}
function isRenderedAutoNum(numType) {
  return numType === "FOOTNOTE" || numType === "ENDNOTE" || numType === "PICTURE" || numType === "TABLE" || numType === "EQUATION";
}
function noteAttrsOf(el) {
  return {
    number: el.getAttribute("number"),
    prefixChar: el.getAttribute("prefixChar"),
    suffixChar: el.getAttribute("suffixChar"),
    userChar: el.getAttribute("userChar")
  };
}
function readSectionNoteFormats(root) {
  const out = {};
  const pick = (names) => {
    for (const name of names) {
      const els = root.getElementsByTagName(name);
      if (els.length === 0)
        continue;
      const f = findChildByLocalName(els[0], "autoNumFormat");
      return f ? noteFormatFrom((n) => f.getAttribute(n)) : void 0;
    }
    return void 0;
  };
  out.footnote = pick(["hp:footNotePr", "footNotePr"]);
  out.endnote = pick(["hp:endNotePr", "endNotePr"]);
  return out;
}
function noteAutoNumOf(el) {
  if (!isRenderedAutoNum(el.getAttribute("numType")))
    return "";
  const f = findChildByLocalName(el, "autoNumFormat");
  return noteAutoNumText(el.getAttribute("num"), noteFormatFrom((n) => f?.getAttribute(n)));
}
export {
  isRenderedAutoNum,
  noteAttrsOf,
  noteAutoNumOf,
  noteAutoNumText,
  noteFormatFrom,
  noteRefMark,
  readSectionNoteFormats
};
