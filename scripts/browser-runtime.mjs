import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const zipEntry = require.resolve('jszip/lib/index.js');

function replaceRequired(source, before, after, label) {
	if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
		throw new Error(`Review the updated ${label} before building.`);
	}
	return source.replace(before, after);
}

/** Keep the full JSZip API, using the promises and timers supplied by Obsidian. */
export function browserRuntime() {
	return {
		name: 'obsidian-browser-runtime',
		setup(builder) {
			builder.onLoad({ filter: /[\\/]lodash-es[\\/]_root\.js$/ }, () => ({
				contents: 'export default globalThis;', loader: 'js',
			}));
			// JSZip's browser field otherwise selects a prebundle with IE script
			// injection and string-to-function timer polyfills, including in docx.
			builder.onResolve({ filter: /^jszip$/ }, () => ({ path: zipEntry }));
			builder.onLoad({ filter: /[\\/]jszip[\\/]lib[\\/]external\.js$/ }, () => ({
				contents: 'module.exports = { Promise };', loader: 'js',
			}));
			// Match JSZip's browser distribution: Node streams are unavailable;
			// Uint8Array, ArrayBuffer and Blob input/output remain supported.
			builder.onLoad({ filter: /[\\/]jszip[\\/]lib[\\/]readable-stream-browser\.js$/ }, () => ({
				contents: 'module.exports = {};', loader: 'js',
			}));
			builder.onLoad({ filter: /[\\/]jszip[\\/]lib[\\/]utils\.js$/ }, async args => {
				const source = await readFile(args.path, 'utf8');
				const legacy = 'require("setimmediate");';
				if (!source.includes(legacy)) throw new Error('Review the updated JSZip scheduler before building.');
				return {
					contents: source.replace(legacy, 'const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);'),
					loader: 'js', resolveDir: path.dirname(args.path),
				};
			});
			builder.onLoad({ filter: /[\\/]docx[\\/]dist[\\/]index\.mjs$/ }, async args => {
				let source = await readFile(args.path, 'utf8');
				// Replace legacy feature detection with the equivalent native features.
				const bindStart = source.indexOf('//#region node_modules/function-bind/implementation.js');
				const bindEnd = source.indexOf('//#endregion', bindStart);
				if (bindStart < 0 || bindEnd < 0) throw new Error('Review the updated docx bind implementation.');
				source = source.slice(0, bindStart) + 'var require_implementation = () => Function.prototype.bind;\n' + source.slice(bindEnd);
				source = replaceRequired(source,
					'$Function("\\"use strict\\"; return (" + expressionSyntax + ").constructor;")()',
					'({ "async function () {}": Object.getPrototypeOf(async function () {}).constructor, "function* () {}": Object.getPrototypeOf(function* () {}).constructor, "async function* () {}": Object.getPrototypeOf(async function* () {}).constructor })[expressionSyntax]',
					'docx intrinsic detection');
				source = replaceRequired(source, 'Function("return function*() {}")()', '(function* () {})', 'docx generator detection');
				const start = source.indexOf('//#region node_modules/jszip/dist/jszip.min.js');
				const end = source.indexOf('//#endregion', start);
				if (start < 0 || end < 0 || !source.slice(start, end).includes('var require_jszip_min =')) {
					throw new Error('Review the updated docx ZIP bundle before building.');
				}
				return {
					contents: 'import ObsidianJSZip from "jszip";\n' + source.slice(0, start)
						+ 'var require_jszip_min = () => ObsidianJSZip;\n' + source.slice(end),
					loader: 'js', resolveDir: path.dirname(args.path),
				};
			});
		},
	};
}
