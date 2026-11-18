import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { loadTsFixture } from './ts-fixture-loader.mjs';
const bundle = await build({ entryPoints: ['src/paged/MarkdownInlineFormat.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { parseInlineMarkdown: parse, serializeInlineMarkdown: serialize, sourceOffsetToVisible, inlineRangesCover } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const fixtures = [
	'서식 없는 한글 문장입니다.\n'.repeat(2000),
	'**굵게** __굵게__ *기울임* _기울임_ ***둘 다*** ~~취소~~ ==강조== <u>밑줄</u>',
	'<span style="color: #ff0000">빨강</span> <span style="background-color: #abcdef">배경</span>',
	'**<span style="color: #ff0000">빨간 *굵은*</span>**  \r\n__원문__\r\n',
	'짝 없는 ** 및 _기호\n5 * 3 * 2 snake_case 한_글_단어',
	'\\*별표\\* `**코드**` `` `*코드*` `` $**수식**$ $$==수식==$$',
	'```md\n**그대로**\n```\n~~~\n==그대로==\n~~~\n**서식**',
	'%%**주석**%% [[링크|**별칭**]] [**링크**](https://a.test/**url**(x))',
	'%% 여러 줄\n**주석**\n%% **이후**\n__끝__',
	'**겹친 *구간** 끝*\n줄 끝 공백  \n\n',
	'==🔴빨강== ==🟠주황== ==🟡노랑== ==🟢초록== ==🔵파랑== ==🟣보라==\r\n==🟥**사각형**==',
	'ㅇㅇ==🟣ㅇㅇ화여도ddfsd==fsdf ㅏㅣ==🟠ㅏㅏㅗㅗ==ㅗㅗ==🔵ㅗㅗ==🟠ㅗ==ㅗ==ㅗㅎ로2',
];
// Dragging through blank space selects only whitespace: no format is "active" there.
{
	const text = '굵게\n\n\n  다음';
	assert.equal(inlineRangesCover(text, [{ from: 0, to: 2 }], 2, 7), false, 'Whitespace-only selection lit up a format');
	assert.equal(inlineRangesCover(text, [{ from: 0, to: 2 }], 0, 5), true, 'Bold text plus trailing blank lines is still bold');
	assert.equal(inlineRangesCover(text, [], 0, 2), false);
}
// Obsidian renders no Markdown inside inline HTML, and Live Preview draws
// inline HTML as a separate widget: a highlight overlapping <span>/<u> is
// written as <mark> (HTML inside HTML), plain `==` everywhere else.
{
	const MARK = c => c ? `<mark data-highlight="${c}" style="background-color: var(--highlight-background-${c}); color: inherit">` : '<mark style="background-color: var(--highlight-background, var(--text-highlight-bg)); color: inherit">';
	const nested = parse('글자');
	nested.colors = [{ from: 0, to: 2, color: '#ff0000' }];
	nested.highlights = [{ from: 0, to: 2, color: 'purple' }];
	assert.equal(serialize(nested), `${MARK('purple')}<span style="color: #ff0000">글자</span></mark>`);
	nested.inline = [{ from: 0, to: 2, kind: 'bold' }, { from: 0, to: 2, kind: 'underline' }, { from: 0, to: 2, kind: 'strikethrough' }];
	assert.equal(serialize(nested), `**~~${MARK('purple')}<u><span style="color: #ff0000">글자</span></u></mark>~~**`);
	const partial = parse('가나다');
	partial.colors = [{ from: 0, to: 3, color: '#123456' }];
	partial.highlights = [{ from: 1, to: 2 }];
	assert.equal(serialize(partial), `<span style="color: #123456">가</span>${MARK('')}<span style="color: #123456">나</span></mark><span style="color: #123456">다</span>`);
	// Highlights that touch no HTML format stay native Markdown.
	const plain = parse('가나다');
	plain.highlights = [{ from: 0, to: 1, color: 'orange' }];
	plain.colors = [{ from: 2, to: 3, color: '#123456' }];
	assert.equal(serialize(plain), '==🟠가==나<span style="color: #123456">다</span>');
	// Our <mark> parses back to the same highlight; foreign marks stay literal.
	for (const md of [`${MARK('orange')}<span style="color: #2b7339">"아닙니다."</span></mark>`, `${MARK('')}글</mark> 끝`]) {
		const state = parse(md);
		assert.equal(serialize(state), md, 'Lossless <mark> round trip');
		assert.equal(state.highlights.length, 1);
	}
	assert.deepEqual(parse(`${MARK('orange')}<span style="color: #2b7339">아</span></mark>`).highlights, [{ from: 0, to: 1, color: 'orange' }]);
	const foreign = '<mark style="background:#fff88f">그대로</mark>';
	assert.deepEqual([parse(foreign).visible, parse(foreign).highlights.length, serialize(parse(foreign))], [foreign, 0, foreign]);
	// Lines written the old ways are rewritten correctly once edited.
	for (const old of ['<span style="color: #096727">==혈 각성==</span>', '==🟠<span style="color: #096727">혈 각성</span>==']) {
		const legacy = parse(old);
		assert.deepEqual([legacy.visible, legacy.highlights.length, legacy.colors.length], ['혈 각성', 1, 1]);
		legacy.visible += '!';
		assert.match(serialize(legacy), /^<mark[^>]*><span style="color: #096727">혈 각성<\/span><\/mark>!$/);
	}
}
// Obsidian opens/closes `==` inside words and right before its color emoji;
// CommonMark flanking would leave `==🟣` and `==` as literal text here.
{
	const state = parse('ㅇㅇ==🟣ㅇㅇ화여도ddfsd==fsdf');
	assert.equal(state.visible, 'ㅇㅇㅇㅇ화여도ddfsdfsdf');
	assert.deepEqual(state.highlights, [{ from: 2, to: 12, color: 'purple' }]);
	const mixed = parse('ㅣ==🟠ㅏㅏ==ㅗ==🔵ㅗㅗ==ㅗ');
	assert.equal(mixed.visible, 'ㅣㅏㅏㅗㅗㅗㅗ');
	assert.deepEqual(mixed.highlights, [{ from: 1, to: 3, color: 'orange' }, { from: 4, to: 6, color: 'blue' }]);
	// Pairs left to right: after `==🔵ㅗㅗ==` closes, a lone `==` stays literal.
	assert.equal(parse('ㅗ==🔵ㅗㅗ==🟠ㅗ==ㅗ').visible, 'ㅗㅗㅗ🟠ㅗ==ㅗ');
	assert.equal(parse('a == b == c').visible, 'a == b == c', 'Spaced == stays literal, like Obsidian');
}
for (const md of fixtures) assert.equal(serialize(parse(md)), md, `Lossless round trip: ${md.slice(0, 100)}`);
assert.equal(parse('**굵게** __둘__ *기울임* ***둘다***').visible, '굵게 둘 기울임 둘다');
assert.deepEqual(parse('***둘***').inline.map(r => r.kind).sort(), ['bold', 'italic']);
assert.equal(parse('5 * 3 * 2 snake_case').visible, '5 * 3 * 2 snake_case');
assert.equal(parse('`**코드**` [[링크|**별칭**]] $**수식**$').inline.length, 0);
assert.equal(parse('%%여러 줄\n**주석**\n%% **다음**').visible, '%%여러 줄\n**주석**\n%% 다음');
assert.equal(parse('[**제목**](https://a.test/**url**)').visible, '[제목](https://a.test/**url**)');
const edited = parse('__첫 줄__\r\n__보존__  \r\n');
edited.visible = '새 줄\r\n첫 줄\r\n보존  \r\n';
edited.inline = [{ from: 5, to: 8, kind: 'bold' }, { from: 10, to: 12, kind: 'bold' }];
assert.equal(serialize(edited), '새 줄\r\n__첫 줄__\r\n__보존__  \r\n');
const toggled = parse('보통 글자');
toggled.inline.push({ from: 0, to: 2, kind: 'bold' });
toggled.highlights.push({ from: 3, to: 5 });
assert.equal(serialize(toggled), '**보통** ==글자==');
toggled.inline = []; toggled.highlights = [];
assert.equal(serialize(toggled), '보통 글자');
const legacy = parse('**가나** 다');
assert.equal(sourceOffsetToVisible(legacy, 2), 0);
assert.equal(sourceOffsetToVisible(legacy, 4), 2);
const nested = parse('<u>밑줄 <span style="color: #aabbcc">색</span></u>');
assert.equal(nested.visible, '밑줄 색');
assert.equal(nested.colors[0].from, 3);
assert.equal(nested.inline[0].kind, 'underline');
for (const kind of ['bold', 'italic', 'underline', 'strikethrough']) {
	const state = parse('가나다라'); state.inline = [{ from: 0, to: 3, kind }];
	assert.equal(parse(serialize(state)).visible, state.visible);
	assert.deepEqual(parse(serialize(state)).inline, state.inline);
}
const crossing = parse('abcde'); crossing.inline = [{ from: 0, to: 3, kind: 'bold' }, { from: 1, to: 5, kind: 'italic' }];
assert.equal(parse(serialize(crossing)).visible, crossing.visible);
assert.equal(serialize(parse(serialize(crossing))), serialize(crossing));
const colored = parse('<span style="color: #ff0000">가<span style="color: #0000ff">나</span>다</span>');
colored.visible += '라';
const recolored = parse(serialize(colored));
assert.equal(recolored.visible, '가나다라');
assert(recolored.colors.some(range => range.from === 1 && range.to === 2 && range.color === '#0000ff'));
const { calcSnapshotCharCount, calcAllCharCounts } = loadTsFixture('src/utils/charCount.ts');
const manuscript = '---\n제목: 제외\n---\n**한글** <u>문장</u> ==강조== <span style="color: #123456">색</span>';
for (const mode of ['munpia', 'novelpia']) assert.equal(calcSnapshotCharCount(manuscript, mode), calcAllCharCounts(parse(manuscript.slice(manuscript.indexOf('**'))).visible)[mode], 'Saved-source and canvas character counts differ');
const { ToolbarManager } = loadTsFixture('src/toolbar/ToolbarManager.ts', {
	obsidian: {}, '../export': {}, '../paged/PagedWritingView': {}, './WritingToolbar': {}, './MobileToolbarLayout': {}, 'diff-match-patch': {},
});
const manager = new ToolbarManager({ settings: {}, saveData: async () => {} });
function editorFixture(source, from, to) {
	let value = source, selection = [from, to];
	const offsetToPos = offset => { const lines=value.slice(0,offset).split('\n');return {line:lines.length-1,ch:lines.at(-1).length}; };
	const posToOffset = pos => value.split('\n').slice(0,pos.line).reduce((sum,line)=>sum+line.length+1,0)+pos.ch;
	return {getValue:()=>value,somethingSelected:()=>selection[0]!==selection[1],getCursor:which=>offsetToPos(selection[which==='from'?0:1]),posToOffset,offsetToPos,
		replaceRange(text,start,end){value=value.slice(0,posToOffset(start))+text+value.slice(posToOffset(end));},
		setSelection(start,end){selection=[posToOffset(start),posToOffset(end)];},focus(){}};
}
for (const [source, from, to, kind, expected] of [
	['__가나__\n__보존__',2,4,'bold','가나\n__보존__'],
	['**가나**',2,4,'italic','***가나***'],
	['***가나***',3,5,'italic','**가나**'],
	['**첫 줄**\n**둘째**',2,13,'bold','첫 줄\n둘째'],
	[' 첫 줄 \n 둘째 ',0,11,'bold',' **첫 줄** \n **둘째** '],
]) {
	const editor=editorFixture(source,from,to);manager.toggleMarkdownFormat(editor,kind);assert.equal(editor.getValue(),expected);
}
const highlighted=editorFixture('==강조==',2,4);manager.applyMarkdownColor(highlighted,'#ff0000','background');assert.equal(highlighted.getValue(),'강조');
for (const [color, circle, square] of [['red','🔴','🟥'],['orange','🟠','🟧'],['yellow','🟡','🟨'],['green','🟢','🟩'],['blue','🔵','🟦'],['purple','🟣','🟪']]) {
	for (const marker of [circle,square]) {
		const source=`==${marker}**강조**==`, state=parse(source);
		assert.equal(state.visible,'강조');assert.deepEqual(state.highlights,[{from:0,to:2,color}]);
		assert.equal(sourceOffsetToVisible(state,4),0);assert.equal(sourceOffsetToVisible(state,7),1);
		state.visible+=' 끝';assert.equal(serialize(state),`==${circle}**강조**== 끝`);
		assert.deepEqual(parse(serialize(state)).highlights,state.highlights);
	}
	const editor=editorFixture('강조',0,2);
	manager.applyMarkdownColor(editor,color,'background');assert.equal(editor.getValue(),`==${circle}강조==`);
	manager.applyMarkdownColor(editor,color,'background');assert.equal(editor.getValue(),'강조');
	manager.applyMarkdownColor(editor,'red','background');manager.applyMarkdownColor(editor,color,'background');
	assert.equal(editor.getValue(),color==='red'?'강조':`==${circle}강조==`);
	if (color!=='red') {manager.applyMarkdownColor(editor,'','background');assert.equal(editor.getValue(),'==강조==');}
	const caret=editorFixture('',0,0);manager.applyMarkdownColor(caret,color,'background');assert.equal(caret.getValue(),`==${circle}==`);
	assert.equal(calcSnapshotCharCount(`==${circle}강조==`,'munpia'),calcAllCharCounts('강조').munpia);
}
console.log('Inline Markdown lossless round trips, protected syntax, source mapping, edits, toggles and overlaps passed.');
