import type { InstalledFontFace } from '../toolbar/InstalledFontCache';
import type { EncodeOptions } from './DocumentModel';
import { wmT } from '../i18n';

function faceWeight(face: InstalledFontFace, family: string): number | null {
    const style = `${face.style ?? ''} ${(face.fullName ?? '').toLowerCase().replace(family, '')} ${face.family.toLowerCase().replace(family, '')}`.toLowerCase().replace(/[\s_-]/g, '');
    if (/italic|oblique|기울|이탤릭/.test(style)) return null;
    if (/thin|hairline/.test(style)) return 100;
    if (/extralight|ultralight/.test(style)) return 200;
    if (/light/.test(style)) return 300;
    if (/medium/.test(style)) return 500;
    if (/semibold|demibold/.test(style)) return 600;
    if (/extrabold|ultrabold/.test(style)) return 800;
    if (/black|heavy/.test(style)) return 900;
    if (/bold/.test(style)) return 700;
    return 400;
}
function weightOrder(weight: number): number[] {
    const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
    // Match CSS's nearest-weight search, including its special 400–500 range.
    if (weight >= 400 && weight <= 500) return [...weights.filter(value => value >= weight && value <= 500), ...weights.filter(value => value < weight).reverse(), ...weights.filter(value => value > 500)];
    return weight < 400 ? [...weights.filter(value => value <= weight).reverse(), ...weights.filter(value => value > weight)] : [...weights.filter(value => value >= weight), ...weights.filter(value => value < weight).reverse()];
}

/** DOCX/HWPX represent intermediate weights using an installed named face. */
export function exportFontWeights(options: EncodeOptions, faces: InstalledFontFace[]): { fontFaces: NonNullable<EncodeOptions['fontFaces']>; notices: string[] } {
    const fontFaces: NonNullable<EncodeOptions['fontFaces']> = {};
    let nearest = false, unavailable = false;
    const styles = [options.style, ...(options.elementStyles?.headings ?? []), ...(options.elementStyles ? [options.elementStyles.footnote] : [])];
    for (const style of styles) {
        if (style.fontWeight === 400 || style.fontWeight === 700) continue;
        const key = JSON.stringify([style.fontFamily, style.fontWeight]);
        if (fontFaces[key]) continue;
        const family = style.fontFamily.toLocaleLowerCase();
        const available = faces.filter(face => {
            const name = face.family.toLocaleLowerCase();
            if (name === family) return true;
            if (!name.startsWith(family)) return false;
            return /^(?:thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)$/.test(name.slice(family.length).replace(/[\s_-]/g, ''));
        }).map(face => ({ face, weight: faceWeight(face, family) })).filter(item => item.weight !== null);
        const order = weightOrder(style.fontWeight);
        available.sort((a, b) => order.indexOf(a.weight!) - order.indexOf(b.weight!));
        const chosen = available[0];
        if (!chosen || chosen.weight !== 400 && chosen.weight !== 700 && !chosen.face.fullName && !chosen.face.postscriptName) {
            fontFaces[key] = { fontFamily: style.fontFamily, fontWeight: style.fontWeight >= 600 ? 700 : 400 }; unavailable = true;
        } else {
            const ordinary = chosen.face.family.toLocaleLowerCase() === family && (chosen.weight === 400 || chosen.weight === 700);
            fontFaces[key] = { fontFamily: ordinary ? chosen.face.family : chosen.face.fullName || chosen.face.postscriptName!, fontWeight: ordinary ? chosen.weight! : 400 };
            if (chosen.weight !== style.fontWeight) nearest = true;
        }
    }
    const notices: string[] = [];
    if (unavailable || nearest) notices.push(wmT('글꼴에 따라 지원하는 두께값에 차이가 있을 수 있습니다'));
    return { fontFaces, notices };
}
