import { setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';

export async function addCompactControl(plugin: WritingMenuPlugin, container: HTMLElement, label: string, value: any, callback: (v: any) => void, icon?: string, type: string = 'text'){
	const div = container.createDiv('writing-menu-control');
	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });
	const input = div.createEl('input', { type: type, value: value });

	if (type === 'text') {
		input.setCssStyles({ width: '100px', textAlign: 'right' });
	}

	input.onchange = (e) => callback((e.target as HTMLInputElement).value);
}

export async function addCompactToggle(plugin: WritingMenuPlugin, container: HTMLElement, label: string, value: boolean, callback: (v: boolean) => void, icon?: string){
	const div = container.createDiv('writing-menu-control');
	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });
	const toggle = div.createDiv(`writing-menu-toggle ${value ? 'is-enabled' : ''}`);
	toggle.createDiv('writing-menu-toggle-thumb');
	toggle.onclick = () => {
		const newVal = !toggle.classList.contains('is-enabled');
		toggle.classList.toggle('is-enabled', newVal);
		callback(newVal);
	};
}

export async function addCompactStepper(plugin: WritingMenuPlugin, container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void, icon?: string){
	const div = container.createDiv('writing-menu-control');
	div.setCssStyles({ paddingRight: '4px' });

	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });

	const group = div.createDiv('writing-menu-control-group');
	group.setCssStyles({ gap: '0' });

	const input = group.createEl('input', { type: 'number', value: value.toString() });
	input.setCssStyles({ width: '40px', textAlign: 'right', border: 'none', background: 'transparent', marginRight: '12px' });
	input.onchange = (e) => callback(Number((e.target as HTMLInputElement).value));

	const minus = group.createDiv('clickable-icon wm-icon-btn-20');
	setIcon(minus, 'minus');
	minus.setCssStyles({ cursor: 'pointer' });
	minus.onclick = () => {
		let newVal = Number(input.value) - step;
		newVal = Math.round(newVal * 100) / 100;
		newVal = Math.max(newVal, min);
		input.value = newVal.toString();
		callback(newVal);
	};
	const minusSvg = minus.querySelector('svg');
	if (minusSvg) {
		minusSvg.setAttribute('width', '15'); minusSvg.setAttribute('height', '15');
		(minusSvg as unknown as HTMLElement).setCssStyles({ width: '15px', height: '15px' });
	}

	const plus = group.createDiv('clickable-icon wm-icon-btn-20');
	setIcon(plus, 'plus');
	plus.setCssStyles({ cursor: 'pointer' });
	plus.onclick = () => {
		let newVal = Number(input.value) + step;
		newVal = Math.round(newVal * 100) / 100;
		input.value = newVal.toString();
		callback(newVal);
	};
	const plusSvg = plus.querySelector('svg');
	if (plusSvg) {
		plusSvg.setAttribute('width', '15'); plusSvg.setAttribute('height', '15');
		(plusSvg as unknown as HTMLElement).setCssStyles({ width: '15px', height: '15px' });
	}

	group.empty();
	group.appendChild(input);
	group.appendChild(minus);
	group.appendChild(plus);
}

export async function addCompactSlider(plugin: WritingMenuPlugin, container: HTMLElement, label: string, value: number, min: number, max: number, step: number, callback: (v: number) => void, icon?: string){
	const div = container.createDiv('writing-menu-control');

	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });

	const slider = div.createEl('input', { type: 'range', cls: 'slider' });
	slider.min = min.toString();
	slider.max = max.toString();
	slider.step = step.toString();
	slider.value = value.toString();
	slider.setCssStyles({ width: '80px' });
	slider.addClass('wm-compact-slider');
	slider.oninput = (e) => callback(Number((e.target as HTMLInputElement).value));
}

export async function addDualColorControl(plugin: WritingMenuPlugin, container: HTMLElement, label: string, value: string | { light: string, dark: string }, callback: (v: any) => void, icon?: string){
	const div = container.createDiv('writing-menu-control');

	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });

	const group = div.createDiv('writing-menu-control-group');
	group.setCssStyles({ gap: '8px' });

	const lightVal = typeof value === 'string' ? value : value.light;
	const darkVal = typeof value === 'string' ? value : value.dark;

	const lightInput = group.createEl('input', { type: 'color', value: lightVal === 'inherit' ? '#000000' : lightVal === 'transparent' ? '#ffffff' : lightVal });
	lightInput.addClass('wm-compact-color-input');

	lightInput.onchange = (e) => {
		const newVal = { light: (e.target as HTMLInputElement).value, dark: darkVal };
		callback(newVal);
	};

	const darkInput = group.createEl('input', { type: 'color', value: darkVal === 'inherit' ? '#ffffff' : darkVal === 'transparent' ? '#000000' : darkVal });
	darkInput.addClass('wm-compact-color-input');

	darkInput.onchange = (e) => {
		const newVal = { light: lightVal, dark: (e.target as HTMLInputElement).value };
		callback(newVal);
	};
}
