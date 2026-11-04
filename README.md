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

The Notes, Sources, Artifacts and Generated lists each have a toolbar with a filter box that matches
titles and types, type chips with counts (shown when there is more than one type), a sort menu
(notebook order, title A-Z, type) and a **Select all visible** checkbox that only touches the rows
the filter leaves showing. Rows the filter hides are deselected, so an export never includes
something you cannot see. The side panel remembers each notebook's filter, sort and selection per
list, so it is still there after a rescan or when you reopen the panel.

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
2. Chat follows ⚙️ **Citation detail** (the line above Export Chat shows the current level):
   Full quotes adds the quoted passage for every citation (slower: it reads each citation's
   popup), Source titles only keeps the [n] links without quotes, No citations removes the
   [n] markers and the Sources section.
3. **Export Chat**. A clean single-version chat downloads as one file,
   `{notebook}-chat-{timestamp}.md`. With several versions, errors or a failed audit you get
   `{notebook}-chat-{timestamp}.zip` with `chat.md` (and `chat-code-blocks.md` /
   `chat-with-images.md` when they apply), `_index.md`, `manifest.json`, `_audit.md` and
   `errors.md` when something failed.

### Artifacts

1. **Artifacts** tab lists everything in the Studio panel. Every downloadable artifact starts
   selected; filter, sort or untick rows to choose what you want.
2. Click **Download** on a row, or **Download Selected (N)** for the ticked rows.
   - **Download** saves one file named `[type]_Title.ext` (for example `[report]_Title.md`,
     `[mind-map]_Title.svg`). A Data Table or mind map saves as one ZIP (`[data-table]_Title.zip`, `[mind-map]_Title.zip`).
   - With **ZIP off** (recommended for whole notebooks), **Download Selected** saves every ticked file into
     `Downloads/<Notebook name>/<type>/…`, one file at a time, so even large audio and video
     overviews work.
   - With **ZIP on**, **Download Selected** writes one `{notebook}-artifacts-{timestamp}.zip` with
     type folders (`audio/ video/ slides/ infographics/ reports/ tables/ mind-maps/`), an
     `_index.md`, a `manifest.json` and `errors.md` when something failed. The side panel builds
     each ZIP in memory, so a big notebook is split into parts of about 500 MB:
     `{notebook}-artifacts-{timestamp}-part1.zip`, `-part2.zip`, and so on. Each part has its
     own type folders, `_index.md` and `manifest.json`. A part can pass 500 MB by one file, and a
     single file over 500 MB gets a part of its own. Building a part briefly needs about twice its size in
     memory, so a part can reach about 500 MB plus one large file and about twice that in memory. For notebooks
     with multi-GB videos, ZIP off (a folder in Downloads) is still the lightest option.
     Folder mode is not split (files go straight to disk).
   - Reports are always Markdown (with front matter), never raw HTML.
3. Slide decks download as PDF or PowerPoint depending on **Settings → Slide deck format**. Older
   decks only offer PDF and always download as PDF.

### Full Takeout

The 📦 **Full Takeout** button in the panel header exports the whole notebook in one run:
sources, then notes, then chat, then artifacts. It scans each category first, so the progress
shows what is coming; a category with nothing in it is reported as "none in notebook". It
uses your Settings (versions, citation detail, slide format). Its own **ZIP** checkbox sits next
to the button: ticked gives one ZIP per category (artifacts may be split into parts of about 500 MB), unticked a folder in Downloads. The choice is
remembered; until you change it, it follows the "Always use ZIP" setting. The Artifacts tab's
**Zip** toggle no longer affects Full Takeout (it only applies to Download Selected). Chat follows
⚙️ **Citation detail** too, the same as the Chat tab (Full quotes, Source titles only or No
citations). Every Slides artifact is saved twice, as `.pdf` and `.pptx`, whatever the slide
format setting says (the Artifacts tab still uses that setting). Notes, sources and chat also
always get their `-with-images` versions (for items that have images), whatever the image
checkboxes in Settings say, so a takeout is complete without extra setup; the tabs still follow
your checkboxes. The cost is bigger and slower takeouts for notebooks with many images.

*With ZIP on* you get one ZIP per category (artifacts may be split into parts of about 500 MB) plus an index ZIP:

```
New-Physics-takeout-sources-2026-11-02T15-13-06.zip
New-Physics-takeout-notes-2026-11-02T15-13-06.zip
New-Physics-takeout-chat-2026-11-02T15-13-06.zip
New-Physics-takeout-artifacts-2026-11-02T15-13-06.zip
New-Physics-takeout-images-2026-11-02T15-13-06.zip
New-Physics-takeout-index-2026-11-02T15-13-06.zip
```

**Unzip all of them into one folder.** They are built to merge into a single tree:

```
New-Physics/
  _index.md            what was exported, per category, with status and the ZIP list
  _index.html          the same, to open in a browser, linking each category's _index.html
  viewer.html          browse everything offline (see below)
  manifest.json        the same as data
  errors.md            every category's errors and notes (only when there are any)
  sources/  notes/  chat/  artifacts/
  images/              the images the viewer shows (only when there are any)
```

Each category folder is a self-contained export: it holds that category's normal ZIP layout,
with its own `_index.md` and `manifest.json` (so the links inside stay valid). Note and source
files sit directly in their category folder:

```
New-Physics/sources/_index.md           New-Physics/notes/_index.md
New-Physics/sources/<stem>.md           New-Physics/notes/<stem>.md
New-Physics/sources/manifest.json       New-Physics/notes/mind-maps/<stem>.svg
New-Physics/chat/chat.md                New-Physics/notes/combined-notes.md
New-Physics/chat/_index.md              New-Physics/artifacts/audio/<stem>.m4a
```

(The YouTube URL lists of the sources sit there too: `New-Physics/sources/youtube-urls.txt`.)

A category that needed several ZIPs (batch size under
Settings) is split into `part-1/`, `part-2/`, … subfolders and the ZIPs are named
`…-takeout-notes-<ts>-part1of3.zip`, so the parts never overwrite each other.

The artifacts category is split the same way by size: with ZIP on, each ZIP holds about 500 MB
(`…-takeout-artifacts-<ts>-part1.zip`, `-part2.zip`, …), and a split category unpacks to
`artifacts/part-1/`, `artifacts/part-2/`, … The takeout index links each part.

*With ZIP off* everything is saved into a folder `Downloads/<Notebook> takeout <timestamp>/`
that contains the same `<Notebook>/` tree, so the files land at
`Downloads/<Notebook> takeout <timestamp>/<Notebook>/sources/…` (the `<Notebook>/`
folder is the one the ZIPs also unpack into). Audio, video and other media go from Google's servers to disk without
passing through memory, so this is the mode for large notebooks.

#### The offline viewer

Every Full Takeout also writes `viewer.html` at the top of the tree. Open it in a browser (no
internet needed) to read your sources, notes and chat, and to open slides, audio and other
artifacts, with citations linked to their sources. `_index.md` and `_index.html` link to it.

Images are files in `images/`, not data inside `viewer.html`, so the page stays small. Uploaded pictures
(sources that are only an image) show there too, and citations of them name the source. An image that
could not be downloaded shows "Image not available offline". Images in a citation quote show in the
citation's popup.

Drag the gaps between Sources, Chat and Studio to resize them (arrow keys move 24 px, double-click resets), or collapse Sources and Studio to a thin rail; the layout is remembered in the browser.

With ZIP on, **unzip all the ZIPs into one folder** before you open it: the viewer is in the index
ZIP and its media and image links point to files in the other ZIPs, so they only work side by side.
Images have their own ZIP (`…-takeout-images-<ts>.zip`, split near 500 MB into `-part1of2`, …). Artifacts
that Chrome saved straight into Downloads (outside the takeout) do not appear in the viewer in a ZIP
takeout. With ZIP off the folder is already in one piece. If the viewer or its images could not be
saved, the takeout is still complete and `errors.md` says so.

For a takeout made with an older version, build a viewer for the unzipped folder with
`node tools/build_viewer.js <takeout folder> <out.html>` (see Development). It writes `images/` beside
the output file.

A category's status in `_index.md` and in the final message is one of: complete, partial
(cancelled), skipped (cancelled earlier), none in notebook, partial (stopped, see errors) when
the notes export stopped itself because citations could not be read, or failed. If one
category fails, the others still run.

**Cancel** ends the category that is running as partial (its ZIP is named `-PARTIAL`, and what
was exported so far is kept) and skips the remaining categories. The root index and
`errors.md` are still written, so you can see exactly what you got.

### Generated tab (optional)

