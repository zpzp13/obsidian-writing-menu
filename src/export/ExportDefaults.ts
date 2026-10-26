import type { WritingMenuSettings } from '../types';
import { DEFAULT_CONTENT, DEFAULT_DOCUMENT_STYLE } from './DocumentModel';
import type { ContentPolicy, DocumentStyle, ExportDefaults } from './DocumentModel';

export function exportContentPolicy(content?: Partial<ContentPolicy>): ContentPolicy {
	const included = (value: unknown): 'text' | 'exclude' => value === 'text' || value === 'keep' ? 'text' : 'exclude';
	return { ...DEFAULT_CONTENT, ...content, properties: content?.properties === 'text' ? 'text' : 'exclude',
		headings: included(content?.headings), tables: included(content?.tables), footnotes: included(content?.footnotes),
		images: content?.images === 'keep' ? 'keep' : 'exclude', formatting: content?.formatting === true, spaceIndent: false };
}

export function exportThemeAppearance(doc: Document | undefined = globalThis.document, dark = false): Pick<DocumentStyle, 'fontFamily' | 'color' | 'background'> {
	const fallback = { fontFamily: 'Arial', color: dark ? '#dadada' : '#222222', background: dark ? '#1e1e1e' : '#ffffff' };
	if (!doc?.defaultView || !doc.body) return fallback;
	const probe = doc.createElement('span');
	Object.assign(probe.style, { position: 'fixed', visibility: 'hidden', pointerEvents: 'none', fontFamily: 'var(--font-interface)', color: 'var(--text-normal)', backgroundColor: 'var(--background-primary)' });
	doc.body.appendChild(probe);
	try {
		const computed = doc.defaultView.getComputedStyle(probe);
		const canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d');
		const hex = (value: string, defaultColor: string): string => {
			if (!context) return defaultColor;
			context.clearRect(0, 0, 1, 1); context.fillStyle = defaultColor; context.fillStyle = value; context.fillRect(0, 0, 1, 1);
			const rgba = context.getImageData(0, 0, 1, 1).data;
			return rgba[3] ? '#' + [rgba[0], rgba[1], rgba[2]].map(channel => channel.toString(16).padStart(2, '0')).join('') : defaultColor;
		};
		const families = computed.fontFamily.split(',').map(font => font.replace(/["']/g, '').trim());
		const family = families.find(font => font && !/^(?:-apple-system|BlinkMacSystemFont|system-ui|ui-sans-serif|sans-serif|serif|monospace|inherit)$/i.test(font));
		return { fontFamily: family || fallback.fontFamily,
			color: hex(computed.color, fallback.color), background: hex(computed.backgroundColor, fallback.background) };
	} finally { probe.remove(); }
}
export function resolvedExportFont(doc: Document | undefined = globalThis.document): string { return exportThemeAppearance(doc).fontFamily; }

export function exportDefaults(settings: Partial<WritingMenuSettings>, resolvedFont?: string, dark = false, doc: Document | undefined = globalThis.document): ExportDefaults {
	const theme = exportThemeAppearance(doc, dark), defaults = settings.documentExportDefaults;
	if (resolvedFont) theme.fontFamily = resolvedFont;
	// The factory style is immutable; only the settings page controls the starting format and content policy.
	return { version: 2, format: defaults?.format ?? 'hwpx', content: defaults?.version === 2 ? exportContentPolicy(defaults.content) : { ...DEFAULT_CONTENT },
		style: { ...DEFAULT_DOCUMENT_STYLE, ...theme }, appearance: { fontFamily: true, color: true, background: true } };
}
