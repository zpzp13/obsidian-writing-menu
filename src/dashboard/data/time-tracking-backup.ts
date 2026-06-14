/**
 * 타이머 작업시간 추적 기능 백업
 * 원본 위치: main.ts
 * 이전 날짜: 2026-06-14
 * 이전 사유: 대시보드 WritingTimeSection.ts로 추적 로직 완전 이관
 *            (processFrontMatter 이중 호출 → 외부 수정 오류·시간 흔들림 버그 해결)
 *
 * 아래 코드는 참조용으로만 보존됩니다. 실제로 사용되지 않습니다.
 */

/*
// ── 멤버 변수 ──
private timeTrackingInterval: number | null = null;
private modeTimeInterval: number | null = null;
private currentTrackingFile: TFile | null = null;
private lastActivityTime: number = 0;
private isActivelyTyping: boolean = false;
private isUpdatingFrontmatter: boolean = false;
private isTrackingBusy: boolean = false;

getTrackingFile(): TFile | null {
    return this.currentTrackingFile;
}

// ── 유틸 메서드 ──
private getModeKey(mode: 'draft' | 'writing' | 'editing' | 'total'): string {
    const keys = { draft: '초고_시간', writing: '집필_시간', editing: '퇴고_시간', total: '총_시간' };
    return keys[mode];
}

async getTimeFromFrontmatter(file: TFile, mode: 'draft' | 'writing' | 'editing' | 'total'): Promise<number> {
    const key = this.getModeKey(mode);
    try {
        const content = await this.app.vault.read(file);
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) return 0;
        const keyRegex = new RegExp(`${key}:\\s*["']?([\\d:]+)["']?`);
        const valueMatch = fmMatch[1].match(keyRegex);
        return valueMatch ? this.parseTime(valueMatch[1]) : 0;
    } catch (e) {
        console.error('Failed to read time from frontmatter:', e);
        return 0;
    }
}

async setTimeToFrontmatter(file: TFile, mode: 'draft' | 'writing' | 'editing' | 'total', seconds: number): Promise<void> {
    const key = this.getModeKey(mode);
    const timeStr = this.formatTime(seconds, true);
    this.isUpdatingFrontmatter = true;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[key] = timeStr;
    });
    setTimeout(() => { this.isUpdatingFrontmatter = false; }, 100);
}

// ── 추적 시작/정지 ──
async startTimeTracking() {
    if (this.timeTrackingInterval || this.isTrackingBusy) return;
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView?.file) return;
    if (!this.shouldApplyToFile(activeView.file)) return;
    this.isTrackingBusy = true;
    try {
        this.currentTrackingFile = activeView.file;
        this.lastActivityTime = 0;
        this.isActivelyTyping = false;
        const file = this.currentTrackingFile;
        this.pendingTimeUpdates.clear();
        const modes: ('draft' | 'writing' | 'editing')[] = ['draft', 'writing', 'editing'];
        for (const m of modes) {
            const key = `${file.path}:${m}`;
            const seconds = await this.getTimeFromFrontmatter(file, m);
            this.pendingTimeUpdates.set(key, { file, mode: m, seconds });
        }
        const totalKey = `${file.path}:total`;
        const totalSeconds = await this.getTimeFromFrontmatter(file, 'total');
        this.pendingTimeUpdates.set(totalKey, { file, mode: 'total', seconds: totalSeconds });
        this.timeTrackingInterval = window.setInterval(async () => {
            if (!this.settings.enableTimeTracking || !this.currentTrackingFile) {
                await this.stopTimeTracking();
                return;
            }
            const now = Date.now();
            const idleTime = now - this.lastActivityTime;
            if (!this.isActivelyTyping && idleTime > 3000 && this.pendingTimeUpdates.size > 0) {
                await this.savePendingTimeUpdates();
            }
        }, 5000);
        this.startModeTimeInterval();
    } finally {
        this.isTrackingBusy = false;
    }
}

private startModeTimeInterval() {
    if (this.modeTimeInterval) return;
    this.modeTimeInterval = window.setInterval(() => {
        if (!this.settings.enableTimeTracking || !this.currentTrackingFile) return;
        const now = Date.now();
        const idleTime = now - this.lastActivityTime;
        if (idleTime > 1000) { this.isActivelyTyping = false; return; }
        if (this.isActivelyTyping) {
            const file = this.currentTrackingFile;
            if (!file) return;
            const mode = this.settings.currentTimeMode;
            const modeKey = `${file.path}:${mode}`;
            let existingMode = this.pendingTimeUpdates.get(modeKey);
            if (!existingMode) { existingMode = { file, mode, seconds: 0 }; this.pendingTimeUpdates.set(modeKey, existingMode); }
            existingMode.seconds += 1;
            const totalKey = `${file.path}:total`;
            let existingTotal = this.pendingTimeUpdates.get(totalKey);
            if (!existingTotal) { existingTotal = { file, mode: 'total', seconds: 0 }; this.pendingTimeUpdates.set(totalKey, existingTotal); }
            existingTotal.seconds += 1;
        }
        this.updateStatusBarDisplay();
    }, 1000);
}

private stopModeTimeInterval() {
    if (this.modeTimeInterval) { window.clearInterval(this.modeTimeInterval); this.modeTimeInterval = null; }
}

async savePendingTimeUpdates() {
    if (this.pendingTimeUpdates.size === 0) return;
    const fileUpdates = new Map<TFile, Map<string, number>>();
    for (const [key, data] of this.pendingTimeUpdates) {
        if (!fileUpdates.has(data.file)) fileUpdates.set(data.file, new Map());
        const modeKey = this.getModeKey(data.mode);
        fileUpdates.get(data.file)!.set(modeKey, data.seconds);
    }
    this.isUpdatingFrontmatter = true;
    for (const [file, modes] of fileUpdates) {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            for (const [modeKey, seconds] of modes) fm[modeKey] = this.formatTime(seconds, true);
        });
    }
    setTimeout(() => { this.isUpdatingFrontmatter = false; }, 100);
}

async stopTimeTracking() {
    if (this.isTrackingBusy) return;
    this.isTrackingBusy = true;
    try {
        if (this.timeTrackingInterval) { window.clearInterval(this.timeTrackingInterval); this.timeTrackingInterval = null; }
        this.stopModeTimeInterval();
        await this.savePendingTimeUpdates();
        this.pendingTimeUpdates.clear();
        this.currentTrackingFile = null;
        this.isActivelyTyping = false;
        this.lastActivityTime = 0;
    } finally {
        this.isTrackingBusy = false;
    }
}

updateActivityTime() {
    if (!this.settings.enableTimeTracking || !this.currentTrackingFile) return;
    if (this.isUpdatingFrontmatter) return;
    const now = Date.now();
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file && this.currentTrackingFile !== activeView.file) {
        if (!this.shouldApplyToFile(activeView.file)) return;
        this.savePendingTimeUpdates();
        this.currentTrackingFile = activeView.file;
        this.loadFileTimesAsync(activeView.file);
    }
    this.lastActivityTime = now;
    this.isActivelyTyping = true;
}

private async loadFileTimesAsync(file: TFile) {
    const modes: ('draft' | 'writing' | 'editing')[] = ['draft', 'writing', 'editing'];
    for (const m of modes) {
        const modeKey = `${file.path}:${m}`;
        if (!this.pendingTimeUpdates.has(modeKey)) {
            const modeTime = await this.getTimeFromFrontmatter(file, m);
            this.pendingTimeUpdates.set(modeKey, { file, mode: m, seconds: modeTime });
        }
    }
    const totalKey = `${file.path}:total`;
    if (!this.pendingTimeUpdates.has(totalKey)) {
        const totalTime = await this.getTimeFromFrontmatter(file, 'total');
        this.pendingTimeUpdates.set(totalKey, { file, mode: 'total', seconds: totalTime });
    }
}

refreshTimeTrackingSidebar() {
    const leaves = this.app.workspace.getLeavesOfType(TIME_TRACKING_VIEW_TYPE);
    leaves.forEach(leaf => {
        const view = leaf.view as TimeTrackingView;
        if (view && typeof view.refresh === 'function') view.refresh();
    });
}
*/

export {};