Enable it under **Settings → Show the Generated tab**. It lists everything Gemini Notebook
generated as one list: the items in the Studio panel (notes, audio, slides, reports and so on)
and the notes in the Sources panel's "Notes" group (type "Note (Sources panel)"). Every row has
**Download** and **Delete**, and there are bulk actions. Delete asks you first and then confirms
Gemini Notebook's own dialog if it shows one. This includes the notes in the Sources panel: the
tab removes them through the panel's "Remove note" menu item. Delete Selected removes the Sources-panel
notes last, from the bottom of the list up.

### Cancelling

Long exports show an overlay on the notebook page with progress and a **Cancel Export**
button; the side panel's progress area has a Cancel button too. Cancelling stops within one
citation. Everything exported so far is saved as `…-PARTIAL.zip`, with `errors.md` when
anything failed (a note in it records the cancellation), and the message says how many items
were exported (e.g. "Cancelled: exported 4 of 10 notes"). For a Full Takeout see
[Full Takeout](#full-takeout).

### Results and Retry

When an export ends, its outcome stays in a results panel under the progress area until you
start another export or click **Dismiss**: what was exported, the ZIP names (or the Downloads
folder) it was saved to, and the errors grouped by kind (collapsed; the first 20 of each, the
rest are in `errors.md`). If items failed, **Retry N failed** exports just those again.
(Chat exports have no Retry: re-export the chat.)

### Resume an unfinished export

If an export stops early (you cancel it, the tab closes, the panel closes or a Full Takeout
runs into failures), the side panel remembers which items were left. When you open that
notebook again, a banner above the results shows "An earlier Notes export stopped at 12 of
40" (a Full Takeout reads "An earlier Full Takeout stopped at …") with **Resume (28 left)** and **Discard**.
When the export ran to the end and only failed items are left, it reads "An earlier Notes export
finished with 3 failed." with **Retry (3)**, which does the same as Resume for those items. It appears only while the active tab is that
notebook, no export is running, and something is left; it goes away when you switch to
another notebook (or a page that is not a notebook), and comes back when you return.

**Resume** looks the left-over and failed items up again in the notebook (by type and title,
so a renamed or deleted item is not guessed at), then exports them as an ordinary new export:
Sources, then Notes, then Artifacts, ending in one results panel. Items that are no longer in
the notebook are listed there as "no longer in the notebook" and dropped from the banner;
items that fail again stay in it. If the page looks only partly loaded (a list not drawn yet),
those items are reported as "could not be checked" and stay in the banner instead of being
dropped. The files come as new ZIPs or folders; a resume never
adds to the earlier export's files. Resume uses your current ⚙️ settings (citation detail,
versions, ZIP), not the ones of the stopped export. **Discard** forgets the earlier export. Chat exports are
never resumed. Cancel stops a resume between its steps, too.

Only one export, scan or download runs at a time. While one runs, the panel's other buttons
are disabled and a second click shows "… is still running".

## Settings (⚙️)

| Setting | Default | |
|---|---|---|
| Show download notifications | on | In-panel toast when a single download finishes (the extension sends no system notifications) |
| Show the Generated tab | off | Adds the Generated tab (the former Studio tab) |
| Always use ZIP for batch downloads | off | Default for the Artifacts ZIP toggle, and the starting value of Full Takeout's ZIP checkbox |
| Slide deck format | PDF | PDF or PowerPoint |
| Source versions | base + metadata | Any mix of: base, with AI summary & topics, each optionally with images |
| Citation detail (notes and chat) | Full quotes | "Source titles only" skips reading each citation's popup: much faster, every [n] still links to its source (one line per source), without the quoted passage. "No citations" removes the [n] markers and the Sources section for clean text. |
| Citation style | Links | "Footnotes (Obsidian, Typora, …)" writes `[^n]` markers and one footnote definition per source instead of `<sup>` links (see below). Notes and chat, "Full quotes" or "Source titles only"; the code-blocks version keeps links. |
| Obsidian-friendly file names | off | Strips `[ ] # ^ \| \ : * ? " < >` from note, source, chat and artifact file names and names single downloads `note - Title` and `mind-map - Title` instead of `[NOTE]_Title` and `[mind-map]_Title` (see below) |
| Reuse citation quotes from earlier exports | on | Notes and chat answers that have not changed since an earlier full-quote export take their citation quotes from a local cache instead of hovering every marker again (much faster re-exports). Not used for "Source titles only", "No citations" or image versions; only complete reads are stored. **Clear citation cache** empties it, for example after you edit a source. The cache needs the "unlimitedStorage" permission (no install warning), so reused quotes are kept for up to 20 notebooks. The `_audit.md` and `_index.md` show "Citations from cache: N of M items" when it was used. |
| Note versions | base + code blocks | Base always; code-block quotes and an image version are added only when a note has quotes or images |
| Sources / notes per ZIP | 25 | Batch size for large exports |
| Clean OCR artifacts from citations | on | Strips `~~~`, `:~:` and similar noise |

