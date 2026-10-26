![Writing Menu — a focused writing workspace for Obsidian](assets/hero.png)

<p align="center">
  <a href="https://github.com/zpzp13/obsidian-writing-menu/stargazers">
    <img src="https://img.shields.io/github/stars/zpzp13/obsidian-writing-menu?style=flat&amp;logo=github&amp;label=stars&amp;color=b699e2" alt="Stars">
  </a>
  <a href="https://github.com/zpzp13/obsidian-writing-menu/releases">
    <img src="https://img.shields.io/github/downloads/zpzp13/obsidian-writing-menu/total?color=b699e2" alt="Downloads">
  </a>
  <a href="https://github.com/zpzp13/obsidian-writing-menu/releases/latest">
    <img src="https://img.shields.io/github/v/release/zpzp13/obsidian-writing-menu?color=b699e2" alt="Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/zpzp13/obsidian-writing-menu?color=7c9e61" alt="MIT License">
  </a>
</p>

**English** | [한국어](README.ko.md)

A writing workspace for fiction and serial stories in Obsidian. Draft manuscripts, plan plots and characters, review your writing, and ask questions about your project.

[Download the latest release](https://github.com/zpzp13/obsidian-writing-menu/releases/latest)

## Write your manuscript

- Use a shared writing toolbar in Markdown and the desktop-only paged view.
- Adjust fonts, spacing, paragraphs, and text color. Work with focus mode, typewriter scrolling, smart quotes, and text replacements.
- Check character counts, copy your text, and export to TXT, DOCX or HWPX from a document-selection and formatting preview dialog. Windows and macOS generation and HWPX template formatting work without Python, Word or Hancom Hangul.

![The same manuscript laid out across multiple editable pages](assets/multi-page.png)

<details>
<summary>Markdown writing view</summary>

![Markdown editor with the writing toolbar](assets/markdown.png)

</details>

<details>
<summary>Project typography</summary>

Configure headings, footnotes, and emphasis for project manuscripts in Style Settings.

![Style Settings controls for project headings and footnotes](assets/project-typography.png)

</details>

## Export documents

Select and reorder manuscripts in a TXT, DOCX, or HWPX preview, then save them separately or merge them into one document. Adjust text, paragraph, and page settings, and apply presets or HWPX template formatting.

The document list uses the Bases core plugin, available in Obsidian 1.10 or later.

![Manuscript merge order alongside an HWPX document preview](assets/document-export.png)

<details>
<summary>Export formatting</summary>

![Font, size, weight, alignment, and line-spacing controls beside the document preview](assets/document-export-formatting.png)

</details>

## Plan your story

Organize plots, characters, foreshadowing, and checklists in project workbooks.

- Manage sheets, rows, columns, subrows, statuses, labels, and cell formatting.
- View and edit the selected row or column as cards in the sidebar.
- Search, paste multiple cells, undo changes, and export to Markdown.
- Type `[[internal links]]` in cells and the sidebar to get note suggestions, then follow links to their sources.

![Plot workbook with scene beats, cast, status, and a row sidebar](assets/plot-workbook.png)

<details>
<summary>Internal link suggestions</summary>

![Note suggestions while entering an internal link in a plot cell](assets/plot-internal-links.png)

</details>

## Deus AI

Ask questions using your project's manuscripts, character notes, and plots.

- **Research:** Look up relationships, chapter events, and character histories. Follow citations back to the source.
- **References:** Add notes with `@` and manage included material from the `+` menu.
- **Character dialogue:** Use `/character` to try a conversation for the current scene or a situation you describe.
- **Conversations:** Search, pin, branch, and export project sessions.

![A project research answer with citations and source chapters](assets/deus-research.png)

<details>
<summary>Character dialogue</summary>

![Elizabeth and Darcy shown with separate dialogue and narration](assets/deus-character-dialogue.png)

</details>

Choose Gemini, Claude Code (CLI), or Codex (CLI) in the model selector. Gemini requires an API key. CLI models use an installed, authenticated desktop CLI. Selecting a CLI opens the model catalog and supported effort levels reported by the installed tool. You can also choose its model, effort, and executable path in Deus settings; a blank path uses automatic executable discovery. All providers share the same project context, retrieval, and citation handling. Citations open in the current tab by default; you can choose a new tab in settings.

<details>
<summary>CLI models and reasoning effort</summary>

![Selecting a Codex model and reasoning effort in Deus](assets/deus-model-selection.png)

</details>

## Review and restore

- Analyze sentence and paragraph lengths, dialogue proportions, and Korean repeated expressions in a manuscript or an entire project.
- Compare manuscript snapshots and restore the full text or selected changes.
- Transfer plot workbooks between devices with Markdown snapshots and restore them manually.

![Sentence lengths, paragraph lengths, and narration/dialogue composition across a project](assets/revision-analysis.png)

<details>
<summary>Compare manuscript snapshots and restore changes</summary>

![A saved draft compared with the current manuscript, with additions and deletions highlighted](assets/manuscript-snapshots.png)

</details>

## Character wiki

Keep character profiles, images, and properties together, and explore connections in a relationship graph.

![Elizabeth Bennet's profile with structured properties, character notes, and linked relationships](assets/character-profile.png)

<details>
<summary>Character relationship graph</summary>

![The main Pride and Prejudice characters connected in a relationship graph](assets/character-relationships.png)

</details>

## Writing dashboard

Track tasks, schedules, character counts, writing time, goals, and timers. Includes character counting for Munpia and Novelpia, plus playback of audio stored in your vault.

![Writing dashboard with character-count trends, goals, and timers](assets/writing-dashboard.png)

<details>
<summary>Calendar, writing tasks, and time by activity</summary>

![A weekly writing calendar, project tasks, and daily planning, drafting, and revision time](assets/calendar-and-writing-time.png)

</details>

## Mobile tools

Look up Korean words, review spelling corrections, and insert symbols with layouts that fit the screen and keyboard. Choose mobile fonts separately from desktop; downloaded fonts remain available offline.

<table>
  <tr><th>Dictionary and Hanja</th><th>Spell checking</th><th>Special characters</th></tr>
  <tr>
    <td width="33%"><a href="assets/mobile-dictionary.png"><img src="assets/mobile-dictionary.png" alt="Mobile Korean dictionary and Hanja conversion" width="260"></a></td>
    <td width="33%"><a href="assets/mobile-spellcheck.png"><img src="assets/mobile-spellcheck.png" alt="Korean spelling correction panel linked to the manuscript" width="260"></a></td>
    <td width="33%"><a href="assets/mobile-special-characters.png"><img src="assets/mobile-special-characters.png" alt="Searchable special characters with favorites" width="260"></a></td>
  </tr>
</table>

## Install and get started

1. Download the `writing-menu-*.zip` asset from the [latest release](https://github.com/zpzp13/obsidian-writing-menu/releases/latest).
2. Extract the ZIP and copy the complete `writing-menu` folder into `.obsidian/plugins/` in your vault.
3. Enable Writing Menu in Obsidian's Community Plugins settings. Keep your existing `data.json` when updating.
4. Register your project and manuscript/character folders in the plugin settings. Add API keys for the dictionary and Gemini services you use. For CLI models, first sign in from a terminal with `claude auth login` or `codex login`.

Assign shortcuts under **Obsidian Settings → Hotkeys → Writing Menu**.

## Interface language

Writing Menu follows Obsidian's language setting: Korean uses the Korean interface; English and other languages use English. Restart Obsidian after changing the app language. Existing notes, project names, custom labels, and statistics metadata keys are preserved. Dictionary, Hanja, spell checking, and morphology analysis remain Korean-language tools.

## External services and license

Download the **Document engine** once in the export settings to enable HWPX previews. Pinned kordoc and its required libraries are downloaded from the npm registry, checked against integrity hashes, and stored in the plugin's `kordoc-assets` folder. A persistent worker inside Obsidian reuses the engine offline. No separate Node.js/npm installation or executable-path setup is required, and manuscripts are not uploaded. kordoc sources are not bundled in the plugin distribution.

Deus AI sends your conversation and reference material to the selected model provider through the Gemini API or an installed CLI. Dictionary and spell-checking tools use their respective services. Mobile fonts and optional analysis assets are downloaded on request and stored locally. Spell checking uses unofficial endpoints; follow the provider's terms.


[MIT License](LICENSE). Notices for external components, including Claudian, are included with the relevant code and distribution files.

Screenshots show demo and test projects. The Jane Austen [Pride and Prejudice](https://www.gutenberg.org/ebooks/1342) examples use the public-domain English text. AI conversations and dictionary/spelling results are illustrative. Mobile images show responsive layout previews.

[Logo (SVG)](assets/logo.svg)
