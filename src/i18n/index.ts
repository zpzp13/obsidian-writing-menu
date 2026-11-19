import { en } from './en';

export type WritingMenuLanguage = 'ko' | 'en';

let language: WritingMenuLanguage = 'ko';

/** Configure once before loading UI modules. User content never passes through this catalog. */
export function setLanguage(value: string): void {
	language = /^ko(?:[-_]|$)/i.test(value) ? 'ko' : 'en';
}

export function getLanguage(): WritingMenuLanguage {
	return language;
}

export function getLocale(): string {
	return language === 'ko' ? 'ko-KR' : 'en-US';
}

/** Korean source keys retain the existing UI and provide a fallback for missing translations. */
export function wmT(source: string, ...values: Array<string | number | boolean | null | undefined>): string {
	// "context\u0004text" (gettext style) gives one Korean word several English
	// translations; untranslated, only the text after the separator is shown.
	const message = language === 'en' && Object.prototype.hasOwnProperty.call(en, source)
		? en[source as keyof typeof en] : source.slice(source.indexOf('\u0004') + 1);
	// A callback keeps dollar signs and braces in filenames and user values literal.
	return message.replace(/\{(\d+)\}/g, (placeholder: string, index: string) => {
		const value = values[Number(index)];
		return Number(index) < values.length ? String(value) : placeholder;
	});
}