The chat export uses the note version settings.

**Reset to defaults** (bottom of ⚙️) puts every option above back to the values in this table,
after a confirm. It keeps the citation cache, Full Takeout's own ZIP tick and saved exports to resume.

### Footnote citations and Obsidian-friendly names

Both are opt-in; with them off every file is exactly as before.

**Citation style: Footnotes.** In the link style a citation is a small `[n]` link and the Sources
section holds an anchor and a quote for it. With Footnotes the body holds `[^n]` and the Sources
section holds one definition per source:

```
… the claim.[^1] [^2]

[^1]: **Source title** — the quoted passage
    which continues on indented lines.

[^2]: **Another source**
```

- "Source titles only" still gets one definition per number (a reference needs its own
  definition), and a citation whose popup could not be read gets `**(citation details unavailable)**`.
- In a combined notes file (`combined-notes*.md`) the label is `note-number`, so note 2's
  citation 1 is `[^2-1]` and never clashes with note 1's. The same holds in `chat.md`, where
  numbers restart in every answer: the label is `answer-number`. The single-note files keep
  plain numbers.
- The code-blocks version (`-code-blocks`) keeps its links: a fenced quote cannot sit inside a
  footnote definition reliably.
- Obsidian, Typora and similar apps show these as real footnotes (Obsidian lists them at the end
  of the note). Please check how yours looks; if something renders oddly, switch back to Links.

