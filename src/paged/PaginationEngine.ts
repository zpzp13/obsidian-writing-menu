import { getTextRuns, renderPagedText } from './textLayout';
import type { PagedInlineFormatRange } from '../types';
import type { PageGeometry, PageRange } from './types';

interface ParagraphMeasurement {
	text: string;
	startsParagraph: boolean;
	lineStarts: number[];
	absoluteFrom: number;
	layoutFormatSignature: string;
}

interface ParagraphSlice {
	from: number;
	text: string;
	startsParagraph: boolean;
}

export interface PaginationEditHint {
	from: number;
	to: number;
	insertLength: number;
}

const CACHE_PREFIX_LENGTH = 32;
const MAX_EXACT_CACHE_ENTRIES = 2048;
const MAX_EXACT_CACHE_TEXT_LENGTH = 4096;
const MAX_MUTABLE_CACHE_ENTRIES = 128;
const MEASUREMENT_WINDOW_LENGTH = 512;
const MAX_LINE_WINDOW_CACHE_ENTRIES = 4096;

/**
 * Chromium-backed paragraph layout cache.
 *
 * The previous paginator rebuilt one hidden DOM containing the complete
 * document suffix after every keystroke. Its cost therefore grew linearly with
 * the document and it forced a synchronous full-document layout for every IME
 * commit. This engine measures only paragraphs whose text changed. Page ranges
 * are then packed from cached visual line starts without another DOM layout.
 *
 * For a paragraph that is being extended, every line before the edit line is
 * stable. One preceding line is included as a shaping/wrapping safety margin;
 * only that tail is sent back through Chromium.
 */
export class PaginationEngine {
	private geometry: PageGeometry;
	private readonly measurer: HTMLElement;
	private readonly range: Range;
	private readonly exactCache = new Map<string, ParagraphMeasurement>();
	private readonly prefixCache = new Map<string, ParagraphMeasurement>();
	private readonly positionCache = new Map<string, ParagraphMeasurement>();
	private readonly lineWindowCache = new Map<string, number[]>();
	private inlineFormats: PagedInlineFormatRange[] = [];

	constructor(measurer: HTMLElement, geometry: PageGeometry) {
		this.measurer = measurer;
		this.geometry = geometry;
		this.range = measurer.ownerDocument.createRange();
	}

	updateGeometry(geometry: PageGeometry): void {
		if (JSON.stringify(this.geometry) !== JSON.stringify(geometry)) {
			this.exactCache.clear();
			this.prefixCache.clear();
			this.positionCache.clear();
			this.lineWindowCache.clear();
		}
		this.geometry = geometry;
	}

	updateInlineFormats(ranges: PagedInlineFormatRange[]): void {
		this.inlineFormats = ranges.map(range => ({ ...range }));
	}

	get contentWidth(): number {
		return this.geometry.pageWidth - this.geometry.marginLeft - this.geometry.marginRight;
	}

	get contentHeight(): number {
		return this.geometry.pageHeight - this.geometry.marginTop - this.geometry.marginBottom;
	}

