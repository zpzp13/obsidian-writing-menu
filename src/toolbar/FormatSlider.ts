import { formatTypographyNumber } from '../utils/typography';

interface FormatSliderOptions {
    label?: string;
    labelledBy?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    display?: (value: number) => string;
    onInput: (value: number) => void;
    onChange?: (value: number) => void;
}

/** The editor Format control and export settings share one slider and scale. */
export function createFormatSlider(container: HTMLElement, options: FormatSliderOptions): { element: HTMLElement; setValue: (value: number) => void } {
    const { min, max, step, label, labelledBy, onInput, onChange } = options;
    const section = container.createDiv({ cls: 'wm-writing-format-section wm-writing-format-slider-section' });
    if (label) section.createDiv({ cls: 'wm-writing-format-section-title', text: label });
    const slider = section.createEl('input', { type: 'range', cls: 'slider wm-writing-format-slider', attr: {
        min: String(min), max: String(max), step: String(step), ...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label || '' }),
    } });
    const scale = section.createDiv({ cls: 'wm-writing-format-slider-scale' });
    const display = options.display ?? formatTypographyNumber;
    scale.createSpan({ cls: 'wm-writing-format-slider-limit', text: display(min) });
    const current = scale.createSpan({ cls: 'wm-writing-format-slider-current' });
    scale.createSpan({ cls: 'wm-writing-format-slider-limit', text: display(max) });
    const sync = (): number => {
        const next = Number(slider.value), percent = max === min ? 0 : (next - min) / (max - min) * 100;
        current.setText(display(next)); slider.setAttribute('aria-valuetext', display(next));
        slider.style.background = `linear-gradient(to right, var(--text-normal) ${percent}%, var(--background-modifier-border) ${percent}%)`;
        return next;
    };
    const setValue = (value: number): void => { slider.value = String(Math.max(min, Math.min(max, value))); sync(); };
    setValue(options.value);
    slider.addEventListener('input', () => onInput(sync()));
    slider.addEventListener('change', () => { const value = sync(); onInput(value); onChange?.(value); });
    return { element: section, setValue };
}
