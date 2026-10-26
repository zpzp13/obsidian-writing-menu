// Only the downloaded renderer boundary is mocked. Codecs and the browser Worker stay real.
export const kordocAssetsUiFixture = `
export const KORDOC_VERSION='4.24.9',KORDOC_PROTOCOL=2;
export class KordocNotInstalledError extends Error { constructor(){super('엔진(kordoc)을 먼저 다운로드해 주세요.');this.name='KordocNotInstalledError';} }
export const getKordocAssetPaths=async()=>{throw new KordocNotInstalledError();};
export async function downloadKordocAssets(plugin,onProgress){
    const host=globalThis.__exportHost;host.engineDownloads=(host.engineDownloads||0)+1;
    onProgress?.('엔진 설치 중…');await Promise.resolve();
    if(host.engineDownloadError)throw Error(host.engineDownloadError);
    host.missingEngine=false;
}
`;
export const kordocUiFixture = `
import { KordocDocumentEngine as Engine } from './src/export/KordocEngine.ts';
import { DocumentWorker } from './src/export/DocumentEngine';
import { KordocNotInstalledError } from './src/export/KordocAssets';
import { unzipSync, strFromU8 } from 'fflate';
export class KordocDocumentEngine extends Engine {
    constructor(plugin) {
        super(plugin, new DocumentWorker(), { cancelGeneration() {}, dispose() {}, render: async (bytes, signal) => {
            if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
            if (globalThis.__exportHost.missingEngine) throw new KordocNotInstalledError();
            const archive = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(archive['Contents/section0.xml']), 'text/xml');
            const paragraphs = [...xml.getElementsByTagNameNS('*', 'p')].map(p => p.textContent);
            const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
            const images = Object.entries(archive).filter(([name]) => name.startsWith('BinData/') && name.endsWith('.png')).map(([, data]) => '<image width="1" height="1" href="data:image/png;base64,' + btoa(Array.from(data, byte => String.fromCharCode(byte)).join('')) + '"/>').join('');
            const pages = [];
            for (let index = 0; index < Math.max(1, paragraphs.length); index += 40) pages.push('<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842" viewBox="0 0 595 842">' + paragraphs.slice(index, index + 40).map((text, row) => '<text x="28" y="' + (40 + row * 18) + '">' + escape(text) + '</text>').join('') + images + '</svg>');
            return { pages, warnings: [] };
        }});
    }
}
`;
