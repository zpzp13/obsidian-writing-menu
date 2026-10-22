import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import postcss from 'postcss';

export const normalize = text => text.replace(/\s+/g, ' ').trim();
export const hash = text => createHash('sha256').update(normalize(text)).digest('hex');
export function cssLocation(root, warning) {
	let found;
	root.walkDecls(node => {
		const { start, end } = node.source;
		if (start.line === warning.line && start.column <= warning.column && (end.line > warning.line || end.column >= warning.column)) found = node;
	});
	if (!found) return { selector: `<unmatched:${warning.line}:${warning.column}>`, property: '', value: '', context: '' };
	const contexts = []; for (let parent = found.parent.parent; parent?.type !== 'root'; parent = parent.parent) contexts.unshift(`@${parent.name} ${parent.params}`);
	return { selector: normalize(found.parent.selector), property: found.prop, value: normalize(found.value), context: contexts.join(' / ') };
}
export function sourceWarnings(results) {
	return results.flatMap(result => result.messages.map(message => {
		const file = path.relative(process.cwd(), result.filePath).replaceAll('\\', '/');
		const line = fs.readFileSync(file, 'utf8').split('\n')[message.line - 1] ?? '';
		return { file, rule: message.ruleId, symbol: line.slice(message.column - 1, message.endColumn ? message.endColumn - 1 : undefined), severity: message.severity === 2 ? 'error' : 'warning', line: message.line, message: message.message };
	}));
}
export function cssWarnings(results) {
	const root = postcss.parse(fs.readFileSync('styles.css', 'utf8'));
	return results.flatMap(result => result.warnings.map(warning => ({ file: 'styles.css', rule: warning.rule, ...cssLocation(root, warning), severity: warning.severity, line: warning.line, message: warning.text })));
}
export function capabilities() {
	const files = ['main.ts'];
	const walk = directory => { for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const name = path.posix.join(directory, item.name); if (item.isDirectory() && item.name !== 'vendor') walk(name); else if (item.isFile() && name.endsWith('.ts')) files.push(name); } };
	walk('src');
	const found = [];
	for (const file of files) {
		const text = fs.readFileSync(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const record = (node, kind, call) => found.push({ file, kind, call, fingerprint: hash(node.getText(source)), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
		const visit = node => {
			if (ts.isImportDeclaration(node) && /^(?:node:)?(?:fs(?:\/promises)?|child_process)$/.test(node.moduleSpecifier.text)) record(node, node.moduleSpecifier.text.includes('fs') ? 'filesystem' : 'process', node.moduleSpecifier.text);
			if (ts.isCallExpression(node)) {
				const expression = node.expression.getText(source), args = node.arguments;
				if (expression === 'require' && args[0] && ts.isStringLiteral(args[0]) && /^(?:node:)?(?:fs(?:\/promises)?|child_process)$/.test(args[0].text)) record(node, args[0].text.includes('fs') ? 'filesystem' : 'process', `require(${args[0].text})`);
				else if (/\.(getFiles|getMarkdownFiles|getAllLoadedFiles)$/.test(expression)) record(node, 'vault-enumeration', expression);
				else if (/(?:localStorage|sessionStorage)\./.test(expression)) record(node, 'device-storage', expression);
				else if (/clipboard\.(readText|writeText|read|write)$/.test(expression)) record(node, 'clipboard', expression);
				else if (/^fs\./.test(expression) || expression === 'getFs') record(node, 'filesystem', expression);
				else if (expression === 'spawn') record(node, 'process', expression);
				else if (expression === 'fetch' || /\.fetch$/.test(expression)) record(node, 'stream-network', expression);
			}
			node.forEachChild(visit);
		}; visit(source);
	}
	return found;
}
export const sourceKey = item => [item.file, item.rule, item.symbol].join('|');
export const cssKey = item => [item.file, item.rule, item.context, item.selector, item.property, item.value].join('|');
export const capabilityKey = item => [item.file, item.kind, item.call, item.fingerprint].join('|');
