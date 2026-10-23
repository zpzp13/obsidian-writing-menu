import { supportedCliEffort, type CliModelOption } from './CliReasoning';

/** Pointer selection is handled directly; the native range remains for keyboard/AT. */
export function renderDeusEffortControl(host: HTMLElement, model: CliModelOption | undefined, selected: string, choose: (value: string) => void, label = '추론 effort'): (() => void) | undefined {
	if (!model?.efforts.length) return;
	const block = host.createDiv({ cls: 'deus-effort-control' });
	const value = block.createDiv({ cls: 'deus-effort-heading' }).createEl('output', { cls: 'deus-effort-value' });
	const levels = model.efforts, track = block.createDiv({ cls: 'deus-effort-track' });
	track.createDiv({ cls: 'deus-effort-fill', attr: { 'aria-hidden': 'true' } });
	const dots = track.createDiv({ cls: 'deus-effort-dots', attr: { 'aria-hidden': 'true' } });
	for (const level of levels) dots.createSpan({ attr: { title: level.label } });
	track.createDiv({ cls: 'deus-effort-thumb', attr: { 'aria-hidden': 'true' } });
	const slider = track.createEl('input', { cls: 'deus-effort-slider', type: 'range', attr: { min: '0', max: String(levels.length - 1), step: '1', 'aria-label': label } });
	const initial = supportedCliEffort(model, selected) || model.defaultEffort || levels.find(level => level.id === 'medium')?.id || levels[0].id;
	slider.value = String(Math.max(0, levels.findIndex(level => level.id === initial)));
	slider.disabled = levels.length < 2;
	let previous = levels[Number(slider.value)].id;
	const update = (commit: boolean) => {
		const effort = levels[Number(slider.value)]; value.setText(effort.label); slider.setAttribute('aria-valuetext', effort.label);
		track.style.setProperty('--deus-effort-progress', String(levels.length > 1 ? Number(slider.value) / (levels.length - 1) : 0));
		if (commit && effort.id !== previous) { previous = effort.id; choose(effort.id); }
	};
	slider.oninput = () => update(true); slider.onchange = () => update(true);
	const point = (event: PointerEvent) => {
		const rect = track.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - 14) / Math.max(1, rect.width - 28)));
		slider.value = String(Math.round(ratio * (levels.length - 1))); update(true);
	};
	track.onpointerdown = event => {
		if (event.button !== 0 || slider.disabled) return;
		event.preventDefault(); slider.focus({ preventScroll: true }); track.setPointerCapture(event.pointerId); point(event);
	};
	track.onpointermove = event => { if (track.hasPointerCapture(event.pointerId)) point(event); };
	track.onpointerup = event => { if (track.hasPointerCapture(event.pointerId)) { point(event); track.releasePointerCapture(event.pointerId); } };
	track.onpointercancel = event => { if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId); };
	slider.addEventListener('keydown', event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); });
	update(false);
	// Fractional flex spacing gave identical circles different edge antialiasing.
	// Run after the popover is positioned so every marker shares the device pixel grid.
	return () => {
		const rect = dots.getBoundingClientRect(), ratio = host.ownerDocument.defaultView?.devicePixelRatio ?? 1;
		const size = Math.round(4 * ratio) / ratio, snap = (value: number) => Math.round(value * ratio) / ratio;
		dots.style.setProperty('--deus-effort-dot-size', `${size}px`);
		Array.from(dots.children).forEach((dot, index) => {
			const marker = dot as HTMLElement, fraction = levels.length > 1 ? index / (levels.length - 1) : 0;
			marker.style.left = `${snap(rect.left + rect.width * fraction - size / 2) - rect.left}px`;
			marker.style.top = `${snap(rect.top + rect.height / 2 - size / 2) - rect.top}px`;
		});
	};
}
