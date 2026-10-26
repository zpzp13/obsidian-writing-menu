export interface InstalledFontFace { family: string; fullName?: string; postscriptName?: string; style?: string }
interface LocalFontWindow extends Window { queryLocalFonts?: () => Promise<InstalledFontFace[]>; }

/** Instance-owned cache: no cross-window permissions or global font state. */
export class InstalledFontCache {
	families: string[] | null = null;
	private pending: Promise<string[]> | null = null;
	private faces: Promise<InstalledFontFace[]> | null = null;
	loadFaces(document: Document): Promise<InstalledFontFace[]> {
		const owner = document.defaultView as LocalFontWindow | null;
		return this.faces ??= (async () => {
			try { return (await owner?.queryLocalFonts?.() ?? []).map(font => ({ family: font.family.trim(), fullName: font.fullName, postscriptName: font.postscriptName, style: font.style })); }
			catch { return []; }
		})();
	}
	load(document: Document): Promise<string[]> {
		if (this.families) return Promise.resolve(this.families);
		if (this.pending) return this.pending;
		this.pending = (async () => {
			try {
				const fonts = await this.loadFaces(document);
				return this.families = [...new Set(fonts.map(font => font.family.trim()).filter(Boolean))]
					.sort((left, right) => left.localeCompare(right, 'ko-KR'));
			} catch { return this.families = []; }
		})();
		return this.pending;
	}
}
