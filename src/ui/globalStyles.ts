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

			/* Status bar stopwatch tag */
			.wm-status-bar-item {
				background: var(--interactive-accent) !important;
				color: var(--text-on-accent) !important;
				border-radius: 4px !important;
				padding: 1px 8px !important;
				cursor: pointer !important;
				font-variant-numeric: tabular-nums !important;
				font-weight: 600 !important;
				font-size: 12px !important;
				align-items: center !important;
				gap: 0 !important;
				margin: 0 2px !important;
			}
			.wm-status-bar-item:hover { opacity: 0.85; }

			/* Status popup */
			.wm-status-popup {
				position: fixed;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				border-radius: 12px;
				padding: 12px 14px 10px;
				min-width: 200px;
				z-index: 9999;
				box-shadow: 0 4px 16px rgba(0,0,0,0.2);
			}
			.wm-popup-row {
				display: flex;
				align-items: center;
				padding: 2px 0;
			}
			/* Mode text buttons (초고/집필/퇴고) */
			.wm-popup-mode-btn {
				background: transparent !important;
				border: none !important;
				box-shadow: none !important;
				outline: none !important;
				color: var(--text-muted);
				font-size: 12px;
				cursor: pointer;
				padding: 0 5px;
				height: 24px;
				line-height: 24px;
				border-radius: 4px;
				white-space: nowrap;
			}
			.wm-popup-mode-btn:hover { color: var(--text-normal); }
			.wm-popup-mode-btn.is-active { color: var(--interactive-accent); font-weight: 600; }
			.wm-popup-meta-val { font-size:12px; font-variant-numeric:tabular-nums; color:var(--text-muted); }
			/* Circular timer */
			.wm-popup-timer-wrap {
				position: relative;
				width: 156px;
				height: 156px;
				display: flex;
				align-items: center;
				justify-content: center;
				margin: 6px auto 4px;
			}
			.wm-popup-circle {
				position: absolute;
				top: 0; left: 0;
				width: 156px; height: 156px;
				transform: rotate(-90deg);
			}
			.wm-popup-circle-track {
				fill: none;
				stroke: var(--background-modifier-border);
				stroke-width: 5;
			}
			.wm-popup-circle-fill {
				fill: none;
				stroke: var(--interactive-accent);
				stroke-width: 5;
				stroke-linecap: round;
				transition: stroke-dashoffset 1s linear;
			}
			.wm-popup-timer-big {
				position: relative;
				z-index: 1;
				font-size: 28px;
				font-weight: 700;
				font-variant-numeric: tabular-nums;
				letter-spacing: 2px;
				color: var(--text-normal);
				font-family: var(--font-monospace, monospace);
				transition: color 0.2s ease;
				user-select: none;
			}
			.wm-popup-timer-big.is-running { color: var(--interactive-accent); }
			/* Text action buttons (+1/+5/+10/+25) */
			.wm-popup-action-btn {
				width: 36px;
				height: 32px;
				display: flex;
				align-items: center;
				justify-content: center;
				background: transparent !important;
				border: none !important;
				box-shadow: none !important;
				outline: none !important;
				color: var(--text-muted);
				font-size: 12px;
				cursor: pointer;
				padding: 0 !important;
				box-sizing: border-box;
				border-radius: 4px;
				flex-shrink: 0;
			}
			.wm-popup-action-btn:hover { color: var(--interactive-accent); background: transparent !important; }
			/* Icon action buttons (play/reset) — use div so setIcon renders cleanly */
			.wm-popup-icon-action {
				width: 36px;
				height: 36px;
				display: flex;
				align-items: center;
				justify-content: center;
				background: transparent;
				border-radius: 6px;
				color: var(--text-muted);
				cursor: pointer;
				flex-shrink: 0;
			}
			.wm-popup-icon-action:hover { color: var(--interactive-accent); }
			.wm-popup-icon-action svg { width: 16px; height: 16px; pointer-events: none; }
			.wm-popup-divider {
				height: 1px;
				background: var(--background-modifier-border);
				margin: 4px 0;
			}

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

			/* ── 버전 패널 (대시보드 탭) ─────────────────────────────────── */

			.wm-vhv-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
			.wm-vhv-header { flex-shrink: 0; position: relative; overflow: visible; }
			.wm-vhv-normal-row { display: flex; align-items: center; padding: 24px 12px; gap: 4px; }
			.wm-vhv-title-group { display: flex; align-items: center; flex: 1; min-width: 0; overflow: hidden; }
			.wm-vhv-search-wrap { display: flex; align-items: center; flex-shrink: 0; border-radius: var(--radius-s); border: 2.5px solid transparent; }
			.wm-vhv-header.is-searching .wm-vhv-title-group { display: none; }
			.wm-vhv-header.is-searching .wm-vhv-search-wrap { flex: 1; border-color: var(--interactive-accent); padding: 0 2px; }
			.wm-vhv-search-input { width: 0; overflow: hidden; opacity: 0; font-size: 14px; color: var(--text-normal); height: 22px; padding: 0; transition: opacity .15s ease; background: transparent !important; border: none !important; outline: none !important; box-shadow: none !important; }
			.wm-vhv-header.is-searching .wm-vhv-search-input { flex: 1; width: auto; overflow: visible; opacity: 1; padding: 0 4px; }
			.wm-vhv-actions { display: flex; align-items: center; gap: 0; flex-shrink: 0; }
			.wm-vhv-actions .wm-cal-icon-btn.is-active { color: var(--text-normal); opacity: 1; }

			.wm-vhv-list { flex: 1; overflow-y: auto; padding-bottom: 16px; }
			.wm-vhv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 16px; gap: 8px; color: var(--text-muted); }
			.wm-vhv-empty p { font-size: var(--font-ui-small); text-align: center; margin: 0; white-space: pre-line; line-height: 1.6; }

			.wm-vhv-group { margin-bottom: 16px; }
			.wm-vhv-group:last-child { margin-bottom: 0; }
			.wm-vhv-group-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px; cursor: pointer; user-select: none; border-bottom: 1px solid var(--background-modifier-border); }
			.wm-vhv-group-header:hover .wm-vhv-group-label { color: var(--text-normal); }
			.wm-vhv-group-label { font-size: 14px; font-weight: var(--font-semibold); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
			.wm-vhv-group-chevron { display: flex; align-items: center; color: var(--text-faint); }
			.wm-vhv-group-chevron svg { width: 18px; height: 18px; }
			.wm-vhv-group-items.is-collapsed { display: none; }

			.wm-vhv-item { padding: 11px 12px; cursor: pointer; position: relative; }
			.wm-vhv-item::after { content: ''; position: absolute; bottom: 0; left: 20px; right: 0; height: 1px; background: var(--background-modifier-border); }
			.wm-vhv-group-items .wm-vhv-item:last-child::after { display: none; }
			.wm-vhv-item-top { position: relative; margin-bottom: 4px; padding-left: 10px; overflow: visible; }
			.wm-vhv-item-name { font-size: calc(var(--font-ui-small) + 2px); font-weight: var(--font-semibold); color: var(--text-normal); line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
			.wm-vhv-item-actions { position: absolute; top: 50%; transform: translateY(-50%); right: -10px; height: 26px; display: flex; align-items: center; gap: 2px; padding: 0 10px 0 4px; opacity: 0; pointer-events: none; transition: opacity .15s; background: var(--background-primary); z-index: 2; }
			.wm-vhv-item:hover .wm-vhv-item-actions { opacity: 1; pointer-events: auto; }
			.wm-vhv-action-btn { width: 24px; height: 24px; padding: 0; background: none !important; border: none !important; box-shadow: none !important; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-s); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
			.wm-vhv-action-btn svg { width: 14px; height: 14px; }
			.wm-vhv-action-btn:hover { color: var(--interactive-accent); background: transparent !important; }
			.wm-vhv-action-danger { width: 18px !important; justify-content: flex-end !important; padding-right: 0 !important; }
			.wm-vhv-action-danger:hover { color: var(--text-error) !important; }

			.wm-vhv-item-desc { font-size: calc(var(--font-ui-smaller) + 2px); color: var(--text-muted); line-height: 1.5; margin-bottom: 6px; padding-left: 10px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
			.wm-vhv-item-bottom { display: flex; align-items: center; gap: 8px; padding-left: 10px; }
			.wm-vhv-item-date { font-size: calc(var(--font-ui-smaller) + 2px); color: var(--text-faint); white-space: nowrap; flex-shrink: 0; }
			.wm-vhv-item-right { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
			.wm-vhv-item-chars { font-size: calc(var(--font-ui-smaller) + 2px); color: var(--text-faint); white-space: nowrap; }
			.theme-dark .wm-vhv-item-date,
			.theme-dark .wm-vhv-item-chars { color: var(--text-muted); }
			.wm-vhv-item-ver { display: inline-flex; align-items: center; gap: 2px; color: var(--interactive-accent) !important; flex-shrink: 0; pointer-events: none; }
			.wm-vhv-item-ver-icon { display: flex; align-items: center; width: 10px; height: 10px; flex-shrink: 0; }
			.wm-vhv-item-ver-icon svg { width: 10px !important; height: 10px !important; flex-shrink: 0; display: block; color: var(--interactive-accent) !important; stroke: currentColor; transition: none !important; }
			.wm-vhv-item-ver-num { font-size: calc(var(--font-ui-smaller) + 2px); font-weight: 700; }
			.wm-vhv-item-stage { font-size: calc(var(--font-ui-smaller) + 2px); color: var(--text-faint); }
			.theme-dark .wm-vhv-item-stage { color: var(--text-muted); }

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
			.wm-ver-popup-section-label { display: flex; align-items: center; gap: 8px; padding: 6px 10px 3px; font-size: var(--font-ui-small); color: var(--text-normal); opacity: 0.4; pointer-events: none; user-select: none; }
			.wm-ver-popup-section-label .wm-ver-popup-icon svg { width: 13px; height: 13px; }

			/* 팝업 단계 선택 행 */
			.wm-ver-popup-stage-row { display: flex; align-items: center; padding: 4px 8px; gap: 2px; }
			.wm-ver-popup-stage-btn { display: flex; align-items: center; gap: 5px; padding: 5px 8px; background: none !important; border: none !important; box-shadow: none !important; cursor: pointer; border-radius: var(--radius-s); font-size: var(--font-ui-small); color: var(--text-muted); flex: 1; justify-content: center; transition: background .1s; }
			.wm-ver-popup-stage-btn:hover { background: var(--background-modifier-hover) !important; }
			.wm-ver-popup-stage-btn.is-active { color: var(--text-normal); font-weight: 600; }
			.wm-ver-popup-stage-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid; flex-shrink: 0; background: none !important; }
			.wm-ver-popup-stage-dot-none { border-color: var(--text-faint) !important; }

			/* 팝업 메뉴 */
			.wm-ver-popup { position: fixed; z-index: 10000; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); padding: 3px; box-shadow: var(--shadow-l); min-width: 185px; animation: wm-popup-in .1s ease-out; }
			@keyframes wm-popup-in { from { opacity: 0; transform: scale(0.97) translateY(-2px); } to { opacity: 1; transform: scale(1) translateY(0); } }
			.wm-ver-popup-item { display: flex; align-items: center; padding: 6px 10px; border-radius: calc(var(--radius-s) - 1px); cursor: pointer; font-size: var(--font-ui-small); color: var(--text-normal); gap: 8px; user-select: none; }
			.wm-ver-popup-item:hover, .wm-ver-popup-item.is-active { background-color: var(--background-modifier-hover); }
			.wm-ver-popup-item-danger { color: var(--text-error); }
			.wm-ver-popup-item-danger:hover { background-color: var(--background-modifier-error-hover); }
			.wm-ver-popup-icon { color: var(--text-muted); display: flex; align-items: center; flex-shrink: 0; }
			.wm-ver-popup-icon svg { width: 14px; height: 14px; }
			.wm-ver-popup-item:hover .wm-ver-popup-icon, .wm-ver-popup-item.is-active .wm-ver-popup-icon { color: var(--text-normal); }
			.wm-ver-popup-item-danger .wm-ver-popup-icon { color: var(--text-error); }
			.wm-ver-popup-label { flex: 1; }
			.wm-ver-popup-label-group { flex: 1; display: flex; flex-direction: column; gap: 1px; }
			.wm-ver-popup-sublabel { font-size: 10px; color: var(--text-faint); }
			.wm-ver-popup-check { display: flex; align-items: center; color: var(--interactive-accent); flex-shrink: 0; margin-left: auto; }
			.wm-ver-popup-check svg { width: 13px; height: 13px; }
			.wm-ver-popup-separator { height: 1px; background: var(--background-modifier-border); margin: 3px 2px; }

			/* 설정 페이지 — 상태 관리 */
			.wm-stage-del-btn { width: 26px !important; height: 26px !important; min-width: 0 !important; padding: 0 !important; background: none !important; border: none !important; box-shadow: none !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0; color: var(--background-modifier-border) !important; }
			.wm-stage-del-btn svg { width: 22px !important; height: 22px !important; }
			.wm-stage-del-btn:hover { color: var(--text-error) !important; background: none !important; }
			.wm-stage-del-btn.mod-warning { color: var(--background-modifier-border) !important; }
			/* 색상 피커 크기 통일 — Obsidian Setting.addColorPicker */
			.wm-settings-group-box .setting-item input[type=color] { width: 26px; height: 26px; padding: 0; }

			/* 미리보기 v-panel 패턴 */


/* 미리보기 페이지 — v-panel-* 패턴 사용 */
			.version-control-view .version-control-content { height: 100%; overflow-y: auto; overflow-x: hidden; }
			.version-control-view .v-panel-header { position: sticky; top: 0; z-index: 10; background: var(--background-primary); display: flex; align-items: center; gap: var(--size-4-3); padding: var(--size-4-3) var(--size-4-2) var(--size-4-2); border-bottom: 1px solid var(--background-modifier-border); min-height: var(--input-height); box-sizing: border-box; }
			.version-control-view .v-panel-header h3 { margin: 0; font-size: var(--font-ui-medium); font-weight: var(--font-semibold); flex-grow: 1; word-break: break-word; white-space: normal !important; overflow: visible !important; text-overflow: unset !important; }
			.version-control-view .v-panel-header-actions { display: flex; align-items: center; gap: var(--size-4-2); flex-shrink: 0; margin-left: auto; }
			.version-control-view .v-diff-meta-container { background-color: var(--background-secondary); flex-shrink: 0; }
			.version-control-view .v-diff-meta-content-wrapper { padding: var(--size-4-2) var(--size-4-4); display: flex; flex-direction: column; gap: var(--size-4-1); border-bottom: 1px solid var(--background-modifier-border); box-sizing: border-box; }
			.version-control-view .v-meta-label { color: var(--text-muted); font-size: var(--font-ui-smaller); display: flex; align-items: center; gap: var(--size-4-2); flex-wrap: wrap; }
			.version-control-view .v-preview-panel-content { padding: var(--size-4-2) var(--size-4-1); box-sizing: border-box; }
			.version-control-view .v-version-content-preview { background-color: var(--background-secondary); padding: var(--size-4-4); border-radius: var(--radius-m); line-height: 1.5; user-select: text; }

			/* ── Diff 플로팅 윈도우 (version-control .v-diff-window 패턴) ── */
			.wm-diff-window { position: fixed; top: 0; left: 0; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); box-shadow: var(--shadow-xl); display: flex; flex-direction: column; overflow: hidden; will-change: transform; touch-action: none; z-index: 9999; }
			.wm-diff-window-dragging { cursor: grabbing !important; user-select: none; }
			.wm-diff-window-header { height: 36px; background-color: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); display: flex; align-items: center; justify-content: flex-end; padding: 0 8px; cursor: grab; user-select: none; flex-shrink: 0; }
			.wm-diff-window-header:active { cursor: grabbing; }
			.wm-diff-window-controls { display: flex; gap: 2px; }
			.wm-diff-window-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

			/* 패널 헤더 */

			/* 메타 */

			/* 본문 */
			.wm-diff-panel-body { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
			.wm-diff-loading { padding: 40px; text-align: center; color: var(--text-faint); font-size: 13px; }
			.wm-diff-no-change { padding: 48px; text-align: center; color: var(--text-faint); font-size: 14px; }

			/* split — 컬럼 헤더 */
			.wm-diff-col-headers { display: grid; grid-template-columns: 1fr 1fr; flex-shrink: 0; border-bottom: 1px solid var(--background-modifier-border); }
			.wm-diff-col-header { padding: 6px 14px; font-size: var(--font-ui-small); font-weight: var(--font-semibold); color: var(--text-muted); background: transparent; text-align: center; }

			/* 공통 스크롤 영역 */
			.wm-diff-scroll { flex: 1; overflow-y: auto; font-family: var(--font-monospace); font-size: 12.5px; line-height: 1.6; }
			.wm-diff-scroll-unified { }
			.wm-diff-table { display: flex; flex-direction: column; }
			.wm-diff-table-unified { display: flex; flex-direction: column; }

			/* split diff — 행/셀 */
			.wm-diff-row { display: grid; grid-template-columns: 1fr 1fr; }
			.wm-diff-equal-row { margin-bottom: 0; background: transparent; }
			.wm-diff-equal-row .wm-diff-cell { background: var(--background-primary); color: var(--text-faint); }
			.wm-diff-cell { padding: 2px 14px; min-height: 20px; white-space: pre-wrap; word-break: break-all; background: var(--background-primary); overflow-wrap: break-word; }
			.theme-light .wm-diff-cell-a { background: color-mix(in srgb, #e74c3c 8%, var(--background-primary)); }
			.theme-light .wm-diff-cell-b { background: color-mix(in srgb, #27ae60 8%, var(--background-primary)); }
			.theme-dark .wm-diff-cell-a { background: color-mix(in srgb, #e74c3c 22%, var(--background-primary)); }
			.theme-dark .wm-diff-cell-b { background: color-mix(in srgb, #27ae60 22%, var(--background-primary)); }
			.wm-diff-cell-empty { background: color-mix(in srgb, var(--background-modifier-border) 40%, var(--background-primary)); }
			.wm-diff-line { min-height: 20px; white-space: pre-wrap; word-break: break-all; }
			.wm-diff-word-del { }
			.wm-diff-word-add { }

			/* collapse */
			.wm-diff-collapse-row { display: flex; justify-content: center; align-items: center; margin: 1px 0; background: color-mix(in srgb, var(--interactive-accent) 8%, transparent); }
			.wm-diff-collapse-btn,
			.wm-diff-collapse-btn:hover,
			.wm-diff-collapse-btn:focus,
			.wm-diff-collapse-btn:active { padding: 4px 16px !important; font-size: var(--font-ui-smaller); color: var(--text-faint); background: transparent !important; border: none !important; box-shadow: none !important; outline: none !important; cursor: pointer; font-family: var(--font-ui); display: flex; align-items: center; gap: 5px; }
			.wm-diff-collapse-btn:hover { color: var(--text-muted) !important; }
			.wm-diff-collapse-btn > div { display: flex; align-items: center; line-height: 1; }
			.wm-diff-collapse-btn svg { width: 12px; height: 12px; }
			.wm-diff-hidden { display: none !important; }

			/* unified diff — 행 */
			.wm-diff-urow { display: flex; align-items: baseline; padding: 1px 10px; white-space: pre-wrap; word-break: break-all; }
			.wm-diff-urow-eq { color: var(--text-faint); background: var(--background-primary); }
			.theme-light .wm-diff-urow-del { color: var(--text-normal); background: color-mix(in srgb, #e74c3c 8%, var(--background-primary)); }
			.theme-light .wm-diff-urow-add { color: var(--text-normal); background: color-mix(in srgb, #27ae60 8%, var(--background-primary)); }
			.theme-dark .wm-diff-urow-del { color: var(--text-normal); background: color-mix(in srgb, #e74c3c 22%, var(--background-primary)); }
			.theme-dark .wm-diff-urow-add { color: var(--text-normal); background: color-mix(in srgb, #27ae60 22%, var(--background-primary)); }
			.wm-diff-umarker { width: 18px; flex-shrink: 0; font-weight: 700; text-align: center; }
			.wm-diff-urow-del .wm-diff-umarker { color: #e74c3c; }
			.wm-diff-urow-add .wm-diff-umarker { color: #27ae60; }
			.wm-diff-ucollapse { display: flex; align-items: center; gap: 5px; padding: 3px 10px; font-size: 11px; color: var(--text-faint); background: var(--background-secondary); border: none; border-top: 1px solid var(--background-modifier-border); border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; font-family: var(--font-text); width: 100%; text-align: left; margin: 1px 0; }
			.wm-diff-ucollapse:hover { color: var(--interactive-accent); background: var(--background-modifier-hover); }
			.wm-diff-ucollapse svg { width: 12px; height: 12px; }

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