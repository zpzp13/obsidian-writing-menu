import { renderHwpxPages } from './node_modules/kordoc/dist/render-Z6N2GGKL.js';
import { isRecord } from '../utils/typeGuards';

const scope = self as unknown as {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(reply: unknown): void;
};
type Render = (bytes: ArrayBuffer, options: { reflow: true }) => Promise<unknown>;
const render = renderHwpxPages as Render;
let queue = Promise.resolve();
scope.onmessage = ({ data: request }) => {
	queue = queue.then(async () => {
		if (!isRecord(request) || typeof request.id !== 'number' || !(request.bytes instanceof ArrayBuffer)) return;
		try {
			const result = await render(request.bytes, { reflow: true });
			if (!isRecord(result) || !(result.pageSvgs instanceof Map)) throw new Error('Invalid document render result.');
			const pageMap = result.pageSvgs as Map<unknown, unknown>;
			const entries: [number, string][] = [];
			for (const [number, svg] of pageMap) {
				if (typeof number !== 'number' || typeof svg !== 'string') throw new Error('Invalid document render page.');
				entries.push([number, svg]);
			}
			entries.sort((a, b) => a[0] - b[0]);
			const warnings = isRecord(result.scene) && Array.isArray(result.scene.warnings) ? (result.scene.warnings as unknown[]).filter((value): value is string => typeof value === 'string') : [];
			scope.postMessage({ id: request.id, kind: 'rendered', pages: entries.map(([, svg]) => svg), warnings });
		} catch (error) { scope.postMessage({ id: request.id, kind: 'error', message: error instanceof Error ? error.message : String(error) }); }
	});
};
scope.postMessage({ kind: 'ready', version: '4.24.9', protocol: 2 });
