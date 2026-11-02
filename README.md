# NotebookLM Takeout

A Chrome extension that exports everything from a Google **Gemini Notebook** (formerly
NotebookLM) to local files: sources, notes, chat history, and Studio artifacts such as
audio overviews, slide decks, reports, data tables and mind maps.

It runs entirely in your browser as a side panel next to the notebook. Nothing is sent
anywhere except the requests Gemini Notebook itself makes.

> Works on `notebook.google.com` and the legacy `notebooklm.google.com` address.

## Features

**Export**

| What | Output |
|---|---|
| **Sources** | Markdown per source: full text, plus optional AI summary and key topics, optional embedded images |
| **Notes** | Markdown with citations: each `[n]` links to a Sources section with the quoted passage, and back to the text |
| **Chat** | The whole conversation as Markdown, with date headings, per-answer citations and quotes |
| **Reports** | Markdown |
| **Data tables** | ZIP with CSV, JSON, HTML and footnotes |
| **Mind maps** | ZIP with SVG, JSON tree and an interactive HTML viewer |
| **Slide decks** | PDF or PowerPoint (your choice in Settings) |
| **Audio / video overviews, infographics** | The original file Gemini Notebook serves |

Flashcards and quizzes are listed but can't be exported yet, because Gemini Notebook offers no download for them.

**Faithful content**

- **Formulas** are exported as the model's original LaTeX (`$…$` / `$$…$$`), copied
  verbatim from the page, not reconstructed from the rendered math.
- **Citations keep their original numbers**, so `[3]` in the text is `[3]` in the Sources
  section. If a citation's details can't be read, it gets a visible placeholder instead of
  silently shifting the other numbers.
- **Collapsed citation groups** in the chat ("…") are opened before export, so no citation is
  missed.
- **Same-title items** export the one you picked, and ZIPs never overwrite files with the same
  name (`Title (2).pdf`).
- **Tables, headings and lists** are preserved; an optional cleanup strips OCR noise
  (`~~~`, `:~:`) from quoted passages.

**Convenience**

- Batch export with ZIP packaging, progress overlay and **Cancel**
- Large exports split into several ZIPs (configurable batch size)
- Files named after the notebook (`New-Physics-notes-2026-11-02T15-13-06.zip`)
- Built-in **health check** (🩺) that tells you when a Gemini Notebook update has broken
  something

## Installation

The extension is not on the Chrome Web Store. Load it from source:

1. Get the code:
   ```bash
   git clone https://github.com/bearspear/notebooklm-takeout.git
   ```
2. Open `chrome://extensions/` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `notebooklm-takeout` folder.
4. Open a notebook at [notebook.google.com](https://notebook.google.com). The Takeout side
   panel opens next to it.

**Updating:** after `git pull`, open `chrome://extensions/`, toggle **NotebookLM Takeout**
off and on, then refresh the notebook tab. The reload icon alone does not pick up new
permissions or content scripts.

## Usage

Open a notebook, then use the tabs in the side panel.

### Sources

1. **Sources** tab → **Scan Sources**.
2. Tick the sources to export → **Export Selected Sources**.
3. You get `{notebook}-sources-{timestamp}.zip` with one or more Markdown versions per
   source, an `_index.md` and a README.

Notes that appear in the Sources panel's **Notes** group are skipped here (the tab tells you
how many) and exported from the Notes tab instead.

### Notes

1. **Notes** tab (scans automatically). This includes notes shown in the Sources panel.
2. Tick notes → **Export Notes**.
3. You get `{notebook}-notes-{timestamp}.zip` (split into parts for large exports).

Each note looks like this:

````markdown
# Note title

Plasma cosmology rejects dark matter<sup><a id="cite-ref-3-1" href="#src-3">[3]</a></sup>.

---

## Sources

