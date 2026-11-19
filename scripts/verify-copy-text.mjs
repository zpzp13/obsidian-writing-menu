import assert from 'node:assert/strict';
import { loadTsFixture } from './ts-fixture-loader.mjs';
const { buildCopyText, stripHtmlTags } = loadTsFixture('src/export/CopyText.ts');
const defaults = { includeComments: false, includeHeadings: false, includeFootnotes: false, includeMarkdown: false, includeHtml: false };
const copy = (source, options = {}) => buildCopyText(source, { ...defaults, ...options });
for (const [source, expected] of [
	['**굵게** *기울임* ~~취소~~ ==하이== `코드`', '굵게 기울임 취소 하이 코드'],
	['==🟣보라==', '보라'],
	['[[노트|별칭]] [[노트]] ![[img.png]] [링크](http://a)', '별칭 노트  링크'],
	['[[노트#제목]] ![alt](http://a)', '노트'],
	['- 대사\n* 항목\n1. 번호\n> 인용\n- [ ] 할 일', '- 대사\n* 항목\n1. 번호\n> 인용\n- [ ] 할 일'],
	['- **굵게** 항목\n* *기울임*', '- 굵게 항목\n* 기울임'],
	['**혼자\na * b * c\nword_in_word', '**혼자\na * b * c\nword_in_word'],
	['본문\n\n\n\n끝', '본문\n\n\n\n끝'],
	['<span style="color: #ff0000">빨강</span><u>밑줄</u>줄<br>바꿈', '빨강밑줄줄\n바꿈'],
	['a < b &amp; &lt;3 &#39; &#x1F600;', "a < b & <3 ' 😀"],
	['앞%%메모%%뒤[^a]\n[^a]: 각주\n    연속\n끝', '앞뒤\n끝'],
	['---\ntitle: note\n---\r\n# 제목\r\n본문', '본문'],
]) assert.equal(copy(source), expected, source);
for (const rule of ['---', '***', '* * *', '___', '- - -']) assert.equal(copy('본문\n\n' + rule + '\n\n본문'), '본문\n\n' + rule + '\n\n본문');
assert.equal(copy('<u>**굵게**</u>', { includeHtml: true }), '<u>굵게</u>');
assert.equal(copy('<u>**굵게**</u>', { includeMarkdown: true }), '**굵게**');
assert.equal(copy('# 1화\n본문', { includeHeadings: true }), '# 1화\n본문');
assert.equal(copy('%%메모%% [^1]\n[^1]: 각주', { includeComments: true, includeFootnotes: true }), '%%메모%% [^1]\n[^1]: 각주');
assert.equal(stripHtmlTags('`<u>&amp;</u>`\n~~~\n<br>\n~~~\n<!--a\nb--><br/>끝'), '`<u>&amp;</u>`\n~~~\n<br>\n~~~\n\n끝');
assert.equal(copy('```\n**그대로** <br>\n```'), '```\n**그대로** <br>\n```');
console.log('PASS copy policies, inline formatting, HTML, code protection and manuscript spacing');

assert.equal(copy('%%memo%%\n---\n본문\n---\n끝', {includeHeadings:true}), '---\n본문\n---\n끝');
assert.equal(stripHtmlTags('<!-- `ignored` -->본문'), '본문');