	paginate(
		source: string,
		startOffset = 0,
		startIndex = 0,
		stopAfterPage?: (page: PageRange) => boolean,
		editHint?: PaginationEditHint,
	): PageRange[] {
		if (source.length === 0) return [{ index: 0, from: 0, to: 0 }];
		if (startOffset > source.length) return [];
		if (startOffset === source.length) {
			return source.endsWith('\n')
				? [{ index: startIndex, from: startOffset, to: startOffset }]
				: [];
		}

		const pages: PageRange[] = [];
		const lineHeight = this.geometry.fontSize * this.geometry.lineHeight;
		const paragraphGap = this.geometry.fontSize * this.geometry.paragraphSpacing;
		// Relative tolerance keeps page boundaries invariant under uniform zoom.
		const pageCapacity = Math.max(lineHeight, this.contentHeight + lineHeight * 0.001);
		let pageFrom = startOffset;
		let usedHeight = 0;
		let pageHasLine = false;
		// Full pagination benefits from measuring missing paragraphs in one DOM
		// batch. Incremental pagination must stay lazy: collecting the entire
		// suffix here would make a one-character edit scan every later paragraph
		// before stopAfterPage gets a chance to reuse the stable page boundary.
		const preparedParagraphs = stopAfterPage ? null : this.collectParagraphs(source, startOffset);
		if (preparedParagraphs) this.prepareMissingParagraphs(preparedParagraphs);
		let paragraphCursor = startOffset;
		let paragraphIndex = 0;

		while (paragraphCursor <= source.length) {
			const newlineAt = source.indexOf('\n', paragraphCursor);
			const paragraphTo = newlineAt < 0 ? source.length : newlineAt;
			const paragraph = preparedParagraphs?.[paragraphIndex] ?? {
				from: paragraphCursor,
				text: source.slice(paragraphCursor, paragraphTo),
				startsParagraph: paragraphCursor === 0 || source[paragraphCursor - 1] === '\n',
			};
			const paragraphFrom = paragraph.from;
			const lineStarts = this.measureParagraph(
				paragraph.text,
				paragraph.startsParagraph,
				paragraph.from,
				editHint,
			);

			for (let lineIndex = 0; lineIndex < lineStarts.length; lineIndex++) {
				const lineFrom = paragraphFrom + lineStarts[lineIndex];
				const gapBeforeLine = lineIndex === 0 && paragraphIndex > 0 && pageHasLine
					? paragraphGap
					: 0;
				if (pageHasLine && usedHeight + gapBeforeLine + lineHeight > pageCapacity) {
					const page = {
						index: startIndex + pages.length,
						from: pageFrom,
						to: lineFrom,
					};
					pages.push(page);
					if (stopAfterPage?.(page)) return pages;
					pageFrom = lineFrom;
					usedHeight = 0;
					pageHasLine = false;
				}

				const effectiveGap = pageHasLine ? gapBeforeLine : 0;
				usedHeight += effectiveGap + lineHeight;
				pageHasLine = true;
			}

			if (newlineAt < 0) break;
			paragraphCursor = newlineAt + 1;
			paragraphIndex++;
		}

		pages.push({
			index: startIndex + pages.length,
			from: pageFrom,
			to: source.length,
		});
		return pages;
	}

	private collectParagraphs(source: string, startOffset: number): ParagraphSlice[] {
		const paragraphs: ParagraphSlice[] = [];
		let from = startOffset;
		while (from <= source.length) {
			const newlineAt = source.indexOf('\n', from);
			const to = newlineAt < 0 ? source.length : newlineAt;
			paragraphs.push({
				from,
				text: source.slice(from, to),
				startsParagraph: from === 0 || source[from - 1] === '\n',
			});
			if (newlineAt < 0) break;
			from = newlineAt + 1;
		}
		return paragraphs;
	}

	private prepareMissingParagraphs(paragraphs: ParagraphSlice[]): void {
		const unique = new Map<string, ParagraphSlice>();
		for (const paragraph of paragraphs) {
			// Long paragraphs must use bounded window measurement even when the
			// document also contains enough short paragraphs to enable batching.
			if (paragraph.text.length > MEASUREMENT_WINDOW_LENGTH) continue;
			const key = this.exactCacheKey(
				paragraph.text,
				paragraph.startsParagraph,
				this.inlineFormatSignature(paragraph.from, paragraph.text.length),
			);
			if (!key || !this.exactCache.has(key)) {
				unique.set(key ?? `long:${paragraph.from}:${paragraph.text.length}`, paragraph);
			}
		}
		// A single changed paragraph should use the incremental tail path. A cold
		// document or a bulk external update is faster as one DOM/layout batch.
		if (unique.size < 4) return;

		const missing = Array.from(unique.values());
		const joined = missing.map(paragraph => paragraph.text).join('\n');
		this.measurer.style.width = `${this.contentWidth}px`;
		renderPagedText(this.measurer, joined, 0, missing[0]?.startsParagraph ?? true);
		const runs = getTextRuns(this.measurer);
		for (let index = 0; index < missing.length; index++) {
			const paragraph = missing[index];
			const run = runs[index];
			if (run) this.applyInlineFormatting(run, paragraph.from, paragraph.text.length);
			const lineStarts = this.measureRunLines(paragraph.text, run);
			const measurement = {
				text: paragraph.text,
				startsParagraph: paragraph.startsParagraph,
				lineStarts,
				absoluteFrom: paragraph.from,
				layoutFormatSignature: this.inlineFormatSignature(paragraph.from, paragraph.text.length),
			};
			this.rememberMeasurement(
				this.exactCacheKey(
					paragraph.text,
					paragraph.startsParagraph,
					this.inlineFormatSignature(paragraph.from, paragraph.text.length),
				),
				this.prefixKey(paragraph.text, paragraph.startsParagraph, paragraph.from),
				this.positionKey(
					paragraph.startsParagraph,
					paragraph.from,
					this.inlineFormatSignature(paragraph.from, paragraph.text.length),
				),
				measurement,
			);
		}
	}

