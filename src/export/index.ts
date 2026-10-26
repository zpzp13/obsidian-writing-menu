import { App, TFile, TFolder } from 'obsidian';
import type WritingMenuPlugin from '../../main';
import { DocumentExportModal } from './DocumentExportModal';
import type { DocumentFormat } from './DocumentModel';
export { DocumentExportModal } from './DocumentExportModal';
export { registerExportIcons, setExportIcon } from './ExportIcons';
export class HwpxExportModal extends DocumentExportModal { constructor(app: App, plugin: WritingMenuPlugin, file: TFile) { super(app, plugin, file, 'hwpx'); } }
export class TxtExportModal extends DocumentExportModal { constructor(app: App, plugin: WritingMenuPlugin, file: TFile) { super(app, plugin, file, 'txt'); } }
export class DocxExportModal extends DocumentExportModal { constructor(app: App, plugin: WritingMenuPlugin, file: TFile) { super(app, plugin, file, 'docx'); } }
export class BatchExportModal extends DocumentExportModal { constructor(app: App, plugin: WritingMenuPlugin, target: TFolder | TFile[], format: DocumentFormat) { super(app, plugin, target, format); } }
