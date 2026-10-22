import type { WikiSavedView, WikiGroupRule, SortRule } from './wiki/WikiTypes';

export interface SymbolOption {
	open: string;
	close: string;
}

export interface SymbolTrigger {
	trigger: string;
	options: SymbolOption[];
	enabled: boolean;
}

export interface TextSubstitution {
	from: string;
	to: string;
	enabled: boolean;
}

export type WritingWidgetId = 'munpia' | 'novelpia' | 'timer';

export type ColorThemeMode = 'light' | 'dark';

export interface ThemeColorPair {
	light: string;
	dark: string;
}

export type ThemeAwareColor = string | ThemeColorPair;

export interface PagedTextColorRange {
	from: number;
	to: number;
	color: string;
}

export type PagedInlineFormatKind = 'bold' | 'italic' | 'underline' | 'strikethrough';

export interface PagedInlineFormatRange {
	from: number;
	to: number;
	kind: PagedInlineFormatKind;
}

export type PagedParagraphAlignmentValue = 'left' | 'center' | 'right' | 'justify';

export interface PagedParagraphAlignment {
	from: number;
	align: PagedParagraphAlignmentValue;
}

export interface TimeModeConfig {
	id: string;
	label: string;
	icon?: string;
	frontmatterKey: string;
	goalSeconds: number;
}

export interface DeadlineSchedule {
	/** JavaScript 요일 값 (0: 일요일, 1: 월요일, ... 6: 토요일) */
	weekdays: number[];
	/** 현지 시각, 24시간제 HH:mm */
	time: string;
}

export interface WritingProject {
	id: string;
	name: string;
	rootFolder: string;
	/** 플롯 매니저에서 새 본문 노트를 만들 기본 폴더. */
	manuscriptFolder: string;
	/** 플롯 매니저와 위키에서 인물 노트를 찾고 만들 기본 폴더. */
	characterFolder: string;
	statisticsEnabled: boolean;
	/** 통계를 집계할 볼트 기준 폴더. 비어 있으면 프로젝트 루트 전체를 사용합니다. */
	statisticsFolders: string[];
	/** 통계에서 제외할 볼트 기준 폴더. */
	statisticsExcludeFolders: string[];
}

