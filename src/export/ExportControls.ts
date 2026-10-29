import { ColorComponent, ExtraButtonComponent, ToggleComponent, setIcon } from 'obsidian';
import { wmT } from '../i18n/index';
import type { DocumentFormat, DocumentStyle, ExportDefaults } from './DocumentModel';
import { ToolbarSelect } from '../toolbar/ToolbarSelect';
import { InstalledFontCache } from '../toolbar/InstalledFontCache';
import { fontWeightOptions } from '../fonts/FontWeights';
import { createFormatSlider } from '../toolbar/FormatSlider';
import { formatTypographyNumber } from '../utils/typography';
import { exportThemeAppearance } from './ExportDefaults';

let nextExportLabel = 0;
export function exportValueLabel(value: HTMLElement): Record<string, string> {
    return { 'aria-labelledby': value.dataset.labelId! };
}
export function exportButton(host: HTMLElement, label: string, action: () => void, cls = ''): HTMLButtonElement {
    const button = host.createEl('button', { text: label, cls, attr: { type: 'button' } }); button.addEventListener('click', action); return button;
}
/** Shared label/value row used by both export pages and the default settings. */
export function exportRow(host: HTMLElement, label: string, icon: string, field = ''): HTMLElement {
    const row = host.createDiv({ cls: 'wm-export-row', attr: field ? { 'data-field': field } : {} });
    const title = row.createDiv({ cls: 'wm-export-row-title' });
    setIcon(title.createSpan({ cls: 'wm-export-row-icon', attr: { 'aria-hidden': 'true' } }), icon);
    const id = 'wm-export-label-' + ++nextExportLabel;
    title.createSpan({ cls: 'wm-export-row-label', text: label, attr: { id } });
    return row.createDiv({ cls: 'wm-export-row-value', attr: { 'data-label-id': id } });
}
export function exportSection(host: HTMLElement, label: string, disabled = false): HTMLFieldSetElement {
    const section = host.createEl('fieldset', { cls: 'wm-export-control-group' }); section.disabled = disabled;
    section.createEl('legend', { cls: 'wm-export-section-title', text: label }); return section;
}
export function exportToggle(host: HTMLElement, label: string, value: boolean, change: (value: boolean) => void, icon = 'toggle-left'): ToggleComponent {
    const control = exportRow(host, label, icon);
    const toggle = new ToggleComponent(control).setValue(value).onChange(change);
    toggle.toggleEl.setAttribute('aria-labelledby', control.dataset.labelId!); return toggle;
}
export function exportSelect<T extends string>(host: HTMLElement, label: string, value: T, options: ReadonlyArray<readonly [T, string]>, change: (value: T) => void, icon = 'list-filter'): HTMLSelectElement {
    const control = exportRow(host, label, icon), wrapper = control.createDiv({ cls: 'wm-plotbook-sidebar-select' });
    const select = wrapper.createEl('select', { attr: exportValueLabel(control) });
    for (const [key, title] of options) select.createEl('option', { value: key, text: title }); select.value = value;
    select.addEventListener('change', () => change(select.value as T)); return select;
}
export class ExportControls {
    private pickers: ToolbarSelect[] = [];
    private fontCache = new InstalledFontCache();
    private paragraphMargin = 0;
    private paperMargin = 0;
    private spacingValues = new Map<DocumentStyle['lineSpacingType'], number>();
    constructor(private host: HTMLElement, private draft: ExportDefaults, private changed: () => void, private fonts: string[] = []) { this.render(); }
    setFormat(format: DocumentFormat): void { this.draft.format = format; this.render(); }
    dispose(): void { for (const picker of this.pickers) picker.destroy(); this.pickers = []; this.host.empty(); }
    private select<T extends string>(host: HTMLElement, label: string, value: T, options: ReadonlyArray<readonly [T, string]>, change: (value: T) => void, icon: string, pickerOptions: ConstructorParameters<typeof ToolbarSelect>[2] = {}): HTMLSelectElement {
        const select = exportSelect(host, label, value, options, change, icon);
        this.pickers.push(new ToolbarSelect(select, 'is-export-context', { ...pickerOptions, valueTooltip: false }));
        return select;
    }
    private number(host: HTMLElement, label: string, key: keyof DocumentStyle, unit: string, icon: string, min = 0, max = 2000): HTMLInputElement {
        const value = exportRow(host, label, icon, key), control = value.createDiv({ cls: 'wm-export-number wm-paged-size-input-row' });
        const input = control.createEl('input', { type: 'number', value: formatTypographyNumber(Number(this.draft.style[key])), attr: { ...exportValueLabel(value), min: String(min), max: String(max), step: '0.5' } });
        control.createSpan({ text: unit, cls: 'wm-paged-size-input-unit' });
        input.addEventListener('input', () => { Object.assign(this.draft.style, { [key]: input.value === '' ? NaN : Number(input.value) }); this.changed(); });
        return input;
    }
    private segments<T extends string>(value: HTMLElement, selected: T, options: ReadonlyArray<readonly [T, string]>, change: (value: T) => void): void {
        const track = value.createDiv({ cls: 'wm-segmented-control wm-export-control-segments', attr: { role: 'group', ...exportValueLabel(value) } });
        const buttons = options.map(([key, label]) => ({ key, button: exportButton(track, label, () => {
            for (const item of buttons) item.button.setAttribute('aria-pressed', String(item.key === key));
            change(key);
        }) }));
        for (const item of buttons) item.button.setAttribute('aria-pressed', String(item.key === selected));
        track.addEventListener('keydown', event => {
            const index = buttons.findIndex(item => item.button === event.target);
            if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next].button.focus(); buttons[next].button.click();
        });
    }
    private fontSize(host: HTMLElement): void {
        const block = host.createDiv({ cls: 'wm-export-slider-block' }), value = exportRow(block, wmT('크기'), 'a-large-small', 'fontSize');
        createFormatSlider(block, { labelledBy: value.dataset.labelId!, value: this.draft.style.fontSize, min: 1, max: Math.max(72, this.draft.style.fontSize), step: .5,
            display: raw => `${formatTypographyNumber(raw)} pt`, onInput: raw => { this.draft.style.fontSize = raw; this.changed(); } });
    }
    private fontWeight(host: HTMLElement): void {
        const block = host.createDiv({ cls: 'wm-export-slider-block' }), value = exportRow(block, wmT('두께'), 'bold', 'fontWeight');
        const weights = fontWeightOptions();
        createFormatSlider(block, { labelledBy: value.dataset.labelId!, value: this.draft.style.fontWeight, min: 100, max: 900, step: 100,
            display: raw => weights.find(([weight]) => weight === raw)?.[1] ?? wmT('보통'),
            onInput: raw => { this.draft.style.fontWeight = raw; this.changed(); } });
    }
    private indentation(host: HTMLElement): void {
        const block = host.createDiv({ cls: 'wm-export-slider-block' });
        const current = Math.max(0, this.draft.style.firstLineIndent), min = 0, max = Math.max(72, current);
        if (current !== this.draft.style.firstLineIndent) { this.draft.style.firstLineIndent = current; queueMicrotask(() => this.changed()); }
        const value = exportRow(block, wmT('들여쓰기'), 'indent-increase', 'firstLineIndent');
        createFormatSlider(block, { labelledBy: value.dataset.labelId!, value: current, min, max, step: .5,
            display: raw => `${formatTypographyNumber(raw)} pt`, onInput: raw => { this.draft.style.firstLineIndent = raw; this.changed(); } });
    }
    private lineSpacing(host: HTMLElement): void {
        const block = host.createDiv({ cls: 'wm-export-slider-block' });
        const choices = [['percent', wmT('비율')], ['fixed', wmT('고정')], ['atLeast', wmT('최소')], ['between', wmT('간격')]] as const;
        let previous = this.draft.style.lineSpacingType;
        this.spacingValues.set(previous, this.draft.style.lineSpacing);
        const row = exportRow(block, wmT('줄간격'), 'move-vertical', 'lineSpacing');
        this.segments(row, previous, choices, value => {
            this.spacingValues.set(previous, this.draft.style.lineSpacing); previous = value;
            this.draft.style.lineSpacingType = value;
            this.draft.style.lineSpacing = this.spacingValues.get(value) ?? (value === 'percent' ? 150 : value === 'between' ? 6 : this.draft.style.fontSize * 1.5);
            renderSlider(); this.changed();
        });
        const sliderHost = block.createDiv();
        const renderSlider = (): void => {
            sliderHost.empty(); const percent = this.draft.style.lineSpacingType === 'percent', current = this.draft.style.lineSpacing;
            createFormatSlider(sliderHost, { labelledBy: row.dataset.labelId!, value: current, min: Math.min(percent ? 100 : .5, current), max: Math.max(percent ? 300 : 72, current), step: percent ? 1 : .5,
                display: value => `${formatTypographyNumber(value)} ${percent ? '%' : 'pt'}`,
                onInput: value => { this.draft.style.lineSpacing = value; this.changed(); } });
        };
        renderSlider();
    }
    private alignment(host: HTMLElement): void {
        const value = exportRow(host, wmT('정렬'), 'align-left', 'align');
        const grid = value.createDiv({ cls: 'wm-paged-alignment-grid wm-export-alignment', attr: { role: 'group', ...exportValueLabel(value) } });
        const buttons: Array<{ button: HTMLButtonElement; alignment: DocumentStyle['align'] }> = [];
        for (const [alignment, icon, label] of [['left', 'align-left', wmT('왼쪽 정렬')], ['center', 'align-center', wmT('가운데 정렬')], ['right', 'align-right', wmT('오른쪽 정렬')], ['justify', 'align-justify', wmT('양쪽 정렬')]] as const) {
            const button = exportButton(grid, '', () => {
                this.draft.style.align = alignment;
                for (const item of buttons) { item.button.toggleClass('is-active', item.alignment === alignment); item.button.setAttribute('aria-pressed', String(item.alignment === alignment)); }
                this.changed();
            }, 'wm-paged-alignment-option');
            const id = 'wm-export-label-' + ++nextExportLabel;
            grid.createSpan({ cls: 'wm-export-sr-label', text: label, attr: { id } });
            button.setAttribute('aria-labelledby', id); button.setAttribute('aria-pressed', String(alignment === this.draft.style.align));
            button.toggleClass('is-active', alignment === this.draft.style.align); setIcon(button, icon); buttons.push({ button, alignment });
        }
    }
    private color(host: HTMLElement, label: string, key: 'color' | 'background', icon: string): void {
        const value = exportRow(host, label, icon, key); value.addClass('wm-export-native-color');
        const disabled = this.draft.format === 'txt';
        let picker: ColorComponent;
        new ExtraButtonComponent(value).setIcon('reset').setTooltip(wmT('기본값으로 초기화')).setDisabled(disabled).onClick(() => {
            this.draft.style[key] = exportThemeAppearance(this.host.ownerDocument)[key];
            this.draft.appearance ??= { fontFamily: false, color: false, background: false }; this.draft.appearance[key] = true;
            picker.setValue(this.draft.style[key]); this.changed();
        });
        picker = new ColorComponent(value).setValue(this.draft.style[key]).setDisabled(disabled).onChange(color => { this.draft.style[key] = color; this.changed(); });
        value.querySelector('input[type="color"]')?.setAttribute('aria-labelledby', value.dataset.labelId!);
    }
    private margins(host: HTMLElement, paper: boolean): void {
        const block = host.createDiv({ cls: 'wm-export-slider-block' });
        const value = exportRow(block, wmT('여백'), 'align-vertical-space-around', paper ? 'page-margins' : 'paragraph-margins');
        const track = value.createDiv({ cls: 'wm-segmented-control wm-export-margin-segments', attr: { role: 'group', ...exportValueLabel(value) } });
        const fields = paper
            ? [['marginTop', wmT('위')], ['marginBottom', wmT('아래')], ['marginLeft', wmT('왼쪽')], ['marginRight', wmT('오른쪽')]] as const
            : [['spaceBefore', wmT('위')], ['spaceAfter', wmT('아래')], ['paragraphLeft', wmT('왼쪽')], ['paragraphRight', wmT('오른쪽')]] as const;
        const sliderHost = block.createDiv();
        const buttons = fields.map(([, label], index) => exportButton(track, label, () => {
            if (paper) this.paperMargin = index; else this.paragraphMargin = index; renderSlider();
        }));
        const renderSlider = (): void => {
            sliderHost.empty(); const selected = paper ? this.paperMargin : this.paragraphMargin, [key] = fields[selected];
            buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === selected)));
            const current = this.draft.style[key];
            const limit = paper ? selected < 2 ? this.draft.style.pageHeight : this.draft.style.pageWidth : 72;
            const slider = createFormatSlider(sliderHost, { labelledBy: value.dataset.labelId!, value: current, min: 0, max: Math.max(current, paper ? Math.min(100, limit - 1) : limit), step: paper ? .1 : .5,
                display: raw => `${formatTypographyNumber(raw)} ${paper ? 'mm' : 'pt'}`, onInput: raw => { this.draft.style[key] = raw; this.changed(); } });
            const range = slider.element.querySelector('input')!; range.setAttribute('aria-labelledby', `${value.dataset.labelId} ${buttons[selected].id}`);
        };
        buttons.forEach(button => { button.id = 'wm-export-label-' + ++nextExportLabel; });
        track.addEventListener('keydown', event => {
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4;
            buttons[next].focus(); buttons[next].click();
        });
        renderSlider();
    }
    private render(): void {
        this.dispose(); this.host.addClass('wm-export-controls');
        const content = exportSection(this.host, wmT('추출 범위'));
        exportToggle(content, wmT('주석'), this.draft.content.comments === 'keep', value => { this.draft.content.comments = value ? 'keep' : 'exclude'; this.changed(); }, 'message-square');
        exportToggle(content, wmT('속성'), this.draft.content.properties === 'text', value => { this.draft.content.properties = value ? 'text' : 'exclude'; this.changed(); }, 'list-filter');
        for (const [key, label, icon] of [['headings', wmT('헤딩'), 'heading'], ['tables', wmT('표'), 'table'], ['footnotes', wmT('각주'), 'superscript']] as const) {
            exportToggle(content, label, this.draft.content[key] !== 'exclude', value => { this.draft.content[key] = value ? 'text' : 'exclude'; this.changed(); }, icon);
        }
        exportToggle(content, wmT('이미지'), this.draft.content.images === 'keep', value => { this.draft.content.images = value ? 'keep' : 'exclude'; this.changed(); }, 'image');
        exportToggle(content, wmT('강조'), this.draft.content.emphasis, value => { this.draft.content.emphasis = value; this.changed(); }, 'bold');
        const formatting = exportToggle(content, wmT('서식'), this.draft.content.formatting === true, value => { this.draft.content.formatting = value; this.changed(); }, 'text-initial');
        formatting.setDisabled(this.draft.format === 'txt');
        const style = exportSection(this.host, wmT('글자'), this.draft.format === 'txt');
        const fonts = [...new Set([this.draft.style.fontFamily, ...this.fonts, 'Arial', '맑은 고딕', 'Apple SD Gothic Neo', '바탕', '함초롬바탕', 'Noto Serif KR'])];
        this.select(style, wmT('글꼴'), this.draft.style.fontFamily, fonts.map(font => [font, font] as const), value => { this.draft.style.fontFamily = value; this.changed(); }, 'type', { searchable: true, custom: 'text', fontPreview: true, loadOptions: () => this.fontCache.load(this.host.ownerDocument) });
        this.fontSize(style);
        this.fontWeight(style);
        this.color(style, wmT('글자색'), 'color', 'baseline');
        const paragraph = exportSection(this.host, wmT('문단'), this.draft.format === 'txt');
        this.alignment(paragraph);
        this.indentation(paragraph);
        this.lineSpacing(paragraph);
        this.margins(paragraph, false);
        const page = exportSection(this.host, wmT('용지'), this.draft.format === 'txt');
        const papers: Record<string, [number, number]> = { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4] };
        const paper = Object.entries(papers).find(([, [width, height]]) => Math.abs(this.draft.style.pageWidth - width) < .1 && Math.abs(this.draft.style.pageHeight - height) < .1)?.[0] || 'custom';
        this.select(page, wmT('규격'), paper, [['custom', wmT('사용자 지정')], ['a4', 'A4'], ['a5', 'A5'], ['letter', 'Letter']], value => {
            if (papers[value]) { [this.draft.style.pageWidth, this.draft.style.pageHeight] = papers[value]; this.render(); this.changed(); }
        }, 'file');
        this.number(page, wmT('너비'), 'pageWidth', 'mm', 'move-horizontal', 20); this.number(page, wmT('높이'), 'pageHeight', 'mm', 'move-vertical', 20);
        this.margins(page, true);
        this.color(page, wmT('배경색'), 'background', 'paint-bucket');
        if (this.draft.format === 'txt') this.host.createEl('p', { cls: 'wm-export-help', text: wmT('TXT 파일에는 글꼴과 쪽 설정이 저장되지 않습니다.') });
    }
}