	private measureParagraph(
		text: string,
		startsParagraph: boolean,
		absoluteFrom: number,
		editHint?: PaginationEditHint,
	): number[] {
		// Never embed a large mutable paragraph in an exact-cache key. A 200k
		// character paragraph previously retained another full key + measurement
		// for every committed syllable until the 8k-entry cap was reached.
		const formatSignature = this.inlineFormatSignature(absoluteFrom, text.length);
		const exactKey = this.exactCacheKey(text, startsParagraph, formatSignature);
		const exact = exactKey ? this.exactCache.get(exactKey) : undefined;
		if (exact) {
			this.positionCache.set(this.positionKey(startsParagraph, absoluteFrom, formatSignature), {
				...exact,
				absoluteFrom,
			});
			this.trimOldest(this.positionCache, MAX_MUTABLE_CACHE_ENTRIES);
			return exact.lineStarts;
		}

		const prefixKey = this.prefixKey(text, startsParagraph, absoluteFrom);
		const positionKey = this.positionKey(startsParagraph, absoluteFrom, formatSignature);
		const candidate = this.positionCache.get(positionKey)
			?? this.prefixCache.get(prefixKey)
			?? this.sliceContainingMeasurement(absoluteFrom, startsParagraph, formatSignature);
		let lineStarts: number[];
		if (candidate?.text === text) {
			lineStarts = candidate.lineStarts;
		} else if (candidate) {
			const hintedBounds = this.localEditBounds(candidate, text, absoluteFrom, editHint);
			const commonPrefix = hintedBounds?.prefix
				?? this.commonPrefixLength(candidate.text, text);
			lineStarts = this.measureChangedTail(
				text,
				startsParagraph,
				candidate,
				commonPrefix,
				absoluteFrom,
				hintedBounds?.suffix,
			);
		} else {
			lineStarts = this.measureAllLines(text, startsParagraph, absoluteFrom);
		}

		const measurement = { text, startsParagraph, lineStarts, absoluteFrom, layoutFormatSignature: formatSignature };
		this.rememberMeasurement(exactKey, prefixKey, positionKey, measurement);
		return lineStarts;
	}

	private sliceContainingMeasurement(
		absoluteFrom: number,
		startsParagraph: boolean,
		formatSignature: string,
	): ParagraphMeasurement | undefined {
		// Bold/italic can change wrap points, so only derive a mid-paragraph cache
		// entry when both the old measurement and the requested suffix use the plain
		// layout. Other formats do not affect PaginationEngine line measurement.
		if (startsParagraph || formatSignature) return undefined;
		let best: ParagraphMeasurement | undefined;
		let bestLineIndex = -1;
		for (const candidate of this.positionCache.values()) {
			if (candidate.layoutFormatSignature || candidate.absoluteFrom >= absoluteFrom) continue;
			const relativeFrom = absoluteFrom - candidate.absoluteFrom;
			if (relativeFrom < 0 || relativeFrom > candidate.text.length) continue;
			const lineIndex = this.upperBound(candidate.lineStarts, relativeFrom) - 1;
			if (lineIndex < 0 || candidate.lineStarts[lineIndex] !== relativeFrom) continue;
			if (!best || candidate.absoluteFrom > best.absoluteFrom) {
				best = candidate;
				bestLineIndex = lineIndex;
			}
		}
		if (!best || bestLineIndex < 0) return undefined;
		const relativeFrom = absoluteFrom - best.absoluteFrom;
		return {
			text: best.text.slice(relativeFrom),
			startsParagraph,
			lineStarts: best.lineStarts.slice(bestLineIndex).map(offset => offset - relativeFrom),
			absoluteFrom,
			layoutFormatSignature: '',
		};
	}

