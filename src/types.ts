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

export interface PreviewTypography {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	paragraphSpacing: number;
	indentation: number;
	bgColor: string;
	textColor: string;
}

export interface TimeModeConfig {
	id: string;
	label: string;
	icon?: string;
	frontmatterKey: string;
	goalSeconds: number;
}

export interface WritingMenuSettings {
	fontFamily: string;
	customFonts: string[];
	fontSize: number;
	fontColor: string | { light: string; dark: string };
	lineHeight: number;
	paragraphSpacing: number;
	indentation: number;
	lineWidth: number;
	inlinePadding: number;
	backgroundColor: string | { light: string; dark: string };
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
	zenWideEnabled: boolean;
	zenFocusEnabled: boolean;
	enableSmartQuotes: boolean;
	symbolTriggers: SymbolTrigger[];
	enableSmartEnter: boolean;
	smartEnterPairs: string[];
	enableSmartInput: boolean;
	enableTextSubstitution: boolean;
	textSubstitutions: TextSubstitution[];
	charCountMode: 'munpia' | 'novelpia';
	statCardDisplay: 'munpia' | 'novelpia' | 'both';
	enableTimeTracking: boolean;
	showTimeInStatusBar: boolean;
	showTimeInDashboard: boolean;
	currentTimeMode: string;
	stopwatchMinutes: number;
	enableStopwatchAlarm: boolean;
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
	previewTypography: PreviewTypography;
	stdictApiKey: string;
	hanjaBracketMode: boolean;
	recentSearches: string[];
	versionStoragePath: string;
	versionMaxCount: number;
	versionStages: { name: string; color: string }[];
	versionToolbarAutoHide: boolean;
	trackingFolder: string;
	dailyNotesFolder: string;
	dailyNotesFormat: string;
	taskAddHeader: string;
	writingGoalChars: number;
	dailyCharCountKey: string;
	timeModes: TimeModeConfig[];
	timeTotalKey: string;
	timeAvgFolderLevel: number;
	timeExcludeFolders?: string[];
	timeCardPalette?: 'accent' | 'solid' | 'pastel' | 'mono';
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
	wikiDefaultGroupField: string;
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
	wikiToolbarAutoHide: boolean;
	calendarPreviewItems: {
		tasks: boolean;
		charCount: boolean;
		avgCharCount: boolean;
		timeModes: boolean;
		totalTime: boolean;
	};
	// ── Special Chars ──────────────────────────────────────────────────────────
	specialCharCloseOnInsert: boolean;
	specialCharFavorites: string[];
	specialCharCustom: { char: string; desc: string }[];
	// ── Plot Manager ───────────────────────────────────────────────────────────
	plotManagerFolder: string;
	plotDataFolder: string;
	plotCharFolder: string;
	plotCharNoteTemplate: string;
	plotHiddenCharIds: string[];
	plotCharNoteOpenMode: 'current' | 'tab' | 'window';
	plotLinkOpenMode: 'current' | 'tab' | 'window';
	plotSortPageSize: number;
	plotCellWidth: number;
	// ── Spell Check ────────────────────────────────────────────────────────────
	spellCheckIgnoredWords: string[];
	// ── AI 챗 ──────────────────────────────────────────────────────────────────
	aiChatApiKey: string;
	aiChatGeminiApiKey: string;
	aiChatCerebrasApiKey: string;
	aiChatModel: string;
	aiChatLastCharacterPath: string;
	aiChatLastSpeakerPath: string;
	aiChatSystemPromptNotePath: string;
	/** 작품 루트 폴더 (에피소드/캐릭터 노트 자동 스코프용, Plot Manager 설정과는 별개) */
	aiEpisodeRootFolder: string;
	/** 루트 폴더 하위 에피소드(플롯) 노트 폴더명 */
	aiEpisodeDataFolder: string;
	/** 루트 폴더 하위 캐릭터 노트 폴더명 */
	aiEpisodeCharFolder: string;
	/** 루트 폴더 하위 완성 본문 노트 폴더명 (직전 회차의 실제 문체를 참고용으로 먹이기 위함) */
	aiEpisodeBodyFolder: string;
	/** 회차챗 초안 패스의 톤/전개 지침 노트. 지정하면 노트를 선택할 때 기본 지침이 자동으로 채워지고, 그 내용을 직접 수정해서 쓸 수 있다. */
	aiEpisodeSystemPromptNotePath: string;
	/** 회차챗 전용 모델 (캐릭터 챗의 aiChatModel과 분리) */
	aiEpisodeModel: string;
	aiChatPersonaHeading: string;
	aiChatTemperature: number;
	aiChatNarrationFontSize: number;
	aiChatDialogueFontSize: number;
	aiChatToolbarAutoHide: boolean;
	// ── 퇴고 매니저 (Revision Manager) ─────────────────────────────────────────
	repetitionVocabNotePath: string;
	// ── Update ────────────────────────────────────────────────────────────────
	lastSeenVersion?: string;
}

