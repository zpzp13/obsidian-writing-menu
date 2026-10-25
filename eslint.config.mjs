import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

const { minAppVersion } = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const typedRules = ['no-unnecessary-type-assertion', 'no-unsafe-member-access', 'no-unsafe-argument',
	'no-unsafe-assignment', 'no-unsafe-return', 'no-unsafe-call', 'no-explicit-any', 'unbound-method',
	'no-misused-promises', 'no-this-alias'];

export default [...obsidianmd.configs.recommended, {
	ignores: ['node_modules/**', '.codex-tmp/**', 'dist/**', 'src/repetition/vendor/**'],
}, {
	files: ['main.ts', 'src/**/*.ts'],
	languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)) } },
	plugins: { obsidianmd, '@typescript-eslint': tseslint.plugin },
	rules: {
		...Object.fromEntries(typedRules.map(name => [`@typescript-eslint/${name}`, 'error'])),
		...Object.fromEntries(['no-global-this', 'prefer-create-el', 'prefer-window-timers', 'hardcoded-config-path', 'no-static-styles-assignment'].map(name => [`obsidianmd/${name}`, 'error'])),
		'obsidianmd/no-unsupported-api': ['error', { minAppVersion }],
		'no-control-regex': 'error',
		'no-useless-escape': 'error',
		'@typescript-eslint/prefer-promise-reject-errors': ['error', { allowEmptyReject: false, allowThrowingAny: false, allowThrowingUnknown: false }],
		'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
		'obsidianmd/ui/sentence-case': ['warn', {
			brands: ['Obsidian', 'Markdown', 'Daum', 'NVIDIA Build', 'Google AI Studio', 'Python', 'Lucide', 'Enter', 'Music Library'],
			acronyms: ['TXT', 'HWP', 'HWPX', 'PC', 'AI', 'API', 'CLI', 'NVIDIA', 'BGM', 'SVG', 'JSON'],
			ignoreRegex: ['^inherit$', '^YYYY-MM-DD$', '^nvapi-\\.\\.\\.$', '^AIza\\.\\.\\.$', '^Music/BGM$', String.raw`^C:\\Users\\사용자\\Desktop$`],
			enforceCamelCaseLower: true,
		}],
	},
}];
