import { isRecord, isUnknownArray } from '../utils/typeGuards';

/** Read old folder settings before removing their keys from modern settings. */
export function takeLegacyTrackingFolder(raw: Record<string, unknown>): string {
	const folder = ['trackingFolder', 'timeTrackingFolder', 'heatmapFolder']
		.map(key => raw[key]).find(value => typeof value === 'string' && value.trim());
	for (const key of ['trackingFolder', 'timeTrackingFolder', 'heatmapFolder']) delete raw[key];
	return typeof folder === 'string' ? folder : '';
}

/** Retired keys are accepted only at this migration boundary, never by feature code. */
export function migrateDashboardSettings(raw: Record<string, unknown>): boolean {
	let changed = false;
	for (const key of ['aiChatSystemPromptNotePath', 'aiChatPersonaHeading', 'aiChatFreeProjectConfirmed', 'aiChatFreeDataConsent']) {
		if (key in raw) { delete raw[key]; changed = true; }
	}
	for (const [oldKey, nextKey] of [['versionStoragePath', 'snapshotStoragePath'], ['versionMaxCount', 'snapshotMaxCount'], ['versionStages', 'snapshotLabels']] as const) {
		if (oldKey in raw) { if (!(nextKey in raw)) raw[nextKey] = raw[oldKey]; delete raw[oldKey]; changed = true; }
	}
	for (const key of Object.keys(raw)) if (/^ai(?:Episode|Image)/.test(key) || key === 'aiChatToolbarAutoHide' || key === 'versionToolbarAutoHide' || key === 'repetitionVocabNotePath') {
		delete raw[key]; changed = true;
	}
	if (isUnknownArray(raw.dashboardSections)) for (const item of raw.dashboardSections) {
		if (isRecord(item) && item.id === 'version') { item.id = 'snapshots'; if (item.label === '버전 관리') item.label = '원고 스냅샷'; changed = true; }
	}
	return changed;
}
