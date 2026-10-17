export const CSS_PX_PER_PT = 96 / 72;
export const CSS_PX_PER_MM = 96 / 25.4;

export function pixelsToPoints(pixels: number): number { return Math.round((pixels / CSS_PX_PER_PT) * 10) / 10; }
export function formatTypographyNumber(value: number): string { return Number(value.toFixed(1)).toString(); }
