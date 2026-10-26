// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/shared/xml.ts. MIT; see LICENSE.
const MAX_XML_DEPTH = 200;
function localName(el) {
  return (el.tagName || el.localName || "").replace(/^[^:]+:/, "");
}
function findChildByLocalName(parent, name) {
  const children = parent.childNodes;
  if (!children)
    return null;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch.nodeType !== 1)
      continue;
    if (localName(ch) === name)
      return ch;
  }
  return null;
}
function childrenByLocalName(parent, name) {
  const out = [];
  const children = parent.childNodes;
  if (!children)
    return out;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch.nodeType !== 1)
      continue;
    if (localName(ch) === name)
      out.push(ch);
  }
  return out;
}
function elementChildren(parent) {
  const out = [];
  const children = parent.childNodes;
  if (!children)
    return out;
  for (let i = 0; i < children.length; i++) {
    if (children[i].nodeType === 1)
      out.push(children[i]);
  }
  return out;
}
function isTextNode(node) {
  return node.nodeType === 3 || node.nodeType === 4;
}
function extractTextFromNode(node, depth = 0) {
  let result = "";
  if (depth > MAX_XML_DEPTH)
    return result;
  const children = node.childNodes;
  if (!children)
    return result;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isTextNode(child))
      result += child.textContent || "";
    else if (child.nodeType === 1)
      result += extractTextFromNode(child, depth + 1);
  }
  return result.trim();
}
function rawTextContent(node, depth = 0) {
  if (depth > MAX_XML_DEPTH)
    return "";
  const children = node.childNodes;
  if (!children)
    return "";
  const parts = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (isTextNode(child))
      parts.push(child.nodeValue || "");
    else if (child.nodeType === 1)
      parts.push(rawTextContent(child, depth + 1));
  }
  return parts.join("");
}
export {
  MAX_XML_DEPTH,
  childrenByLocalName,
  elementChildren,
  extractTextFromNode,
  findChildByLocalName,
  localName,
  rawTextContent
};
