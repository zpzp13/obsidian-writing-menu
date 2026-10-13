// 빌드 산출물을 테스트 vault의 플러그인 폴더로 복사한다.
import fs from 'fs';

const DEST = 'C:/Users/82109/Desktop/Obsidian/Test/.obsidian/plugins/writing-menu/';

// Hot Reload는 세 파일의 연속 변경을 한 번의 재로딩으로 합치는 과정에서
// styles.css가 아직 적용되지 않은 중간 상태를 잡을 수 있다. 정적 파일을 먼저
// 복사하고 감시기의 짧은 디바운스가 끝난 뒤 main.js로 최종 재로딩을 유도한다.
for (const f of ['styles.css', 'manifest.json', 'garu-worker.js']) {
	try {
		fs.copyFileSync(f, DEST + f);
		console.log('copied', f);
	} catch (e) {
		console.error('skip', f, e.message);
	}
}

await new Promise(resolve => setTimeout(resolve, 750));

try {
	fs.copyFileSync('main.js', DEST + 'main.js');
	console.log('copied main.js');
} catch (e) {
	console.error('skip main.js', e.message);
}
