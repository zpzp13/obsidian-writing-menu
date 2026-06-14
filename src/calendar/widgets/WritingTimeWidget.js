// src/calendar/widgets/WritingTimeWidget.js
// writing-menu frontmatter(초고_시간, 집필_시간, 퇴고_시간)을 읽어
// 대시보드에 글쓰기 시간 통계를 표시하는 위젯.
import { setIcon } from 'obsidian';

const TIME_KEYS = {
    draft:   '초고_시간',
    writing: '집필_시간',
    editing: '퇴고_시간',
};

const MODE_LABELS = {
    draft:   '초고',
    writing: '집필',
    editing: '퇴고',
};

const MODE_COLORS = {
    draft:   'rgba(100, 149, 237, 0.8)',   // 파란색
    writing: 'rgba(76, 175, 80, 0.8)',     // 초록색
    editing: 'rgba(255, 152, 0, 0.8)',     // 주황색
};

/** HH:MM:SS 또는 MM:SS 문자열을 초 단위 정수로 변환 */
function parseTimeStr(str) {
    if (!str) return 0;
    const parts = String(str).split(':').map(p => parseInt(p, 10) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

/** 초를 "X시간 Y분" 형식으로 포맷 */
function formatSeconds(totalSec) {
    if (totalSec <= 0) return '0분';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h > 0 && m > 0) return `${h}시간 ${m}분`;
    if (h > 0) return `${h}시간`;
    return `${m}분`;
}

export class WritingTimeWidget {
    /**
     * @param {import('obsidian').App} app
     * @param {HTMLElement} container  위젯을 렌더링할 DOM 컨테이너
     * @param {object} options
     * @param {number} [options.lookbackDays=30]  집계할 과거 일수
     * @param {boolean} [options.showHeatmap=true]  히트맵 표시 여부
     */
    constructor(app, container, options = {}) {
        this.app = app;
        this.container = container;
        this.lookbackDays = options.lookbackDays ?? 30;
        this.showHeatmap = options.showHeatmap ?? true;
    }

    async render() {
        this.container.empty();
        this.container.addClass('cpwn-writing-time-widget');

        const data = await this._aggregate();
        this._renderSummaryBars(data.totals);
        if (this.showHeatmap) {
            this._renderHeatmap(data.daily);
        }
    }

    /** 볼트 전체 마크다운 파일에서 시간 frontmatter를 집계 */
    async _aggregate() {
        const files = this.app.vault.getMarkdownFiles();
        const cutoff = Date.now() - this.lookbackDays * 86400 * 1000;

        const totals = { draft: 0, writing: 0, editing: 0 };
        // daily: Map<'YYYY-MM-DD', {draft, writing, editing}>
        const daily = new Map();

        for (const file of files) {
            if (file.stat.mtime < cutoff) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (!fm) continue;

            const hasSomeTime = Object.values(TIME_KEYS).some(k => fm[k]);
            if (!hasSomeTime) continue;

            const dateKey = new Date(file.stat.mtime).toISOString().slice(0, 10);
            if (!daily.has(dateKey)) daily.set(dateKey, { draft: 0, writing: 0, editing: 0 });

            for (const [mode, key] of Object.entries(TIME_KEYS)) {
                const sec = parseTimeStr(fm[key]);
                totals[mode] += sec;
                daily.get(dateKey)[mode] += sec;
            }
        }

        return { totals, daily };
    }

    /** 모드별 합계 바 렌더링 */
    _renderSummaryBars(totals) {
        const totalAll = totals.draft + totals.writing + totals.editing;

        const header = this.container.createDiv({ cls: 'cpwn-wt-header' });
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;';
        header.createSpan({ text: `최근 ${this.lookbackDays}일 글쓰기 시간`, cls: 'cpwn-wt-title' });
        header.createSpan({ text: formatSeconds(totalAll), cls: 'cpwn-wt-total' });

        const barsEl = this.container.createDiv({ cls: 'cpwn-wt-bars' });
        barsEl.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

        for (const mode of ['draft', 'writing', 'editing']) {
            const sec = totals[mode];
            const pct = totalAll > 0 ? Math.round((sec / totalAll) * 100) : 0;

            const row = barsEl.createDiv({ cls: 'cpwn-wt-bar-row' });
            row.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:12px;';

            const label = row.createSpan({ text: MODE_LABELS[mode] });
            label.style.cssText = 'width:28px; flex-shrink:0;';

            const track = row.createDiv({ cls: 'cpwn-wt-bar-track' });
            track.style.cssText = 'flex:1; height:8px; background:var(--background-modifier-border); border-radius:4px; overflow:hidden;';

            const fill = track.createDiv({ cls: 'cpwn-wt-bar-fill' });
            fill.style.cssText = `height:100%; width:${pct}%; background:${MODE_COLORS[mode]}; border-radius:4px; transition:width 0.3s;`;

            row.createSpan({ text: formatSeconds(sec) }).style.cssText = 'min-width:52px; text-align:right; color:var(--text-muted); font-size:11px;';
        }
    }

    /** 날짜별 히트맵 렌더링 (최근 lookbackDays일) */
    _renderHeatmap(daily) {
        const heatmapEl = this.container.createDiv({ cls: 'cpwn-wt-heatmap' });
        heatmapEl.style.cssText = 'margin-top:10px;';

        const subTitle = heatmapEl.createDiv({ text: '일별 활동', cls: 'cpwn-wt-heatmap-title' });
        subTitle.style.cssText = 'font-size:11px; color:var(--text-muted); margin-bottom:4px;';

        const grid = heatmapEl.createDiv({ cls: 'cpwn-wt-heatmap-grid' });
        grid.style.cssText = 'display:flex; flex-wrap:wrap; gap:2px;';

        const today = new Date();
        const maxSec = Math.max(...Array.from(daily.values()).map(d => d.draft + d.writing + d.editing), 1);

        for (let i = this.lookbackDays - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            const entry = daily.get(key);
            const totalSec = entry ? entry.draft + entry.writing + entry.editing : 0;
            const intensity = totalSec / maxSec;
            const alpha = totalSec > 0 ? 0.15 + intensity * 0.85 : 0;

            const cell = grid.createDiv({ cls: 'cpwn-wt-cell' });
            cell.style.cssText = `width:10px; height:10px; border-radius:2px; background:rgba(76,175,80,${alpha.toFixed(2)}); border:1px solid var(--background-modifier-border);`;
            cell.setAttribute('aria-label', `${key}: ${formatSeconds(totalSec)}`);
            cell.title = `${key}\n${totalSec > 0 ? formatSeconds(totalSec) : '기록 없음'}`;
        }
    }
}
