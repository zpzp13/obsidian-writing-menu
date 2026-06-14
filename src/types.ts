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

export interface WritingMenuSettings {
	fontFamily: string;
	customFonts: string[];
	fontSize: number;
	fontColor: string | { light: string; dark: string };
	lineHeight: number;
	paragraphSpacing: number;
	indentation: number;
	lineWidth: number;
	backgroundColor: string | { light: string; dark: string };
	applyToFolder: string;
	disableLinkColor: boolean;
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
	enableTimeTracking: boolean;
	hideTimeTracking: boolean;
	currentTimeMode: 'draft' | 'writing' | 'editing';
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
	calendarHeatmapSource: 'files' | 'daily-notes' | 'time' | 'tasks';
	heatmapColor: string;
	heatmapFolder: string;
	heatmapLevels: [number, number, number, number];
	dailyNotesFolder: string;
	dailyNotesFormat: string;
	taskAddHeader: string;
	writingGoalChars: number;
	timeKeys: {
		draft:   string;
		writing: string;
		editing: string;
		total:   string;
	};
	timeGoals: {
		draft:   number;
		writing: number;
		editing: number;
	};
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
	backgroundColor: 'transparent',
	applyToFolder: '',
	disableLinkColor: false,
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
	enableTimeTracking: false,
	hideTimeTracking: false,
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
	previewTypography: {
		fontFamily: 'inherit',
		fontSize: 16,
		lineHeight: 1.8,
		paragraphSpacing: 1,
		indentation: 0,
		bgColor: 'var(--background-primary)',
		textColor: 'var(--text-normal)',
	},
	calendarHeatmapSource: 'files',
	heatmapColor: '#4f9cf9',
	heatmapFolder: '',
	heatmapLevels: [2000, 4000, 6000, 8000],
	dailyNotesFolder: '',
	dailyNotesFormat: 'YYYY-MM-DD',
	taskAddHeader: '할 일',
	writingGoalChars: 0,
	timeKeys: { draft: '초고_시간', writing: '집필_시간', editing: '퇴고_시간', total: '총_시간' },
	timeGoals: { draft: 7200, writing: 7200, editing: 7200 },
};
import type { Component } from 'obsidian';

export interface IWritingMenuPlugin extends Component {
	app: import('obsidian').App;
	settings: WritingMenuSettings;
	saveSettings(): Promise<void>;
	addCompactStepper(container: HTMLElement, label: string, value: number, step: number, min: number, callback: (v: number) => void, icon?: string): Promise<void>;
	addSeparator(container: HTMLElement): void;
}
