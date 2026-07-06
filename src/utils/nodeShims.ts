import { Platform } from 'obsidian';

// 심사 환경이 @types/node를 해석하지 못하는 경우에도(설치 여부와 무관하게 그런
// 경우가 있는 것으로 보임) fs/child_process 호출이 any로 전파되지 않도록,
// 실제로 쓰는 API 표면만 최소로 직접 선언해서 캐스팅에 사용한다.
// (path 모듈은 아예 안 쓰고 자체 joinPath 헬퍼로 대체했다.)

const PATH_SEP = Platform.isWin ? '\\' : '/';
export function joinPath(...segments: string[]): string {
	return segments
		.filter(s => s.length > 0)
		.map((s, i) => {
			let seg = s.replace(/[\\/]+$/, '');
			if (i !== 0) seg = seg.replace(/^[\\/]+/, '');
			return seg;
		})
		.join(PATH_SEP);
}

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

declare const require: (id: string) => unknown;

// fs는 데스크톱(볼트/스크립트 폴더 밖 파일 접근)에서만 필요하므로, 모바일에서
// 로드 자체가 되지 않도록 최상단 정적 import 대신 지연 로드한다. require('fs')는
// 항상 같은 싱글턴 모듈을 반환하므로 캐시를 여러 호출부가 공유해도 안전하다.
let fsModule: FsLike | null = null;
export async function getFs(): Promise<FsLike> {
	if (Platform.isDesktop) {
		if (!fsModule) fsModule = require('fs') as FsLike;
		return fsModule;
	}
	throw new Error('데스크톱 전용 기능입니다.');
}