	private measureChangedTail(
		text: string,
		startsParagraph: boolean,
		candidate: ParagraphMeasurement,
		commonPrefix: number,
		absoluteFrom: number,
		commonSuffixHint?: number,
	): number[] {
		let containingLine = this.upperBound(candidate.lineStarts, commonPrefix) - 1;
		containingLine = Math.max(0, containingLine);
		// Re-measure the line before the edit as well. This protects wrapping at
		// the shared boundary from kerning, ligatures and fallback-font shaping.
		const remeasureLine = Math.max(0, containingLine - 1);
		const stableFrom = candidate.lineStarts[remeasureLine] ?? 0;
		const reusable = candidate.lineStarts.slice(0, remeasureLine);
		const commonSuffix = commonSuffixHint
			?? this.commonSuffixLength(candidate.text, text, commonPrefix);
		if (commonSuffix >= CACHE_PREFIX_LENGTH * 2) {
			const delta = text.length - candidate.text.length;
			const oldSuffixFrom = candidate.text.length - commonSuffix;
			const newSuffixFrom = text.length - commonSuffix;
			const oldLineStarts = new Set(candidate.lineStarts.filter(offset => offset >= oldSuffixFrom));
			let chunkTo = Math.min(text.length, Math.max(stableFrom + 1024, newSuffixFrom + 256));
			for (;;) {
				const measured = this.measureAllLines(
					text.slice(stableFrom, chunkTo),
					startsParagraph && stableFrom === 0,
					absoluteFrom + stableFrom,
				).map(offset => stableFrom + offset);
				const safeMeasuredTo = chunkTo === text.length
					? chunkTo
					: chunkTo - CACHE_PREFIX_LENGTH * 2;
				const matchedNewStart = measured.find(offset => {
					if (offset < newSuffixFrom || offset > safeMeasuredTo) return false;
					return oldLineStarts.has(offset - delta);
				});
				if (matchedNewStart !== undefined) {
					const matchedOldStart = matchedNewStart - delta;
					return [
						...reusable,
						...measured.filter(offset => offset <= matchedNewStart),
						...candidate.lineStarts
							.filter(offset => offset > matchedOldStart)
							.map(offset => offset + delta),
					];
				}
				// If no old line boundary can be reused, the measurement that already
				// reached the end is the complete answer. Do not render the same long
				// tail once more below.
				if (chunkTo === text.length) return [...reusable, ...measured];
				// Growing by a fixed 1 KiB made a failed suffix search re-render
				// 1+2+...+N KiB. A 150k paragraph could therefore occupy the main
				// thread for seconds. Exponential growth bounds all probes together to
				// less than twice the final measured range.
				const measuredLength = Math.max(1024, chunkTo - stableFrom);
				chunkTo = Math.min(text.length, stableFrom + measuredLength * 2);
			}
		}
		const tailStarts = this.measureAllLines(
			text.slice(stableFrom),
			startsParagraph && stableFrom === 0,
			absoluteFrom + stableFrom,
		).map(offset => stableFrom + offset);
		return [...reusable, ...tailStarts];
	}

