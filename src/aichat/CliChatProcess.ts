import type { CliChatOptions } from './CliChatApi';
import { Platform } from 'obsidian';
import { checkChatAbort } from './ChatStream';
import { isRecord } from '../utils/typeGuards';
import { isCliEffort } from './CliReasoning';

// Match the project's desktop-only Node shims without introducing globals on mobile.
declare const require: (id: string) => unknown;
declare const process: { platform: string; arch: string; execPath: string; env: Record<string, string | undefined> };
export interface CliChild {
	pid?: number; exitCode: number | null; killed: boolean; kill(): void;
	stdout: { setEncoding(encoding: string): void; on(event: 'data', listener: (data: string) => void): void };
	stderr: CliChild['stdout'];
	stdin: { end(text?: string): void; write(text: string): void; on(event: 'error', listener: (error: Error) => void): void };
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'close', listener: (code: number | null) => void): void;
}
type CliSpawn = (command: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined>; windowsHide: boolean; shell: false; stdio: string | string[] }) => CliChild;
function cliRuntime() {
	if (Platform.isDesktop) return {
		spawn: (require('child_process') as { spawn: CliSpawn }).spawn,
		stat: (require('fs/promises') as { stat: (filename: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }> }).stat,
		homedir: (require('os') as { homedir: () => string }).homedir,
		path: require('path') as { delimiter: string; join(...parts: string[]): string; dirname(filename: string): string; isAbsolute(filename: string): boolean },
	};
	throw new Error('CLI 연결은 데스크톱 Obsidian에서 사용할 수 있습니다.');
}

interface CliCommand { command: string; prefix: string[] }

/** Resolve npm shims to their JS entry point so prompts never pass through a shell. */
export async function resolveCliCommand(provider: CliChatOptions['provider'], configured = '', hostExecPath = process.execPath): Promise<CliCommand> {
	const { stat, homedir, path } = cliRuntime();
	const isFile = async (filename: string) => { try { return (await stat(filename)).isFile(); } catch { return false; } };
	const home = homedir(), windows = process.platform === 'win32';
	const folders = [...(process.env.PATH ?? process.env.Path ?? '').split(path.delimiter), path.join(home, '.local', 'bin'),
		...(windows ? [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm')] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin')])].filter(Boolean);
	const selected = configured.trim().replace(/^"|"$/g, '').replace(/^~(?=[/\\])/, home);
	const candidates = selected ? [selected] : folders.flatMap(folder => (windows ? ['.exe', '.cmd', '.js'] : ['']).map(suffix => path.join(folder, provider + suffix)));
	for (const candidate of candidates) {
		if (!await isFile(candidate)) continue;
		let executable = candidate;
		if (/\.(?:cmd|bat|ps1)$/i.test(candidate)) {
			const entry = provider === 'codex' ? ['@openai', 'codex', 'bin', 'codex.js'] : ['@anthropic-ai', 'claude-code', 'cli.js'];
			executable = path.join(path.dirname(candidate), 'node_modules', ...entry);
			if (!await isFile(executable)) { if (selected) throw new Error('이 CLI 바로가기를 실행할 수 없습니다. 실행 파일 또는 CLI의 JS 파일 경로를 지정해 주세요.'); continue; }
		}
		if (/\.[cm]?js$/i.test(executable)) {
			if (provider === 'codex') {
				const platform = process.platform, arch = process.arch, root = path.dirname(path.dirname(executable));
				const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'win32' ? 'pc-windows-msvc' : platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
				const packageName = `codex-${platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux'}-${arch}`;
				for (const vendor of [path.join(root, 'node_modules', '@openai', packageName, 'vendor'), path.join(path.dirname(root), packageName, 'vendor'), path.join(root, 'vendor')]) {
					const native = path.join(vendor, target, 'bin', windows ? 'codex.exe' : 'codex');
					if (await isFile(native)) return { command: native, prefix: [] };
				}
			}
			// Electron applications may ignore ELECTRON_RUN_AS_NODE. Never launch a CLI with the host app.
			const nodes = [...(/(?:^|[/\\])node(?:\.exe)?$/i.test(hostExecPath) ? [hostExecPath] : []),
				...folders.map(folder => path.join(folder, windows ? 'node.exe' : 'node')),
				...(windows ? [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe')] : ['/usr/bin/node'])];
			for (const node of nodes) if (await isFile(node)) return { command: node, prefix: [executable] };
			throw new Error('이 CLI의 JS 실행 파일에는 Node.js가 필요합니다. Node.js를 설치하거나 CLI 실행 파일 경로를 지정해 주세요.');
		}
		return { command: executable, prefix: [] };
	}
	throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'} CLI를 찾지 못했습니다. 설치 후 Deus 설정에서 CLI 경로를 지정해 주세요.`);
}

export function cliArguments(options: CliChatOptions, system: string): string[] {
	const model = options.model.trim() ? ['--model', options.model.trim()] : [];
	const effort = isCliEffort(options.effort) ? options.effort : '';
	if (options.provider === 'claude') return ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
		'--tools', '', '--strict-mcp-config', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
		'--disable-slash-commands', '--no-session-persistence', '--system-prompt', system, ...model, ...(effort ? ['--effort', effort] : [])];
	return ['exec', '--json', '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config',
		...['features.shell_tool=false', 'features.multi_agent=false', 'features.apps=false', 'features.hooks=false', 'features.memories=false',
			'features.js_repl=false', 'tools.view_image=false', 'web_search="disabled"', 'project_doc_max_bytes=0'].flatMap(value => ['-c', value]), ...model, ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), '-'];
}