export interface WritingMenuSettings {
	fontFamily: string;
	customFonts: string[];
	/** Mobile uses downloaded fonts without changing the desktop selection. */
	mobileFontFamily: string;
	fontWeight: number;
	fontSize: number;
	fontColor: string | { light: string; dark: string };
	lineHeight: number;
	paragraphSpacing: number;
	indentation: number;
	lineWidth: number;
	inlinePadding: number;
	backgroundColor: string | { light: string; dark: string };
	pagedPageWidth: number;
	pagedPageHeight: number;
	pagedMarginTop: number;
	pagedMarginRight: number;
	pagedMarginBottom: number;
	pagedMarginLeft: number;
	pagedTextColors: Record<string, PagedTextColorRange[]>;
	pagedTextBackgrounds: Record<string, PagedTextColorRange[]>;
	pagedInlineFormats: Record<string, PagedInlineFormatRange[]>;
	pagedParagraphAlignments: Record<string, PagedParagraphAlignment[]>;
	pagedDefaultAlignment: PagedParagraphAlignmentValue;
	pagedLastTextColor: string;
	pagedLastBackgroundColor: string;
	plotWorkbookLastTextColor: ThemeAwareColor;
	plotWorkbookLastBackgroundColor: ThemeAwareColor;
	plotCharacterLinkOpenMode: 'tab' | 'current' | 'sidebar';
	plotCharacterLinkFormat: 'markdown' | 'wiki';
	plotSnapshotFolder: string;
	applyToFolder: string;
	disableLinkColor: boolean;
	hrEnabled: boolean;
	hrType: 'text' | 'svg';
	hrContent: string;
	hrColor: string;
	hrAlign: 'left' | 'center' | 'right';
	hrSvg: string;
	hrSvgSize: number;
	hrMargin: number;
	enableFocusMode: boolean;
	focusOpacity: number;
	enableTypewriterScrolling: boolean;
	enableSmartQuotes: boolean;
	symbolTriggers: SymbolTrigger[];
	enableSmartEnter: boolean;
	smartEnterPairs: string[];
	enableSmartInput: boolean;
	enableTextSubstitution: boolean;
	textSubstitutions: TextSubstitution[];
	charCountMode: 'munpia' | 'novelpia';
	showMunpiaWidget: boolean;
	showNovelpiaWidget: boolean;
	showTimerWidget: boolean;
	writingWidgetOrder: WritingWidgetId[];
	markdownToolbarAutoHide: boolean;
	pagedToolbarAutoHide: boolean;
	statCardDisplay: 'munpia' | 'novelpia' | 'both';
	dashboardCharRange: '7' | '30' | '90' | '365';
	enableTimeTracking: boolean;
	currentTimeMode: string;
	stopwatchMinutes: number;
	stopwatchAlarmSound: 'bell' | 'chime' | 'beep' | 'ding' | 'gong';
	hwpExportPath: string;
	hwpTemplatePath: string;
	exportDefaultSpaceIndent: boolean;
	exportDefaultExcludeHeadings: boolean;
	h1FontFamily: string;
	h1FontSize: number;
	h1LineHeight: number;
	h1Color: string;
	footnoteFontFamily: string;
	footnoteFontSize: number;
	footnoteLineHeight: number;
	footnoteColor: string;
	copyExcludeHeadings: boolean;
	copyExcludeFootnotes: boolean;
	stdictApiKey: string;
	hanjaBracketMode: boolean;
	recentSearches: string[];
	snapshotStoragePath: string;
	snapshotMaxCount: number;
	snapshotLabels: { name: string; color: string }[];
	projects: WritingProject[];
	restrictStatisticsToProjects: boolean;
	dailyNotesFolder: string;
	dailyNotesFormat: string;
	taskAddHeader: string;
	writingGoalChars: number;
	dailyCharCountKey: string;
	timeModes: TimeModeConfig[];
	timeTotalKey: string;
	timeExcludeFolders?: string[];
	timeCardPalette?: 'accent' | 'solid' | 'pastel' | 'mono';
	deadlineSchedule: DeadlineSchedule;
	// 마이그레이션용 (deprecated)
	timeKeys?: { draft: string; writing: string; editing: string; total: string };
	timeGoals?: { draft: number; writing: number; editing: number };
	dashboardSections?: DashSectionConfig[];
	// ── Music Player ──────────────────────────────────────────────────────
	musicFolderPaths: string[];
	musicVolume: number;
	musicPlaybackMode: 'loop' | 'single' | 'shuffle';
	musicFavorites: string[];
	musicFavoritesMax: number;
	// ── Wiki ──────────────────────────────────────────────────────────────
	wikiColor: string;
	wikiPaletteMode: string;
	wikiImageFieldName: string;
	wikiNameFieldName: string;
	wikiCardAdditionalProps: string[];
	wikiHiddenProperties: string[];
	wikiColoredProperties: string;
	/** 관계 strip 목록화에 사용할 프론트매터 키들 (쉼표 구분, 예: "조력자, 적대자") */
	wikiRelationFields: string;
	wikiSavedViews: WikiSavedView[];
	wikiCustomGroups: WikiGroupRule[];
	wikiSortRules: SortRule[];
	wikiOpenLinksInWiki: boolean;
	wikiIncludeSubfolders: boolean;
	wikiGroupImageTitleSize: number;
	wikiGroupImagePropSize: number;
	wikiProfileHeaderSize: number;
	wikiProfileKeySize: number;
	wikiProfileValueSize: number;
	wikiProfileImage: string;
	wikiUseTableLayout: boolean;
	wikiStripCollapsedDefault: boolean;
	wikiLastFilePath: string;
	wikiLastFolderPath: string;
	wikiGraphRootFolderPath: string;
	wikiGraphNodeDistance: number;
	wikiGraphRelationLabelColors: Record<string, string>;
	wikiGraphRelationVisibilityScale: number;
	wikiToolbarAutoHide: boolean;
	// ── Special Chars ──────────────────────────────────────────────────────────
	specialCharCloseOnInsert: boolean;
	specialCharFavorites: string[];
	specialCharCustom: { char: string; desc: string }[];
	// ── Legacy plot import (kept so existing users can migrate safely) ─────────
	plotManagerFolder: string;
	plotDataFolder: string;
	// ── Spell Check ────────────────────────────────────────────────────────────
	spellCheckIgnoredWords: string[];
	// ── AI 챗 ──────────────────────────────────────────────────────────────────
	aiChatApiKey: string;
	aiChatGeminiApiKey: string;
	aiChatModel: string;
	aiChatLastCharacterPath: string;
	aiChatLastSpeakerPath: string;
	aiChatTemperature: number;
	aiChatNarrationFontSize: number;
	aiChatDialogueFontSize: number;
	aiChatSidebarWidth: number;
	aiChatStreaming: boolean;
	aiChatCitationOpenMode: 'current' | 'tab';
	aiChatMaxOutputTokens: number;
	aiChatHistoryTurns: number;
	aiChatAutoContext: boolean;
	aiChatFreeOnly: boolean;
	aiChatFreeModel: string;
	// ── 퇴고 매니저 (Revision Manager) ─────────────────────────────────────────
	paragraphAnalysis: { countSpaces: boolean; boundary: 'line' | 'block'; mobileLineChars: number; singleQuote: 'narration' | 'dialogue' | 'monologue' | 'special'; roundBracket: 'narration' | 'dialogue' | 'monologue' | 'special' };
	// ── Update ────────────────────────────────────────────────────────────────
	lastSeenVersion?: string;
}