	private measureAllLines(text: string, startsParagraph: boolean, absoluteFrom: number): number[] {
		if (text.length <= MEASUREMENT_WINDOW_LENGTH) {
			return this.measureLineWindow(text, startsParagraph, absoluteFrom);
		}
		// Range geometry lookups inside one giant text node grow expensive with its
		// length. Even a single cold 200k paragraph made tens of thousands of queries
		// against that same node. Measure bounded windows and resume at a verified
		// visual line start, keeping two trailing lines as wrapping/shaping context.
		const lineStarts: number[] = [];
		let cursor = 0;
		while (cursor < text.length) {
			let chunkTo = Math.min(text.length, cursor + MEASUREMENT_WINDOW_LENGTH);
			let measured: number[];
			for (;;) {
				if (chunkTo < text.length && text.charCodeAt(chunkTo - 1) >= 0xd800
					&& text.charCodeAt(chunkTo - 1) <= 0xdbff) chunkTo++;
				measured = this.measureLineWindow(text.slice(cursor, chunkTo), startsParagraph && cursor === 0, absoluteFrom + cursor);
				if (chunkTo === text.length || measured.length >= 3) break;
				chunkTo = Math.min(text.length, cursor + (chunkTo - cursor) * 2);
			}
			if (chunkTo === text.length) {
				for (const offset of measured) lineStarts.push(cursor + offset);
				break;
			}
			const resumeLine = measured.length - 2;
			for (let index = 0; index < resumeLine; index++) lineStarts.push(cursor + measured[index]);
			cursor += measured[resumeLine];
		}
		return lineStarts;
	}

	private measureLineWindow(text: string, startsParagraph: boolean, absoluteFrom: number): number[] {
		const key = this.exactCacheKey(text, startsParagraph, this.inlineFormatSignature(absoluteFrom, text.length));
		const cached = key ? this.lineWindowCache.get(key) : undefined;
		if (cached) return cached;
		this.measurer.style.width = `${this.contentWidth}px`;
		renderPagedText(this.measurer, text, absoluteFrom, startsParagraph);
		const run = getTextRuns(this.measurer)[0];
		if (run) this.applyInlineFormatting(run, absoluteFrom, text.length);
		const measured = this.measureRunLines(text, run);
		if (key) {
			this.lineWindowCache.set(key, measured);
			this.trimOldest(this.lineWindowCache, MAX_LINE_WINDOW_CACHE_ENTRIES);
		}
		return measured;
	}

	private measureRunLines(text: string, run: HTMLElement | undefined): number[] {
		if (!run || text.length === 0) return [0];
		const offsets = this.codePointOffsets(text);
		const characterCount = offsets.length - 1;
		if (characterCount <= 1) return [0];

		const lineStarts = [0];
		let currentIndex = 0;
		let currentTop = this.characterTop(run, offsets, currentIndex);
		let estimatedLineLength = Math.min(64, characterCount - 1);
		while (currentIndex < characterCount - 1) {
			let sameLineIndex = currentIndex;
			let probe = Math.min(characterCount - 1, currentIndex + Math.max(1, estimatedLineLength));
			let probeTop = this.characterTop(run, offsets, probe);
			// Consecutive Korean lines commonly contain the same number of glyphs.
			// Prove the predicted boundary with its two neighbouring characters and
			// avoid another binary search across every line of a large paragraph.
			if (probeTop > currentTop + 0.5
				&& probe > currentIndex
				&& this.characterTop(run, offsets, probe - 1) <= currentTop + 0.5) {
				const previousIndex = currentIndex;
				currentIndex = probe;
				estimatedLineLength = currentIndex - previousIndex;
				currentTop = probeTop;
				lineStarts.push(offsets[currentIndex]);
				continue;
			}
			while (probe < characterCount - 1 && probeTop <= currentTop + 0.5) {
				sameLineIndex = probe;
				const distance = Math.max(1, probe - currentIndex);
				probe = Math.min(characterCount - 1, currentIndex + distance * 2);
				probeTop = this.characterTop(run, offsets, probe);
			}
			if (probeTop <= currentTop + 0.5) break;
			let low = sameLineIndex + 1;
			let high = probe;
			let nextTop = probeTop;
			while (low < high) {
				const middle = low + Math.floor((high - low) / 2);
				const middleTop = this.characterTop(run, offsets, middle);
				if (middleTop > currentTop + 0.5) {
					high = middle;
					nextTop = middleTop;
				} else low = middle + 1;
			}
			const previousIndex = currentIndex;
			currentIndex = low;
			estimatedLineLength = Math.max(1, currentIndex - previousIndex);
			currentTop = nextTop;
			lineStarts.push(offsets[currentIndex]);
		}
		return lineStarts;
	}

