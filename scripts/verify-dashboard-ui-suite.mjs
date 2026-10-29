// Serialized into an isolated Chromium page by verify-paged-performance.mjs --dashboard.
export async function runDashboardChecks() {
	Object.assign(HTMLElement.prototype, {
		empty() { this.replaceChildren(); }, addClass(...names) { this.classList.add(...names); }, removeClass(...names) { this.classList.remove(...names); }, hasClass(name) { return this.classList.contains(name); },
		toggleClass(name, value) { this.classList.toggle(name, value); }, setText(value) { this.textContent = value; }, toggle(visible) { this.style.display = visible ? '' : 'none'; },
		setCssStyles(values) { Object.assign(this.style, values); }, setCssProps(values) { for (const [key,value] of Object.entries(values)) this.style.setProperty(key,value); },
		appendText(value) { this.appendChild(document.createTextNode(value)); },
		createEl(tag, options = {}) {
			const element = document.createElement(tag); if (options.cls) element.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
			if (options.text) element.textContent = options.text;
			for (const key of ['type','value','placeholder']) if (options[key] !== undefined) element[key] = options[key];
			for (const [key,value] of Object.entries(options.attr || {})) element.setAttribute(key,value); this.appendChild(element); return element;
		},
		createDiv(options = {}) { return this.createEl('div',typeof options === 'string' ? {cls:options} : options); }, createSpan(options = {}) { return this.createEl('span',options); },
	});
	SVGElement.prototype.setCssStyles = HTMLElement.prototype.setCssStyles;
	globalThis.activeDocument = document; globalThis.activeWindow = window;
	document.body.classList.add('theme-light');
	const style = document.createElement('style');
	style.textContent = `body{font:14px Arial;--wm-dash-page:var(--background-primary);--wm-dash-ink-1:var(--text-normal);--wm-dash-ink-2:var(--text-muted);--wm-dash-ink-3:var(--text-faint);--wm-dash-grid:var(--background-modifier-border);--wm-dash-up:#006300;--wm-dash-down:#b3261e;--font-interface:Arial;--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:14px;--text-normal:#222;--text-muted:#777;--text-faint:#999;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ddd;--background-modifier-hover:#eee;--interactive-accent:#e96841;--radius-s:4px;--radius-m:10px;}body.theme-dark{--wm-dash-up:#0ca30c;--wm-dash-down:#e66767;--text-normal:#ddd;--text-muted:#aaa;--text-faint:#888;--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#444;--background-modifier-hover:#333;}button,input,textarea,select{font:inherit;}button{cursor:pointer;} .modal-container{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:100;background:#0003;}.modal{background:var(--background-primary);border-radius:12px;overflow:hidden;box-shadow:0 12px 50px #0003;}.dashboard-preview{display:flex;gap:20px;padding:24px;background:var(--background-primary);color:var(--text-normal);}.dashboard-preview>[hidden]{display:none!important;}.dashboard-preview>section{width:350px;height:720px;overflow:auto;}.dashboard-preview .wm-chat-panel{height:720px;}.dashboard-preview .wm-revision-root{padding:8px;}.modal-close-button{position:absolute;top:12px;right:12px;}.clickable-icon svg{width:16px;height:16px;}`;
	document.head.appendChild(style);
	if(globalThis.runOnlyRagSettings){await globalThis.runRagSettingsControlsChecks();return {ok:true,suite:'RAG settings controls',paidRequests:0};}
	await globalThis.runDashboardCoreChecks();
	if(globalThis.runOnlyReviewTab)return {ok:true,suite:'Review dashboard tab',paidRequests:0};
	return { ok: true, suite: 'snapshots / revision / chat', paidRequests: 0 };
}
