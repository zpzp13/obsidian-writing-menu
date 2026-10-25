import { Notice, Platform } from 'obsidian';
import { wmT } from '../i18n/index';
import { joinPath } from '../utils/nodeShims';
import type { SpawnLike } from '../utils/nodeShims';

declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined> };

/** Fixed code only: document text and paths arrive as JSON on standard input. */
export const TEMPLATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$hwp = $null
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $template = [IO.Path]::GetFullPath([string]$request.template)
    if (-not (Test-Path -LiteralPath $template -PathType Leaf)) { throw 'TEMPLATE_NOT_FOUND' }
    if ([IO.Path]::GetExtension($template) -notin @('.hwp', '.hwpx')) { throw 'INVALID_TEMPLATE' }
    foreach ($item in $request.documents) {
        $output = [IO.Path]::GetFullPath([string]$item.path)
        if ([string]::Equals($template, $output, [StringComparison]::OrdinalIgnoreCase)) { throw 'TEMPLATE_OVERWRITE' }
    }
    try { $hwp = New-Object -ComObject HWPFrame.HwpObject } catch { throw 'HANCOM_NOT_INSTALLED' }
    $hwp.XHwpWindows.Item(0).Visible = $true
    [void]$hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
    foreach ($item in $request.documents) {
        $output = [IO.Path]::GetFullPath([string]$item.path)
        if (-not $hwp.Open($template, '', 'forceopen:true')) { throw 'TEMPLATE_OPEN_FAILED' }
        [void]$hwp.HAction.Run('MoveDocEnd')
        [void]$hwp.HAction.Run('SelectAll')
        [void]$hwp.HAction.Run('Delete')
        [void]$hwp.HAction.GetDefault('InsertText', $hwp.HParameterSet.HInsertText.HSet)
        $lf = [string][char]10
        $crlf = [string][char]13 + [char]10
        $hwp.HParameterSet.HInsertText.Text = ([string]$item.text).Replace($crlf, $lf).Replace($lf, $crlf)
        if (([string]$item.text).Length -gt 0 -and -not $hwp.HAction.Execute('InsertText', $hwp.HParameterSet.HInsertText.HSet)) { throw 'INSERT_FAILED' }
        if (-not $hwp.SaveAs($output, 'HWPX', '')) { throw 'SAVE_FAILED' }
        if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'SAVE_FAILED' }
        [void]$hwp.Clear(1)
    }
    [Console]::Out.Write('OK')
} catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $hwp) {
        try { [void]$hwp.Clear(1); [void]$hwp.Quit() } catch {}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($hwp)
    }
}
`;

const PICKER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = $null
try {
    if ([Console]::In.ReadToEnd().Trim() -eq 'file') {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Filter = 'Hancom documents (*.hwp;*.hwpx)|*.hwp;*.hwpx'
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

export interface TemplateDocument { path: string; text: string }

export async function fillHancomTemplate(template: string, documents: TemplateDocument[]): Promise<void> {
    if (!Platform.isDesktop || !Platform.isWin) throw new Error(wmT('템플릿 적용은 Windows에서만 사용할 수 있습니다.'));
    const { command, args } = powershellCommand(TEMPLATE_SCRIPT);
    try {
        const result = await runDesktopCommand(command, args, JSON.stringify({ template, documents }));
        if (result.trim() !== 'OK') throw new Error(wmT('한글 문서를 저장하지 못했습니다.'));
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const messages: Record<string, string> = {
            TEMPLATE_NOT_FOUND: wmT('템플릿 파일을 찾을 수 없습니다.'),
            INVALID_TEMPLATE: wmT('HWP 또는 HWPX 템플릿을 선택해 주세요.'),
            TEMPLATE_OVERWRITE: wmT('템플릿 원본과 다른 저장 경로를 선택해 주세요.'),
            HANCOM_NOT_INSTALLED: wmT('템플릿 적용에는 Windows용 한컴오피스 한글이 필요합니다.'),
            TEMPLATE_OPEN_FAILED: wmT('템플릿을 열지 못했습니다. 한글의 파일 접근 승인 창도 확인해 주세요.'),
            INSERT_FAILED: wmT('한글 문서에 원고를 넣지 못했습니다.'),
            SAVE_FAILED: wmT('한글 문서를 저장하지 못했습니다. 저장 권한을 확인해 주세요.'),
        };
        throw new Error(messages[detail] || detail);
    }
}
