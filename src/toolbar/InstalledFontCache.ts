interface LocalFontWindow extends Window { queryLocalFonts?: () => Promise<Array<{ family: string }>>; }

/** Instance-owned cache: no cross-window permissions or global font state. */
export class InstalledFontCache {
	families: string[] | null = null;
	private pending: Promise<string[]> | null = null;
	load(document: Document): Promise<string[]> {
		if (this.families) return Promise.resolve(this.families);
		if (this.pending) return this.pending;
		const owner = document.defaultView as LocalFontWindow | null;
		this.pending = (async () => {
			try {
				const fonts = await owner?.queryLocalFonts?.() ?? [];
				return this.families = [...new Set(fonts.map(font => font.family.trim()).filter(Boolean))]
					.sort((left, right) => left.localeCompare(right, 'ko-KR'));
			} catch { return this.families = []; }
		})();
		return this.pending;
	}
}
