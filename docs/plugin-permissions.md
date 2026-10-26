# Plugin permissions

Writing Menu retains the **Direct Filesystem Access** and **Shell Execution** warnings. The export changes reduce their use; they do not hide these capabilities.

## Document export

- Markdown manuscripts and embedded Vault images are read through Obsidian Vault API. TXT/DOCX/HWPX generation and previews run locally without uploading manuscripts, calling Python, launching Office/Hangul or using COM.
- `fs` reads only an external HWPX template chosen/configured by the user, and creates folders/writes the external output selected or entered by the user. It checks collisions, explicit overwrite permission and template identity (`realpathSync` includes existing symbolic links). Templates are read only. Missing/corrupt/unsupported templates block the selected template operation.
- Windows `child_process` starts built-in Windows PowerShell **only for file/folder dialogs**. A fixed encoded script receives the mode (`file`/`folder`) on stdin; filenames and manuscript text never enter its source/arguments. The filter permits HWPX. Argument arrays use `shell:false` and hidden process windows. Dialogs are disposed in `finally`.
- macOS uses fixed `/usr/bin/osascript` file/folder picker expressions. Cancellation returns without saving. Template parsing itself works in TypeScript on both platforms and launches no external program.
- Other desktop platforms can enter paths manually. Export is unavailable on mobile.
- No converter script or temporary manuscript list is installed. Old `converter.py` files from earlier installations are not called or automatically deleted.

## AI CLI connections

Optional Codex and Claude CLI connections still use filesystem checks and `child_process` to locate and communicate with the installed CLI. Their behavior is unchanged. This remains another reason for both review warnings.

## Other capabilities and audits

Clipboard operations run when invoked by the user. Legacy `hwpTemplatePath`/`hwpExportPath` and user presets are preserved. Version 2 export defaults use the factory document style; the removed one-space indentation option is disabled when loading old defaults/presets. Popup overrides are saved only by the explicit preset-save action. Folder structure preservation defaults to off, and existing-output overwrite defaults to on. Local image normalization uses browser canvas and Vault bytes, with no additional filesystem or process access.

`scripts/warning-exceptions.json` inventories exact capability call sites and reviewed source/CSS warnings. New or stale entries fail `verify-warning-policy.mjs`; source/CSS errors cannot be exceptions. Vendor code is tracked by pinned provenance and browser-only build/UI checks. The optional native verification script uses COM to test synthetic files, but it is a development tool and is never bundled into the plugin.
