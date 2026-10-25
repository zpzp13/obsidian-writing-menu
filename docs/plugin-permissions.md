# Plugin permissions

Writing Menu retains the **Direct Filesystem Access** and **Shell Execution** capabilities. They are not removed or hidden by the HWPX export change.

## Document export

- Manuscripts are read through the Obsidian Vault API. Plain HWPX files are assembled locally from a sanitized blank Hancom document; no manuscript is uploaded, and Python or Hancom Hangul is not required.
- Node.js `fs` creates folders and writes TXT/HWPX files at the external destination selected or entered by the user. Windows template export also checks that the destination will not overwrite the template, including symbolic links resolved by `realpathSync`.
- On Windows, `child_process` starts the built-in Windows PowerShell for file/folder dialogs and, only when template use is enabled, Hancom COM automation. Fixed PowerShell source receives template paths, output paths and manuscript text as JSON on standard input. User text is not interpolated into PowerShell source. Processes use literal argument arrays with `shell: false`.
- The template document stays unchanged; the result is saved as a separate HWPX file. The registered Hancom file approval module is used when available. Hancom may ask the user to approve file access. Missing templates or failed saves produce an error rather than a plain-document fallback.
- On macOS, the built-in `/usr/bin/osascript` opens a file/folder selection dialog. Plain HWPX generation itself does not start external programs. Template automation is Windows-only.
- On other desktop platforms, output paths can be entered manually. Native folder dialogs are provided for Windows and macOS. Export remains unavailable on mobile.
- No converter script or manuscript list is installed in the vault. Old `converter.py` files left by an earlier installation are no longer called and are not automatically deleted.

## AI CLI connections

The optional Codex and Claude CLI connections continue to use filesystem checks to locate the installed CLI and `child_process` to communicate with it. Their behavior is unchanged by the export feature. This is an additional reason why both community-review capability warnings remain.

## Other capabilities

Clipboard operations run when the user invokes copying. Plugin settings and existing feature data retain their current storage behavior; this export change does not migrate them. The legacy `hwpTemplatePath` and `hwpExportPath` settings are retained so existing external paths remain available.