export interface DashSectionConfig {
	id: 'chars' | 'time' | 'tasks' | 'music' | 'version' | 'repetition';
	label: string;
	visible: boolean;
}

export const DEFAULT_SETTINGS: WritingMenuSettings = {
	fontFamily: 'inherit',
	customFonts: [],
	fontSize: 16,
	fontColor: 'inherit',
	lineHeight: 1.5,
	paragraphSpacing: 1,
	indentation: 0,
	lineWidth: 700,
	inlinePadding: 40,
	backgroundColor: 'transparent',
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
	zenWideEnabled: true,
	zenFocusEnabled: true,
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
	statCardDisplay: 'both',
	enableTimeTracking: true,
	showTimeInStatusBar: false,
	showTimeInDashboard: true,
	currentTimeMode: 'draft',
	stopwatchMinutes: 25,
	enableStopwatchAlarm: true,
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
	versionStoragePath: '.writing-menu-versions',
	versionMaxCount: 50,
	versionStages: [
		{ name: '초고', color: '#a8c8f0' },
		{ name: '퇴고', color: '#f0c8a8' },
		{ name: '연출', color: '#c8a8f0' },
	],
	versionToolbarAutoHide: false,
	previewTypography: {
		fontFamily: 'inherit',
		fontSize: 16,
		lineHeight: 1.8,
		paragraphSpacing: 1,
		indentation: 0,
		bgColor: 'var(--background-primary)',
		textColor: 'var(--text-normal)',
	},
	trackingFolder: '',
	dailyNotesFolder: '',
	dailyNotesFormat: 'YYYY-MM-DD',
	taskAddHeader: '할 일',
	writingGoalChars: 0,
	dailyCharCountKey: '글자수',
	timeModes: [
		{ id: 'draft',   label: '기획', icon: 'lightbulb',   frontmatterKey: '초고_시간', goalSeconds: 7200 },
		{ id: 'writing', label: '초고', icon: 'pencil',       frontmatterKey: '집필_시간', goalSeconds: 7200 },
		{ id: 'editing', label: '퇴고', icon: 'spell-check',  frontmatterKey: '퇴고_시간', goalSeconds: 7200 },
	],
	timeTotalKey: '총_시간',
	timeAvgFolderLevel: 0,
	timeExcludeFolders: [],
	dashboardSections: [
		{ id: 'chars',   label: '글자수',   visible: true },
		{ id: 'time',    label: '작업시간', visible: true },
		{ id: 'tasks',   label: '할 일',    visible: true },
		{ id: 'music',   label: '음악',     visible: true },
		{ id: 'version', label: '버전관리', visible: true },
		{ id: 'repetition', label: '퇴고 매니저', visible: true },
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
	wikiDefaultGroupField: 'None',
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
	wikiToolbarAutoHide: false,
	calendarPreviewItems: {
		tasks: true,
		charCount: true,
		avgCharCount: true,
		timeModes: true,
		totalTime: true,
	},
	specialCharCloseOnInsert: true,
	specialCharFavorites: [],
	specialCharCustom: [],
	plotManagerFolder: '',
	plotDataFolder: '',
	plotCharFolder: '',
	plotCharNoteTemplate: '',
	plotHiddenCharIds: [],
	plotCharNoteOpenMode: 'tab',
	plotLinkOpenMode: 'tab',
	plotSortPageSize: 5,
	plotCellWidth: 200,
	spellCheckIgnoredWords: [],
	aiChatApiKey: '',
	aiChatGeminiApiKey: '',
	aiChatCerebrasApiKey: '',
	aiChatModel: 'google/diffusiongemma-26b-a4b-it',
	aiChatLastCharacterPath: '',
	aiChatLastSpeakerPath: '',
	aiChatSystemPromptNotePath: '',
	aiEpisodeRootFolder: '',
	aiEpisodeDataFolder: '',
	aiEpisodeCharFolder: '',
	aiEpisodeBodyFolder: '',
	aiEpisodeSystemPromptNotePath: '',
	aiEpisodeModel: 'google/diffusiongemma-26b-a4b-it',
	aiChatPersonaHeading: '',
	aiChatTemperature: 1.0,
	aiChatNarrationFontSize: 0.9,
	aiChatDialogueFontSize: 1.0,
	aiChatToolbarAutoHide: false,
	repetitionVocabNotePath: '',
};
import type { Component } from 'obsidian';

export interface IWritingMenuPlugin extends Component {
	app: import('obsidian').App;
	settings: WritingMenuSettings;
	saveSettings(): Promise<void>;
	addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void, icon?: string): Promise<void>;
	addSeparator(container: HTMLElement): void;
}
