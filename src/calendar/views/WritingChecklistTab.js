// src/calendar/views/WritingChecklistTab.js
// 집필 체크리스트 탭 — frontmatter writing_checklist 기반

export class WritingChecklistTab {
    constructor(app) {
        this.app = app;
        this._currentFile = null;
        this._container = null;
    }

    /** 탭 컨텐츠 렌더링 */
    render(container, file) {
        this._container = container;
        this._currentFile = file;
        container.empty();

        if (!file) {
            container.createEl('div', { cls: 'cpwn-checklist-empty', text: '활성 파일을 선택하세요.' });
            return;
        }

        const items = this._getItems(file);

        // 진행 바
        this._renderProgressBar(container, items);

        // 체크리스트 목록
        const listEl = container.createEl('div', { cls: 'cpwn-checklist-list' });
        items.forEach((item, idx) => this._renderItem(listEl, item, idx, file));

        // 추가 입력창
        this._renderAddInput(container, file);
    }

    _renderProgressBar(container, items) {
        const total = items.length;
        const done = items.filter(i => i.done).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;

        const wrap = container.createEl('div', { cls: 'cpwn-checklist-progress-wrap' });
        const label = wrap.createEl('span', { cls: 'cpwn-checklist-progress-label' });
        label.textContent = `${done} / ${total} 완료 (${pct}%)`;
        const bar = wrap.createEl('div', { cls: 'cpwn-checklist-progress-bar' });
        const fill = bar.createEl('div', { cls: 'cpwn-checklist-progress-fill' });
        fill.style.width = `${pct}%`;
    }

    _renderItem(listEl, item, idx, file) {
        const row = listEl.createEl('div', { cls: 'cpwn-checklist-item' + (item.done ? ' cpwn-checklist-done' : '') });

        const checkbox = row.createEl('input', { type: 'checkbox' });
        checkbox.checked = item.done;
        checkbox.addEventListener('change', () => this.toggleItem(idx, file));

        const textEl = row.createEl('span', { cls: 'cpwn-checklist-text', text: item.text });

        const delBtn = row.createEl('button', { cls: 'cpwn-checklist-del-btn', text: '×' });
        delBtn.setAttribute('aria-label', '항목 삭제');
        delBtn.addEventListener('click', () => this.deleteItem(idx, file));
    }

    _renderAddInput(container, file) {
        const addRow = container.createEl('div', { cls: 'cpwn-checklist-add-row' });
        const input = addRow.createEl('input', {
            type: 'text',
            cls: 'cpwn-checklist-add-input',
            placeholder: '새 항목 추가...',
        });
        const btn = addRow.createEl('button', { cls: 'cpwn-checklist-add-btn', text: '추가' });

        const submit = () => {
            const text = input.value.trim();
            if (text) {
                this.addItem(text, file);
                input.value = '';
            }
        };
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    // --- 데이터 접근 ---

    _getItems(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm?.writing_checklist || !Array.isArray(fm.writing_checklist)) return [];
        return fm.writing_checklist.map(i =>
            typeof i === 'object' && i !== null ? { text: String(i.text || ''), done: Boolean(i.done) } : { text: String(i), done: false }
        );
    }

    async _saveItems(items, file) {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm.writing_checklist = items;
        });
    }

    // --- 공개 메서드 ---

    async addItem(text, file) {
        const items = this._getItems(file);
        items.push({ text, done: false });
        await this._saveItems(items, file);
        this.render(this._container, file);
    }

    async toggleItem(index, file) {
        const items = this._getItems(file);
        if (index < 0 || index >= items.length) return;
        items[index].done = !items[index].done;
        await this._saveItems(items, file);
        this.render(this._container, file);
    }

    async deleteItem(index, file) {
        const items = this._getItems(file);
        if (index < 0 || index >= items.length) return;
        items.splice(index, 1);
        await this._saveItems(items, file);
        this.render(this._container, file);
    }
}
