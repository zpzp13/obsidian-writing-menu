import { setIcon, App, Platform, Setting } from 'obsidian';
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
		input.style.width = '100px';
		input.style.textAlign = 'right';
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
	div.style.paddingRight = '4px';

	const labelGroup = div.createDiv('writing-menu-control-label-group');
	if (icon) {
		const iconSpan = labelGroup.createSpan('writing-menu-icon');
		setIcon(iconSpan, icon);
	}
	labelGroup.createEl('label', { text: label });

	const group = div.createDiv('writing-menu-control-group');
	group.style.gap = '0';

	const input = group.createEl('input', { type: 'number', value: value.toString() });
	input.style.width = '40px';
	input.style.textAlign = 'right';
	input.style.border = 'none';
	input.style.background = 'transparent';
	input.style.marginRight = '12px'; // Increased spacing as requested
	input.onchange = (e) => callback(Number((e.target as HTMLInputElement).value));

	const minus = group.createDiv('clickable-icon');
	setIcon(minus, 'minus');
	// Force dimensions with !important to override Obsidian defaults
	minus.style.setProperty('width', '20px', 'important');
	minus.style.setProperty('height', '20px', 'important');
	minus.style.setProperty('min-width', '20px', 'important');
	minus.style.setProperty('min-height', '20px', 'important');
	minus.style.setProperty('padding', '0', 'important');
	minus.style.setProperty('display', 'flex', 'important');
	minus.style.setProperty('align-items', 'center', 'important');
	minus.style.setProperty('justify-content', 'center', 'important');
	minus.style.setProperty('margin', '0', 'important');
	minus.style.cursor = 'pointer';
	minus.onclick = () => {
		let newVal = Number(input.value) - step;
		newVal = Math.round(newVal * 100) / 100;
		newVal = Math.max(newVal, min); // Enforce min
		input.value = newVal.toString();
		callback(newVal);
	};
	const minusSvg = minus.querySelector('svg');
	if (minusSvg) {
		minusSvg.setAttribute('width', '15'); minusSvg.setAttribute('height', '15');
		minusSvg.style.width = '15px'; minusSvg.style.height = '15px';
		// minusSvg.style.setProperty('width', '15px', 'important'); // Optional, mainly container issue
	}

	const plus = group.createDiv('clickable-icon');
	setIcon(plus, 'plus');
	// Force dimensions with !important
	plus.style.setProperty('width', '20px', 'important');
	plus.style.setProperty('height', '20px', 'important');
	plus.style.setProperty('min-width', '20px', 'important');
	plus.style.setProperty('min-height', '20px', 'important');
	plus.style.setProperty('padding', '0', 'important');
	plus.style.setProperty('display', 'flex', 'important');
	plus.style.setProperty('align-items', 'center', 'important');
	plus.style.setProperty('justify-content', 'center', 'important');
	plus.style.setProperty('margin', '0', 'important');
	plus.style.cursor = 'pointer';
	plus.onclick = () => {
		let newVal = Number(input.value) + step;
		newVal = Math.round(newVal * 100) / 100;
		input.value = newVal.toString();
		callback(newVal);
	};
	const plusSvg = plus.querySelector('svg');
	if (plusSvg) {
		plusSvg.setAttribute('width', '15'); plusSvg.setAttribute('height', '15');
		plusSvg.style.width = '15px'; plusSvg.style.height = '15px';
	}

	// New Order: [ Input ] [ - ] [ + ]
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

	// Added explicit styling for track visibility + 'slider' class
	const slider = div.createEl('input', { type: 'range', cls: 'slider' });
	slider.min = min.toString();
	slider.max = max.toString();
	slider.step = step.toString();
	slider.value = value.toString();
	slider.style.width = '80px';
	slider.style.setProperty('background', 'var(--background-modifier-border)', 'important');
	slider.style.setProperty('height', '4px', 'important');
	slider.style.setProperty('border-radius', '2px', 'important');
	slider.style.setProperty('outline', 'none', 'important');
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
	group.style.gap = '8px';

	const lightVal = typeof value === 'string' ? value : value.light;
	const darkVal = typeof value === 'string' ? value : value.dark;

	const lightInput = group.createEl('input', { type: 'color', value: lightVal === 'inherit' ? '#000000' : lightVal === 'transparent' ? '#ffffff' : lightVal });
	lightInput.style.setProperty('width', '25px', 'important');
	lightInput.style.setProperty('height', '25px', 'important');
	lightInput.style.setProperty('min-width', '25px', 'important');
	lightInput.style.setProperty('min-height', '25px', 'important');
	lightInput.style.setProperty('padding', '0', 'important');
	lightInput.style.setProperty('margin', '0', 'important');
	lightInput.style.setProperty('border', 'none', 'important');
	lightInput.style.setProperty('outline', 'none', 'important');
	lightInput.style.cursor = 'pointer';

	lightInput.onchange = (e) => {
		const newVal = { light: (e.target as HTMLInputElement).value, dark: darkVal };
		callback(newVal);
	};

	const darkInput = group.createEl('input', { type: 'color', value: darkVal === 'inherit' ? '#ffffff' : darkVal === 'transparent' ? '#000000' : darkVal });
	darkInput.style.setProperty('width', '25px', 'important');
	darkInput.style.setProperty('height', '25px', 'important');
	darkInput.style.setProperty('min-width', '25px', 'important');
	darkInput.style.setProperty('min-height', '25px', 'important');
	darkInput.style.setProperty('padding', '0', 'important');
	darkInput.style.setProperty('margin', '0', 'important');
	darkInput.style.setProperty('border', 'none', 'important');
	darkInput.style.setProperty('outline', 'none', 'important');
	darkInput.style.cursor = 'pointer';

	darkInput.onchange = (e) => {
		const newVal = { light: lightVal, dark: (e.target as HTMLInputElement).value };
		callback(newVal);
	};
}
