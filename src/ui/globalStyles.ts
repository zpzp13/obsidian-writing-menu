export const GLOBAL_STYLES_CSS = `
			.writing-menu-toggle {
				width: 40px;
				height: 22px;
				min-width: 40px;
				flex-shrink: 0;
				border-radius: 11px;
				background-color: var(--background-modifier-border-hover);
				position: relative;
				cursor: pointer;
				transition: background-color 0.15s ease-in-out;
			}
			.writing-menu-toggle.is-enabled {
				background-color: var(--interactive-accent);
			}
			.writing-menu-toggle-thumb {
				width: 18px;
				height: 18px;
				border-radius: 50%;
				background-color: white;
				position: absolute;
				top: 2px;
				left: 2px;
				transition: left 0.15s ease-in-out;
				box-shadow: 0 1px 2px rgba(0,0,0,0.2);
			}
			.writing-menu-toggle.is-enabled .writing-menu-toggle-thumb {
				left: 20px;
			}

			/* 집중 모드 (OS fullscreen + hide everything) */
			body.wm-focus-mode .workspace-split.mod-left-split,
			body.wm-focus-mode .workspace-split.mod-right-split,
			body.wm-focus-mode .workspace-ribbon.mod-left,
			body.wm-focus-mode .status-bar,
			body.wm-focus-mode .workspace-tab-header-container { display: none !important; }
			body.wm-focus-mode .view-header { display: none !important; }
			body.wm-focus-mode .workspace-split.mod-root { width: 100vw !important; }

			/* 구분선 비활성화 */
			body.wm-hr-disabled .markdown-preview-view hr,
			body.wm-hr-disabled .markdown-rendered hr { display: none !important; }
			body.wm-hr-disabled .cm-line.HyperMD-hr { display: none !important; }

			/* 길게 보기 (hide vertical chrome, keep sidebars) */
			body.wm-wide-mode { --titlebar-height: 0px !important; }
			body.wm-wide-mode .titlebar,
			body.wm-wide-mode .view-header,
			body.wm-wide-mode .workspace-tab-header-container,
			body.wm-wide-mode .status-bar { display: none !important; }

			/* Search highlight — fix mix-blend-mode on custom backgrounds, keep accent color */
			body [data-writing-menu-id] .obsidian-search-match-highlight {
				mix-blend-mode: normal !important;
				background: color-mix(in srgb, var(--text-accent) 45%, transparent) !important;
				background-color: color-mix(in srgb, var(--text-accent) 45%, transparent) !important;
				box-shadow: none !important;
				border-radius: 2px !important;
			}
			body [data-writing-menu-id] .cm-searchMatch { background: color-mix(in srgb, var(--text-accent) 55%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 55%, transparent) !important; border-radius: 2px !important; }
			body [data-writing-menu-id] .cm-searchMatch-selected { background: color-mix(in srgb, var(--text-accent) 80%, transparent) !important; background-color: color-mix(in srgb, var(--text-accent) 80%, transparent) !important; border-radius: 2px !important; }

			/* Dictionary modal */
			.wm-dict-modal .modal-content { padding: 0; overflow: hidden; }
			.wm-dict-header { padding: 12px 14px 20px; border-bottom: 1px solid var(--background-modifier-border); }

			/* 검색 박스 */
			.wm-dict-search-container { position: relative; width: 65%; margin: 0 auto; }
			.wm-dict-search-box { border: 2px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); transition: border-color 0.15s, border-radius 0.12s; }
			.wm-dict-search-box:focus-within { border-color: var(--interactive-accent); }
			.wm-dict-search-box.is-open { border-radius: 6px 6px 0 0; }
			.wm-dict-search-input-row { display: flex; align-items: center; border-bottom: 1px solid transparent; }
			.wm-dict-search-box.is-open .wm-dict-search-input-row { border-bottom-color: var(--background-modifier-border); }
			.wm-dict-search-box.is-open:focus-within .wm-dict-search-input-row { border-bottom-color: color-mix(in srgb, var(--interactive-accent) 35%, var(--background-modifier-border)); }
			.wm-dict-search { flex: 1; border: none !important; background: transparent !important; color: var(--text-normal); font-size: 16px; padding: 8px 0 8px 12px; outline: none !important; box-shadow: none !important; min-width: 0; }
			.wm-dict-search-icon { display: flex; align-items: center; padding: 0 10px; color: var(--text-faint); flex-shrink: 0; pointer-events: none; transition: color 0.15s; }
			.wm-dict-search-icon svg { width: 16px; height: 16px; }
			.wm-dict-search-box:focus-within .wm-dict-search-icon { color: var(--interactive-accent); }

			/* 드롭다운 — 절대 위치로 표 위에 겹침 */
			.wm-dict-dropdown { position: absolute; top: 100%; margin-top: -2px; left: 0; right: 0; z-index: 200; background: var(--background-primary); border: 2px solid var(--background-modifier-border); border-top: none; border-radius: 0 0 6px 6px; overflow: hidden; }
			.wm-dict-search-box.is-open:focus-within ~ .wm-dict-dropdown { border-color: var(--interactive-accent); }
			.wm-dict-dropdown-item { display: flex; align-items: center; padding: 7px 0 7px 12px; cursor: pointer; }
			.wm-dict-dropdown-item:hover, .wm-dict-dropdown-item.is-focused { background: var(--background-modifier-hover); }
			.wm-dict-dropdown-word { font-size: 14px; font-weight: 500; color: var(--text-normal); flex: 1; }
			.wm-dict-drop-word { font-size: 14px; color: var(--text-normal); flex: 1; }
			.wm-dict-drop-remove { display: flex; align-items: center; color: var(--text-faint); cursor: pointer; flex-shrink: 0; padding: 0 10px; }
			.wm-dict-drop-remove:hover { color: var(--text-normal); }
			.wm-dict-drop-remove svg { width: 13px; height: 13px; }
			.wm-dict-drop-clear-all { padding: 7px 12px; font-size: 12px; color: var(--text-faint); cursor: pointer; border-top: 1px solid var(--background-modifier-border); text-align: center; }
			.wm-dict-drop-clear-all:hover { color: var(--text-normal); background: var(--background-modifier-hover); }

			.wm-dict-body { display: flex; height: 390px; overflow: hidden; }

			/* 좌열 */
			.wm-dict-left { width: 148px; flex-shrink: 0; border-right: 1px solid var(--background-modifier-border); overflow-y: auto; padding: 6px 0; }
			.wm-dict-left-item { padding: 9px 12px; cursor: pointer; border-radius: 6px; margin: 2px 6px; }
			.wm-dict-left-item:hover { background: var(--background-modifier-hover); }
			.wm-dict-left-item.is-active { background: var(--interactive-accent); }
			.wm-dict-left-word { font-size: 18px; font-weight: 700; color: var(--text-normal); }
			.wm-dict-left-word sup { font-size: 11px; font-weight: 400; vertical-align: super; }
			.wm-dict-left-item.is-active .wm-dict-left-word { color: var(--text-on-accent); }

			/* 우열 */
			.wm-dict-right { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
			.wm-dict-view { overflow-y: auto; flex: 1; padding-bottom: 8px; }

			/* 한자 */
			.wm-dict-origin-text { font-size: 22px; font-weight: 700; color: var(--text-normal); line-height: 1.2; letter-spacing: 3px; padding: 18px 16px 10px; }

			/* 품사 */
			.wm-dict-pos-tag { font-size: 13px; color: var(--text-muted); padding: 0 16px 12px; }
			.wm-dict-pos-first { padding-top: 18px; }

			/* 뜻풀이 */
			.wm-dict-defs { padding: 0 16px 14px; }
			.wm-dict-sense { font-size: 15px; color: var(--text-normal); line-height: 1.9; padding: 2px 0; }
			.wm-dict-sense-no { color: var(--text-muted); margin-right: 4px; }

			/* 용례 */
			.wm-dict-examples-section { padding: 0 16px 14px; }
			.wm-dict-examples-divider { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 11px; color: var(--text-faint); }
			.wm-dict-examples-divider::before, .wm-dict-examples-divider::after { content: ''; flex: 1; height: 1px; background: var(--background-modifier-border); }
			.wm-dict-example { font-size: 14px; color: var(--text-muted); line-height: 1.9; padding: 2px 0; }
			.wm-dict-example-no { color: var(--text-faint); margin-right: 2px; }
			.wm-dict-highlight { background: color-mix(in srgb, var(--interactive-accent) 25%, transparent); border-radius: 2px; font-style: normal; }
			.wm-dict-loading-small { font-size: 12px; color: var(--text-faint); }

			/* 하단 */
			.wm-dict-footer { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-top: 1px solid var(--background-modifier-border); }
			.wm-dict-footer-left { display: flex; align-items: center; gap: 2px; }
			.wm-dict-footer-btn { background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important; color: var(--text-muted); cursor: pointer; padding: 4px 12px; font-size: 13px; border-radius: 4px; }
			.wm-dict-footer-btn:hover { color: var(--interactive-accent); background: transparent !important; }
			.wm-dict-apply-btn { background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important; color: var(--text-normal); cursor: pointer; padding: 4px 12px; font-size: 13px; border-radius: 4px; }
			.wm-dict-apply-btn:hover:not(:disabled) { color: var(--interactive-accent); }
			.wm-dict-apply-btn:disabled { opacity: 0.35; cursor: default; }
			.wm-dict-bracket-btn { display: flex; align-items: center; gap: 5px; background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important; color: var(--text-muted); cursor: pointer; padding: 4px 10px; font-size: 13px; border-radius: 4px; }
			.wm-dict-bracket-btn:hover:not(.is-disabled):not(.is-checked) { color: var(--text-normal); }
			.wm-dict-bracket-btn.is-checked { color: var(--interactive-accent) !important; }
			.wm-dict-bracket-btn.is-disabled { opacity: 0.35; cursor: default; pointer-events: none; }
			.wm-dict-bracket-icon { display: flex; align-items: center; flex-shrink: 0; }
			.wm-dict-bracket-icon svg { width: 14px; height: 14px; }
			.wm-dict-loading { padding: 40px 16px; font-size: 13px; color: var(--text-muted); text-align: center; }

			/* ── 버전 저장 모달 ─────────────────────────────────────────── */
			.wm-save-ver-modal { padding: 20px 24px 16px; }
			.wm-save-ver-title { font-size: 16px; font-weight: 600; margin: 0 0 14px; }
			.wm-save-ver-label { display: block; font-size: 12px; color: var(--text-muted); margin: 10px 0 5px; text-transform: uppercase; letter-spacing: 0.04em; }
			.wm-save-ver-label:first-of-type { margin-top: 0; }
			.wm-save-ver-input { width: 100%; font-size: 14px; padding: 8px 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); color: var(--text-normal); outline: none; box-sizing: border-box; }
			.wm-save-ver-input:focus { border-color: var(--interactive-accent); }
			.wm-save-ver-stage-row { display: flex; gap: 6px; }
			.wm-save-ver-stage-btn { flex: 1; padding: 5px 0; font-size: 13px; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 5px; cursor: pointer; color: var(--text-muted); transition: all 0.12s; }
			.wm-save-ver-stage-btn:hover { color: var(--text-normal); border-color: var(--text-muted); }
			.wm-save-ver-stage-btn-active { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
			.wm-save-ver-desc { width: 100%; font-size: 13px; padding: 8px 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); color: var(--text-normal); outline: none; box-sizing: border-box; resize: vertical; font-family: var(--font-text); line-height: 1.5; }
			.wm-save-ver-desc:focus { border-color: var(--interactive-accent); }
			.wm-save-ver-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
			.wm-save-ver-btn-cancel { padding: 6px 16px; font-size: 13px; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 5px; cursor: pointer; color: var(--text-muted); }
			.wm-save-ver-btn-cancel:hover { color: var(--text-normal); }
			.wm-save-ver-btn-save { padding: 6px 16px; font-size: 13px; background: var(--interactive-accent); border: none; border-radius: 5px; cursor: pointer; color: var(--text-on-accent); font-weight: 600; }
			.wm-save-ver-btn-save:hover:not(:disabled) { opacity: 0.88; }
			.wm-save-ver-btn-save:disabled { opacity: 0.5; cursor: default; }

			/* 버전 편집 모달 */
			.wm-edit-ver-modal { width: 560px !important; max-width: 92vw !important; }
			.wm-edit-ver-modal .modal-content { padding: 20px !important; display: flex; flex-direction: column; gap: 0; background: transparent !important; border: none !important; box-shadow: none !important; }
			.wm-evm-table { border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); overflow: hidden; }
			.wm-evm-row { border-bottom: 1px solid var(--background-modifier-border); }
			.wm-evm-row:last-child { border-bottom: none; }
			.wm-evm-row-2col { display: grid; grid-template-columns: 64px 1fr; min-height: 38px; }
			.wm-evm-cell-label { padding: 0 12px; font-size: var(--font-ui-small); color: var(--text-muted); border-right: 1px solid var(--background-modifier-border); display: flex; align-items: center; justify-content: center; }
			.wm-evm-cell-field { display: flex; align-items: center; min-width: 0; }
			.wm-evm-field,
			.wm-edit-ver-modal input.wm-evm-field,
			.wm-edit-ver-modal input.wm-evm-field:focus,
			.wm-edit-ver-modal input.wm-evm-field:active,
			.wm-edit-ver-modal input.wm-evm-field:hover { width: 100%; padding: 9px 12px; font-size: var(--font-ui-small); font-family: inherit; background: transparent !important; color: var(--text-normal); border: none !important; outline: none !important; box-shadow: none !important; line-height: 1.5; }
			.wm-evm-row-body { padding: 0; }
			.wm-evm-field-body,
			.wm-edit-ver-modal textarea.wm-evm-field-body,
			.wm-edit-ver-modal textarea.wm-evm-field-body:focus,
			.wm-edit-ver-modal textarea.wm-evm-field-body:active,
			.wm-edit-ver-modal textarea.wm-evm-field-body:hover { display: block; width: 100%; min-height: 400px; padding: 10px 12px; font-family: var(--font-monospace); font-size: 12.5px; line-height: 1.65; resize: vertical; box-sizing: border-box; background: transparent !important; color: var(--text-normal); border: none !important; outline: none !important; box-shadow: none !important; }
			.wm-evm-footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding-top: 14px; background: transparent !important; border: none !important; }
			.wm-evm-char-info { font-size: var(--font-ui-smaller); color: var(--text-faint); margin-right: auto; }
			.wm-evm-btn,
			.wm-edit-ver-modal button.wm-evm-btn,
			.wm-edit-ver-modal button.wm-evm-btn:hover,
			.wm-edit-ver-modal button.wm-evm-btn:focus,
			.wm-edit-ver-modal button.wm-evm-btn:active { background: none !important; border: none !important; box-shadow: none !important; outline: none !important; padding: 0 !important; font-size: var(--font-ui-small); color: var(--text-normal); cursor: pointer; }
			.wm-evm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
			.wm-evm-skeleton { display: flex; flex-direction: column; gap: 7px; padding: 12px; }
			.wm-evm-skeleton-line { height: 10px; background: var(--background-modifier-border); border-radius: 3px; animation: wm-skel 1.4s ease-in-out infinite; }
			.wm-evm-skeleton-line:nth-child(2) { width: 78%; animation-delay: .1s; }
			.wm-evm-skeleton-line:nth-child(3) { width: 62%; animation-delay: .2s; }
			@keyframes wm-skel { 0%,100% { opacity: .9; } 50% { opacity: .35; } }

			/* 팝업 섹션 라벨 — 같은 크기, 낮은 투명도, 아이콘 포함 */
			.wm-popup-section-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px 3px; font-size: var(--font-ui-small); color: var(--text-normal); opacity: 0.4; pointer-events: none; user-select: none; }
			.wm-popup-section-label .wm-popup-icon svg { width: 13px; height: 13px; }

			/* 팝업 단계 선택 행 */
			.wm-popup-stage-row { display: flex; align-items: center; padding: 4px 8px; gap: 2px; }
			.wm-popup-stage-btn { display: flex; align-items: center; gap: 5px; padding: 5px 8px; background: none !important; border: none !important; box-shadow: none !important; cursor: pointer; border-radius: var(--radius-s); font-size: var(--font-ui-small); color: var(--text-muted); flex: 1; justify-content: center; transition: background .1s; }
			.wm-popup-stage-btn:hover { background: var(--background-modifier-hover) !important; }
			.wm-popup-stage-btn.is-active { color: var(--text-normal); font-weight: 600; }
			.wm-popup-stage-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid; flex-shrink: 0; background: none !important; }
			.wm-popup-stage-dot-none { border-color: var(--text-faint) !important; }

			/* 팝업 메뉴 */
			.wm-popup { position: fixed; z-index: 10000; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); padding: 3px; box-shadow: var(--shadow-l); min-width: 185px; animation: wm-popup-in .1s ease-out; }
			@keyframes wm-popup-in { from { opacity: 0; transform: scale(0.97) translateY(-2px); } to { opacity: 1; transform: scale(1) translateY(0); } }
			.wm-popup-item { display: flex; align-items: center; padding: 6px 10px; border-radius: calc(var(--radius-s) - 1px); cursor: pointer; font-size: var(--font-ui-small); color: var(--text-normal); gap: 8px; user-select: none; }
			.wm-popup-item:hover, .wm-popup-item.is-active { background-color: var(--background-modifier-hover); }
			.wm-popup-item-danger { color: var(--text-error); }
			.wm-popup-item-danger:hover { background-color: var(--background-modifier-error-hover); }
			.wm-popup-icon { color: var(--text-muted); display: flex; align-items: center; flex-shrink: 0; }
			.wm-popup-icon svg { width: 14px; height: 14px; }
			.wm-popup-item:hover .wm-popup-icon, .wm-popup-item.is-active .wm-popup-icon { color: var(--text-normal); }
			.wm-popup-item-danger .wm-popup-icon { color: var(--text-error); }
			.wm-popup-label { flex: 1; }
			.wm-popup-label-group { flex: 1; display: flex; flex-direction: column; gap: 1px; }
			.wm-popup-sublabel { font-size: 10px; color: var(--text-faint); }
			.wm-popup-check { display: flex; align-items: center; color: var(--interactive-accent); flex-shrink: 0; margin-left: auto; }
			.wm-popup-check svg { width: 13px; height: 13px; }
			.wm-popup-separator { height: 1px; background: var(--background-modifier-border); margin: 3px 2px; }

			/* ── writing-menu-text-btn (드롭다운 버튼) ─────────────────── */
			.writing-menu-text-btn { font-size: 12px; padding: 2px 9px; background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer; color: var(--text-muted); }
			.writing-menu-text-btn:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }

			/* Zen mode — show only the active leaf */
			body.wm-focus-mode.wm-has-zen-leaf .workspace-tabs:not(:has(.wm-zen-leaf)),
			body.wm-focus-mode.wm-has-zen-leaf .workspace-split:not(.mod-root):not(:has(.wm-zen-leaf)) {
				display: none !important;
			}
			body.wm-focus-mode.wm-has-zen-leaf .workspace-tabs:has(.wm-zen-leaf) { flex: 1 1 auto !important; }
			body.wm-focus-mode.wm-has-zen-leaf .workspace-leaf.wm-zen-leaf { flex: 1 1 auto !important; }

`;
