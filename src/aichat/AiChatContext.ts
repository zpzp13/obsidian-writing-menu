/** 앞뒤에 남은 큰따옴표/괄호를 벗겨낸다 (모델이 형식 지침을 어겼을 때의 방어용). */
export function stripWrapping(text: string): string {
	let t = text.trim();
	for (let i = 0; i < 2; i++) {
		const before = t;
		t = t.replace(/^["“”']+|["“”']+$/g, '').trim();
		t = t.replace(/^\(([\s\S]*)\)$/, '$1').trim();
		if (t === before) break;
	}
	return t;
}
