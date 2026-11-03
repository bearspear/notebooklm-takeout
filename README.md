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
| **Full Takeout** | Everything in the notebook in one click: sources, notes, chat and artifacts (see [Full Takeout](#full-takeout)) |
| **Sources** | Markdown per source: full text, plus optional AI summary and key topics, optional embedded images |
| **Notes** | Markdown with citations: each `[n]` links to a Sources section with the quoted passage, and back to the text |
| **Chat** | The whole conversation as Markdown, with date headings, per-answer citations and quotes |
| **Reports** | Markdown |
| **Data tables** | CSV, JSON, HTML and footnotes (one ZIP per single download; loose files in `tables/` in archives and folder exports) |
| **Mind maps** | SVG, JSON tree and an interactive HTML viewer (one ZIP per single download; loose files in `mind-maps/` in archives and folder exports) |
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
  name (`Title`, `Title-2`; compared case-insensitively, since macOS and Windows folders are).
- **Tables, headings and lists** are preserved; an optional cleanup strips OCR noise
  (`~~~`, `:~:`) from quoted passages.

**Convenience**

- **One-click Full Takeout** (📦) of the whole notebook, with a progress overlay and **Cancel**
- Batch export with ZIP packaging (the text is really compressed) and **Cancel**
- Large exports split into several ZIPs (configurable batch size)
- A uniform layout: every ZIP has `_index.md`, `_index.html` and `manifest.json`, every Markdown file starts
  with YAML front matter
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
   source, an `_index.md` and a `manifest.json` (see [What an export contains](#what-an-export-contains)).

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
3. **Export Chat**. A clean single-version chat downloads as one file,
   `{notebook}-chat-{timestamp}.md`. With several versions, errors or a failed audit you get
   `{notebook}-chat-{timestamp}.zip` with `chat.md` (and `chat-code-blocks.md` /
   `chat-with-images.md` when they apply), `_index.md`, `manifest.json`, `_audit.md` and
   `errors.md` when something failed.

### Artifacts

1. **Artifacts** tab lists everything in the Studio panel.
2. Click **Download** on a row, or **Download All**.
   - **Download** saves one file named `[type]_Title.ext` (for example `[report]_Title.md`,
     `[mind-map]_Title.svg`). A Data Table or mind map saves as one ZIP (`[data-table]_Title.zip`, `[MINDMAP]_Title.zip`).
   - With **ZIP off** (recommended for whole notebooks), **Download All** saves every file into
     `Downloads/<Notebook name>/<type>/…`, one file at a time, so even large audio and video
     overviews work.
   - With **ZIP on**, **Download All** writes one `{notebook}-artifacts-{timestamp}.zip` with
     type folders (`audio/ video/ slides/ infographics/ reports/ tables/ mind-maps/`), an
     `_index.md`, a `manifest.json` and `errors.md` when something failed. The side panel builds
     it in memory, so a full notebook with audio/video can be too large for a ZIP; use folder
     mode for those.
   - Reports are always Markdown (with front matter), never raw HTML.
3. Slide decks download as PDF or PowerPoint depending on **Settings → Slide deck format**.

### Full Takeout

The 📦 **Full Takeout** button in the panel header exports the whole notebook in one run:
sources, then notes, then chat, then artifacts. It scans each category first, so the progress
shows what is coming; a category with nothing in it is reported as "none in notebook". It
uses your Settings (versions, citation detail, slide format) and the Artifacts tab's **Zip**
toggle (the saved "Always use ZIP" setting until you open that tab). Chat follows
⚙️ **Citation detail** too (Full quotes gives quoted chat citations, the other levels give
titles-only sources); the Chat tab keeps its own **Extract Full Citations** checkbox for its
own export.

*With ZIP on* you get one ZIP per category plus an index ZIP:

```
New-Physics-takeout-sources-2026-11-02T15-13-06.zip
New-Physics-takeout-notes-2026-11-02T15-13-06.zip
New-Physics-takeout-chat-2026-11-02T15-13-06.zip
New-Physics-takeout-artifacts-2026-11-02T15-13-06.zip
New-Physics-takeout-index-2026-11-02T15-13-06.zip
```

**Unzip all of them into one folder.** They are built to merge into a single tree:

```
New-Physics/
  _index.md            what was exported, per category, with status and the ZIP list
  _index.html          the same, to open in a browser, linking each category's _index.html
  manifest.json        the same as data
  errors.md            every category's errors and notes (only when there are any)
  sources/  notes/  chat/  artifacts/
```

Each category folder is a self-contained export: it holds that category's normal ZIP layout,
with its own `_index.md` and `manifest.json` (so the links inside stay valid). That nests one
level deeper than you might expect:

```
New-Physics/sources/_index.md           New-Physics/notes/_index.md
New-Physics/sources/sources/<stem>.md   New-Physics/notes/notes/<stem>.md
New-Physics/sources/manifest.json       New-Physics/notes/combined-notes.md
New-Physics/chat/chat.md                New-Physics/artifacts/audio/<stem>.m4a
New-Physics/chat/_index.md              New-Physics/artifacts/reports/<stem>.md
```

A category that needed several ZIPs (batch size under
Settings) is split into `part-1/`, `part-2/`, … subfolders and the ZIPs are named
`…-takeout-notes-<ts>-part1of3.zip`, so the parts never overwrite each other.

*With ZIP off* everything is saved into a folder `Downloads/<Notebook> takeout <timestamp>/`
that contains the same `<Notebook>/` tree, so the files land at
`Downloads/<Notebook> takeout <timestamp>/<Notebook>/sources/sources/…` (the `<Notebook>/`
folder is the one the ZIPs also unpack into). Audio, video and other media go from Google's servers to disk without
passing through memory, so this is the mode for large notebooks.

A category's status in `_index.md` and in the final message is one of: complete, partial
(cancelled), skipped (cancelled earlier), none in notebook, partial (stopped, see errors) when
the notes export stopped itself because citations could not be read, or failed. If one
category fails, the others still run.

**Cancel** ends the category that is running as partial (its ZIP is named `-PARTIAL`, and what
was exported so far is kept) and skips the remaining categories. The root index and
`errors.md` are still written, so you can see exactly what you got.

### Studio tab (optional)

Enable it under **Settings → Show Studio tab**. It mirrors the Studio panel as one list with
per-row **Download** and **Delete**, plus bulk actions. Delete asks you first, then confirms
Gemini Notebook's own dialog.

### Cancelling

Long exports show an overlay on the notebook page with progress and a **Cancel Export**
button; the side panel's progress area has a Cancel button too. Cancelling stops within one
citation. Everything exported so far is saved as `…-PARTIAL.zip`, with `errors.md` when
anything failed (a note in it records the cancellation), and the message says how many items
were exported (e.g. "Cancelled: exported 4 of 10 notes"). For a Full Takeout see
[Full Takeout](#full-takeout).

Only one export, scan or download runs at a time. While one runs, the panel's other buttons
are disabled and a second click shows "… is still running".

## Settings (⚙️)

| Setting | Default | |
|---|---|---|
| Show download notifications | on | In-panel toast when a single download finishes (the extension sends no system notifications) |
| Show Studio tab | off | Adds the Studio tab |
| Always use ZIP for batch downloads | off | Default for the Artifacts ZIP toggle, also used by Full Takeout |
| Slide deck format | PDF | PDF or PowerPoint |
| Source versions | base + metadata | Any mix of: base, with AI summary & topics, each optionally with images |
| Citation detail | Full quotes | "Source titles only" skips reading each citation's popup: much faster, every [n] still links to its source (one line per source), without the quoted passage. "No citations" removes the [n] markers and the Sources section for clean text. |
| Note versions | base + code blocks | Base always; code-block quotes and an image version are added only when a note has quotes or images |
| Sources / notes per ZIP | 25 | Batch size for large exports |
| Clean OCR artifacts from citations | on | Strips `~~~`, `:~:` and similar noise |

The chat export uses the note version settings.

## What an export contains

Every export follows one layout, whatever you export:

- `_index.md`: what is in the export, linked, with statistics.
- `_index.html`: the same as a web page. Open it in a browser for a clickable list of every file
  (one self-contained page: no scripts, works offline, light and dark). Not for the single-file chat download.
- `manifest.json`: the same as data: notebook, exporter version, a `partial` flag, counts,
  and every file with its size and kind. A takeout can be audited without opening every file.
- `errors.md`: only when something failed or was cancelled.
- `_audit.md`: for notes, sources and chat, what the page showed against what was exported.
- Type folders: `sources/`, `notes/`, `mind-maps/`, or `audio/ video/ slides/ infographics/
  reports/ tables/ mind-maps/` for artifacts.

Every Markdown item file starts with YAML front matter, so tools such as Obsidian or a script
can read the metadata:

```yaml
---
title: "Indeed, Our Sun is Electric"
notebook: "New Physics"
notebook_url: "https://notebook.google.com/notebook/…"
notebook_id: "…"
exporter: "NotebookLM Takeout 1.4.0"
exported: "2026-11-02T15:13:06.000Z"
kind: note
variant: base
---
```

`kind` is `note`, `source`, `report`, `chat` and so on; `variant` is `base`, `code-blocks`
or `with-images`. YouTube sources also carry `youtube_url`, and the chat has `messages` (the
number of question/answer pairs). Empty values are left out.

## Health check (🩺)

Gemini Notebook changes its page structure from time to time, and that can break exports.
Click 🩺 in the panel header to test what the extension depends on. You can copy the report
to the clipboard.

- **General:** notebook title, the Studio viewer close button, and whether formulas carry
  their LaTeX source
- **Notes, Sources, Chat:** the lists and viewers each export reads
- **Artifacts:** Studio items, their download menus, and unknown item types
- **Citations:** reads two real citations exactly the way exports do; if this fails, exports
  would lose their quotes

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
  The ZIPs are built in the side panel, not in a background process.
- The extension has no server, analytics or tracking.
- It works inside your signed-in notebook tab and uses Gemini Notebook's own download
  links for media files.

**Permissions:** `sidePanel`, `tabs`, `scripting` (run inside the notebook tab), `downloads`
and `storage` (settings). Host access is limited to `notebook.google.com` /
`notebooklm.google.com` and the hosts Gemini Notebook serves downloads from
(`contribution.usercontent.google.com`, `*.googleusercontent.com`, and
`*.scf.usercontent.goog` for mind maps). Downloads from any other host, or from other tabs,
are never touched.

## Development

Plain JavaScript Manifest V3 extension: no build step, no npm dependencies.

```
manifest.json         Manifest V3
sidebar.html/.js      Side panel UI and export orchestration (Markdown, formulas, per-category runners)
sidebar-takeout.js    File writer (ZIP/folder/single), export shell and Full Takeout
takeout-job.js        The one export job runner: batching, cancel, errors (unit tested)
styles.css            Side panel styles
content.js            Runs in the notebook page: scanning, extraction, citation popups
takeout-shared.js     Selectors and DOM-free helpers shared by all contexts (unit tested)
mindmap-extract.js    Mind map extraction (page and sandboxed mind map frame)
background.js         Service worker: download interception and naming, mind map frame extraction
injected.js           Page-world hook that captures download URLs
mindmap-template.html Interactive mind map viewer template
turndown.min.js       HTML → Markdown (bundled)
jszip.min.js          ZIP creation (bundled)
tests/                node:test unit tests for takeout-shared.js and takeout-job.js
```

Check your changes:

```bash
for f in sidebar.js sidebar-takeout.js takeout-job.js content.js background.js injected.js mindmap-extract.js takeout-shared.js; do node --check "$f"; done
node --test tests/
```

DOM behaviour is verified in Chrome with the health check and real exports.
**[AGENT.md](AGENT.md)** is the engineering guide: architecture, message protocol, the DOM
contract with Gemini Notebook, past drift and recipes.

## Version history

**1.4.0 (Nov 2026)**: one-click Full Takeout and one layout everywhere.
- New **Full Takeout** (📦): sources, notes, chat and artifacts of a notebook in one run, as one
  ZIP per category plus an index (unzip into one folder), or straight into a Downloads folder.
  Cancel keeps what was exported and skips the rest; every category reports complete, partial,
  skipped, none, stopped or failed.
- Every ZIP has `_index.md` and `manifest.json`, `errors.md` when something failed and
  `_audit.md` for audited exports. The plain-text README and error files of earlier versions are gone.
- Every Markdown file starts with YAML front matter (title, notebook, exporter, kind, variant).
- Download All builds its ZIP in the side panel with type folders (`audio/ … mind-maps/`); with
  ZIP off it saves into `Downloads/<Notebook>/<type>/`. Reports are Markdown, never raw HTML.
- ZIPs are now really compressed (text is DEFLATEd; media stays as is).
- One naming scheme for notes, sources and artifacts: repeated titles become `Title`,
  `Title-2`, compared case-insensitively.
- Single mind map downloads are named `[mind-map]_Title`.
- Removed the unused `notifications` permission; "Show download notifications" is a toast
  setting.
- The background service worker no longer builds ZIPs (about 500 lines removed).

**1.3.0 (Nov 2026)**: lean, shared and correct output.
- Each export writes `_audit.md`, comparing what the page showed with what was exported
  (items, citations, formulas), and warns when something is missing.
- New citation modes: "Source titles only" (no popup reading, one Sources line per source) and "No citations" (plain text). Both make large exports much faster.
- Reports get a Sources section; quotes render as blockquotes; no more identical duplicate
  files; the sources index links same-titled sources correctly.
- Error reports have one format for every export (a cancelled chat export no longer fails).
- The health check can really fail: it reads real citations and checks artifacts.
- Narrower permissions and download trust: only Gemini Notebook's download hosts.
- About 1,300 lines of dead code removed; one tested copy of each shared helper.

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
