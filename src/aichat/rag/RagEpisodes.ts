import type { CorpusDocument } from './ChatCorpusProvider';
import type { WritingProject } from '../../types';

export interface EpisodeScope { from?: number; to?: number; volume?: number }
export function requestedEpisodeScope(question: string): EpisodeScope | undefined {
	const normalized = question.normalize('NFKC');
	const volumes = [...normalized.matchAll(/(?:^|[^\p{L}\p{N}])(?:제\s*)?(\d{1,6})\s*권(?!\s*(?:분량|짜리|규모))/gu)];
	const ranges = [...normalized.matchAll(/(?:^|[^\p{L}\p{N}])(?:제\s*)?(\d{1,6})\s*(?:회차|화|회|편|장)?\s*(?:~|〜|∼|–|—|-|부터|에서)\s*(?:제\s*)?(\d{1,6})\s*(?:회차|화|회|편|장)/gu)];
	if (volumes.length > 1 || ranges.length > 1) throw new Error('요약할 권 또는 연속 회차 범위를 하나 지정해 주세요. 예: 1권, 1~25화.');
	const volume = volumes.length ? Number(volumes[0][1]) : undefined;
	if (ranges.length) {
		const from = Number(ranges[0][1]), to = Number(ranges[0][2]);
		if (from > to || to - from > 1000) throw new Error('회차 범위의 시작·끝을 확인해 주세요. 한 번에 최대 1,001개 회차를 확인할 수 있습니다.');
		return { from, to, ...(volume !== undefined ? { volume } : {}) };
	}
	if (volume !== undefined && /\d+\s*(?:회차|화|회|편|장)(?!\s*(?:분량|짜리|규모))/u.test(normalized)) return;
	return volume !== undefined ? { volume } : undefined;
}

export function episodeInVolume(document: CorpusDocument, project: WritingProject, volume: number): boolean {
	const folder = project.manuscriptFolder?.replace(/\/$/, '');
	if (!folder || !document.path?.startsWith(folder + '/')) return false;
	return document.path.slice(folder.length + 1).split('/').slice(0, -1).some(part => {
		const found = /^(?:제\s*)?(\d+)\s*권(?=$|\s|[(_-])/u.exec(part.normalize('NFKC'));
		return found && Number(found[1]) === volume;
	});
}

/** Explicit episode references are identifiers, not semantic similarity queries. */
export function requestedEpisode(question: string): number | undefined {
	try { if (requestedEpisodeScope(question)) return; } catch { return; }
	const normalized = question.normalize('NFKC');
	const numbers = new Set<number>();
	for (const match of normalized.matchAll(/(?:^|[^\p{L}\p{N}])(?:제\s*)?(\d{1,6})\s*(?:회차|화|회|편|장)(?![\p{N}])/gu)) {
		if (/^\s*(?:분량|짜리|규모)/.test(normalized.slice(match.index + match[0].length))) continue;
		numbers.add(Number(match[1]));
	}
	for (const match of normalized.matchAll(/\b(?:episode|chapter|ep\.?)[\s#]*(\d{1,6})\b/gi)) numbers.add(Number(match[1]));
	return numbers.size === 1 ? [...numbers][0] : undefined;
}

/** A complete manuscript is sufficient for a self-contained chapter overview. */
export function isEpisodeOverview(question: string): boolean {
	return /내용|줄거리|요약|무슨\s*일|어떤\s*일|뭐였/.test(question)
		&& !/왜|이유|누구|누가|관계|비교|모순|충돌|어떻게|이후|이전/.test(question);
}

export function episodeFileNumber(title: string): number | undefined {
	const normalized = title.normalize('NFKC').trim();
	const match = /^(?:제\s*)?(\d{1,6})\s*(?:회차|화|회|편|장)(?!\d)/u.exec(normalized)
		?? /^(?:episode|chapter|ep\.?)[\s#]*(\d{1,6})(?!\d)/i.exec(normalized)
		?? /^(\d{1,6})(?=$|[\s._\-–—│|:：)\]])/u.exec(normalized);
	return match ? Number(match[1]) : undefined;
}

/** Never use a volume-folder number, a '(3)' subtitle, or plot row ordinal as episode 3. */
export function episodeManuscripts(documents: CorpusDocument[], project: WritingProject, episode: number): CorpusDocument[] {
	const folder = project.manuscriptFolder?.replace(/\/$/, '');
	return documents.filter(document => {
		if (!document.path || document.kind === 'plot' || document.kind === 'character') return false;
		if (folder && !document.path.startsWith(folder + '/')) return false;
		const title = document.path.split('/').pop()!.replace(/\.md$/i, '');
		return episodeFileNumber(title) === episode;
	});
}
