export const DONUT_RADII = { inner: 69, outer: 87, selected: 99 } as const;

/** Filled sectors keep the hole fixed; a thicker translated stroke cannot do this. */
export function donutSegmentPath(start: number, end: number, outer: number, inner = DONUT_RADII.inner, center = 110): string {
	if (![start, end, outer, inner, center].every(Number.isFinite) || end <= start || inner <= 0 || outer <= inner) return '';
	const span = Math.min(1, end - start), finish = start + span;
	const point = (turn: number, radius: number) => {
		const angle = turn * Math.PI * 2 - Math.PI / 2;
		return `${center + Math.cos(angle) * radius} ${center + Math.sin(angle) * radius}`;
	};
	if (span === 1) {
		// A full circle needs two arcs, with the hole wound in the opposite direction.
		return `M ${point(start, outer)} A ${outer} ${outer} 0 1 1 ${point(start + .5, outer)} A ${outer} ${outer} 0 1 1 ${point(finish, outer)} Z `
			+ `M ${point(start, inner)} A ${inner} ${inner} 0 1 0 ${point(start + .5, inner)} A ${inner} ${inner} 0 1 0 ${point(finish, inner)} Z`;
	}
	const large = span > .5 ? 1 : 0;
	return `M ${point(start, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(finish, outer)} L ${point(finish, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(start, inner)} Z`;
}
