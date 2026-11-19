import { Notice, Setting } from 'obsidian';
import { wmT } from '../i18n/index';
import type WritingMenuPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../types';
import { parseMunpiaNovelId } from './munpia';

interface ReviewSettingsLayout { section(title: string): HTMLElement }

/** 설정 › 대시보드 › 리뷰. The surrounding settings tab owns navigation and layout. */
export function renderReviewSettings(plugin: WritingMenuPlugin, layout: ReviewSettingsLayout): void {
	const settings = plugin.settings, save = () => plugin.saveSettings();

	const links = layout.section(wmT('작품 연결'));
	const targets: Array<{ key: string; name: string }> = [
		...plugin.projectContext.getProjects().map(project => ({ key: project.id, name: project.name || project.rootFolder || project.id })),
		{ key: 'default', name: wmT('프로젝트 밖 노트') },
	];
	for (const target of targets) {
		const current = settings.reviewMunpiaNovels?.[target.key] ?? '';
		const setting = new Setting(links).setName(target.name);
		setting.addText(text => {
			text.setPlaceholder(wmT('문피아 작품 링크 또는 번호')).setValue(current);
			text.inputEl.addEventListener('change', () => {
				const value = text.getValue().trim(), next = { ...settings.reviewMunpiaNovels };
				if (!value) delete next[target.key];
				else {
					const id = parseMunpiaNovelId(value);
					if (!id) { new Notice(wmT('작품 번호를 찾지 못했습니다. 작품 페이지 주소를 붙여넣어 주세요.')); text.setValue(current); return; }
					next[target.key] = id; text.setValue(id);
				}
				settings.reviewMunpiaNovels = next; void save();
			});
		});
	}

	const munpia = layout.section(wmT('24시간 지표'));
	new Setting(munpia)
		.setName(wmT('자동 기록'))
		.setDesc(wmT('옵시디언이 켜져 있는 동안 1시간마다 연결된 작품의 선호작 수와, 최근 72시간 안에 공개된 회차의 조회수·추천·댓글을 기록합니다. 24시간 지표를 계산하는 데 씁니다. 작품당 한 시간에 요청 2번입니다.'))
		.addToggle(toggle => toggle.setValue(settings.reviewMunpiaAutoTrack).onChange(async value => { settings.reviewMunpiaAutoTrack = value; await save(); }));
	const count = Object.values(settings.reviewMunpiaSnapshots ?? {}).reduce((sum, list) => sum + list.length, 0);
	new Setting(munpia)
		.setName(wmT('{0}개 기록', count))
		.setDesc(wmT('지금까지 저장한 선호작 기록입니다. 지우면 24시간 변화를 다시 계산할 수 없습니다.'))
		.addButton(button => button.setButtonText(wmT('기록 지우기')).setDisabled(!count).onClick(async () => {
			settings.reviewMunpiaSnapshots = {}; await save(); button.setDisabled(true); new Notice(wmT('선호작 기록을 지웠습니다.'));
		}));

	const comments = layout.section(wmT('고급'));
	for (const [key, name, desc] of [
		['reviewMunpiaCommentUrl', wmT('뷰어 주소'), wmT('{novel}은 작품 번호, {chapter}는 회차 ID, {num}은 회차 번호로 바뀝니다.')],
		['reviewMunpiaCommentSelector', wmT('댓글 CSS 선택자'), wmT('쉼표로 여러 개를 적으면 앞에서부터 차례로 찾습니다.')],
	] as const) {
		new Setting(comments).setName(name).setDesc(desc)
			.addText(text => text.setValue(settings[key]).onChange(async value => { settings[key] = value.trim() || DEFAULT_SETTINGS[key]; await save(); }))
			.addExtraButton(button => button.setIcon('rotate-ccw').setTooltip(wmT('기본값으로')).onClick(async () => { settings[key] = DEFAULT_SETTINGS[key]; await save(); new Notice(wmT('기본값으로 되돌렸습니다. 설정 화면을 다시 열면 반영됩니다.')); }));
	}
}
