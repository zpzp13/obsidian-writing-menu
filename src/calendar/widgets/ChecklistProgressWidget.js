// src/calendar/widgets/ChecklistProgressWidget.js
// 대시보드 위젯 — 전체 볼트의 writing_checklist 진행 현황

export class ChecklistProgressWidget {
    constructor(app, options = {}) {
        this.app = app;
        this.topN = options.topN || 10; // 상위 N개 파일 표시
    }

    /** 대시보드 컨테이너에 위젯 렌더링 */
    render(container) {
        const wrap = container.createEl('div', { cls: 'cpwn-widget cpwn-checklist-progress-widget' });
        const header = wrap.createEl('div', { cls: 'cpwn-widget-header' });
        header.createEl('span', { cls: 'cpwn-widget-title', text: '집필 체크리스트 진행' });

        const data = this._aggregate();

        if (data.files.length === 0) {
            wrap.createEl('div', { cls: 'cpwn-widget-empty', text: '체크리스트가 있는 파일이 없습니다.' });
            return;
        }

        // 전체 요약
        const summary = wrap.createEl('div', { cls: 'cpwn-checklist-widget-summary' });
        const totalPct = data.totalItems > 0 ? Math.round((data.totalDone / data.totalItems) * 100) : 0;
        summary.createEl('span', { text: `전체: ${data.totalDone} / ${data.totalItems} 완료 (${totalPct}%)` });

        const overallBar = wrap.createEl('div', { cls: 'cpwn-checklist-progress-bar cpwn-checklist-overall-bar' });
        const overallFill = overallBar.createEl('div', { cls: 'cpwn-checklist-progress-fill' });
        overallFill.style.width = `${totalPct}%`;

        // 파일별 목록
        const listEl = wrap.createEl('div', { cls: 'cpwn-checklist-widget-list' });
        const topFiles = data.files.slice(0, this.topN);
        for (const f of topFiles) {
            const pct = f.total > 0 ? Math.round((f.done / f.total) * 100) : 0;
            const row = listEl.createEl('div', { cls: 'cpwn-checklist-widget-row' });
            const nameEl = row.createEl('span', { cls: 'cpwn-checklist-widget-name', text: f.name });
            nameEl.setAttribute('title', f.path);
            const barWrap = row.createEl('div', { cls: 'cpwn-checklist-widget-bar-wrap' });
            const bar = barWrap.createEl('div', { cls: 'cpwn-checklist-progress-bar' });
            const fill = bar.createEl('div', { cls: 'cpwn-checklist-progress-fill' });
            fill.style.width = `${pct}%`;
            barWrap.createEl('span', { cls: 'cpwn-checklist-widget-pct', text: `${pct}%` });
        }
    }

    _aggregate() {
        const files = this.app.vault.getMarkdownFiles();
        let totalDone = 0;
        let totalItems = 0;
        const fileData = [];

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm?.writing_checklist || !Array.isArray(fm.writing_checklist)) continue;

            const items = fm.writing_checklist;
            if (items.length === 0) continue;

            const done = items.filter(i => i && i.done).length;
            totalDone += done;
            totalItems += items.length;
            fileData.push({
                path: file.path,
                name: file.basename,
                total: items.length,
                done,
            });
        }

        // 미완료 비율 높은 순 → 완료율 낮은 파일 먼저
        fileData.sort((a, b) => {
            const pctA = a.total > 0 ? a.done / a.total : 0;
            const pctB = b.total > 0 ? b.done / b.total : 0;
            return pctA - pctB;
        });

        return { files: fileData, totalDone, totalItems };
    }
}
