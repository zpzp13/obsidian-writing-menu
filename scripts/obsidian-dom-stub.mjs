/** Public Obsidian DOM helpers, including detached globals and SVG namespaces. */
export function installObsidianDomHelpers() {
	if (!Object.getOwnPropertyDescriptor(Document.prototype, 'win')) Object.defineProperty(Document.prototype, 'win', { get() { return this.defaultView; } });
	const make = (doc, tag, options = {}, svg = false) => {
		if (typeof options === 'string') options = { cls: options };
		const element = svg ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
		if (options.cls) element.setAttribute('class', Array.isArray(options.cls) ? options.cls.join(' ') : options.cls);
		if (options.text !== undefined) element.textContent = options.text;
		for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
		for (const key of ['type', 'value', 'placeholder', 'href', 'title']) if (options[key] !== undefined) element[key] = options[key];
		if (options.parent) options.parent.appendChild(element);
		return element;
	};
	window.createEl = (tag, options, callback) => { const el = make(document, tag, options); callback?.(el); return el; };
	window.createDiv = (options, callback) => window.createEl('div', options, callback);
	window.createSpan = (options, callback) => window.createEl('span', options, callback);
	window.createSvg = (tag, options, callback) => { const el = make(document, tag, options, true); callback?.(el); return el; };
	window.createFragment = callback => { const fragment = document.createDocumentFragment(); callback?.(fragment); return fragment; };
	Node.prototype.createSvg = function(tag, options, callback) { const el = make(this.ownerDocument ?? document, tag, options, true); this.appendChild(el); callback?.(el); return el; };
}
