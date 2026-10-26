// Derived from kordoc 4.24.6, 71666c52fe6321e2ad1df8dfbc21b58693bd6ae3, src/utils.ts. MIT; see LICENSE.
const format = (...values) => values.map(String).join(" ");
const VERSION = typeof __KORDOC_VERSION__ !== "undefined" ? __KORDOC_VERSION__ : "0.0.0-dev";
function toArrayBuffer(buf) {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
    return buf.buffer;
  }
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
class KordocError extends Error {
  constructor(message) {
    super(message);
    this.name = "KordocError";
  }
}
function isFileNotFound(err) {
  if (typeof err !== "object" || err === null)
    return false;
  if (err.code === "ENOENT")
    return true;
  const msg = err.message;
  return typeof msg === "string" && /ENOENT|no such file or directory/i.test(msg);
}
function sanitizeError(err) {
  if (err instanceof KordocError)
    return err.message;
  if (isFileNotFound(err))
    return "\uD30C\uC77C \uB610\uB294 \uB514\uB809\uD1A0\uB9AC\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4";
  return "\uBB38\uC11C \uCC98\uB9AC \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4";
}
function isPathTraversal(name) {
  if (name.includes("\0"))
    return true;
  const normalized = name.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.some((s) => s === "..") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized);
}
function normalizeSectionHref(href) {
  if (!href)
    return null;
  let normalized = href.replace(/\\/g, "/").replace(/^\/+/, "");
  if (isPathTraversal(normalized))
    return null;
  if (/^[Ss]ection\d+\.xml$/.test(normalized))
    normalized = "Contents/" + normalized;
  return /(?:^|\/)[Ss]ection\d+\.xml$/.test(normalized) ? normalized : null;
}
function compareSectionPaths(a, b) {
  const ai = Number(a.match(/[Ss]ection(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const bi = Number(b.match(/[Ss]ection(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return ai === bi ? a.localeCompare(b) : ai - bi;
}
const MAX_UNZIP_ENV_MB = 8192;
function unzipLimitBytes(defaultBytes) {
  const mb = NaN;
  return Number.isFinite(mb) && mb > 0 ? Math.min(mb, MAX_UNZIP_ENV_MB) * 1024 * 1024 : defaultBytes;
}
function precheckZipSize(buffer, maxUncompressedSize = 256 * 1024 * 1024, maxEntries = 500, media) {
  try {
    const data = new DataView(buffer);
    const len = buffer.byteLength;
    let eocdOffset = -1;
    for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (data.getUint32(i, true) === 101010256) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0)
      return { totalUncompressed: 0, entryCount: 0 };
    const entryCount = data.getUint16(eocdOffset + 10, true);
    if (entryCount > maxEntries) {
      throw new KordocError(`ZIP \uC5D4\uD2B8\uB9AC \uC218 \uCD08\uACFC: ${entryCount} (\uCD5C\uB300 ${maxEntries})`);
    }
    const cdSize = data.getUint32(eocdOffset + 12, true);
    const cdOffset = data.getUint32(eocdOffset + 16, true);
    if (cdOffset + cdSize > len)
      return { totalUncompressed: 0, entryCount };
    let totalUncompressed = 0;
    let mediaUncompressed = 0;
    let pos = cdOffset;
    for (let i = 0; i < entryCount && pos + 46 <= cdOffset + cdSize; i++) {
      if (data.getUint32(pos, true) !== 33639248)
        break;
      const localOff = data.getUint32(pos + 42, true);
      const localSize = localOff + 30 <= len && data.getUint32(localOff, true) === 67324752 ? data.getUint32(localOff + 22, true) : 0;
      const size = Math.max(data.getUint32(pos + 24, true), localSize);
      const nameLen = data.getUint16(pos + 28, true);
      const extraLen = data.getUint16(pos + 30, true);
      const commentLen = data.getUint16(pos + 32, true);
      const isMedia = !!media && pos + 46 + nameLen <= len && media.re.test(new TextDecoder().decode(new Uint8Array(buffer, pos + 46, nameLen)));
      const never = isMedia && !!media?.never && media.never.test(new TextDecoder().decode(new Uint8Array(buffer, pos + 46, nameLen)));
      if (isMedia && !never)
        mediaUncompressed += size;
      if (!(isMedia && (media?.skip || never)))
        totalUncompressed += size;
      pos += 46 + nameLen + extraLen + commentLen;
    }
    if (totalUncompressed > maxUncompressedSize) {
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      const mediaNote = media && !media.skip && mediaUncompressed > 0 ? ` \u2014 \uADF8\uB9BC\xB7\uAC1C\uCCB4 \uD30C\uD2B8\uAC00 ${mb(mediaUncompressed)}MB, \uC774\uBBF8\uC9C0 \uCD94\uCD9C\uC744 \uB044\uBA74(images: false\xB7--no-images) \uC138\uC9C0 \uC54A\uB294\uB2E4` : "";
      throw new KordocError(`ZIP \uBE44\uC555\uCD95 \uD06C\uAE30 \uCD08\uACFC: ${mb(totalUncompressed)}MB (\uCD5C\uB300 ${maxUncompressedSize / 1024 / 1024}MB)${mediaNote}`);
    }
    return { totalUncompressed, entryCount };
  } catch (err) {
    if (err instanceof KordocError)
      throw err;
    return { totalUncompressed: 0, entryCount: 0 };
  }
}
function stripDtd(xml) {
  return xml.replace(/^\uFEFF/, "").replace(/<!DOCTYPE\s[^[>]*(\[[\s\S]*?\])?\s*>/gi, "");
}
const SAFE_HREF_RE = /^(?:https?:|mailto:|tel:|#)/i;
const HREF_ESCAPE = { "(": "%28", ")": "%29", "<": "%3C", ">": "%3E", '"': "%22", "'": "%27", "`": "%60" };
function sanitizeHref(href) {
  const trimmed = href.trim();
  if (!trimmed || !SAFE_HREF_RE.test(trimmed))
    return null;
  return trimmed.replace(/[()<>"'`]/g, (c) => HREF_ESCAPE[c]).replace(/\s/g, (c) => encodeURIComponent(c));
}
function escapeHtml(text, attr = false) {
  const s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return attr ? s.replace(/"/g, "&quot;") : s;
}
function unescapeHtml(text) {
  return text.replace(/&(lt|gt|quot|#39|amp);/g, (_, e) => HTML_ENTITY[e]);
}
const HTML_ENTITY = { lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" };
function routeConsoleToStderr() {}
function safeMin(arr) {
  let min = Infinity;
  for (let i = 0; i < arr.length; i++)
    if (arr[i] < min)
      min = arr[i];
  return min;
}
function safeMax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++)
    if (arr[i] > max)
      max = arr[i];
  return max;
}
const OPTIONAL_DEP_INSTALL_HINT = " \uB124\uD2B8\uC6CC\uD06C\uAC00 \uC81C\uD55C\uB41C linux/x64 \uC5D0\uC11C npx \uB85C \uC124\uCE58\uD588\uB2E4\uBA74 onnxruntime-node \uC758 CUDA \uB2E4\uC6B4\uB85C\uB4DC \uC2E4\uD328\uB85C \uD568\uAED8 \uBE60\uC84C\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4 \u2014 `ONNXRUNTIME_NODE_INSTALL=skip npx -y kordoc@^4 \u2026` \uB85C \uB2E4\uC2DC \uC124\uCE58\uD558\uC138\uC694.";
function classifyError(err) {
  if (!(err instanceof Error))
    return "PARSE_ERROR";
  const msg = err.message;
  if (isFileNotFound(err))
    return "FILE_NOT_FOUND";
  if (msg.includes("DRM"))
    return "DRM_PROTECTED";
  if (msg.includes("\uC554\uD638\uD654") || msg.includes("\uC554\uD638\uB85C \uBCF4\uD638"))
    return "ENCRYPTED";
  if (msg.includes("optional dependency"))
    return "MISSING_DEPENDENCY";
  if (msg.includes("Invalid string length") || msg.includes("Cannot create a string longer"))
    return "OUTPUT_TOO_LARGE";
  if (msg.includes("ZIP bomb") || msg.includes("ZIP \uBE44\uC555\uCD95 \uD06C\uAE30 \uCD08\uACFC") || msg.includes("ZIP \uC5D4\uD2B8\uB9AC \uC218 \uCD08\uACFC"))
    return "ZIP_BOMB";
  if (msg.includes("bomb") || msg.includes("\uD06C\uAE30 \uCD08\uACFC") || msg.includes("\uC555\uCD95 \uD574\uC81C"))
    return "DECOMPRESSION_BOMB";
  if (msg.includes("\uC774\uBBF8\uC9C0 \uAE30\uBC18"))
    return "IMAGE_BASED_PDF";
  if (msg.includes("\uC139\uC158") && (msg.includes("\uCC3E\uC744 \uC218 \uC5C6") || msg.includes("\uC5C6\uC74C")))
    return "NO_SECTIONS";
  if (msg.includes("\uC2DC\uADF8\uB2C8\uCC98") || msg.includes("\uBCF5\uAD6C\uD560 \uC218 \uC5C6"))
    return "CORRUPTED";
  return "PARSE_ERROR";
}
function partExtension(path) {
  return (/\.([A-Za-z0-9]{1,5})$/.exec(path.slice(path.lastIndexOf("/") + 1))?.[1] ?? "bin").toLowerCase();
}
export {
  KordocError,
  OPTIONAL_DEP_INSTALL_HINT,
  VERSION,
  classifyError,
  compareSectionPaths,
  escapeHtml,
  isPathTraversal,
  normalizeSectionHref,
  partExtension,
  precheckZipSize,
  routeConsoleToStderr,
  safeMax,
  safeMin,
  sanitizeError,
  sanitizeHref,
  stripDtd,
  toArrayBuffer,
  unescapeHtml,
  unzipLimitBytes
};
