import { App, Modal, TFile, TFolder, Notice, Setting, Vault, TAbstractFile, setIcon } from 'obsidian';
import type WritingMenuPlugin from '../../main';

// HWP Export Modal
export class HwpExportModal extends Modal {
	private plugin: WritingMenuPlugin;
	private file: TFile;
	private resultName: string;
	private resultPath: string;
	private useSpaceIndent: boolean;
	private excludeHeadings: boolean;
	private pathComponent: any = null;

	constructor(app: App, plugin: WritingMenuPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.resultName = file.basename;
		this.resultPath = plugin.getDefaultExportPath();
		this.useSpaceIndent = plugin.settings.exportDefaultSpaceIndent;
		this.excludeHeadings = plugin.settings.exportDefaultExcludeHeadings;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '한글(HWP)로 내보내기' });

		// File Name Input
		const fileSetting = new Setting(contentEl)
			.setName('파일 이름')
			.setDesc('내보낼 파일의 이름을 입력하세요.');

		fileSetting.addText((text) =>
			text
				.setValue(this.resultName)
				.onChange((value) => {
					this.resultName = value;
				})
		);

		fileSetting.settingEl.addClass('hwp-filename-setting');

		const extEl = fileSetting.controlEl.createEl('span', {
			text: '.hwp',
			cls: 'hwp-filename-extension'
		});
		extEl.style.cssText = 'margin-left:4px; color:var(--text-muted); font-size:14px;';

		// Export Path Input with Folder Button
		const pathSetting = new Setting(contentEl)
			.setName('저장 경로')
			.setDesc('파일이 저장될 폴더를 선택하세요.');

		pathSetting.addText((text) => {
			text
				.setValue(this.resultPath)
				.onChange((value) => {
					this.resultPath = value;
				});
			this.pathComponent = text;
		});

		pathSetting.addExtraButton((btn) =>
			btn
				.setIcon('folder')
				.setTooltip('폴더 선택')
				.onClick(async () => {
					const picked = await this.plugin.openFolderPicker();
					if (picked) {
						this.resultPath = picked;
						if (this.pathComponent) {
							this.pathComponent.setValue(picked);
						}
					}
				})
		);

		// Indentation Toggle
		new Setting(contentEl)
			.setName('문단 들여쓰기')
			.setDesc('각 문단 시작에 띄어쓰기 한 칸을 추가합니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.useSpaceIndent)
					.onChange((value) => {
						this.useSpaceIndent = value;
					})
			);

		// Exclude Headings Toggle
		new Setting(contentEl)
			.setName('헤딩 제외')
			.setDesc('마크다운 헤딩(#)을 제외하고 내보냅니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.excludeHeadings)
					.onChange((value) => {
						this.excludeHeadings = value;
					})
			);

		// Export Button
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('내보내기')
					.setCta()
					.onClick(() => {
						this.close();
						const finalName = this.resultName + '.hwp';
						this.plugin.convertToHwp(this.file, finalName, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// TXT Export Modal
export class TxtExportModal extends Modal {
	private plugin: WritingMenuPlugin;
	private file: TFile;
	private resultName: string;
	private resultPath: string;
	private useSpaceIndent: boolean;
	private excludeHeadings: boolean;
	private pathComponent: any = null;

	constructor(app: App, plugin: WritingMenuPlugin, file: TFile) {
		super(app);
		this.plugin = plugin;
		this.file = file;
		this.resultName = file.basename;
		this.resultPath = plugin.getDefaultExportPath();
		this.useSpaceIndent = plugin.settings.exportDefaultSpaceIndent;
		this.excludeHeadings = plugin.settings.exportDefaultExcludeHeadings;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '텍스트(TXT)로 내보내기' });

		// File Name Input
		const fileSetting = new Setting(contentEl)
			.setName('파일 이름')
			.setDesc('내보낼 파일의 이름을 입력하세요.');

		fileSetting.addText((text) =>
			text
				.setValue(this.resultName)
				.onChange((value) => {
					this.resultName = value;
				})
		);

		const extEl = fileSetting.controlEl.createEl('span', {
			text: '.txt',
			cls: 'txt-filename-extension'
		});
		extEl.style.cssText = 'margin-left:4px; color:var(--text-muted); font-size:14px;';

		// Export Path Input with Folder Button
		const pathSetting = new Setting(contentEl)
			.setName('저장 경로')
			.setDesc('파일이 저장될 폴더를 선택하세요.');

		pathSetting.addText((text) => {
			text
				.setValue(this.resultPath)
				.onChange((value) => {
					this.resultPath = value;
				});
			this.pathComponent = text;
		});

		pathSetting.addExtraButton((btn) =>
			btn
				.setIcon('folder')
				.setTooltip('폴더 선택')
				.onClick(async () => {
					const picked = await this.plugin.openFolderPicker();
					if (picked) {
						this.resultPath = picked;
						if (this.pathComponent) {
							this.pathComponent.setValue(picked);
						}
					}
				})
		);

		// Indentation Toggle
		new Setting(contentEl)
			.setName('문단 들여쓰기')
			.setDesc('각 문단 시작에 띄어쓰기 한 칸을 추가합니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.useSpaceIndent)
					.onChange((value) => {
						this.useSpaceIndent = value;
					})
			);

		// Exclude Headings Toggle
		new Setting(contentEl)
			.setName('헤딩 제외')
			.setDesc('마크다운 헤딩(#)을 제외하고 내보냅니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.excludeHeadings)
					.onChange((value) => {
						this.excludeHeadings = value;
					})
			);

		// Export Button
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('내보내기')
					.setCta()
					.onClick(() => {
						this.close();
						const finalName = this.resultName + '.txt';
						this.plugin.convertToTxt(this.file, finalName, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Batch Export Modal (Folder or Multi-file)
export class BatchExportModal extends Modal {
	private plugin: WritingMenuPlugin;
	private target: any; // TFolder or TFile[]
	private mode: 'folder' | 'multi';
	private format: 'hwp' | 'txt';
	private resultPath: string;
	private resultName: string;
	private useSpaceIndent: boolean;
	private excludeHeadings: boolean;
	private mergeFiles: boolean = false;
	private pathComponent: any = null;
	private nameComponent: any = null;
	private fileNameSetting: any = null;
	private sortedFiles: TFile[] = [];
	private removedFiles: TFile[] = [];
	private fileListContainer: HTMLElement | null = null;
	private listScrollTop: number = 0;

	constructor(app: App, plugin: WritingMenuPlugin, target: any, format: 'hwp' | 'txt') {
		super(app);
		this.plugin = plugin;
		this.target = target;
		this.format = format;
		this.mode = Array.isArray(target) ? 'multi' : 'folder';
		this.resultPath = plugin.getDefaultExportPath();
		this.useSpaceIndent = plugin.settings.exportDefaultSpaceIndent;
		this.excludeHeadings = plugin.settings.exportDefaultExcludeHeadings;
		// Default merged file name
		if (this.mode === 'folder') {
			this.resultName = this.target.name;
		} else {
			this.resultName = '병합된_문서';
		}
		// Initialize sorted files
		this.initSortedFiles();
	}

	// Natural sort comparator for filenames with numbers
	private naturalSort(a: TFile, b: TFile): number {
		const regex = /(\d+)|(\D+)/g;
		const aParts = a.basename.match(regex) || [];
		const bParts = b.basename.match(regex) || [];

		for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
			if (i >= aParts.length) return -1;
			if (i >= bParts.length) return 1;

			const aPart = aParts[i];
			const bPart = bParts[i];

			const aNum = parseInt(aPart);
			const bNum = parseInt(bPart);

			if (!isNaN(aNum) && !isNaN(bNum)) {
				if (aNum !== bNum) return aNum - bNum;
			} else {
				const cmp = aPart.localeCompare(bPart);
				if (cmp !== 0) return cmp;
			}
		}
		return 0;
	}

	private initSortedFiles() {
		if (this.mode === 'multi') {
			// For multi-file selection, copy and sort
			this.sortedFiles = [...this.target].sort((a: TFile, b: TFile) => this.naturalSort(a, b));
		} else {
			// For folder, get all markdown files and sort
			const folder = this.target as TFolder;
			const files: TFile[] = [];
			Vault.recurseChildren(folder, (child: TAbstractFile) => {
				if (child instanceof TFile && child.extension === 'md') {
					files.push(child);
				}
			});
			this.sortedFiles = files.sort((a, b) => this.naturalSort(a, b));
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const formatLabel = this.format === 'hwp' ? 'HWP' : 'TXT';
		const fileExt = this.format === 'hwp' ? '.hwp' : '.txt';

		if (this.mode === 'folder') {
			contentEl.createEl('h2', { text: `폴더를 ${formatLabel}로 내보내기` });
			contentEl.createEl('p', {
				text: `"${this.target.name}" 폴더 내 모든 마크다운 파일이 변환됩니다.`,
				cls: 'setting-item-description'
			});
		} else {
			contentEl.createEl('h2', { text: `${this.target.length}개 파일을 ${formatLabel}로 내보내기` });
		}

		// Merge/Individual Toggle
		new Setting(contentEl)
			.setName('파일 병합')
			.setDesc('모든 파일을 하나로 병합하여 저장합니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.mergeFiles)
					.onChange((value) => {
						this.mergeFiles = value;
						this.updateFileNameVisibility();
					})
			);

		// File Name Input (shown when merge is enabled)
		this.fileNameSetting = new Setting(contentEl)
			.setName('파일 이름')
			.setDesc('저장할 파일의 이름을 입력하세요.');

		this.fileNameSetting.addText((text: any) => {
			text
				.setValue(this.resultName)
				.onChange((value: string) => {
					this.resultName = value;
				});
			this.nameComponent = text;
		});

		const extEl = this.fileNameSetting.controlEl.createEl('span', {
			text: fileExt,
			cls: 'export-filename-extension'
		});
		extEl.style.cssText = 'margin-left:4px; color:var(--text-muted); font-size:14px;';

		// Initially hide file name setting
		this.fileNameSetting.settingEl.style.display = 'none';

		// File list container (for drag-and-drop reordering)
		this.fileListContainer = contentEl.createDiv({ cls: 'batch-export-file-list-container' });
		this.fileListContainer.style.cssText = 'display:none; margin-bottom:16px;';
		this.renderFileList();

		// Export Path Input with Folder Button
		const pathSetting = new Setting(contentEl)
			.setName('저장 경로')
			.setDesc('파일이 저장될 폴더를 선택하세요.');

		pathSetting.addText((text) => {
			text
				.setValue(this.resultPath)
				.onChange((value) => {
					this.resultPath = value;
				});
			this.pathComponent = text;
		});

		pathSetting.addExtraButton((btn) =>
			btn
				.setIcon('folder')
				.setTooltip('폴더 선택')
				.onClick(async () => {
					const picked = await this.plugin.openFolderPicker();
					if (picked) {
						this.resultPath = picked;
						if (this.pathComponent) {
							this.pathComponent.setValue(picked);
						}
					}
				})
		);

		// Indentation Toggle
		new Setting(contentEl)
			.setName('문단 들여쓰기')
			.setDesc('각 문단 시작에 띄어쓰기 한 칸을 추가합니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.useSpaceIndent)
					.onChange((value) => {
						this.useSpaceIndent = value;
					})
			);

		// Exclude Headings Toggle
		new Setting(contentEl)
			.setName('헤딩 제외')
			.setDesc('마크다운 헤딩(#)을 제외하고 내보냅니다.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.excludeHeadings)
					.onChange((value) => {
						this.excludeHeadings = value;
					})
			);

		// Export Button
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText('내보내기')
					.setCta()
					.onClick(() => {
						this.close();
						const fileName = this.resultName + (this.format === 'hwp' ? '.hwp' : '.txt');

						if (this.mergeFiles) {
							// Merge export - use sortedFiles which respects user's drag-and-drop order
							if (this.format === 'hwp') {
								this.plugin.convertFilesToHwpMerged(this.sortedFiles, this.resultPath, fileName, this.useSpaceIndent, this.excludeHeadings);
							} else {
								this.plugin.convertFilesToTxtMerged(this.sortedFiles, this.resultPath, fileName, this.useSpaceIndent, this.excludeHeadings);
							}
						} else {
							// Individual export
							if (this.mode === 'folder') {
								if (this.format === 'hwp') {
									this.plugin.convertFolderToHwp(this.target.path, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
								} else {
									this.plugin.convertFolderToTxt(this.target.path, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
								}
							} else {
								if (this.format === 'hwp') {
									this.plugin.convertFilesToHwp(this.target, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
								} else {
									this.plugin.convertFilesToTxt(this.target, this.resultPath, this.useSpaceIndent, this.excludeHeadings);
								}
							}
						}
					})
			);
	}

	updateFileNameVisibility() {
		if (this.fileNameSetting) {
			this.fileNameSetting.settingEl.style.display = this.mergeFiles ? '' : 'none';
		}
		if (this.fileListContainer) {
			this.fileListContainer.style.display = this.mergeFiles ? '' : 'none';
		}
	}

	private renderFileList() {
		if (!this.fileListContainer) return;
		this.fileListContainer.empty();

		// Header for included files
		const header = this.fileListContainer.createDiv({ cls: 'file-list-header' });
		header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;';
		header.createEl('span', { text: '포함할 파일 (드래그하여 정렬)' }).style.cssText = 'font-size:13px; color:var(--text-muted);';
		const countEl = header.createEl('span', { text: `${this.sortedFiles.length}개 파일` });
		countEl.style.cssText = 'font-size:12px; color:var(--text-faint);';

		// File list
		const listEl = this.fileListContainer.createDiv({ cls: 'file-list' });
		listEl.style.cssText = 'border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); max-height:200px; overflow-y:auto;';

		// Drag state
		let draggedIndex: number | null = null;
		let draggedEl: HTMLElement | null = null;

		const updateNumbers = () => {
			const items = listEl.querySelectorAll('.file-list-item');
			items.forEach((item, i) => {
				const numEl = item.querySelector('.file-num') as HTMLElement;
				if (numEl) numEl.textContent = `${i + 1}.`;
				(item as HTMLElement).setAttribute('data-index', String(i));
			});
			countEl.textContent = `${this.sortedFiles.length}개 파일`;
		};

		this.sortedFiles.forEach((file, index) => {
			const itemEl = listEl.createDiv({ cls: 'file-list-item' });
			itemEl.setAttribute('draggable', 'true');
			itemEl.setAttribute('data-index', String(index));
			itemEl.style.cssText = 'display:flex; align-items:center; padding:6px 12px; cursor:grab; border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); transition: background 0.1s;';

			// Drag handle icon (Lucide grip-vertical)
			const handleEl = itemEl.createDiv({ cls: 'drag-handle' });
			handleEl.style.cssText = 'margin-right:8px; color:var(--text-faint); display:flex; align-items:center;';
			setIcon(handleEl, 'grip-vertical');
			const iconSvg = handleEl.querySelector('svg');
			if (iconSvg) {
				iconSvg.setAttribute('width', '14');
				iconSvg.setAttribute('height', '14');
			}

			// File number
			const numEl = itemEl.createEl('span', { text: `${index + 1}.`, cls: 'file-num' });
			numEl.style.cssText = 'margin-right:8px; color:var(--text-faint); font-size:12px; min-width:20px;';

			// File name
			const nameEl = itemEl.createEl('span', { text: file.basename });
			nameEl.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

			// Remove button
			const removeBtn = itemEl.createDiv({ cls: 'file-remove-btn' });
			removeBtn.style.cssText = 'margin-left:8px; color:var(--text-faint); cursor:pointer; display:flex; align-items:center; padding:2px;';
			setIcon(removeBtn, 'x');
			const removeSvg = removeBtn.querySelector('svg');
			if (removeSvg) {
				removeSvg.setAttribute('width', '14');
				removeSvg.setAttribute('height', '14');
			}
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const idx = parseInt(itemEl.getAttribute('data-index') || '0');
				const [removed] = this.sortedFiles.splice(idx, 1);
				this.removedFiles.push(removed);
				itemEl.remove();
				updateNumbers();
				this.renderRemovedFiles();
			});
			removeBtn.addEventListener('mouseenter', () => {
				removeBtn.style.color = 'var(--text-error)';
			});
			removeBtn.addEventListener('mouseleave', () => {
				removeBtn.style.color = 'var(--text-faint)';
			});

			// Hover effect
			itemEl.addEventListener('mouseenter', () => {
				if (draggedEl !== itemEl) itemEl.style.background = 'var(--background-secondary)';
			});
			itemEl.addEventListener('mouseleave', () => {
				if (draggedEl !== itemEl) itemEl.style.background = 'var(--background-primary)';
			});

			// Drag events - optimized without full re-render
			itemEl.addEventListener('dragstart', (e) => {
				draggedIndex = parseInt(itemEl.getAttribute('data-index') || '0');
				draggedEl = itemEl;
				itemEl.style.opacity = '0.5';
				e.dataTransfer?.setData('text/plain', String(draggedIndex));
				e.dataTransfer!.effectAllowed = 'move';
			});

			itemEl.addEventListener('dragend', () => {
				itemEl.style.opacity = '1';
				draggedEl = null;
				draggedIndex = null;
				// Clear all indicators
				listEl.querySelectorAll('.file-list-item').forEach((el) => {
					(el as HTMLElement).style.borderTop = '';
					(el as HTMLElement).style.borderBottom = '';
				});
			});

			itemEl.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer!.dropEffect = 'move';
				if (draggedEl === itemEl) return;

				const rect = itemEl.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;

				// Clear previous indicators on this item
				itemEl.style.borderTop = '';
				itemEl.style.borderBottom = '';

				if (e.clientY < midY) {
					itemEl.style.borderTop = '2px solid var(--interactive-accent)';
				} else {
					itemEl.style.borderBottom = '2px solid var(--interactive-accent)';
				}
			});

			itemEl.addEventListener('dragleave', () => {
				itemEl.style.borderTop = '';
				itemEl.style.borderBottom = '';
			});

			itemEl.addEventListener('drop', (e) => {
				e.preventDefault();
				if (draggedIndex === null || draggedEl === null) return;

				const toIndex = parseInt(itemEl.getAttribute('data-index') || '0');
				if (draggedIndex === toIndex) return;

				const rect = itemEl.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;
				const insertBefore = e.clientY < midY;

				// Update array
				const [movedFile] = this.sortedFiles.splice(draggedIndex, 1);
				let newIndex = toIndex;
				if (draggedIndex < toIndex) {
					newIndex = insertBefore ? toIndex - 1 : toIndex;
				} else {
					newIndex = insertBefore ? toIndex : toIndex + 1;
				}
				this.sortedFiles.splice(newIndex, 0, movedFile);

				// Move DOM element directly
				if (insertBefore) {
					listEl.insertBefore(draggedEl, itemEl);
				} else {
					listEl.insertBefore(draggedEl, itemEl.nextSibling);
				}

				// Update numbers and data-index
				updateNumbers();

				// Clear indicators
				itemEl.style.borderTop = '';
				itemEl.style.borderBottom = '';
			});
		});

		// Remove border from last item
		const lastItem = listEl.querySelector('.file-list-item:last-child') as HTMLElement;
		if (lastItem) {
			lastItem.style.borderBottom = 'none';
		}

		// Restore scroll position
		requestAnimationFrame(() => {
			listEl.scrollTop = this.listScrollTop;
		});

		// Render removed files section
		this.renderRemovedFiles();
	}

	private renderRemovedFiles() {
		if (!this.fileListContainer) return;

		// Remove existing removed section
		const existingRemoved = this.fileListContainer.querySelector('.removed-section');
		if (existingRemoved) existingRemoved.remove();

		if (this.removedFiles.length === 0) return;

		const removedSection = this.fileListContainer.createDiv({ cls: 'removed-section' });

		const removedHeader = removedSection.createDiv({ cls: 'removed-files-header' });
		removedHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-top:12px; margin-bottom:8px;';
		removedHeader.createEl('span', { text: '제외된 파일' }).style.cssText = 'font-size:13px; color:var(--text-muted);';
		const removedCountEl = removedHeader.createEl('span', { text: `${this.removedFiles.length}개` });
		removedCountEl.style.cssText = 'font-size:12px; color:var(--text-faint);';

		const removedListEl = removedSection.createDiv({ cls: 'removed-file-list' });
		removedListEl.style.cssText = 'border:1px solid var(--background-modifier-border); border-radius:var(--radius-m); max-height:120px; overflow-y:auto; opacity:0.7;';

		this.removedFiles.forEach((file, index) => {
			const itemEl = removedListEl.createDiv({ cls: 'removed-file-item' });
			itemEl.setAttribute('data-index', String(index));
			itemEl.style.cssText = 'display:flex; align-items:center; padding:6px 12px; border-bottom:1px solid var(--background-modifier-border); background:var(--background-primary); transition: background 0.1s;';

			// File name
			const nameEl = itemEl.createEl('span', { text: file.basename });
			nameEl.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted);';

			// Add back button
			const addBtn = itemEl.createDiv({ cls: 'file-add-btn' });
			addBtn.style.cssText = 'margin-left:8px; color:var(--text-faint); cursor:pointer; display:flex; align-items:center; padding:2px;';
			setIcon(addBtn, 'plus');
			const addSvg = addBtn.querySelector('svg');
			if (addSvg) {
				addSvg.setAttribute('width', '14');
				addSvg.setAttribute('height', '14');
			}
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const idx = parseInt(itemEl.getAttribute('data-index') || '0');
				const [restored] = this.removedFiles.splice(idx, 1);
				this.sortedFiles.push(restored);
				this.listScrollTop = 0; // Reset scroll when adding back
				this.renderFileList();
			});
			addBtn.addEventListener('mouseenter', () => {
				addBtn.style.color = 'var(--text-success)';
			});
			addBtn.addEventListener('mouseleave', () => {
				addBtn.style.color = 'var(--text-faint)';
			});

			// Hover effect
			itemEl.addEventListener('mouseenter', () => {
				itemEl.style.background = 'var(--background-secondary)';
			});
			itemEl.addEventListener('mouseleave', () => {
				itemEl.style.background = 'var(--background-primary)';
			});
		});

		// Remove border from last item
		const lastRemovedItem = removedListEl.querySelector('.removed-file-item:last-child') as HTMLElement;
		if (lastRemovedItem) {
			lastRemovedItem.style.borderBottom = 'none';
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
