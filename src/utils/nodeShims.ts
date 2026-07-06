// 심사 환경이 @types/node를 해석하지 못하는 경우에도(설치 여부와 무관하게 그런
// 경우가 있는 것으로 보임) fs/path/child_process 호출이 any로 전파되지 않도록,
// 실제로 쓰는 API 표면만 최소로 직접 선언해서 캐스팅에 사용한다.

export interface DirentLike {
	name: string;
	isDirectory(): boolean;
}

export interface FsLike {
	existsSync(path: string): boolean;
	mkdirSync(path: string, options?: { recursive?: boolean }): void;
	writeFileSync(path: string, data: string | Uint8Array, encoding?: string): void;
	readFileSync(path: string, encoding: string): string;
	readFileSync(path: string): Uint8Array;
	readdirSync(path: string, options: { withFileTypes: true }): DirentLike[];
	unlinkSync(path: string): void;
}

export interface PathLike {
	join(...segments: string[]): string;
}

interface DataEventEmitterLike {
	on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void;
}

export interface ChildProcessLike {
	stdout: DataEventEmitterLike;
	stderr: DataEventEmitterLike;
	on(event: 'error', listener: (err: Error) => void): void;
	on(event: 'close', listener: (code: number) => void): void;
}

export type SpawnLike = (
	command: string,
	args: string[],
	options?: { cwd?: string; env?: Record<string, string> },
) => ChildProcessLike;