**Obsidian-friendly file names.** Obsidian cannot link to a file whose name holds `[ ] # ^ | \`
and a few more characters, and `[NOTE]_Title` is awkward in `[[links]]`. With this option those
characters become a space (then a dash, like any other space), single downloads are named
`note - Title.md` / `mind-map - Title.zip` / `report - Title.md`, and repeats still get `-2`, `-3`.
The links in `_index.md`, `_index.html` and `manifest.json` follow the new names.

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

## Known limitations

- Citation quotes from long, unpunctuated transcript sources, such as YouTube videos, are cut at
  about 1,000 characters and can start or end mid-word. That is the window Gemini Notebook's
  citation popover shows for such sources, and the exported quote matches the popover exactly.
  Structured documents quote whole paragraphs.

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
`storage` (settings, unfinished-export records and list settings) and `unlimitedStorage` (the
citation cache; no install warning). Host access is limited to `notebook.google.com` /
`notebooklm.google.com` and the hosts Gemini Notebook serves downloads from
(`contribution.usercontent.google.com`, `*.googleusercontent.com`, and
`*.scf.usercontent.goog` for mind maps), plus `lh3.google.com`, where notebook image URLs
redirect. Image requests are made without the `authuser` parameter. A 403 on an image during the
citation hover is retried by the embed pass with waits; the cause of those 403s is not known. Downloads from any other host, or from other tabs, are never touched.

## Development

Plain JavaScript Manifest V3 extension: no build step, no npm dependencies.

```
manifest.json         Manifest V3
sidebar.html          Side panel UI
sidebar-core.js       Settings, tab and notebook switching, job lock, shared helpers, Markdown and formulas
sidebar-artifacts.js  Artifacts tab: scan, Download Selected, Download All, table converters
sidebar-notes.js      Notes tab: scan, list, note export jobs
sidebar-sources.js    Sources tab: scan, list, source export jobs
sidebar-chat.js       Chat tab: scan, chat export job
sidebar-generated.js  Generated tab: list, download and delete
sidebar-health.js     DOM health check panel and report
sidebar-list.js       List toolbar: filter, type chips, sort, select all visible, remembered state
sidebar-results.js    Results panel (outcome, saved files, errors, Retry)
sidebar-takeout.js    File writer (ZIP/folder/single), export shell and Full Takeout
takeout-job.js        The one export job runner: batching, cancel, errors (unit tested)
styles.css            Side panel styles
content.js            Runs in the notebook page: scanning, extraction, citation popups
takeout-shared.js     Selectors and DOM-free helpers shared by all contexts (unit tested)
takeout-markdown.js   The one Markdown converter and KaTeX → LaTeX (side panel and page)
mindmap-extract.js    Mind map extraction (page and sandboxed mind map frame)
background.js         Service worker: download interception and naming, mind map frame extraction
injected.js           Page-world hook that captures download URLs
mindmap-template.html Interactive mind map viewer template
takeout-viewer.js     Builds the offline viewer (data and page); viewer/ holds its template, app and bundled libraries
turndown.min.js       HTML → Markdown (bundled)
jszip.min.js          ZIP creation (bundled)
tests/                node:test unit tests for takeout-shared.js, takeout-job.js, the message protocol and file structure
tools/                validate_export.py: checks exports and compares them with a baseline (Python 3, standard library); build_viewer.js: builds viewer.html for an unzipped takeout
```

Check your changes:

```bash
for f in sidebar-*.js takeout-job.js content.js background.js injected.js mindmap-extract.js takeout-shared.js takeout-markdown.js takeout-viewer.js viewer/viewer-app.js tools/build_viewer.js; do node --check "$f"; done
node --test tests/
python3 -I -m unittest discover -s tools
```

DOM behaviour is verified in Chrome with the health check and real exports.

### Checking an export

`tools/validate_export.py` checks finished exports: ZIPs, extracted folders, Full Takeout folders
or single `.md` downloads. It never writes next to them (ZIPs are unpacked into a temp folder).

```bash
python3 -I tools/validate_export.py ~/Downloads/New-Math-notes-*.zip          # one or more exports
python3 -I tools/validate_export.py NEW.zip --baseline OLD.zip                # same as an older export?
python3 -I tools/validate_export.py NEW.zip --baseline OLD.zip --allow '\$[^$\n]+\$'   # accept a known change
```

- **Per export:** every file in `manifest.json` exists and has its listed size; no stray files;
  `_audit.md` counts ("N of M") are complete; `_index.md` / `_index.html` links open; `_index.md`
  has front matter (from 1.7.0); every footnote has exactly one definition; no internal markers
  are left; no `[object …]` text; PARTIAL and failed exports are explained from `errors.md`; split
  exports have every part and no item file appears in two parts; in a Full Takeout, viewer.html
  has readable data and every file it links exists (the link check needs the artifacts folder, so
  it is skipped for a category ZIP checked alone).
- **Against a baseline:** files are compared after removing run details (dates, times, version,
  export statistics, file sizes that only changed because a date got shorter). Differences only in
  front matter are listed separately; `--allow REGEX` accepts known changes.
- Each export gets PASS, WARN or FAIL; the exit code is 1 when anything fails or differs.
- **With Claude Code:** `tools/validate-notebooklm-export/` is a skill that runs the checker and explains
  its findings. Link it once with `ln -s "$PWD/tools/validate-notebooklm-export" ~/.claude/skills/`,
  then ask "validate my latest exports".
**[AGENT.md](AGENT.md)** is the engineering guide: architecture, message protocol, the DOM
contract with Gemini Notebook, past drift and recipes.

## Version history

**1.8.0 (Nov 2026)**: offline viewer.
- Every Full Takeout writes `viewer.html`: browse sources, notes, chat and artifacts offline, with
  linked citations. Unzip the ZIPs into one folder for media links to work.
- Images show in the viewer, from an `images/` folder (its own ZIP with ZIP on), also in citation popups.
- Image sources (an uploaded picture) are exported with their image, and citations of them are kept
  by title instead of failing. Images download with your Google sign-in, with retries and limits.
- Older slide decks that only offer PDF: Full Takeout saves the PDF once and notes the missing
  PowerPoint in `errors.md`, instead of saving it twice (`Name (1).pdf`).
- The export checker accepts links with parentheses, and the formula count in `_audit.md` now counts
  formulas next to words (85 of 150 was a false alarm).
- `_index.md` and `_index.html` link to the viewer; the root `manifest.json` lists it.
- `tools/build_viewer.js` builds a viewer for an unzipped takeout; the export checker reports
  `viewer-invalid`, `viewer-broken-link` and `viewer-missing`.

**1.7.0 (Nov 2026)**: one converter, clean structure, footnotes.
- New ⚙️ options, both off by default: footnote-style citations (`[^1]`, for Obsidian, Typora and
  other Markdown apps) and Obsidian-friendly file names.
- Formulas are now written as LaTeX in source guides, the notebook summary and citation quotes
  (they used to come out as doubled text). The citation cache is cleared once when updating to
  1.7.0, so quotes are read again with formulas.
- Numbered lists that start after 1 keep their numbering in quotes, guides and the summary.
- Every category `_index.md` starts with front matter (`kind: index`), like the items.
- Split sources exports get an `_audit.md` per part; Resume can be cancelled while it scans;
  folder-mode manifests record downloaded file sizes; Delete Selected counts only items it can
  delete; a delete no longer clicks a dialog's backdrop on a menu's behalf or closes dialogs it didn't
  open (it closes its own menu and confirm dialog).
- ⚙️ has a **Reset to defaults** button; the citation cache and exports to resume are kept.
- Under the hood: `sidebar.js` is split into one file per tab, the page script answers messages
  through a handler table, and one module (`takeout-markdown.js`) holds all Markdown conversion.
  Exports are otherwise byte-identical to 1.6.0.

**1.6.0 (Nov 2026)**: faster re-exports, resume, and a complete Generated tab.
- Re-exports reuse citation quotes read before (⚙️ "Reuse citation quotes from earlier exports", with a
  Clear button); only new or edited notes and answers are hovered again. `_audit.md` says how many came
  from the cache. Adds the `unlimitedStorage` permission so the cache can hold large notebooks.
- An export that was cancelled, stopped or cut off can be resumed: a banner offers "Resume (N left)",
  rescans, and exports only what is left; items removed from the notebook are reported, never swapped.
  Cancel between two retry or resume steps now stops the rest.
- The Generated tab can delete notes in the Sources panel. Deletes refuse when the item changed since the
  scan, close any open page menu first, and only click the item's own menu entry.
- Long transcript quotes cut by Gemini Notebook's ~1,000-character window are marked with "…"; chat in
  "Source titles only" mode groups its sources like notes; single mind maps download as `[mind-map]_Title`.
- Split notes exports get an `_audit.md` per part; takeout indexes group files under Notes, Sources and
  Mind maps; old per-notebook list settings are cleaned up; lists ignore clicks while an export runs.

**1.5.0 (Nov 2026)**: find, retry, finish.
- Every list (Artifacts, Notes, Sources, Generated) has a filter box, type chips, sorting and
  "Select all visible", with "N of M shown · K selected". Each notebook remembers its choices.
- The Artifacts tab downloads the selected items ("Download Selected"); everything is selected
  by default. The download button on a Notes row exports just that note.
- Export results stay in a panel (what was saved, errors grouped by type) with
  "Retry N failed" for notes, sources and artifacts, also after a Full Takeout.
- Full Takeout has its own ZIP checkbox next to 📦. The Artifacts tab's Zip tick now only affects
  Download Selected.
- The open list rescans when you switch to another notebook (another tab, or a notebook opened from
  the home page). A stale chat scan is cleared.
- Chat follows ⚙️ Citation detail (full quotes, source titles only, or no citations); its own
  checkbox is gone.
- ZIP exports of artifacts are split into parts of about 500 MB (`-part1.zip`, `-part2.zip`; in a
  takeout `artifacts/part-1/`, …), so a big notebook no longer builds one huge ZIP in memory.
- Full Takeout always includes `-with-images` versions for items that have images, and puts
  notes and sources straight into `notes/` and `sources/` (no more `notes/notes/`).
- Fixes: the takeout index keeps parts written before a failure and links folders that hold only
  errors; unreadable chats count the messages on the page; downloads keep their real file
  extension (e.g. `.jpeg`); names that differ only in Unicode form no longer overwrite each other;
  Download All and Retry use the tab they were started from.
- The Studio tab is now the Generated tab and also lists the notes in the Sources panel (download
  only; they can't be deleted there yet). The setting keeps its saved value.

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
- Studio tab (now the Generated tab) and mind map export.
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
[JSZip](https://stuk.github.io/jszip/). The offline viewer includes
[marked](https://github.com/markedjs/marked) 12.0.2 (MIT licence, Copyright (c) 2011-2024,
Christopher Jeffrey) and [KaTeX](https://katex.org) 0.16.11 (MIT licence, Copyright (c) 2013-2020
Khan Academy and other contributors). KaTeX's code is MIT; its fonts are under the SIL Open Font
License 1.1. The notices are in `viewer/THIRD-PARTY-NOTICES.txt`.
