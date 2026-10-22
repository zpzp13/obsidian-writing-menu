// Pixel comparison of the same rendered state with the old and new stylesheet.
// The optional full baseline is a local pre-refactor copy, never a user vault file.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const after = await readFile('styles.css', 'utf8');
const reference = JSON.parse(await readFile('scripts/fixtures/css-priority-reference.json', 'utf8'));
const baseline = process.env.WM_CSS_BASELINE ? await readFile(process.env.WM_CSS_BASELINE, 'utf8')
	: after + '\n' + reference.map(rule => `${rule.selector}{${rule.declarations.map(item => `${item.property}:${item.value}!important`).join(';')}}`).join('\n');
const archive = await readFile('C:/Users/82109/AppData/Local/Programs/Obsidian/resources/obsidian.asar');
const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const file = header.files['app.css'], offset = 8 + archive.readUInt32LE(4) + Number(file.offset);
const native = archive.subarray(offset, offset + file.size).toString();

export async function assertCssVisualParity(driver, name) {
	await driver.evaluate(({ native }) => {
		const nativeStyle = document.createElement('style'); nativeStyle.id = 'audit-native'; nativeStyle.textContent = native; document.head.prepend(nativeStyle);
		const freeze = document.createElement('style'); freeze.id = 'audit-freeze'; freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(freeze);
	}, { native });
	const settle = () => driver.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
	try {
		await settle();
		const current = await driver.capture();
		await driver.evaluate(({ baseline, legacyFonts }) => {
			const owner = [...document.styleSheets].map(sheet => sheet.ownerNode).find(node => node?.getAttribute('href') === '/styles.css' || node?.textContent?.includes('.writing-menu-typewriter-active'));
			if (!owner) throw Error('Plugin stylesheet missing from visual fixture');
			const previous = document.createElement('style'); previous.id = 'audit-previous'; previous.textContent = baseline; owner.before(previous); owner.sheet.disabled = true; window.auditStyleOwner = owner;
			window.auditInlineFonts = [];
			if (legacyFonts) for (const element of document.querySelectorAll('.wm-plotbook-custom-font-size')) {
				window.auditInlineFonts.push([element, element.style.fontSize]);
				element.style.fontSize = element.style.getPropertyValue('--wm-cell-font-size');
			}
		}, { baseline, legacyFonts: !!process.env.WM_CSS_BASELINE });
		await settle();
		const previous = await driver.capture();
		const result = await driver.evaluate(async ({ current, previous }) => {
			const pixels = async data => {
				const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
				const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
				const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
				return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
			};
			const a = await pixels(current), b = await pixels(previous);
			if (a.width !== b.width || a.height !== b.height) return { dimensionsChanged: true };
			let changedPixels = 0, maximumChannelDelta = 0;
			for (let index = 0; index < a.data.length; index += 4) {
				let changed = false;
				for (let channel = 0; channel < 4; channel++) { const delta = Math.abs(a.data[index + channel] - b.data[index + channel]); if (delta) changed = true; maximumChannelDelta = Math.max(maximumChannelDelta, delta); }
				if (changed) changedPixels++;
			}
			return { width: a.width, height: a.height, changedPixels, maximumChannelDelta };
		}, { current: Buffer.from(current).toString('base64'), previous: Buffer.from(previous).toString('base64') });
		const directory = path.resolve('.codex-tmp/css-visual'); await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, name + '-current.png'), current); await writeFile(path.join(directory, name + '-previous.png'), previous);
		await writeFile(path.join(directory, name + '.json'), JSON.stringify(result, null, 2));
		if (result.dimensionsChanged || result.changedPixels) throw Error(`CSS changed pixels in ${name}: ${JSON.stringify(result)}. See ${directory}`);
		console.log(`PASS unchanged CSS pixels: ${name}`);
	} finally {
		await driver.evaluate(() => {
			if (window.auditStyleOwner) window.auditStyleOwner.sheet.disabled = false;
			for (const [element, size] of window.auditInlineFonts ?? []) element.style.fontSize = size;
			for (const id of ['audit-previous', 'audit-freeze', 'audit-native']) document.getElementById(id)?.remove();
			delete window.auditStyleOwner; delete window.auditInlineFonts;
		});
	}
}