export interface DashSectionConfig {
	id: 'calendar' | 'chars' | 'timer' | 'time' | 'music' | 'tasks' | 'snapshots' | 'repetition';
	label: string;
	visible: boolean;
}

export const DEFAULT_SETTINGS: WritingMenuSettings = {
	fontFamily: 'inherit',
	customFonts: [],
	mobileFontFamily: 'inherit',
	fontWeight: 400,
	fontSize: 16,
	fontColor: 'inherit',
	lineHeight: 1.5,
	paragraphSpacing: 1,
	indentation: 0,
	lineWidth: 700,
	inlinePadding: 40,
	backgroundColor: 'transparent',
	pagedPageWidth: 794,
	pagedPageHeight: 1123,
	pagedMarginTop: 76,
	pagedMarginRight: 72,
	pagedMarginBottom: 76,
	pagedMarginLeft: 72,
	pagedTextColors: {},
	pagedTextBackgrounds: {},
	pagedInlineFormats: {},
	pagedParagraphAlignments: {},
	pagedDefaultAlignment: 'left',
	pagedLastTextColor: '',
	pagedLastBackgroundColor: '',
	plotWorkbookLastTextColor: { light: '#202020', dark: '#f1f1f1' },
	plotWorkbookLastBackgroundColor: { light: '#fef3c7', dark: '#514719' },
	plotCharacterLinkOpenMode: 'sidebar',
	plotCharacterLinkFormat: 'wiki',
	plotSnapshotFolder: '',
	applyToFolder: '',
	disableLinkColor: false,
	hrEnabled: false,
	hrType: 'text',
	hrContent: '✦ ✦ ✦',
	hrColor: '',
	hrAlign: 'center',
	hrSvg: '',
	hrSvgSize: 2,
	hrMargin: 0.5,
	enableFocusMode: false,
	focusOpacity: 0.25,
	enableTypewriterScrolling: false,
	enableSmartQuotes: false,
	symbolTriggers: [
		{
			trigger: '1',
			options: [
				{ open: '「', close: '」' },
				{ open: '『', close: '』' }
			],
			enabled: true
		}
	],
	enableSmartEnter: false,
	smartEnterPairs: ['()', '[]', '{}', '""', "''", '“”', '‘’', '「」', '『』', '【】', '《》'],
	enableSmartInput: false,
	enableTextSubstitution: false,
	textSubstitutions: [
		{ from: '-->', to: '→', enabled: true },
		{ from: '<--', to: '←', enabled: true },
		{ from: '<->', to: '↔', enabled: true },
		{ from: '=>', to: '⇒', enabled: true },
		{ from: '...', to: '…', enabled: true },
		{ from: '1/2', to: '½', enabled: true },
		{ from: '1/4', to: '¼', enabled: true },
		{ from: '3/4', to: '¾', enabled: true },
		{ from: '!=', to: '≠', enabled: true },
		{ from: '<=', to: '≤', enabled: true },
		{ from: '>=', to: '≥', enabled: true },
	],
	charCountMode: 'munpia',
	showMunpiaWidget: true,
	showNovelpiaWidget: false,
	showTimerWidget: false,
	writingWidgetOrder: ['munpia', 'novelpia', 'timer'],
	markdownToolbarAutoHide: false,
	pagedToolbarAutoHide: false,
	statCardDisplay: 'both',
	dashboardCharRange: '30',
	enableTimeTracking: true,
	currentTimeMode: 'draft',
	stopwatchMinutes: 25,
	stopwatchAlarmSound: 'bell',
	hwpExportPath: '',
	hwpTemplatePath: '',
	exportDefaultSpaceIndent: false,
	exportDefaultExcludeHeadings: false,
	h1FontFamily: 'inherit',
	h1FontSize: 24,
	h1LineHeight: 1.5,
	h1Color: 'inherit',
	footnoteFontFamily: 'inherit',
	footnoteFontSize: 13,
	footnoteLineHeight: 1.5,
	footnoteColor: 'inherit',
	copyExcludeHeadings: true,
	copyExcludeFootnotes: true,
	stdictApiKey: '',
	hanjaBracketMode: false,
	recentSearches: [],
	snapshotStoragePath: '.writing-menu-versions',
	snapshotMaxCount: 50,
	snapshotLabels: [
		{ name: '초고', color: '#a8c8f0' },
		{ name: '퇴고', color: '#f0c8a8' },
		{ name: '연출', color: '#c8a8f0' },
	],
	projects: [],
	restrictStatisticsToProjects: true,
	dailyNotesFolder: '',
	dailyNotesFormat: 'YYYY-MM-DD',
	taskAddHeader: '할 일',
	writingGoalChars: 10000,
	dailyCharCountKey: '글자수',
	timeModes: [
		{ id: 'draft',   label: '기획', icon: 'lightbulb',   frontmatterKey: '초고_시간', goalSeconds: 7200 },
		{ id: 'writing', label: '초고', icon: 'pencil',       frontmatterKey: '집필_시간', goalSeconds: 7200 },
		{ id: 'editing', label: '퇴고', icon: 'spell-check',  frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
	],
	timeTotalKey: '총_시간',
	timeExcludeFolders: [],
	deadlineSchedule: { weekdays: [], time: '10:00' },
	dashboardSections: [
		{ id: 'calendar', label: '일정',     visible: true },
		{ id: 'timer',   label: '타이머',   visible: true },
		{ id: 'chars',   label: '글자수',   visible: true },
		{ id: 'time',    label: '작업시간', visible: true },
		{ id: 'music',   label: '음악',     visible: true },
	],
	musicFolderPaths: [],
	musicVolume: 1.0,
	musicPlaybackMode: 'loop',
	musicFavorites: [],
	musicFavoritesMax: 10,
	// ── Wiki defaults ──────────────────────────────────────────────────────
	wikiColor: '#7025db',
	wikiPaletteMode: 'background',
	wikiImageFieldName: 'image',
	wikiNameFieldName: 'name',
	wikiCardAdditionalProps: ['role', 'rank'],
	wikiHiddenProperties: [],
	wikiColoredProperties: '',
	wikiRelationFields: '',
	wikiSavedViews: [],
	wikiCustomGroups: [],
	wikiSortRules: [],
	wikiOpenLinksInWiki: false,
	wikiIncludeSubfolders: false,
	wikiGroupImageTitleSize: 18,
	wikiGroupImagePropSize: 12,
	wikiProfileHeaderSize: 18,
	wikiProfileKeySize: 13,
	wikiProfileValueSize: 13,
	wikiProfileImage: '',
	wikiUseTableLayout: false,
	wikiStripCollapsedDefault: false,
	wikiLastFilePath: '',
	wikiLastFolderPath: '',
	wikiGraphRootFolderPath: '',
	wikiGraphNodeDistance: 1.25,
	wikiGraphRelationLabelColors: {},
	wikiGraphRelationVisibilityScale: 0.72,
	wikiToolbarAutoHide: false,
	specialCharCloseOnInsert: true,
	specialCharFavorites: [],
	specialCharCustom: [],
	plotManagerFolder: '',
	plotDataFolder: '',
	spellCheckIgnoredWords: [],
	aiChatApiKey: '',
	aiChatGeminiApiKey: '',
	aiChatModel: 'gemini-3.8-flash',
	aiChatLastCharacterPath: '',
	aiChatLastSpeakerPath: '',
	aiChatTemperature: 1.0,
	aiChatNarrationFontSize: 0.9,
	aiChatDialogueFontSize: 1.0,
	aiChatSidebarWidth: 200,
	aiChatStreaming: true,
	aiChatCitationOpenMode: 'current',
	aiChatMaxOutputTokens: 4096,
	aiChatHistoryTurns: 30,
	aiChatAutoContext: true,
	aiChatFreeOnly: true,
	aiChatFreeModel: 'gemini-3.5-flash-lite',
	paragraphAnalysis: { countSpaces: true, boundary: 'line', mobileLineChars: 28, singleQuote: 'monologue', roundBracket: 'monologue' },
};
import type { Component } from 'obsidian';

export interface IWritingMenuPlugin extends Component {
	app: import('obsidian').App;
	settings: WritingMenuSettings;
	saveSettings(): Promise<void>;
	addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void, icon?: string): Promise<void>;
	addSeparator(container: HTMLElement): void;
}