export async function withCliProcess<T>(options: CliChatOptions, args: string[], signal: AbortSignal | undefined, run: (child: CliChild, terminate: () => void) => Promise<T>): Promise<T> {
	checkChatAbort(signal);
	const { spawn, stat, path } = cliRuntime();
	if (!path.isAbsolute(options.cwd) || !(await stat(options.cwd)).isDirectory()) throw new Error('CLI에 전달할 프로젝트 폴더를 찾지 못했습니다.');
	const resolved = await resolveCliCommand(options.provider, options.path);
	checkChatAbort(signal);
	const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
	delete env.CLAUDECODE;
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(resolved.command, [...resolved.prefix, ...args], { cwd: options.cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
	const terminate = () => {
		if (child.exitCode !== null || child.killed) return;
		if (process.platform === 'win32' && child.pid) {
			const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', shell: false });
			killer.on('error', () => child.kill());
			killer.on('close', code => { if (code) child.kill(); });
		} else child.kill();
	};
	return run(child, terminate);
}

export async function runCliChat(options: CliChatOptions, prompt: string, system: string, signal?: AbortSignal, onText?: (text: string) => void): Promise<string> {
	return withCliProcess(options, cliArguments(options, system), signal, (child, terminate) => new Promise((resolve, reject) => {
		let buffer = '', stderr = '', text = '', failure = '', settled = false, completed = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true; signal?.removeEventListener('abort', abort);
			if (error) reject(error); else resolve(text);
		};
		const abort = () => { terminate(); finish(new DOMException('응답 수신을 중단했습니다.', 'AbortError')); };
		const update = (value: string) => { text = value; onText?.(text); };
		const consume = (line: string) => {
			line = line.replace(/^\uFEFF/, '').trim();
			if (settled || !line) return;
			if (!line.startsWith('{')) { stderr = (stderr + '\n' + line).slice(-2000); return; }
			let record: unknown;
			try { record = JSON.parse(line); } catch { throw new Error('CLI에서 올바른 JSON 응답을 받지 못했습니다.'); }
			if (!isRecord(record)) return;
			if (record.type === 'error') failure = typeof record.message === 'string' ? record.message : 'CLI 오류';
			if (options.provider === 'codex') {
				if (record.type === 'turn.failed') failure = isRecord(record.error) && typeof record.error.message === 'string' ? record.error.message : 'Codex 응답 실패';
				if (record.type === 'turn.completed') completed = true;
				if (record.type === 'item.completed' && isRecord(record.item) && record.item.type === 'agent_message' && typeof record.item.text === 'string') update(record.item.text);
			} else {
				if (record.type === 'stream_event' && isRecord(record.event) && record.event.type === 'content_block_delta' && isRecord(record.event.delta)
					&& record.event.delta.type === 'text_delta' && typeof record.event.delta.text === 'string') update(text + record.event.delta.text);
				if (record.type === 'assistant' && isRecord(record.message) && Array.isArray(record.message.content)) {
					const blocks = (record.message.content as unknown[]).filter(isRecord);
					const full = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text as string).join('');
					if (full) update(full);
				}
				if (record.type === 'result') {
					completed = !record.is_error && record.subtype === 'success';
					if (!completed) failure = typeof record.result === 'string' ? record.result : 'Claude Code 응답 실패';
					else if (typeof record.result === 'string') update(record.result);
				}
			}
		};
		child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
		child.stdout.on('data', (data: string) => {
			try {
				buffer += data;
				if (buffer.length > 16_000_000) throw new Error('CLI 응답이 너무 큽니다.');
				let newline: number;
				while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consume(line); }
			} catch (error) { terminate(); finish(error instanceof Error ? error : new Error(String(error))); }
		});
		child.stderr.on('data', (data: string) => { stderr = (stderr + data).slice(-2000); });
		child.on('error', error => finish(new Error(`CLI를 실행하지 못했습니다: ${error.message}`)));
		child.stdin.on('error', error => { if (!settled) { terminate(); finish(new Error(`CLI 입력을 전달하지 못했습니다: ${error.message}`)); } });
		child.on('close', code => {
			if (settled) return;
			try {
				consume(buffer);
				const detail = failure || stderr.trim();
				if (/not logged in|please.*(?:log ?in|sign ?in)|authentication required/i.test(detail)) finish(new Error(`CLI 로그인이 필요합니다. 터미널에서 ${options.provider === 'claude' ? 'claude auth login' : 'codex login'} 실행 후 다시 시도해 주세요.`));
				else if (code !== 0 || failure || !completed || !text.trim()) finish(new Error(failure || `CLI 응답을 완료하지 못했습니다 (${code ?? '중단'}). ${stderr.trim() || '터미널에서 CLI 설치와 로그인 상태를 확인해 주세요.'}`));
				else finish();
			} catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
		});
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort(); else child.stdin.end(prompt);
	}));
}
