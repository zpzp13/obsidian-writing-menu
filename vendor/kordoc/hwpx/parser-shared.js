// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/hwpx/parser-shared.ts. MIT; see LICENSE.
import { DOMParser } from "@xmldom/xmldom";
import { KordocError, unzipLimitBytes } from "../utils.js";
const MAX_DECOMPRESS_SIZE = unzipLimitBytes(256 * 1024 * 1024);
const MAX_ZIP_ENTRIES = 500;
class ZipBombError extends KordocError {
  constructor(message) {
    super(message);
    this.name = "ZipBombError";
  }
}
function readZipEntry(file, type, used = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const declared = file._data?.uncompressedSize;
    const limit = typeof declared === 'number' && declared >= 0 ? declared : Number.POSITIVE_INFINITY;
    const stream = file.internalStream('uint8array');
    stream.on('data', chunk => {
      size += chunk.length;
      if (used + size > MAX_DECOMPRESS_SIZE || size > limit) {
        stream.pause(); reject(new ZipBombError('ZIP decompression size limit exceeded')); return;
      }
      chunks.push(chunk);
    }).on('error', reject).on('end', () => {
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
      resolve(type === 'text' ? new TextDecoder().decode(bytes) : bytes);
    }).resume();
  });
}
function clampSpan(val, max) {
  return Math.max(1, Math.min(val, max));
}
import { MAX_XML_DEPTH, findChildByLocalName, extractTextFromNode } from "../shared/xml.js";
function createSectionShared() {
  return {
    numState: /* @__PURE__ */ new Map(),
    pageText: { headers: [], footers: [] },
    track: { deleteDepth: 0, warned: false, deletedObjects: /* @__PURE__ */ new WeakSet(), deletedImageRefs: /* @__PURE__ */ new Set() },
    pageState: { base: 0, allUsable: true },
    tocTexts: /* @__PURE__ */ new Set()
  };
}
function createXmlParser(warnings) {
  return new DOMParser({
    onError(level, msg) {
      if (level === "fatalError")
        throw new KordocError(`XML \uD30C\uC2F1 \uC2E4\uD328: ${msg}`);
      warnings?.push({ code: "MALFORMED_XML", message: `XML ${level === "warning" ? "\uACBD\uACE0" : "\uC624\uB958"}: ${msg}` });
    }
  });
}
function applyPageText(blocks, shared) {
  const { headers, footers } = shared.pageText;
  if (headers.length > 0) {
    blocks.unshift(...headers.map((t) => ({ type: "paragraph", text: t, pageNumber: 1 })));
  }
  if (footers.length > 0) {
    blocks.push(...footers.map((t) => ({ type: "paragraph", text: t })));
  }
}
export {
  MAX_DECOMPRESS_SIZE,
  MAX_XML_DEPTH,
  MAX_ZIP_ENTRIES,
  ZipBombError,
  applyPageText,
  clampSpan,
  createSectionShared,
  createXmlParser,
  extractTextFromNode,
  findChildByLocalName,
  readZipEntry
};
