import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Execute production TS with explicit host mocks and real relative helper modules. */
export function loadTsFixture(file, bindings = {}) {
	const modules = new Map();
	const load = filename => {
		const cached = modules.get(filename);
		if (cached) return cached.exports;
		const module = { exports: {} };
		modules.set(filename, module);
		const source = readFileSync(filename, 'utf8');
		const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
		new Function('require', 'module', 'exports', js)(name => {
			if (Object.hasOwn(bindings, name)) return bindings[name];
			assert(name.startsWith('.'), 'Unexpected host dependency: ' + name);
			const dependency = path.resolve(path.dirname(filename), name + '.ts');
			assert(dependency.startsWith(root + path.sep), 'Fixture import escaped the repository');
			return load(dependency);
		}, module, module.exports);
		return module.exports;
	};
	return load(path.resolve(root, file));
}