	private characterTop(run: HTMLElement, offsets: number[], codePointIndex: number): number {
		const from = offsets[codePointIndex] ?? 0;
		const to = offsets[codePointIndex + 1] ?? from;
		const start = this.domPointAtOffset(run, from);
		const end = this.domPointAtOffset(run, Math.max(from, to));
		this.range.setStart(start.node, start.offset);
		this.range.setEnd(end.node, end.offset);
		const rect = this.range.getClientRects()[0] ?? this.range.getBoundingClientRect();
		return rect.top;
	}

	private domPointAtOffset(run: HTMLElement, offset: number): { node: Text; offset: number } {
		const onlyChild = run.childNodes.length === 1 ? run.firstChild : null;
		if (onlyChild?.nodeType === Node.TEXT_NODE) {
			const text = onlyChild as Text;
			return { node: text, offset: Math.max(0, Math.min(text.length, offset)) };
		}
		const walker = run.ownerDocument.createTreeWalker(run, 4);
		let remaining = Math.max(0, offset);
		let last: Text | null = null;
		let current = walker.nextNode() as Text | null;
		while (current) {
			last = current;
			if (remaining <= current.length) return { node: current, offset: remaining };
			remaining -= current.length;
			current = walker.nextNode() as Text | null;
		}
		const fallback = last ?? run.appendChild(run.ownerDocument.createTextNode(''));
		return { node: fallback, offset: fallback.length };
	}

	private applyInlineFormatting(run: HTMLElement, absoluteFrom: number, textLength: number): void {
		const absoluteTo = absoluteFrom + textLength;
		const formats = this.inlineFormats.filter(range =>
			(range.kind === 'bold' || range.kind === 'italic')
			&& range.from < absoluteTo
			&& range.to > absoluteFrom,
		);
		if (formats.length === 0) return;
		const value = run.textContent ?? '';
		const boundaries = new Set<number>([absoluteFrom, absoluteTo]);
		for (const range of formats) {
			boundaries.add(Math.max(absoluteFrom, range.from));
			boundaries.add(Math.min(absoluteTo, range.to));
		}
		const points = Array.from(boundaries).sort((left, right) => left - right);
		const fragment = run.ownerDocument.createDocumentFragment();
		for (let index = 0; index < points.length - 1; index++) {
			const from = points[index];
			const to = points[index + 1];
			if (to <= from) continue;
			const segment = value.slice(from - absoluteFrom, to - absoluteFrom);
			const active = formats.filter(range => range.from <= from && range.to >= to);
			if (active.length === 0) {
				fragment.appendChild(run.ownerDocument.createTextNode(segment));
				continue;
			}
			const formatted = run.ownerDocument.createElement('span');
			if (active.some(range => range.kind === 'bold')) formatted.style.fontWeight = '700';
			if (active.some(range => range.kind === 'italic')) formatted.style.fontStyle = 'italic';
			formatted.textContent = segment;
			fragment.appendChild(formatted);
		}
		run.replaceChildren(fragment);
	}

	private codePointOffsets(text: string): number[] {
		const offsets = [0];
		let cursor = 0;
		while (cursor < text.length) {
			const codePoint = text.codePointAt(cursor) ?? 0;
			cursor += String.fromCodePoint(codePoint).length;
			offsets.push(cursor);
		}
		return offsets;
	}

	private commonPrefixLength(left: string, right: string): number {
		const limit = Math.min(left.length, right.length);
		let index = 0;
		while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index++;
		if (
			index > 0
			&& index < right.length
			&& right.charCodeAt(index) >= 0xdc00
			&& right.charCodeAt(index) <= 0xdfff
		) index--;
		return index;
	}