<a id="src-3"></a>
**[[3]](#cite-ref-3-1)** Donald E. Scott: Indeed, Our Sun is Electric

```markdown
The quoted passage from the source…
```
````

### Chat

1. **Chat** tab → **Scan Chat** (scrolls to load the whole history and opens collapsed
   citation groups).
2. Optional: **Extract Full Citations** adds the quoted passage for every citation. This is
   slower: it reads each citation's popup.
3. **Export Chat** → `{notebook}-chat-{timestamp}.zip`.

### Artifacts

1. **Artifacts** tab lists everything in the Studio panel.
2. Click **Download** on a row, or **Download All**.
   - With **ZIP off** (recommended for whole notebooks), every file is saved into
     `Downloads/<Notebook name>/`, one file at a time, so even large audio and video overviews work.
   - With **ZIP on**, everything is packed into one archive in memory. That suits a handful of
     documents and slide decks, but a full notebook with audio/video can be too large.
3. Slide decks download as PDF or PowerPoint depending on **Settings → Slide deck format**.

### Studio tab (optional)

Enable it under **Settings → Show Studio tab**. It mirrors the Studio panel as one list with
per-row **Download** and **Delete**, plus bulk actions. Delete asks you first, then confirms
Gemini Notebook's own dialog.

### Cancelling

Long exports show an overlay on the notebook page with progress and a **Cancel Export**
button; the side panel's progress area has a Cancel button too. Cancelling stops within one
citation. Everything exported so far is saved as `…-PARTIAL.zip`, with `errors.txt` when
anything failed, and the message says how many items were exported (e.g. "Cancelled:
exported 4 of 10 notes").

Only one export, scan or download runs at a time. While one runs, the panel's other buttons
are disabled and a second click shows "… is still running".

## Settings (⚙️)

| Setting | Default | |
|---|---|---|
| Show download notifications | on | Toasts when downloads finish |
| Show Studio tab | off | Adds the Studio tab |
| Always use ZIP for batch downloads | off | Default for the Artifacts ZIP toggle |
| Slide deck format | PDF | PDF or PowerPoint |
| Source versions | base + metadata | Any mix of: base, with AI summary & topics, each optionally with images |
| Note versions | base + code blocks | Any mix of: Markdown citations, citations in code blocks, each optionally with images |
| Sources / notes per ZIP | 25 | Batch size for large exports |
| Clean OCR artifacts from citations | on | Strips `~~~`, `:~:` and similar noise |

The chat export uses the note version settings.

## Health check (🩺)

Gemini Notebook changes its page structure from time to time, and that can break exports.
Click 🩺 in the panel header to test what the extension depends on. You can copy the report
to the clipboard.

- **General:** notebook title, the Studio viewer close button, and whether formulas carry
  their LaTeX source
- **Notes, Sources, Chat:** the lists and viewers each export reads
- **Citations:** opens one citation popup and checks it can be read and closed

`[OK]` is fine. `[WARN]` means exports still work but with reduced fidelity: for example, a
formula without LaTeX source will be rebuilt from its rendered form. `[FAIL]` on a critical
check means that export is likely broken. Please
[open an issue](https://github.com/bearspear/notebooklm-takeout/issues) and paste the report.

## Troubleshooting

| Problem | Try |
|---|---|
| "Please open NotebookLM first", or the panel stays empty | Make sure the tab is a notebook on `notebook.google.com`; refresh it |
| Behaviour didn't change after updating | Toggle the extension off/on in `chrome://extensions/`, then refresh the notebook tab |
| Nothing found / scan returns 0 | Wait for the notebook to finish loading, then scan again |
| Citations missing or wrong | Run 🩺 and check **Citations**; export a single note to compare |
| A viewer stays open after an export | Close it in Gemini Notebook; run 🩺 and check "Studio header close control" |
| Download failed | Download that item on its own; check Chrome's download permissions and disk space |
| Overlay won't go away | Click **Cancel Export**, or refresh the notebook tab |

Logs: open DevTools on the notebook tab (content script), right-click the side panel →
**Inspect** (side panel), or **Service worker** under the extension in `chrome://extensions/`.
All lines start with `[NotebookLM Takeout]`.

## How long exports take

Exports drive the page the way you would, one item at a time, and continue as soon as the
page is ready (no fixed waits). Measured on a real notebook with version 1.2.0:

| Export | Time |
|---|---|
| 10 notes with full citations (154 citations) | 49 s |
| 5 sources with summaries | 8 s |
| Chat with full citations (17 answers, 134 citations) | 30 s |
| One citation | about 0.2 s |

Each export's `_index.md` ends with an "Export statistics" block showing where the time went.

Reading a citation only opens its popup. The citation text is already in the page, so it
causes no extra requests to Gemini Notebook.

## Privacy

- Everything runs locally in your browser; exports are saved straight to your Downloads.
- The extension has no server, analytics or tracking.
- It works inside your signed-in notebook tab and uses Gemini Notebook's own download
  links for media files.

**Permissions:** `sidePanel`, `tabs`, `activeTab`, `scripting` (run inside the notebook tab),
`downloads`, `storage` (settings), `notifications`, `cookies`. Host access to
`notebook.google.com` / `notebooklm.google.com`, and to Google's download hosts
(`*.googleusercontent.com`, `*.google.com`, `*.scf.usercontent.goog` for mind maps).

## Development

Plain JavaScript Manifest V3 extension: no build step, no npm dependencies.

```
manifest.json         Manifest V3
sidebar.html/.js      Side panel UI and export orchestration (Markdown, ZIPs, formulas)
styles.css            Side panel styles
content.js            Runs in the notebook page: scanning, extraction, citation popups
takeout-shared.js     Selectors and DOM-free helpers shared by all contexts (unit tested)
mindmap-extract.js    Mind map extraction (page and sandboxed mind map frame)
background.js         Service worker: download interception, batch ZIPs
injected.js           Page-world hook that captures download URLs
content-styles.css    Export overlay styles
mindmap-template.html Interactive mind map viewer template
turndown.min.js       HTML → Markdown (bundled)
jszip.min.js          ZIP creation (bundled)
tests/                node:test unit tests for takeout-shared.js
```

Check your changes:

```bash
for f in sidebar.js content.js background.js injected.js mindmap-extract.js takeout-shared.js; do node --check "$f"; done
node --test tests/
```

DOM behaviour is verified in Chrome with the health check and real exports.
**[AGENT.md](AGENT.md)** is the engineering guide: architecture, message protocol, the DOM
contract with Gemini Notebook, past drift and recipes.

## Version history

**1.2.0 (Nov 2026)**: trustworthy and faster exports.
- Every item is checked by title before it is saved, so a list that changes mid-export can't
  save one item's content under another's name.
- Honest results: "Exported 7 of 10 notes (3 failed)", `-PARTIAL` ZIPs on cancel, and
  `errors.txt` is never lost.
- Your own Download clicks in Gemini Notebook work again (the download hook only acts on the
  extension's own clicks).
- Download All saves into a per-notebook folder; the ZIP uses proper UTF-8 names and
  includes `errors.txt`; PowerPoint decks keep their `.pptx` extension.
- Citation quotes keep their paragraphs, lists, tables and code.
- Much faster: fixed waits replaced by readiness checks, and `_index.md` reports per-phase
  timing.
- One export at a time, with a working Cancel button.

**1.1.0 (Nov 2026)**: adapted to the November 2026 Gemini Notebook redesign.
- Citations work with the new popup, and their numbers stay stable.
- Back-links resolve, and the chat no longer loses citations from collapsed groups.
- Formulas are exported from their original LaTeX.
- Viewers close via the new header button.
- Sources-panel notes can be exported.
- New: PDF/PowerPoint choice for slide decks, data table and Flashcards/Quiz detection, and
  the right item is exported when titles repeat.
- Removed the background polling and the toolbar badge.
- Added unit tests.

**1.0.x (2026)**:
- Studio tab and mind map export.
- KaTeX conversion.
- ProseMirror note support.
- Domain move to `notebook.google.com`.
- Health check.

**1.0.0**: first release with source, note, artifact and chat export.

See the git history for details. CHANGELOG.md is not maintained.

## Contributing

Issues and pull requests are welcome at
[bearspear/notebooklm-takeout](https://github.com/bearspear/notebooklm-takeout). Please run
the checks above, test the affected export in Chrome, and read [AGENT.md](AGENT.md) first.

## License and disclaimer

MIT License.

This is an unofficial tool. It is not affiliated with, endorsed by or connected to Google.
Gemini Notebook can change at any time and break exports. Export only content you have the
right to use, and respect Google's terms of service.

Built with [Turndown](https://github.com/mixmark-io/turndown) and
[JSZip](https://stuk.github.io/jszip/).
