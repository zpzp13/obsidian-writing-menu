import { Notice, Platform } from 'obsidian';
import { wmT } from '../i18n/index';
import { joinPath } from '../utils/nodeShims';
import type { SpawnLike } from '../utils/nodeShims';

declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined> };

const PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = $null
try {
    if ([Console]::In.ReadToEnd().Trim() -eq 'file') {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Filter = 'HWPX documents (*.hwpx)|*.hwpx'
        $dialog.CheckFileExists = $true
    } else {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        if ($dialog -is [System.Windows.Forms.OpenFileDialog]) { [Console]::Out.Write($dialog.FileName) }
        else { [Console]::Out.Write($dialog.SelectedPath) }
    }
} catch { [Console]::Error.Write($_.Exception.Message); exit 1 }
finally { if ($null -ne $dialog) { $dialog.Dispose() } }
`;

function powershellCommand(script: string): { command: string; args: string[] } {
    // EncodedCommand is UTF-16LE. Encoding static source avoids .ps1 installation and quoting.
    const bytes = new Uint8Array(script.length * 2);
    for (let i = 0; i < script.length; i++) { bytes[i * 2] = script.charCodeAt(i) & 255; bytes[i * 2 + 1] = script.charCodeAt(i) >>> 8; }
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return {
        command: joinPath(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', btoa(binary)],
    };
}

export async function runDesktopCommand(command: string, args: string[], input = ''): Promise<string> {
    if (!Platform.isDesktop) throw new Error(wmT('데스크톱 전용 기능입니다.'));
    const spawn = (require('child_process') as { spawn: SpawnLike }).spawn;
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
        child.on('error', reject);
        child.stdin.on('error', reject);
        child.on('close', code => { if (code === 0) resolve(stdout.replace(/^\uFEFF/, '')); else reject(new Error(stderr.trim() || wmT('외부 프로그램을 실행하지 못했습니다.'))); });
        child.stdin.end(input);
    });
}

export async function pickExternalPath(mode: 'folder' | 'file'): Promise<string | null> {
    try {
        if (Platform.isWin) {
            const { command, args } = powershellCommand(PICKER_SCRIPT);
            return (await runDesktopCommand(command, args, mode)).trim() || null;
        }
        if (Platform.isMacOS) {
            const script = mode === 'folder' ? 'POSIX path of (choose folder)' : 'POSIX path of (choose file)';
            try { return (await runDesktopCommand('/usr/bin/osascript', ['-e', script])).trim() || null; }
            catch (error) { if (error instanceof Error && /\(-128\)/.test(error.message)) return null; throw error; }
        }
        throw new Error(wmT('폴더 경로를 직접 입력해 주세요.'));
    } catch (error) {
        new Notice(wmT('파일 선택 실패: {0}', error instanceof Error ? error.message : String(error)), 5000);
        return null;
    }
}

