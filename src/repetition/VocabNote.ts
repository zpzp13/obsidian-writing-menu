import type { App, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';
import { parseDictText } from './SynonymDict';

const TABLE_HEADER = '| 단어 | 유의어 후보 |\n| --- | --- |\n';

/** 단어장 노트(표)에 단어를 한 행 추가한다. 이미 같은 단어가 있으면 건너뛴다. */
export async function saveToVocabNote(app: App, notePath: string, word: string): Promise<'added' | 'duplicate'> {
	const path = normalizePath(notePath);
	const row = `| ${word} |  |\n`;
	let file = app.vault.getAbstractFileByPath(path);

	if (!file) {
		file = await app.vault.create(path, TABLE_HEADER + row);
		return 'added';
	}

	const text = await app.vault.cachedRead(file as TFile);
	const exists = parseDictText(text).some(e => e.word === word);
	if (exists) return 'duplicate';

	const needsTable = !text.includes('|');
	const needsNewline = text.length > 0 && !text.endsWith('\n');
	const prefix = (needsNewline ? '\n' : '') + (needsTable ? TABLE_HEADER : '');
	await app.vault.append(file as TFile, prefix + row);
	return 'added';
}