	private commonSuffixLength(left: string, right: string, commonPrefix: number): number {
		const limit = Math.min(left.length, right.length) - commonPrefix;
		let length = 0;
		while (
			length < limit
			&& left.charCodeAt(left.length - length - 1) === right.charCodeAt(right.length - length - 1)
		) length++;
		if (
			length > 0
			&& length < right.length
			&& right.charCodeAt(right.length - length) >= 0xdc00
			&& right.charCodeAt(right.length - length) <= 0xdfff
		) length--;
		return length;
	}

	private localEditBounds(
		candidate: ParagraphMeasurement,
		text: string,
		absoluteFrom: number,
		editHint?: PaginationEditHint,
	): { prefix: number; suffix: number } | null {
		if (!editHint || candidate.absoluteFrom !== absoluteFrom) return null;
		const oldFrom = editHint.from - absoluteFrom;
		const oldTo = editHint.to - absoluteFrom;
		const newTo = oldFrom + editHint.insertLength;
		if (
			oldFrom < 0
			|| oldTo < oldFrom
			|| oldTo > candidate.text.length
			|| newTo < oldFrom
			|| newTo > text.length
		) return null;
		// Native edits that still fit in a page can skip measurement for several IME
		// commits. The cached paragraph may then predate more than this single edit.
		// Verify the unchanged sides before treating its hint as a proven boundary;
		// otherwise stale line starts can be reused and later pages lose a line.
		if (candidate.text.length + editHint.insertLength - (oldTo - oldFrom) !== text.length
			|| !text.startsWith(candidate.text.slice(0, oldFrom))
			|| !text.endsWith(candidate.text.slice(oldTo))) return null;
		return {
			prefix: oldFrom,
			suffix: Math.min(candidate.text.length - oldTo, text.length - newTo),
		};
	}

	private upperBound(values: number[], target: number): number {
		let low = 0;
		let high = values.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if (values[middle] <= target) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	private inlineFormatSignature(absoluteFrom: number, textLength: number): string {
		const absoluteTo = absoluteFrom + textLength;
		return this.inlineFormats
			.filter(range => (range.kind === 'bold' || range.kind === 'italic') && range.from < absoluteTo && range.to > absoluteFrom)
			.map(range => `${range.kind}:${Math.max(0, range.from - absoluteFrom)}-${Math.min(textLength, range.to - absoluteFrom)}`)
			.join(',');
	}

	private exactCacheKey(text: string, startsParagraph: boolean, formatSignature: string): string | null {
		if (text.length > MAX_EXACT_CACHE_TEXT_LENGTH) return null;
		return `${startsParagraph ? '1' : '0'}:${formatSignature}:${text}`;
	}

	private prefixKey(text: string, startsParagraph: boolean, absoluteFrom: number): string {
		return `${startsParagraph ? '1' : '0'}:${this.inlineFormatSignature(absoluteFrom, Math.min(text.length, CACHE_PREFIX_LENGTH))}:${text.slice(0, CACHE_PREFIX_LENGTH)}`;
	}

	private positionKey(startsParagraph: boolean, absoluteFrom: number, formatSignature: string): string {
		return `${startsParagraph ? '1' : '0'}:${absoluteFrom}:${formatSignature}`;
	}

	private rememberMeasurement(
		exactKey: string | null,
		prefixKey: string,
		positionKey: string,
		measurement: ParagraphMeasurement,
	): void {
		if (exactKey) this.exactCache.set(exactKey, measurement);
		this.prefixCache.set(prefixKey, measurement);
		this.positionCache.set(positionKey, measurement);
		this.trimOldest(this.exactCache, MAX_EXACT_CACHE_ENTRIES);
		this.trimOldest(this.prefixCache, MAX_MUTABLE_CACHE_ENTRIES);
		this.trimOldest(this.positionCache, MAX_MUTABLE_CACHE_ENTRIES);
	}

	private trimOldest<T>(cache: Map<string, T>, maxEntries: number): void {
		while (cache.size > maxEntries) {
			const oldest = cache.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}
}
