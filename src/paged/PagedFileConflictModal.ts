import { wmT } from '../i18n/index';
import { Modal, Notice, Setting, type App } from 'obsidian';
import type { PagedConflictChoice, PagedConflictReview } from './PagedFileStore';
import { computeLineDiff } from '../snapshots/diff';

export class PagedFileConflictModal extends Modal {
	constructor(app: App, private readonly read: () => PagedConflictReview | null,
		private readonly choose: (choice: PagedConflictChoice) => Promise<void>) { super(app); }
	onOpen(): void { this.modalEl.addClass('wm-paged-file-conflict-modal'); this.setTitle(wmT("동기화 변경 검토")); this.render(); }
	private render(): void {
		this.contentEl.empty(); const review = this.read(); if (!review) { this.close(); return; }
		this.contentEl.createEl('p', { cls: 'setting-item-description', text: wmT("양쪽 원문은 별도 복구 파일로 보존됩니다. 변경 구간을 선택하거나 최종 결과를 직접 편집하세요.") });
		const tabs = this.contentEl.createDiv({ cls: 'wm-paged-merge-tabs' });
		const panes = this.contentEl.createDiv({ cls: 'wm-paged-merge-inputs' });
		for (const [index, [title, value]] of [[wmT("내 편집본"), review.local], [wmT("외부 변경본"), review.remote]].entries()) {
			const pane = panes.createDiv({ cls: index === 0 ? 'is-active' : '' }); pane.createEl('h4', { text: title });
			const tab = tabs.createEl('button', { text: title }); tab.onclick = () => { for (const child of Array.from(panes.children)) child.toggleClass('is-active', child === pane); };
			const input = pane.createEl('textarea', { attr: { 'aria-label': title } }); input.value = value; input.readOnly = true;
		}
		const base = this.contentEl.createEl('details'); base.createEl('summary', { text: wmT("이 편집기의 비교 기준 (원격 동기화 완료 기준은 아닙니다)") });
		const baseText = base.createEl('textarea'); baseText.value = review.base; baseText.readOnly = true;
		const hunks = computeLineDiff(review.local, review.remote), selected = new Map<number, 'local' | 'remote'>();
		const changes = this.contentEl.createDiv({ cls: 'wm-paged-merge-choices' });
		const result = this.contentEl.createDiv(); result.createEl('h4', { text: wmT("최종 결과") });
		const editor = result.createEl('textarea', { attr: { 'aria-label': wmT("최종 결과") } }); editor.value = review.local;
		let manual = false;
		const unresolved = () => hunks.filter((hunk, index) => hunk.type !== 'equal' && !selected.has(index)).length;
		const rebuild = () => { editor.value = hunks.flatMap((hunk, index) => selected.get(index) === 'remote' ? hunk.bLines : hunk.aLines).join('\n'); refresh(); };
		for (const [index, hunk] of hunks.entries()) {
			if (hunk.type === 'equal') continue;
			new Setting(changes).setName(wmT("변경 {0}", index + 1)).setDesc(wmT("내 편집본 {0}행 · 외부 변경본 {1}행", hunk.aStart + 1, hunk.bStart + 1))
				.addButton(button => button.setButtonText(wmT("내 편집본")).onClick(() => { selected.set(index, 'local'); manual = false; rebuild(); }))
				.addButton(button => button.setButtonText(wmT("외부 변경본")).onClick(() => { selected.set(index, 'remote'); manual = false; rebuild(); }));
		}
		const status = this.contentEl.createDiv({ cls: 'setting-item-description', attr: { role: 'status' } });
		let apply: HTMLButtonElement;
		const refresh = () => { const count = manual ? 0 : unresolved(); status.setText(manual ? wmT("직접 편집한 최종 결과") : wmT("검토하지 않은 변경 {0}개", count)); if (apply) apply.disabled = count > 0; };
		editor.oninput = () => { manual = true; refresh(); };
		new Setting(this.contentEl).addButton(button => button.setButtonText(wmT("나중에")).onClick(() => this.close()))
			.addButton(button => { apply = button.buttonEl; button.setButtonText(wmT("최종 결과 저장")).setCta().onClick(async () => {
				if (!manual && unresolved()) return; button.setDisabled(true);
				try { await this.choose({ content: editor.value, local: review.local, remote: review.remote }); this.close(); }
				catch (error) { new Notice(error instanceof Error ? error.message : String(error)); this.render(); }
			}); });
		refresh();
	}
}
