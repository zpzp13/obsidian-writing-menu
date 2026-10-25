import { wmT } from '../i18n/index';
// Deus owns the lookup loop; the CLI's automatic delegation mode is not offered.
export const CLI_EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CliEffort = typeof CLI_EFFORT_LEVELS[number];
export interface CliEffortOption { id: CliEffort; label: string }
export interface CliModelOption { id: string; label: string; isDefault: boolean; efforts: CliEffortOption[]; defaultEffort?: CliEffort }

export function isCliEffort(value: unknown): value is CliEffort {
	return typeof value === 'string' && (CLI_EFFORT_LEVELS as readonly string[]).includes(value);
}
export function cliEffortLabel(value: string): string {
	return value === 'xhigh' ? 'Extra High' : value ? value[0].toUpperCase() + value.slice(1) : wmT("기본");
}
export function selectedCliModel(models: CliModelOption[], configured: string): CliModelOption | undefined {
	return configured ? models.find(model => model.id === configured) : models.find(model => model.isDefault) ?? models[0];
}
export function supportedCliEffort(model: CliModelOption | undefined, value: unknown): string {
	return isCliEffort(value) && model?.efforts.some(effort => effort.id === value) ? value : '';
}
