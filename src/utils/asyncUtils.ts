// void 콜백이 필요한 자리(이벤트 리스너, Obsidian 컴포넌트 onChange/onClick 등)에
// async 함수를 그대로 넘기면 @typescript-eslint/no-misused-promises에 걸린다.
// 반환된 Promise를 의도적으로 무시함을 명시하기 위한 래퍼.
export function fireAndForget(fn: () => Promise<unknown>): void {
	void fn();
}
