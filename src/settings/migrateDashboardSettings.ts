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
	if (Array.isArray(raw.dashboardSections)) for (const item of raw.dashboardSections) {
		if (item && typeof item === 'object' && item.id === 'version') { item.id = 'snapshots'; if (item.label === '버전 관리') item.label = '원고 스냅샷'; changed = true; }
	}
	return changed;
}
