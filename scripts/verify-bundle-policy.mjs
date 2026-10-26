import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Inspect executable AST nodes, including workers embedded as source strings. */
export function inspectBundle(source, filename = 'main.js') {
	const findings = [];
	const visited = new Set();
	function inspect(text, label) {
		if (visited.has(text)) return;
		visited.add(text);
		const internalName = `bundle-${visited.size}.js`;
		const file = ts.createSourceFile(internalName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
		const options = { allowJs: true, noResolve: true, noLib: true };
		const host = ts.createCompilerHost(options);
		host.getSourceFile = name => name === internalName ? file : undefined;
		const checker = ts.createProgram([internalName], options, host).getTypeChecker();
		function isConstructor(expression, seen = new Set()) {
			if (!ts.isIdentifier(expression)) return false;
			if (expression.text === 'Function') return true;
			const symbol = checker.getSymbolAtLocation(expression);
			if (!symbol || seen.has(symbol)) return false;
			seen.add(symbol);
			return symbol.declarations?.some(declaration => ts.isVariableDeclaration(declaration)
				&& declaration.initializer && isConstructor(declaration.initializer, seen)) ?? false;
		}
		function visit(node) {
			if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
				const expression = node.expression;
				const name = ts.isIdentifier(expression) ? expression.text
					: ts.isPropertyAccessExpression(expression) ? expression.name.text
						: ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : '';
				const args = node.arguments ?? [];
				const script = /^(?:createElement|createElementNS|createEl)$/.test(name)
					&& args.some(arg => ts.isStringLiteralLike(arg) && arg.text.toLowerCase() === 'script');
				if (script || name === 'eval' || name === 'Function' || isConstructor(expression)) {
					findings.push(`${label}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${script ? 'runtime script element' : 'dynamic code execution'}: ${node.getText(file).slice(0, 100)}`);
				}
			}
			if (ts.isStringLiteralLike(node) && node.text.length > 200 && /createElement|createEl|\bFunction\b|\beval\b/.test(node.text)) {
				inspect(node.text, `${label}:embedded`);
			}
			node.forEachChild(visit);
		}
		visit(file);
	}
	inspect(source, filename);
	return findings;
}

export async function verifyBundlePolicy(filename = 'main.js') {
	const findings = inspectBundle(await readFile(filename, 'utf8'), filename);
	assert.deepEqual(findings, [], 'Release bundle must not inject scripts or evaluate code dynamically');
	console.log('PASS bundle policy, including embedded workers: no script injection, eval or Function constructor.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyBundlePolicy();
