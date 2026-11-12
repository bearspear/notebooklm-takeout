# Takeout for Gemini Notebook

Formerly NotebookLM Takeout.

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
| **Export everything** | Everything in the notebook in one click: sources, notes, chat and artifacts (see [Export everything](#export-everything)) |
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

- **Export everything** on the Home screen: the whole notebook in one run, with a progress overlay and **Cancel**
- Batch export with ZIP packaging (the text is really compressed) and **Cancel**
- Large exports split into several ZIPs (configurable batch size)
- A uniform layout: every ZIP has `_index.md`, `_index.html` and `manifest.json`, every Markdown file starts
  with YAML front matter
- Files named after the notebook (`New-Physics-notes-2026-11-02T15-13-06.zip`)
- Built-in **health check** that tells you when a Gemini Notebook update has broken
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

**Updating:** after `git pull`, open `chrome://extensions/`, toggle **Takeout for Gemini Notebook**
off and on, then refresh the notebook tab. The reload icon alone does not pick up new
permissions or content scripts.

## Usage

Open a notebook. The side panel opens on **Home**: **Export everything** at the top, then a row for
Sources, Notes, Studio and Chat with what each one holds. Click a row to open that list. The tabs
stay there to move between lists, and the back arrow in the header returns to Home. Home counts
Sources, Notes and Studio by reading the page, which clicks and scrolls nothing. Chat shows
**Load**: its row only opens the Chat tab, because loading a chat scrolls the page. A count shows **—**
until it is known: the page draws its lists late, so Home reads an empty list again before it
believes it. Home reads again when you come back to the tab or the panel, and on **Refresh**.

Reopening the panel on the same notebook returns to the list you left, and a new notebook always
starts on Home. If a notebook has an export to resume, the panel opens on Home, where the Resume card
is. While you are on a list, a dot on the back arrow says the card is waiting.

The Sources, Notes and Studio lists each have a toolbar with a filter box that matches
titles and types, type chips with counts (shown when there is more than one type), a sort menu
(notebook order, title A-Z, type) and a **Select all visible** checkbox that only touches the rows
the filter leaves showing. Rows the filter hides are deselected, so an export never includes
something you cannot see. The side panel remembers each notebook's filter, sort and selection per
list, so it is still there after a rescan or when you reopen the panel.

### Sources

1. Click **Sources** on Home. The tab lists the notebook's sources.
2. Tick the sources to export → **Export N sources**.
3. You get `{notebook}-sources-{timestamp}.zip` with one or more Markdown versions per
   source, an `_index.md` and a `manifest.json` (see [What an export contains](#what-an-export-contains)).

Notes that appear in the Sources panel's **Notes** group are skipped here (the tab tells you
how many) and exported from the Notes tab instead.

### Notes

1. **Notes** tab (scans automatically). This includes notes shown in the Sources panel.
2. Tick notes → **Export N notes**.
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

1. **Chat** tab → **Load chat** (scrolls to load the whole history and opens collapsed
   citation groups). The note above the button says this moves your place in the chat.
2. Choose the citations in the export sheet: the preset sets them, and Custom lets you pick.
   Full quotes adds the quoted passage for every citation (slower: it reads each citation's
   popup), Source titles only keeps the [n] links without quotes, No citations removes the
   [n] markers and the Sources section.
3. **Export N messages**. A clean single-version chat downloads as one file,
   `{notebook}-chat-{timestamp}.md`. With several versions, errors or a failed audit you get
   `{notebook}-chat-{timestamp}.zip` with `chat.md` (and `chat-code-blocks.md` /
   `chat-with-images.md` when they apply), `_index.md`, `manifest.json`, `_audit.md` and
   `errors.md` when something failed.

### Studio

1. The **Studio** tab lists everything Gemini Notebook generated as one list: the items in the
   Studio panel (audio, slides, reports, notes and so on) and the notes in the Sources panel's
   "Notes" group (type "Note (Sources panel)"). Nothing starts selected, because the same selection
   drives **Delete Selected**; tick or filter rows to choose what you want.
2. Click **Download** on a row, or **Export N items** under the list for the ticked rows. Notes in
   the selection are exported after the artifacts, into `{notebook}-notes-{timestamp}.zip` as on the
   Notes tab. If you press Cancel during the artifacts, the notes do not start. Flashcards, quizzes and
   items with no More menu yet stay in the list so you can delete them, but they can't be exported. The
   button says how many ("Export 1 item · 2 can't be exported"), and the results list them by title as a warning.
   Whether artifacts go to a ZIP or a folder is the export sheet's **Save as**.
   - **Download** saves one file named `[type]_Title.ext` (for example `[report]_Title.md`,
     `[mind-map]_Title.svg`). A Data Table or mind map saves as one ZIP (`[data-table]_Title.zip`, `[mind-map]_Title.zip`).
   - With **ZIP off** (recommended for whole notebooks), **Export N items** saves every ticked artifact into
     `Downloads/<Notebook name>/<type>/…`, one file at a time, so even large audio and video
     overviews work.
   - With **ZIP on**, **Export N items** writes one `{notebook}-artifacts-{timestamp}.zip` with
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

### The export sheet

Every export opens a sheet first, for that one export: Export everything, each list's action and
Chat. The row download buttons skip it and use your default preset.

| Preset | |
|---|---|
| Archive | Full quotes and image copies. The default |
| AI-ready | Source titles only, no image copies |
| Custom | Choose citations, image copies and Obsidian-friendly file names |

The sheet shows the estimated time for what you chose; a number it does not know yet is named
("not counting chat"). Export everything, and Studio with artifacts selected, also offer
**Save as**, a folder or a ZIP. Sources, notes and chat always go to ZIPs (or a single file).
What you choose applies to this export and to its Retry and Resume. It does not change your defaults.
On a Retry or Resume, Save as covers the artifacts only. Either one writes new files, as an ordinary
export of those items: it never joins the folder of the export it continues.
Press Escape or click outside the sheet to close it.

### Export everything

**Export everything**, at the top of Home, is the whole notebook in one run,
sources, then notes, then chat, then artifacts. It scans each category first, so the progress
shows what is coming; a category with nothing in it is reported as "none in notebook". It
opens the export sheet, then uses your Settings for the rest (versions, slide format). **Save as** in the sheet
gives one ZIP per category (artifacts may be split into parts of about 500 MB) or a folder in Downloads.
Every Slides artifact is saved twice, as `.pdf` and `.pptx`, whatever the slide
format setting says (the Studio tab still uses that setting). The Archive preset gives notes
and sources their `-with-images` versions (for items that have images), so an export is complete
without extra setup. The cost is bigger and slower exports for notebooks with many images.

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

Every Export everything run also writes `viewer.html` at the top of the tree. Open it in a browser (no
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

### Deleting from the Studio tab

Every row on the **Studio** tab has **Delete**, and **Delete Selected (N)** sits beside the export
button. Delete asks you first and then confirms Gemini Notebook's own dialog if it shows one. This
includes the notes in the Sources panel: the tab removes them through the panel's "Remove note" menu
item. Delete Selected removes the Sources-panel notes last, from the bottom of the list up. It skips
untitled items and Studio items that share a title with another item, and says so first: delete those
with their row's button.

### Cancelling

Long exports show an overlay on the notebook page with progress and a **Cancel export**
button; the side panel's progress view has a **Cancel** button too. The progress view takes the
place of the list while the export runs: how many items are done, the time left once there is a
pace to go by, and the current item. The list comes back afterwards as you left it. Cancel goes
away during Export everything's final save, which always runs to the end. Cancelling stops within one
citation. Everything exported so far is saved as `…-PARTIAL.zip`, with `errors.md` when
anything failed (a note in it records the cancellation), and the message says how many items
were exported (e.g. "Cancelled: exported 4 of 10 notes"). For Export everything see
[Export everything](#export-everything).

### Results and Retry

When an export ends, its outcome takes the same place and stays until you click **Done** or start
another export: how many items were exported, a plain line on how it went, the ZIP names (or the
Downloads folder) it was saved to, and under that the errors grouped by kind (collapsed; the first
20 of each, the rest are in `errors.md`). If items failed, **Retry N failed** exports just those
again. It refuses if the tab has moved to another notebook: open the notebook the export ran on.
(Chat exports have no Retry: re-export the chat.) If a source or note still has images that did not
download, **Retry N with missing images** exports just those again; images Google rate-limited count
too. For a chat, re-export the chat. **Done** goes back to where you started the
export. If you switch notebooks meanwhile, the results stay, marked with their notebook's name,
and Done goes to Home.

### Resume an unfinished export

If an export stops early (you cancel it, the tab closes, the panel closes or Export everything
runs into failures), the side panel remembers which items were left. When you open that
notebook again, the panel opens on Home, where a card shows "An earlier Notes export stopped at 12 of
40" (Export everything reads "An earlier Export everything stopped at …") with **Resume (28 left)** and **Discard**.
When the export ran to the end and only failed items are left, it reads "An earlier Notes export
finished with 3 failed." with **Retry (3)**, which does the same as Resume for those items. It appears only while the active tab is that
notebook, no export is running, and something is left; it goes away when you switch to
another notebook (or a page that is not a notebook), and comes back when you return. If it appears
while you are on a list, you stay there and a dot on the back arrow says it is waiting on Home.

**Resume** looks the left-over and failed items up again in the notebook (by type and title,
so a renamed or deleted item is not guessed at), then exports them as an ordinary new export:
Sources, then Notes, then Artifacts, ending in one set of results. Items that are no longer in
the notebook are listed there as "no longer in the notebook" and dropped from the banner;
items that fail again stay in it. If the page looks only partly loaded (a list not drawn yet),
those items are reported as "could not be checked" and stay in the banner instead of being
dropped. The files come as new ZIPs or folders; a resume never
adds to the earlier export's files. Resume uses what you chose in the sheet for the stopped export (preset and
Save as), and your current Settings for the rest. An export from before 1.9.3 uses your current Settings. **Discard** forgets the earlier export. Chat exports are
never resumed. Cancel stops a resume between its steps, too.

Only one export, scan or download runs at a time. While one runs, the panel's other buttons
are disabled and a second click shows "… is still running".

## Settings

| Setting | Default | |
|---|---|---|
| Show download notifications | on | In-panel toast when a single download finishes (the extension sends no system notifications) |
| Default preset | Archive | Where the export sheet starts, and what the row download buttons use |
| Default save | Folder | Where **Save as** in the export sheet starts. If you used "Always use ZIP for batch downloads" before 1.9.3 and had never turned off the ZIP checkbox on Export everything, it starts on ZIP |
| Theme | Auto | Auto (match the browser), Light or Dark |
| Slide deck format | PDF | PDF or PowerPoint |
| Source versions | base + metadata | Any mix of: base, with AI summary & topics. The metadata version can include images. Image copies of the base version come from the preset; AI-ready, and Custom with Image copies off, leave out the metadata version's images too |
| Citations (Custom only) | Full quotes | Shown when Default preset is Custom. Notes and chat. "Source titles only" skips reading each citation's popup: much faster, every [n] still links to its source (one line per source), without the quoted passage. "No citations" removes the [n] markers and the Sources section for clean text. |
| Image copies (Custom only) | on | Shown when Default preset is Custom. Also writes a `-with-images` version of each note, source and chat that has images |
| Citation style | Links | "Footnotes (Obsidian, Typora, …)" writes `[^n]` markers and one footnote definition per source instead of `<sup>` links (see below). Notes and chat, "Full quotes" or "Source titles only"; the code-blocks version keeps links. |
| Obsidian-friendly file names (Custom only) | off | Shown when Default preset is Custom. Strips `[ ] # ^ \| \ : * ? " < >` from note, source, chat and artifact file names and names single downloads `note - Title` and `mind-map - Title` instead of `[NOTE]_Title` and `[mind-map]_Title` (see below) |
| Reuse citation quotes from earlier exports | on | Notes and chat answers that have not changed since an earlier full-quote export take their citation quotes from a local cache instead of hovering every marker again (much faster re-exports). Not used for "Source titles only", "No citations" or image versions; only complete reads are stored. **Clear citation cache** empties it, for example after you edit a source. The cache needs the "unlimitedStorage" permission (no install warning), so reused quotes are kept for up to 20 notebooks. The `_audit.md` and `_index.md` show "Citations from cache: N of M items" when it was used. |
| Note versions | base + code blocks | Base always; code-block quotes are added only when a note has quotes. Image copies come from the preset |
| Sources / notes per ZIP | 25 | Batch size for large exports |
| Clean OCR artifacts from citations | on | Strips `~~~`, `:~:` and similar noise |

The chat export uses the note version settings.

**Reset to defaults** (bottom of Settings) puts every option above except Default save back to the values
in this table, after a confirm. It keeps Default save as it shows, the citation cache and saved exports to resume.

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
- `errors.md`: only when something failed, was skipped or was cancelled.
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
or `with-images`. YouTube sources also carry `youtube_url`, sources carry `source_type` (the type icon the page shows, such as `drive_pdf`), and the chat has `messages` (the
number of question/answer pairs). Empty values are left out.

## Health check

Gemini Notebook changes its page structure from time to time, and that can break exports.
Open Settings, Diagnostics, **Run health check** to test what the extension depends on. You can copy the report
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
| "Open a notebook first.", or the panel stays empty | Make sure the tab is a notebook on `notebook.google.com`; refresh it |
| Behaviour didn't change after updating | Toggle the extension off/on in `chrome://extensions/`, then refresh the notebook tab |
| Nothing found / scan returns 0 | Wait for the notebook to finish loading, then scan again |
| Citations missing or wrong | Run the health check and check **Citations**; export a single note to compare |
| A viewer stays open after an export | Close it in Gemini Notebook; run the health check and check "Studio header close control" |
| Download failed | Download that item on its own; check Chrome's download permissions and disk space |
| Overlay won't go away | Click **Cancel export**, or refresh the notebook tab |

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
sidebar-artifacts.js  Artifact files and the artifact export, table converters
sidebar-notes.js      Notes tab: scan, list, note export jobs
sidebar-sources.js    Sources tab: scan, list, source export jobs
sidebar-chat.js       Chat tab: scan, chat export job
sidebar-generated.js  Studio tab: list, export, download and delete
sidebar-health.js     DOM health check panel and report
sidebar-sheet.js      Export sheet: preset, Save as, estimate, Start export
sidebar-list.js       List toolbar: filter, type chips, sort, select all visible, remembered state
sidebar-results.js    Results panel (outcome, saved files, errors, Retry)
sidebar-takeout.js    File writer (ZIP/folder/single), export shell and Export everything
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
tools/                validate_export.py: checks exports and compares them with a baseline (Python 3, standard library); build_viewer.js: builds viewer.html for an unzipped takeout; repair_mindmap_json.js: repairs mind-map trees in exports made before 1.9.17
```

Check your changes:

```bash
for f in sidebar-*.js takeout-job.js content.js background.js injected.js mindmap-extract.js takeout-shared.js takeout-markdown.js takeout-viewer.js viewer/viewer-app.js tools/build_viewer.js tools/repair_mindmap_json.js; do node --check "$f"; done
node --test tests/
python3 -I -m unittest discover -s tools
```

DOM behaviour is verified in Chrome with the health check and real exports.

### Repairing mind-map trees (exports before 1.9.17)

Before 1.9.17, a mind map's `.json` put every node below the branches under the last branch (the
`.svg`, `.html` and the viewer were always right). `tools/repair_mindmap_json.js` rebuilds the tree
from the file's own node list. It only reports by default and changes files only with `--write`:

```bash
node tools/repair_mindmap_json.js ~/Downloads/"My notebook takeout 2026-11-11T18-30-39"          # report: fixed / ok / skipped
node tools/repair_mindmap_json.js ~/Downloads/"My notebook takeout 2026-11-11T18-30-39" --write  # repair
```

It finds every mind map's `.json` below the folder (Studio's `artifacts/mind-maps/` and the Notes tab's `mind-maps/`), never touches the `.svg` or `.html`,
and skips a file whose counts don't add up rather than writing a wrong tree.

### Checking an export

`tools/validate_export.py` checks finished exports: ZIPs, extracted folders, Export everything folders
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
  exports have every part and no item file appears in two parts; in an Export everything run, viewer.html
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

**1.9.17 (Nov 2026)**: mind-map `.json` files now keep each branch's own children. Before, every node below the branches sat under the last branch; the `.svg`, `.html` and the viewer were always right. If a mind map's tree can't be read (for example a branch was still collapsed), its `.json` lists the nodes flat under the root and `errors.md` says "Mind map structure could not be read" instead of writing a wrong tree. `tools/repair_mindmap_json.js` repairs the `.json` files in older exports; it only reports unless given `--write`.

**1.9.16 (Nov 2026)**: viewer: a Data Table now shows once in Studio, not twice (its references file joins the table as a fourth download link), and the table's references are listed under it. Exported files are unchanged.

**1.9.15 (Nov 2026)**: missing images: an image that fails to download gets one more try about a minute later during an export, before the files are written (a single note exported from its row reports at once). Items that still have missing images get a "Retry N with missing images" button in the results (for sources and notes; for chat, re-export the chat). Exported files are unchanged when every image downloads.

**1.9.14 (Nov 2026)**: viewer fixes: the sources search also finds sources by their text, listing title matches first and then the others under "Found in the text", and opening one highlights the matches; approximate values such as "(~272 km) … (~910 km)" no longer show as struck-through text (only `~~text~~` strikes through). Exported files are unchanged.

**1.9.13 (Nov 2026)**: viewer fix: highlighted search matches stay inside the line instead of each taking a full-width block. Exported files are unchanged.

**1.9.12 (Nov 2026)**: a real extension icon (a page with a download arrow over a tray) in place of the plain blue square. Exported files are unchanged.

**1.9.11 (Nov 2026)**: viewer search and source guide. The search box takes operators: `"exact phrase"`, `-word`, `OR`, `in:sources`, `in:notes`, `in:chat`, `in:studio`, `source:name` and `type:pdf`, `youtube`, `web`, `audio` or `image`, with a "?" help button beside it. Every match is highlighted in chat search and in opened results, and a Thoughts section opens when a match is inside it. A source's guide shows as a card with its summary and clickable topics; a topic searches the whole archive for that phrase. Exported files are unchanged.

**1.9.10 (Nov 2026)**: viewer fixes. Formulas that start with a digit are drawn instead of shown as raw text, and no stray `**` is left beside a formula. Fractions inside formulas are drawn. Citation popups now show formatted text (headings, bold, tables, formulas) instead of raw Markdown marks. The export checker flags a formula the viewer cannot draw (`viewer-math-raw`). **Security:** formulas are now put back only into the page's text, after every safety check; before, crafted text with a formula inside an HTML attribute could slip markup past the viewer's cleaning. Text inside code shows `$…$` as written. Exported files are unchanged.

**1.9.9 (Nov 2026)**: cleaner Markdown from pages and PDFs. Citation quotes from some PDFs had a lost letter stored as an invisible control character ("Rotat?ng"); the "i" is restored and no control characters are written. Links in web sources point to the real address instead of a google.com/url redirect. Headings are written without bold inside (`# **A** **B**` becomes `# A B`). Text the source page marked as a formula but that is really prose (or Cyrillic) is written as text. Lines starting with a year and ")" no longer turn into numbered lists, long dash lines become a divider, and bracketed names lose their backslashes. Images in "-with-images" files no longer use their own address as alt text. Content without these patterns exports exactly as before.

**1.9.8 (Nov 2026)**: a **source guide** is no longer saved half-written. When you export a source you have just added, its summary and key topics are still being written; the export used to save the summary as soon as it had any text, so it could be cut short and the key topics missing. Now, when the guide is still being written, it waits until the summary and the key topics have stopped changing for half a second, still within the same 10-second limit. A guide that is still changing at that limit is saved as far as it got, with a note in errors.md that it may be incomplete. Guides that are already finished export exactly as before and just as fast. The test suite runs in seconds again: one image test waited out real retry pauses.

**1.9.7 (Nov 2026)**: a chat answer's **Thoughts** are now a collapsed section, closed by default, instead of a quote block. In the Markdown it is a `<details>` block with the summary "Thoughts", so Markdown readers that support it show one line you can click to open; the steps inside are plain Markdown. The offline viewer shows the same closed "Thoughts" line with a small arrow and opens it on a click, and a search hit inside it opens it. Copy as Markdown still includes the Thoughts. **Web sources** now really record where they came from: in 1.9.6 the export misread the website icon in the source list, so `source_type` and `source_url` were missing. They are written now, and a web source's Markdown shows its address under the title, `**Web Page:** <address>` (or `**Web PDF:**`), the way a YouTube source shows `**YouTube Video:**`. The viewer shows "Open original page" at the top of a web source, like "Open original video" for YouTube. Chats without Thoughts and sources that are not from the web export exactly as before.

**1.9.6 (Nov 2026)**: a chat answer's **Thoughts** are exported. The export opens each answer's collapsed Thoughts, reads every step and its text, and closes it again, also when the export is cancelled or something goes wrong. The reasoning appears as a "Thoughts" quote block where the section was, not as the single word "Thoughts". If a section doesn't open within 3 seconds, the answer still exports and `errors.md` says "Thoughts could not be read". A **source import card** in a chat ("Report & Outside sources (5): Research Report, Open Logic Project, and nLab, +2. All sources imported.") is now one line of text, without its website icons. **Web sources** now record where they came from: `source_type: "web"` (or `"web_pdf"` for a PDF on the web) and `source_url` in the source's front matter, an Original link in `_index.md`, and an "Open original page" link in the viewer. **The offline viewer stays offline.** `viewer.html` carries a Content-Security-Policy that lets it load only the export's own files. Its images that point to the web show as "not available offline", and mind maps no longer fetch a web font. In every with-images file, an image that couldn't be saved is now a plain link (keeping its description) instead of a web image, and website icons are left out. Chats without Thoughts or import cards export exactly as before. An older export rebuilt with `tools/build_viewer.js` keeps its mind maps, which load a web font when the viewer shows them (the script warns about this); export the notebook again to get mind maps that load nothing from the web.

**1.9.5 (Nov 2026)**: the formula count in `_audit.md` now counts the formulas the converter actually wrote, so a price such as "US$3.5 billion … US$4.7" never counts as one, and a formula that looks like a price (`1 micron (μm): 10-6 m`) is no longer missed. Export everything no longer saves the wrong file when an item that is still being generated has the same title as another: that item is skipped, listed in `errors.md` under "Skipped: same title as another item", and kept for Resume. Two ready items with one title both export. An item still being generated with a title of its own is tried as before; if that fails, `errors.md` says "Still being generated. Try again when it is ready (Resume will retry it)." The Studio export still leaves out rows that are not ready, and now lists them in `errors.md` ("Skipped: still being generated"). If the list changes during an export, so that an item's place now holds another item with the same title, that item is refused instead of saved under the other's name, and Resume finds it again. Export everything and Resume wait up to 8 seconds for the notes list to be drawn instead of reporting "none in notebook", and `errors.md` says when the Studio list was still loading or not visible. In the panel, Delete Selected is the light red button again (the Delete in its dialog stays solid red), and Settings, the health check and the rest of the panel use one set of text sizes. The time left counts down while a long item runs, and Start in the export sheet puts the keyboard straight on Cancel. A delete asked just after the panel opens is no longer refused, open dialogs close when the tab leaves the notebook, and Delete Selected stopped by a notebook change refreshes the list. When nothing is skipped, exported files are unchanged, except that `_audit.md` formula lines may differ.

**1.9.4 (Nov 2026)**: the extension is now **Takeout for Gemini Notebook**, after Google renamed NotebookLM, and the panel and page overlay say Gemini Notebook. Exported files are unchanged: their `exporter` line still reads `NotebookLM Takeout <version>`, and a notebook whose name can't be read still saves under the `NotebookLM` name. The Generated tab is called **Studio** again, Gemini Notebook's own name for that pane (it still lists the notes in the Sources panel too). The overlay on the notebook page is redrawn as a small card in the panel's light or dark colours: what is being saved, how many items, the current item, a progress bar and **Cancel export**, which gives way to "Finishing up" during the final save. Delete, Delete Selected and Reset settings ask in the panel's own dialog instead of the browser's, and the "Gemini Notebook looks different" warning uses the same dialog. Escape or a click outside cancels, and a delete starts on Cancel. Notices at the foot of the panel carry an icon; warnings and errors stay 6 seconds, can be closed, and wait while the pointer or keyboard is on them. The panel works from the keyboard: every control shows a focus ring, the list tabs move with the arrow keys, Home and End (Enter opens one), and Settings and the health check take the focus when they open, close with Escape and give it back. Motion is short (at most 160 ms) and stops when the system asks for reduced motion. Delete Selected is a red button now, like the Delete in its dialog, and the empty status bubble on Studio rows is gone.

**1.9.3 (Nov 2026)**: every export starts from a sheet: Archive, AI-ready or Custom, and where to save, with the estimated time. A choice is for that export and its Retry and Resume. While an export runs, one calm view takes the place of the list: how many items are done, the time left, the current item and Cancel. Results take the same place, with Retry and **Done**, which goes back to where you started with your filter and selection intact. Settings keeps only defaults: **Default preset** and **Default save**. Citations, image copies and Obsidian names show there under Custom, and the old citation, image-copy and "Always use ZIP" rows are gone. An existing "Always use ZIP" still sets where Save as starts. Row downloads and Retry refuse, and say so, if the tab has moved to another notebook. **Under Archive, the default, tab and row exports now write `-with-images` files too, take longer, and don't reuse cached quotes, and the Chat tab's export becomes a ZIP with images.** Export everything already did. AI-ready or Custom with Image copies off avoids this.

**1.9.2 (Nov 2026)**: a new notebook opens on a Home screen. **Export everything** (the Full Takeout, with its ZIP checkbox) sits at the top, with a row for Sources, Notes, Generated and Chat showing what each holds. A back arrow returns to Home, and reopening the panel on the same notebook returns to the last list. The Resume card moved onto Home, so a notebook with an export to resume opens there.

**1.9.1 (Nov 2026)**: Artifacts and Generated are now one always-visible Generated tab, between Notes and Chat. Export N items saves the ticked artifacts and notes together, and Cancel stops before the notes start. Nothing starts selected, because the same selection drives Delete Selected. Whether artifacts go to a ZIP now follows the Always use ZIP setting, and an unchanged rescan keeps your place in the list.

**1.9.0 (Nov 2026)**: the side panel has a one-line header with the notebook's name, the connection status, Refresh and Settings. One set of simple line icons replaces the emoji and mixed icons, and Auto-refresh and the health check moved into Settings.

**1.8.8 (Nov 2026)**: a long notebook name no longer cuts the time off a Full Takeout folder, so two runs on one day stay apart. The export checker no longer fails a source's own footnote text.

**1.8.7 (Nov 2026)**: the offline viewer's Copy button gives clean Markdown, without citation numbers, and open sources, notes and reports now have one too.

**1.8.6 (Nov 2026)**: the offline viewer can search everything, and exports are clearer about what happened.
- Viewer: a search box covers source text, notes, reports, tables, chat and titles, and a result opens at the highlighted match. What is open survives a refresh and can be bookmarked.
- Viewer: sources show a type icon (audio, PDF, image, video, web, document, slides, spreadsheet, Markdown, text), the cover and tab title show the notebook's emoji, and Studio file links open in a new tab. Older takeouts need a re-export.
- The Notes, Artifacts and Generated tabs say when an open Studio item hides the list, instead of showing it empty.
- A deck with no PowerPoint version is a notice, not an error, so a clean takeout no longer warns.
- Full Takeout's Cancel button goes away during the final save, which always runs to the end.
- Citation popups are closed properly when one lingers.

**1.8.5 (Nov 2026)**: nested lists stay nested in notes and chat. Sub-bullets used to export at the same level as their parent. The offline viewer's Copy answer button now shows a tick, or a cross if the copy failed.

**1.8.4 (Nov 2026)**: no false `formulas: 0 of 2` audit warning for price ranges. The page draws `$3-$4 million` as math; the export's text was always right.

**1.8.3 (Nov 2026)**: infographics download again.
- Their download link moved to a host the extension did not recognise, so each one failed with "Download was not captured".
- A takeout started with a note open now closes it first. Before, the notes and artifacts lists were not in the page, so the compatibility warning showed and "Try Anyway" could miss them.
- A notebook tab left open across an extension update no longer keeps the old download hook.
- An item right after a PDF-only deck could be saved with that deck's PDF, because the deck's menu stayed open. A false success: re-export any infographic or other downloaded item that follows such a deck.

**1.8.2 (Nov 2026)**: bracketed text such as `[Resolution #1]` no longer turns into a math error in Markdown viewers with math turned on.

**1.8.1 (Nov 2026)**: no more duplicate file names across parts.
- When an export splits into several ZIPs, a note, source or mind map whose name repeats one from an
  earlier part is now numbered (`Name-2`), as it already was inside one part. Unzipping the parts into
  one folder no longer overwrites a file. Names that never collided are unchanged. A Retry or Resume
  runs as a new export, so its files are not numbered against the earlier run's.

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
- Full Takeout includes `-with-images` versions for items that have images (from 1.9.3, under the Archive preset), and puts
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
