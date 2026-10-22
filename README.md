# Writing Menu

**English** | [한국어](README.ko.md)

A writing workspace for fiction and serial stories in Obsidian. Draft manuscripts, plan plots and characters, review your writing, and ask questions about your project.

**Version 3.4.1** · [Download](https://github.com/zpzp13/obsidian-writing-menu/releases/tag/3.4.1)

![A manuscript laid out across multiple pages](<docs/여러 쪽 보기.png>)

## Write your manuscript

- Use a shared writing toolbar in Markdown and the desktop-only paged view.
- Adjust fonts, spacing, paragraphs, and text color. Work with focus mode, typewriter scrolling, smart quotes, and text replacements.
- Check character counts, copy your text, and export to TXT or HWP. HWP conversion requires Windows and Python.

<details>
<summary>Markdown writing view</summary>

![Markdown editor with the writing toolbar](docs/마크다운.png)

</details>

## Plan your story

Organize plots, characters, foreshadowing, and checklists in project workbooks.

- Manage sheets, rows, columns, subrows, statuses, labels, and cell formatting.
- View and edit the selected row or column as cards in the sidebar.
- Search, paste multiple cells, undo changes, and export to Markdown.

![Plot workbook with its row and column sidebar](<docs/플롯 매니저.png>)

## Deus AI

Ask questions using your project's manuscripts, character notes, and plots.

- **Research:** Look up relationships, chapter events, and character histories. Follow citations back to the source.
- **References:** Add notes with `@` and manage included material from the `+` menu.
- **Character dialogue:** Use `/character` to try a conversation for the current scene or a situation you describe.
- **Conversations:** Search, pin, branch, and export project sessions.

<table>
  <tr><th>Answers with sources</th><th>Character dialogue</th></tr>
  <tr>
    <td width="50%"><img src="docs/DEUS%20AI%20(3).png" alt="Character history answer with links to source passages" width="420"></td>
    <td width="50%"><img src="docs/DEUS%20AI%20(2).png" alt="Character skill showing dialogue and narration" width="420"></td>
  </tr>
</table>

Requires a Gemini API key. Citations open in the current tab by default; you can choose a new tab in settings.

## Review and restore

- Analyze sentence and paragraph lengths, dialogue proportions, and repeated expressions in a manuscript or an entire project.
- Compare manuscript snapshots and restore the full text or selected changes.
- Transfer plot workbooks between devices with Markdown snapshots and restore them manually.

![Sentence, paragraph, composition, and repetition analysis](<docs/교정 도우미.png>)

## Character wiki

Keep character profiles, images, and properties together, and explore connections in a relationship graph.

<table>
  <tr><th>Character profile</th><th>Relationship graph</th></tr>
  <tr>
    <td width="50%"><img src="docs/위키%20(2).png" alt="Character profile with structured properties and notes" width="420"></td>
    <td width="50%"><img src="docs/위키%20(1).png" alt="Graph connecting characters and their relationships" width="420"></td>
  </tr>
</table>

## Writing dashboard

Track tasks, schedules, character counts, writing time, goals, and timers. Includes character counting for Munpia and Novelpia, plus playback of audio stored in your vault.

<img src="docs/대시보드.png" alt="Writing dashboard with tasks, statistics, and timers" width="720">

## Mobile tools

Look up Korean words, review spelling corrections, and insert symbols with layouts that fit the screen and keyboard. Choose mobile fonts separately from desktop; downloaded fonts remain available offline.

<table>
  <tr><th>Dictionary and Hanja</th><th>Spell checking</th><th>Special characters</th></tr>
  <tr>
    <td width="33%"><img src="docs/모바일%20국어사전.png" alt="Mobile Korean dictionary and Hanja conversion" width="260"></td>
    <td width="33%"><img src="docs/모바일%20맞검기.png" alt="Spelling correction panel linked to the manuscript" width="260"></td>
    <td width="33%"><img src="docs/모바일%20특수문자.png" alt="Searchable special characters with favorites" width="260"></td>
  </tr>
</table>

## Install and get started

1. Download `writing-menu-3.4.1.zip` from the [release page](https://github.com/zpzp13/obsidian-writing-menu/releases/tag/3.4.1).
2. Extract the ZIP and copy the complete `writing-menu` folder into `.obsidian/plugins/` in your vault.
3. Enable Writing Menu in Obsidian's Community Plugins settings. Keep your existing `data.json` when updating.
4. Register your project and manuscript/character folders in the plugin settings. Add API keys for the dictionary and Deus AI services you use.

Assign shortcuts under **Obsidian Settings → Hotkeys → Writing Menu**.

## External services and license

Deus AI sends your conversation and reference material to the Gemini API. Dictionary and spell-checking tools use their respective services. Mobile fonts and optional analysis assets are downloaded on request and stored locally. Spell checking uses unofficial endpoints; follow the provider's terms.

See [plugin permissions](docs/plugin-permissions.md) for filesystem, Python, clipboard, and local-storage usage.

[MIT License](LICENSE). Notices for external components, including Claudian, are included with the relevant code and distribution files.
