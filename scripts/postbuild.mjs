// 빌드 산출물을 테스트 vault의 플러그인 폴더로 복사한다.
import fs from 'fs';

const DEST = 'C:/Users/82109/Desktop/Obsidian/Test/.obsidian/plugins/writing-menu/';

for (const f of ['main.js', 'styles.css', 'manifest.json']) {
	try {
		fs.copyFileSync(f, DEST + f);
		console.log('copied', f);
	} catch (e) {
		console.error('skip', f, e.message);
	}
}
