# Agent guide: NotebookLM Takeout

Single-document reference for any LLM/engineer picking up this extension. Optimised for fast
context recovery — dense pointers, not narrative. Read top to bottom once; after that, use
the table of contents to jump.

- Repo root: `/Users/mbehringer/Downloads/notebooklm-exporter`
- Remote: `git@github.com-personal:bearspear/notebooklm-takeout.git`
- Manifest: V3 Chrome extension, no build step
- Latest meaningful work: Milestone 1 "Trustworthy and faster" (v1.2.0), branch
  `fix/milestone-1-trustworthy-faster`, after PR #2 (`27e073c`, v1.1.0)
- Branch: `main`

## Table of contents

1. [TL;DR](#tldr)
2. [How to load and iterate](#how-to-load-and-iterate)
3. [Architecture: four execution contexts](#architecture-four-execution-contexts)
4. [File map with line counts](#file-map-with-line-counts)
5. [Settings shape and storage](#settings-shape-and-storage)
6. [Tab system](#tab-system)
7. [Message protocol](#message-protocol)
8. [Export pipelines (deep)](#export-pipelines-deep)
9. [DOM contract with NotebookLM](#dom-contract-with-notebooklm)
10. [Citation hover protocol](#citation-hover-protocol)
11. [KaTeX → LaTeX conversion](#katex--latex-conversion)
12. [Mindmap extraction](#mindmap-extraction)
13. [DOM health check](#dom-health-check)
14. [Studio tab internals](#studio-tab-internals)
15. [Drift patterns Google has shipped](#drift-patterns-google-has-shipped)
16. [Known issues and latent bugs](#known-issues-and-latent-bugs)
17. [Recipes](#recipes)
18. [Testing and verification](#testing-and-verification)
19. [Conventions in this codebase](#conventions-in-this-codebase)
20. [Git workflow](#git-workflow)

---

## TL;DR

A Chrome side-panel extension that scrapes content out of `notebook.google.com` (formerly
`notebooklm.google.com`, renamed to "Gemini Notebook" in Aug 2026) into local
files. Five user-facing surfaces: Sources, Notes, Artifacts, Chat, and the optional Studio
tab. The Studio tab gives a unified flat list with per-item Download / Delete; everything
else uses tab-specific batch exports producing ZIPs.

No backend, no build. Unit tests cover the DOM-free helpers in `takeout-shared.js`
(`node --test tests/`); everything DOM-related is verified by hand. The hard parts are:

- **DOM scraping against a moving target.** Google reorganises NotebookLM's DOM regularly.
  Recent drift events: studio-card render changes, ProseMirror replacing Quill in note
  editors, chat AI replies adopting the same `<labs-tailwind-doc-viewer>` component used in
  notes (caused chat-citation contamination), notebook title selector churn.
- **Citation hover dance.** To get citation source + quote text we hover each
  `button.citation-marker`, wait for the popover (`NLME.CITATION_TOOLTIP_SELECTOR`), scrape
  `.citation-tooltip-header` and `.citation-tooltip-text`, then mouseleave and wait for the
  popover to fully close. Single-flighted, ~0.3–1 s per citation. The quote text is already in
  the page: hovers cause no Gemini Notebook data requests (measured Nov 2026).
- **Download interception.** Some artifact types (slides, audio, infographics) only download
  via NotebookLM's "More → Download" menu, which calls `window.open` to a Google CDN URL.
  We override `window.open` in `injected.js` and route the URL back through the extension's
  `chrome.downloads` API so no tab opens.
- **KaTeX math.** Notes and chat render math via KaTeX. The model's original LaTeX sits on
  the host span as `data-math` (Nov 2026) and is exported verbatim; then the MathML
  `<annotation>`; only when both are missing do we reconstruct LaTeX from `.katex-html`.
  The health check's "Formulas carry LaTeX source" line warns when formulas lack a source.

## How to load and iterate

```bash
# 1. Open chrome://extensions/ → enable Developer mode → Load unpacked → pick this folder
# 2. Open notebook.google.com → side panel auto-opens
# 3. After any code change: hit the reload icon next to the extension entry in chrome://extensions/
# 4. Inspect logs:
#    - Sidebar logic:   right-click sidebar → Inspect → Console
#    - Content script:  open DevTools on the NotebookLM tab → Console
#    - Service worker:  chrome://extensions/ → "Service worker" link under the entry
```

All log lines are prefixed `[NotebookLM Takeout]`. The codebase has a `logger` helper
(`logger.info` / `logger.warn` / `logger.error` / `logger.download`) defined in `sidebar.js`.

No package.json, no lint config, no formatter. After every edit run `node --check` on each
touched file and `node --test tests/` (Node 20 built-in runner, no npm packages).

After any manifest change or new content-script file, toggle the extension off/on in
`chrome://extensions/` — the reload icon alone does not apply them. A stale install keeps
running pre-pull code (seen Nov 2026: the console showed old line numbers).

## Architecture: four execution contexts

```
┌─────────────────── Chrome extension ──────────────────────┐
│                                                            │
│  [sidebar.js  ◄──messages──►  background.js]              │
│       │                              │                     │
│       │ scripting / sendMessage      │                     │
│       ▼                              ▼                     │
│  [content.js  ◄──postMessage──►  injected.js]             │
│       │                              │                     │
│       │ direct DOM                   │ page-world hooks   │
│       ▼                              ▼                     │
│            NotebookLM page DOM + globals                  │
└────────────────────────────────────────────────────────────┘
```

| Context | File | Lives in | Has DOM | Has chrome.* APIs |
|---|---|---|---|---|
| Sidebar | `sidebar.js` | Side panel iframe | own sidebar DOM only | yes |
| Background | `background.js` | Service worker | none | yes |
| Content | `content.js` | NotebookLM page (isolated world) | yes, read+write | yes (subset) |
| Injected | `injected.js` | NotebookLM page (MAIN world content script) | yes | no (uses postMessage) |

Why two scripts inside the page: Chrome content scripts run in an isolated JS world and
cannot patch `window.open`. `injected.js` (with `takeout-shared.js`) is a MAIN-world
content script at `document_start` (manifest; `ensureContentScriptLoaded` re-injects it).
It intercepts a download URL **only when armed**: `content.js` dispatches the DOM event
`nlme-arm-intercept` right before its own Download click (`NLME.createInterceptArm`, 3 s,
consumed by the first match), so the user's own downloads are never touched. It posts
`NLME_DOWNLOAD_URL_INTERCEPTED` `{url, timestamp}`; content accepts only URLs captured
after its click (`NLME.pickFreshIntercept`).

Sidebar talks to content via `chrome.tabs.sendMessage(tabId, {type, data})`. Content responds
synchronously (sendResponse) or asynchronously (`return true` in the listener and call
sendResponse later).

## File map with line counts

```
notebooklm-exporter/
├── manifest.json           — V3 manifest, permissions, side_panel, content_scripts
├── takeout-shared.js (488) — Selectors + DOM-free helpers (NLME global); content script,
│                             sidebar, service worker (importScripts) and Node tests load it
├── tests/                  — node:test unit tests for takeout-shared.js
├── sidebar.html  ( 423)    — Side panel UI: tabs, controls, settings/health panels
├── sidebar.js    (6404)    — UI logic, export orchestration, KaTeX, mindmap helpers
├── styles.css    (1635)    — Side panel styles
├── content.js    (5042)    — DOM scraping + extraction, runs on NotebookLM
├── mindmap-extract.js (325) — Mind map SVG/tree extraction; content script and injected
│                             by background into the *.scf.usercontent.goog app frame
├── content-styles.css (57) — Page overlay styles (export progress overlay)
├── background.js (1186)    — Service worker, download interception, batch ZIP, frame extraction
├── injected.js   (  68)    — MAIN-world download hook (window.open + link clicks), armed per click
├── mindmap-template.html (371) — Standalone interactive mindmap viewer (used as template)
├── jszip.min.js  (  12)    — Bundled JSZip
├── turndown.min.js (973)   — Bundled Turndown (HTML → Markdown)
├── icons/                  — 16/48/128 PNG icons
├── docs/                   — Misc internal notes (untracked locally)
├── README.md               — User-facing docs (features, usage, settings, troubleshooting)
├── CHANGELOG.md            — Not maintained; use git log
├── popup.html.backup       — Tracked leftover from the pre-side-panel popup
└── TECHNICAL.md            — Untracked earlier deep dive; partly superseded, cross-check
```

`sidebar.js` and `content.js` are the two real surfaces of work. Almost every change touches
one or both. Use grep extensively. Useful anchors:

Line numbers drift with every change, so anchors are names: `grep -n "<name>" <file>`.

| What | Where (grep for) |
|---|---|
| Settings defaults | `let settings = {` in sidebar.js |
| `loadSettings` / `saveSettings` | sidebar.js |
| Tab switching | `setupTabSwitching` (sidebar.js) |
| KaTeX converter (shared) | `convertKatexNodeToLatex`, `katexRenderInline` (sidebar.js) |
| Per-item artifact download | `async function downloadArtifact` (sidebar.js) |
| Sources / Notes / Chat export | `exportSources`, `exportNotesAsMarkdown`, `createNotesZip`, `exportChat`, `convertChatToMarkdown` (sidebar.js) |
| Note Markdown (citations, Sources section) | `function convertToMarkdown` (sidebar.js) |
| Studio tab | `scanStudioPage`, `handleStudioDownloadRow`, `exportSingleNote` (sidebar.js) |
| Content message dispatcher | `chrome.runtime.onMessage.addListener` near the top of content.js |
| Note extraction | `extractNoteContent`, `extractTailwindNoteContent`, `extractSourcesPanelNote` (content.js) |
| Citation hover | `extractSingleCitationWithRetry` (content.js) |
| Chat scan | `scanChat`, `autoScrollChatToTop`, `expandCollapsedCitations` (content.js) |
| Artifact download | `handleArtifactDownload`, `findDownloadButton`, `getArtifactItemsWithMore` (content.js) |
| Studio scan / delete | `scanStudioItems`, `deleteStudioItem`, `findMenuItemByText`, `findConfirmDialogButton` (content.js) |
| Viewer closing | `closeStudioViewer`, `closeSourceViewer`, `findStudioHeaderCloseButton` (content.js) |
| Health check | `runComprehensiveHealthCheck`, `checkProjectTitleHealth` (content.js) |
| Mind maps | `mindmap-extract.js`; `extractMindmapFromAppFrame` (background.js) |
| Batch ZIP | `runBatchDownload`, `createZipFromFiles` (background.js) |

## Settings shape and storage

Storage: `chrome.storage.local`, single key `settings`. Defaults in `let settings = {` (sidebar.js):

```js
{
  // Behavior
  autoZip: false,                            // default Artifacts ZIP toggle to on
  showNotifications: true,                   // toast on download completion
  refreshInterval: 10,                       // seconds, auto-refresh in artifacts tab

  // Source export variants (any combo, ≥1 required)
  exportSourceBase: true,                    // base, no metadata, no images
  exportSourcePlusMeta: true,                // + AI summary & key topics
  exportSourceWithImages: false,             // base + base64 images
  exportSourcePlusMetaWithImages: false,     // metadata + images
  sourcesPerZip: 25,                         // batch size

  // Note export variants (any combo, ≥1 required)
  exportNoteBase: true,                      // markdown-citation format
  exportNoteCodeBlocks: true,                // citations rendered as code blocks
  exportNoteWithImages: false,               // base + embedded images
  exportNoteCodeBlocksWithImages: false,
  notesPerZip: 25,

  // Text cleanup
  cleanOCRArtifacts: true,                   // scrub ~~~, :~:, etc. from quotes

  // Interface
  showStudioTab: false,                      // gate the optional Studio tab

  // Downloads
  slidesFormat: 'pdf',                       // 'pdf' | 'pptx' — slide deck More-menu item
}
```

Migration helpers run in `loadSettings` for two renames done in earlier versions
(`citationsCodeBlock` → `exportNoteCodeBlocks`, `includeCitationImages` →
`exportNoteWithImages`, `includeSourceMetadata` → `exportSourcePlusMeta`,
`exportWithImagesVersion` → `exportSourceWithImages`). Two legacy keys are *also* set on the
in-memory object (`settings.citationsCodeBlock`, `settings.includeCitationImages`) because
chat export code reads them. Update both halves if you touch this.

Adding a new boolean setting:

1. Add field to the `let settings = {` defaults object in sidebar.js.
2. Add `<input type="checkbox" id="{name}-checkbox">` inside the appropriate
   `.setting-section` in `sidebar.html`.
3. Read in `loadSettings`: `document.getElementById('{name}-checkbox').checked = settings.{name};`
4. Write in `saveSettings`: `settings.{name} = document.getElementById('{name}-checkbox').checked;`
5. Reference where consumed.

Parent/child checkbox dependencies (e.g. "with images" disabled when base is off) are set up
in `setupEventListeners` (`sourceParentChildPairs` / `noteParentChildPairs`).

## Tab system

Five tabs: `sources`, `notes`, `artifacts`, `chat`, `studio` (the last hidden by default).

Markup (`sidebar.html`):

```html
<div class="tabs">
  <button class="tab-btn active" data-tab="sources">Sources</button>
  <button class="tab-btn" data-tab="notes">Notes</button>
  <button class="tab-btn" data-tab="artifacts">Artifacts</button>
  <button class="tab-btn" data-tab="chat">Chat</button>
  <button class="tab-btn" data-tab="studio" hidden>Studio</button>
</div>

<div class="tab-content" data-tab-content="{name}">...</div>
```

Wiring is in `setupTabSwitching` (sidebar.js). Each button toggles the `.active` class on
itself + the matching `.tab-content`, then calls the relevant scan:

```js
if (targetTab === 'notes')        await scanNotesPage();
else if (targetTab === 'artifacts') await scanPage();
else if (targetTab === 'sources') await scanSourcesPage();
else if (targetTab === 'studio')  await scanStudioPage();
// chat: manual via Scan Chat button
```

Studio visibility is gated by `settings.showStudioTab`. `applyStudioTabVisibility()` toggles
the `hidden` attribute on both the tab button and the tab-content, and falls back to Sources
if Studio was active when disabled. Called from `loadSettings` and `saveSettings`.

## Message protocol

All `chrome.tabs.sendMessage` payloads use the shape `{type, data?}`. Content handlers either
respond synchronously (and `return true` is omitted) or asynchronously (must
`return true` from the listener and call `sendResponse` later).

### Sidebar → content (dispatcher: `chrome.runtime.onMessage.addListener` in content.js)

| Type | Data | Returns |
|---|---|---|
| `PING` | — | `{success: true}` |
| `GET_PROJECT_NAME` | — | `{projectName}` (used for filenames) |
| `TRIGGER_DOWNLOAD` | `{artifactType, artifact}` | `{success}` |
| `DEBUG_PAGE` | — | dumps DOM structure to console |
| `SCAN_ARTIFACTS` | — | `{success}` only (legacy; the polling scan was removed Nov 2026) |
| `FETCH_FILE` | `{url}` | `{success, content?}` — fetches with page credentials |
| `EXTRACT_NOTE` | `{noteIndex, noteTitle, sourceIndex?, includeCitationImages}` | `{html, sources, errors}` or `{isMindmap, svgContent, treeData}`. With `sourceIndex` the note is opened from the Sources panel "Notes" group |
| `SCAN_NOTES` | — | `{notes: [{index, title, type, iconType, sourceIndex?}]}` — Sources-panel notes have `index: -1`, `type: 'Note (Sources panel)'` |
| `SCAN_SOURCES` | — | `{sources, skippedNotes}` — Sources-panel notes are skipped |
| `EXTRACT_SOURCE` | `{sourceIndex, title, needsGuide}` | `{html, sources, title, ..., timing}` — `title` is checked strictly (`Item changed`); the guide/summary wait runs only with `needsGuide` |
| `REQUEST_EXPORT_CANCEL` | — | `{success}` — side panel Cancel: sets the content cancel flag and broadcasts `CANCEL_EXPORT` |
| `NAVIGATE_BACK` | — | `{success}` — closes open note/source viewer |
| `SHOW_EXPORT_OVERLAY` | `{message}` | `{success}` — page overlay on NotebookLM |
| `UPDATE_EXPORT_OVERLAY` | `{message, progress}` | `{success}` |
| `HIDE_EXPORT_OVERLAY` | — | `{success}` |
| `CHECK_EXPORT_CANCELLED` | — | `{cancelled}` |
| `DEBUG_NOTES` | — | diagnostic — list of titles |
| `DOWNLOAD_ARTIFACT` | `{artifactIndex, artifactType, artifactName, skipMoreButton, downloadPreference}` (content resolves the row strictly by title and clicks its own More button) | `method`: `content_extraction` / `mindmap_extraction` / `mindmap_app_frame` / `url_intercepted` / `button_click` / `svg_extract` / `canvas_export`. `artifactIndex` = index among `artifact-library-item`s with a More button |
| `SCAN_CHAT` | — | `{notebookTitle, notebookSummary, messagePairs, dateRange}` |
| `EXTRACT_ALL_CHAT_CITATIONS` | — | `{sourcesByIndex, errors}` |
| `EXTRACT_MESSAGE_CITATIONS` | `{messageIndex, messageHTML, sourceIndices, includeCitationImages}` | `{sourcesByIndex, errors}` |
| `CHECK_DOM_HEALTH` | `{type: 'notes'\|'sources'\|'artifacts'\|'chat'}` | `{healthy, issues, trackerIssues}` |
| `GET_DOM_ERRORS` | — | `{shouldWarn, issues}` |
| `RESET_DOM_TRACKER` | — | `{success}` |
| `RUN_COMPREHENSIVE_HEALTH_CHECK` | `{fastMode, skipCitations}` | full results object |
| `SCAN_STUDIO_ITEMS` | — | `{items: [{combinedIndex, kindIndex, moreIndex, kind, label, type, details, downloadable, hasMoreButton}]}` — also feeds the Artifacts tab |
| `DELETE_STUDIO_ITEM` | `{label?, combinedIndex?}` | `{success, error?}` |

### Sidebar → background (`background.js`)

| Type | Purpose |
|---|---|
| `SET_PENDING_DOWNLOAD` | Tell background to rename the next `chrome.downloads.onCreated` event |
| `START_INTERCEPT_DOWNLOAD` | Enter intercept mode (capture URL, suppress tab) |
| `GET_INTERCEPTED_DOWNLOAD` | Read the captured intercept result |
| `CANCEL_INTERCEPT` | Exit intercept mode (extraction succeeded another way) |
| `START_BATCH_DOWNLOAD` | Begin batch capture for ZIP packaging |
| `END_BATCH_DOWNLOAD` | Stop batch capture |
| `GET_CAPTURED_DOWNLOAD` | Pull a captured URL out of batch state |
| `FETCH_FILE_CONTENT` | Fetch a URL with credentials (background context) |
| `BATCH_DOWNLOAD_ALL` | Dispatch a batch ZIP build (`{tabId, items, downloadPreference}`) |
| `CANCEL_BATCH_DOWNLOAD` | Stop the batch between items |
| `EXTRACT_MINDMAP_FRAME` | Inject `mindmap-extract.js` into the mind map app iframe, extract, close viewer |
| `GET_BATCH_STATUS` | Poll batch progress |
| `DIRECT_DOWNLOAD_URL` | Hand a finalised URL + filename to background to call `chrome.downloads.download` |
| `ARTIFACT_DETECTED` / `GET_ARTIFACTS` / `CLEAR_ARTIFACTS` | Legacy `capturedArtifacts` map. Nothing sends `ARTIFACT_DETECTED` since the polling scan was removed; the map is cleared at startup |

### Page-world → content (via `window.postMessage`, in `injected.js`)

- `NLME_DOWNLOAD_URL_INTERCEPTED` — content listens for this and forwards to background.
  This is the only page-world message; the old API-response capture was removed.

## Export pipelines (deep)

### Sources

1. `scanSourcesPage` → message `SCAN_SOURCES` → content lists `.single-source-container`.
2. User picks rows → `exportSources(selectedSources)`.
3. For each source, message `EXTRACT_SOURCE` with index → content clicks source button,
   waits for `labs-tailwind-doc-viewer`, scrapes content + guide markdown + key topics.
4. Sidebar produces 1–4 variants per source based on `settings.exportSource*`:
   - base.md, plus-meta.md, with-images.md (only if source has images), plus-meta-with-images.md
5. ZIPs are batched (`sourcesPerZip`, default 25) with a `_README.md`, `_index.md`, and
   `errors.txt` if any.
6. Download via JSZip → `URL.createObjectURL` → `<a download>` click → `URL.revokeObjectURL`.
7. NAVIGATE_BACK between sources to close the viewer.

### Notes

1. `scanNotesPage` → `SCAN_NOTES` → content returns notes from the Studio list
   (`artifact-library-note`, icon in `NLME.NOTE_ICONS`) plus Sources-panel notes
   (`index: -1`, `sourceIndex`). Mind maps are Studio artifacts now (Artifacts tab).
2. `exportNotesAsMarkdown(selected)`:
   - Pre-flight: `CHECK_DOM_HEALTH` with type=notes; if unhealthy, show warning dialog.
   - Show page overlay (`SHOW_EXPORT_OVERLAY`).
   - Batch loop (`notesPerZip` chunks).
   - For each note, `EXTRACT_NOTE` → content:
     - Closes any open viewer first (`closeStudioViewer`: header close button, then
       "Close note view", then Escape).
     - Resolves the note with `NLME.pickByIndexThenTitle` (scanned index while its title
       still matches, else the first title match), so duplicate titles export correctly.
       With `sourceIndex` it opens the note from the Sources panel instead.
     - Clicks the note button, races viewer wait for `rich-text-editor .ql-editor` |
       `rich-text-editor .ProseMirror` | `markdown-editor-legacy .ql-editor` |
       `labs-tailwind-doc-viewer` | `mindmap-viewer`. **Scoped to `<studio-panel>`** —
       essential to avoid hitting the chat panel's own `labs-tailwind-doc-viewer`.
     - If mindmap-viewer → `extractMindmapSVG`. Else if labs-tailwind → `extractTailwindNoteContent`
       (citation hover loop). Else raw HTML.
   - `NAVIGATE_BACK` after each note; 3s settle between iterations.
3. Per batch, `createNotesZip` produces 1–4 markdown variants per note (mirroring the
   source variants), de-duplicating filenames, + mindmap bundles (`mindmaps/` folder) for
   any legacy in-page mind map notes.
4. `convertToMarkdown` keeps NotebookLM's citation numbers, renumbers anchor occurrences
   in document order (`NLME.renumberCitationAnchors`, because the list rule converts each
   `<li>` twice), and builds the Sources section with `NLME.buildCitationEntries`.
   Reports and source content pass `citationPlaceholders = false`.
5. ZIP names: `{project-name}-notes-{timestamp}[-partNofM].zip`.

### Chat

1. `scanChatPage` → `SCAN_CHAT` → content extracts:
   - Notebook title via `.title-label-inner` and 4 fallback selectors (was `.notebook-title`,
     stale).
   - Notebook summary (`.notebook-summary .summary-content`).
   - All `.chat-message-pair` elements, with date separators and user/AI containers.
   - Before extracting, `autoScrollChatToTop` loads the whole history and
     `expandCollapsedCitations` opens collapsed citation groups. It clicks only groups
     where `NLME.isCollapsedCitationGroup` is true: an open group's button reads "Hide
     additional citations" (`unfold_less`), and clicking it would close the group again
     (this lost ~250 citations on a second scan before Nov 2026). Up to 3 passes, re-scanned.
2. `exportChat(chatData, extractFullCitations)`:
   - Optionally calls `EXTRACT_MESSAGE_CITATIONS` per message to populate quote text: one
     hover per distinct citation number per answer (~1,400 for a 219-message chat).
   - `totalCitationsFound` counts numbered markers only (not group buttons).
   - `convertChatToMarkdown` builds the final markdown using Turndown with chat-specific
     rules (`addChatTurndownRules`).
   - Produces up to 4 variants based on Note settings, plus an `errors.txt` and `_index.md`.
   - ZIP name: `{project-title-sanitized}-chat-{timestamp}.zip`.

Citation handling in chat uses message-scoped anchors: `msg-{i}-cite-ref-{n}-{k}` →
`#msg-{i}-src-{n}`, back-links to `msg-{i}-cite-ref-{n}-1`. Each answer is renumbered with
`NLME.renumberCitationAnchors` and has its own `**Sources:**` block. Citation numbers restart
in every answer, so sources must never be keyed by number across answers.

### Artifacts

1. `scanPage` (artifacts) sends `SCAN_STUDIO_ITEMS` and keeps `kind === 'artifact'`
   rows (`index` = `moreIndex`). Flashcards and Quiz rows are disabled (no Download).
2. Type = `NLME.resolveArtifactType({iconText, buttonLabel})`: the stretched button's
   aria-label when it names a type ("Data Table", "Report", …; "Artifact" is ignored),
   else the icon:
   ```
   auto_tab_group → Report            tablet → Slides
   stacked_bar_chart → Infographic    table_view / format_list_bulleted → Data Table
   flowchart → Mind Map               headphones / audio_magic_eraser / audio_spark → Audio Overview
   videocam → Video Overview          copy → Flashcards (not downloadable)
   quiz → Quiz (not downloadable)
   ```
3. Each row renders with a per-item Download button. Bulk: `Download All` with optional ZIP
   toggle.
4. `downloadArtifact(tabId, artifactIndex, artifactType, artifactName)` (sidebar.js):
   - **Reports / Data Tables**: skip More button. Message `DOWNLOAD_ARTIFACT` with
     `skipMoreButton: true`. Content opens the item (`resolveArtifactItem`) and extracts
     HTML. Reports → Markdown (no citation placeholders). Tables → ZIP with CSV, JSON, HTML
     and footnotes.
   - **Mind maps**: content opens the item in `artifact-viewer`. If it renders in the
     sandboxed `app-viewer iframe` (`*.scf.usercontent.goog`), content returns
     `method: 'mindmap_app_frame'` and the sidebar asks background `EXTRACT_MINDMAP_FRAME`
     (see [Mindmap extraction](#mindmap-extraction)). Output: ZIP with SVG, JSON, HTML.
   - **Slides**: the More menu offers PDF and PowerPoint; `findDownloadButton` picks via
     `NLME.pickDownloadMenuIndex(labels, settings.slidesFormat)`.
   - **Others**: enter intercept mode preemptively, then message content, which resolves
     the row by title (`NLME.pickByIndexThenTitleStrict`), clicks its More button, arms the
     hook and clicks the "Download" menu item.
     The click triggers NotebookLM's `window.open(googleusercontent...)`. `injected.js`
     intercepts, sends URL back via `NLME_DOWNLOAD_URL_INTERCEPTED`. Sidebar then routes
     through background's `DIRECT_DOWNLOAD_URL` to call `chrome.downloads.download` with
     the proper filename. The extension comes from the URL's `filename` parameter
     (`NLME.extensionFromDownloadUrl`; `.pptx` vs `.pdf`). A download that is never captured
     now fails ("Download was not captured") instead of reporting success.
   - **Download All, ZIP off**: saves every file into `Downloads/<Notebook>/`
     (`activeDownloadFolder`, `NLME.downloadFolderPath`); no size limit.
   - **Download All, ZIP on**: background `runBatchDownload` builds the ZIP with JSZip
     (`importScripts`), with `errors.txt`; `GET_BATCH_STATUS` returns the final `result`.
     Everything is held in service-worker memory, so a whole notebook with audio/video
     overviews can exceed it; use folder mode for full exports.
   - Extension-started downloads (blob/data URLs) register their name first via
     `NAME_NEXT_DOWNLOAD`: Chrome drops the `filename` option while an
     `onDeterminingFilename` listener exists and does not suggest one.

Filename convention: `[{prefix}]_{sanitized-title}.{ext}` where prefix is one of `audio-overview`,
`slides`, `infographic`, `report`, `data-table`, `flowchart`. In the batch ZIP
(`notebooklm-export-{timestamp}.zip`), repeated names get ` (2)`, ` (3)` via
`NLME.uniqueFilenames`.

### Studio (new)

1. `scanStudioPage` → `SCAN_STUDIO_ITEMS` → content walks
   `document.querySelectorAll('artifact-library-item, artifact-library-note')` in DOM order
   and returns unified records.
2. Each record carries:
   - `combinedIndex` — position in the combined DOM walk (stable identifier for delete)
   - `kindIndex` — position within its own kind (`artifact` or `note`)
   - `moreIndex` — index among `artifact-library-item`s that have a More button; this is
     the index every artifact download uses (Artifacts tab, Studio tab, batch)
   - `downloadable` — false for Flashcards / Quiz
   - `kind` — `'artifact'` | `'note'`
   - `label` (title), `details`, `type`, `hasMoreButton`
3. Row Download:
   - `kind === 'artifact'` → `downloadArtifact(tabId, moreIndex, type, label)` (same path
     as Artifacts tab).
   - `kind === 'note'` → `exportSingleNote({index: kindIndex, title: label, type})`.
     - Mindmap path: drops three files via `downloadBlob` blob URLs (`.svg`, `.json`,
       `.html` from `generateMindmapHTML(svgContent, title)`).
     - Note path: produces 1+ markdown variants based on Note settings (full citation
       extraction included, identical to Notes tab output).
4. Row Delete:
   - Sidebar `confirm()` first.
   - Message `DELETE_STUDIO_ITEM` with `{label, combinedIndex}`.
   - Content opens the More menu, calls `findMenuItemByText('delete')`, clicks it.
   - Polls for confirmation dialog via `findConfirmDialogButton` (matches
     `mat-dialog-container`, `[role="dialog"]`, `.cdk-overlay-pane`, prefers cards that
     have both "Cancel" and "Delete" buttons). Auto-clicks the destructive button.
   - Polls for the row to disappear (6s timeout). Succeeds either silently (notes often
     delete with an undo toast) or after dialog confirm.
5. Bulk delete:
   - Snapshots `(label, kind)` per selected row.
   - Iterates; 1s settle between deletes so undo toasts dismiss.
   - Each iteration resolves the target by label only (lossy when names duplicate).

## DOM contract with NotebookLM

Selectors are the contract — when they drift, exports break. Treat this section as the source
of truth for "what we assume about the NotebookLM DOM" and update whenever you fix a
selector.

### Layout containers

| Element | Role |
|---|---|
| `chat-panel` | Middle column (chat) |
| `studio-panel` | Right column (notes, mindmaps, audio, slides, infographics, reports, data tables) |
| `.cdk-overlay-container` | Body-attached container for menus, tooltips, dialogs (singleton) |

The studio-panel scope is **critical** for note extraction. Always scope viewer queries to
it — see the [Drift patterns](#drift-patterns-google-has-shipped) section for the chat-panel
shadowing bug.

### Header / project

| Selector | Used for |
|---|---|
| `.title-label-inner` (primary) | Notebook project title (filename prefix) |
| `editable-project-title .title-label span` | Fallback 1 |
| `.title-container .title span` | Fallback 2 |
| `[class*="title-label"]` | Fallback 3 |
| `.notebook-title` | Legacy fallback (last resort) |

### Studio panel items

| Selector | Element type |
|---|---|
| `artifact-library-item` | Audio / slides / infographic / report / data table / flowchart |
| `artifact-library-note` | Notes and mindmaps |
| `.artifact-title` | Title text (titles can repeat — resolve with `NLME.pickByIndexThenTitle`) |
| `.artifact-details` | Subtitle (source count, age) |
| `mat-icon.artifact-icon` | Icon, textContent identifies kind |
| `button[aria-label="More"]` | Per-item three-dot menu |

Icon textContent → kind:
- Notes (inside `artifact-library-note`): `article` (Nov 2026) / `sticky_note_2` → Note.
  Mind maps are now `artifact-library-item`s (`flowchart`), not notes.
- Artifacts (inside `artifact-library-item`): see the [Artifacts pipeline](#artifacts)
  mapping table.

### Viewers (right studio panel)

| Element | Content type | Notes |
|---|---|---|
| `artifact-viewer` | Dialog wrapper for mind maps, reports, tables (Nov 2026) | Mind maps render in `artifact-viewer app-viewer iframe` (`*.scf.usercontent.goog`) |
| `labs-tailwind-doc-viewer` | Tailwind-rendered notes/sources | **Also used by chat — always scope** |
| `rich-text-editor .ProseMirror` | New ProseMirror note editor | Recent migration |
| `rich-text-editor .ql-editor` | Older Quill editor | Still in some accounts |
| `markdown-editor-legacy .ql-editor` | Legacy markdown editor | Very old notes |
| `mindmap-viewer` | Mindmap | Has its own internal structure |
| `report-viewer` | Reports | Click-to-open content, not a wrapper |
| `note-editor` | Note edit shell (contains rich-text-editor) | |
| `table-viewer` | Data tables | |

### Note viewer header (when a note is open)

| Selector | Used for |
|---|---|
| `studio-panel note-editor` | Detect "viewing a note" state |
| `input.note-header__editable-title` | Note title |
| `button[aria-label="Close note view"]` | Close button (used by NAVIGATE_BACK) |
| `section.studio-panel .panel-header button[aria-label^="Close"]` | **Studio viewer close (Nov 2026)**, outside `<studio-panel>`. Labels: "Close web page viewer", "Close report viewer", "Close table", "Close note view". Never click "Collapse studio panel". Escape no longer closes viewers |

### Citations

| Selector | Element |
|---|---|
| `button.citation-marker` (class `chat-bidi-enabled`, no `ng-star-inserted` since Nov 2026) | Citation marker (the "[1]" buttons) |
| Inner `span[aria-label="1: Source title"]` | Citation number text + source-title aria |
| Inner `mat-icon` `more_horiz` / aria "Show additional citations" | Collapsed group: click to open (`NLME.isCollapsedCitationGroup`) |
| Inner `mat-icon` `unfold_less` / aria "Hide additional citations" | Open group: never click. Both states are excluded from citations by `NLME.isCitationExpander` |
| `NLME.CITATION_TOOLTIP_SELECTOR` | Hover tooltip: `.cdk-overlay-pane.citation-tooltip-panel` > `nb-popover-container` > `div.popover-card[aria-label="Citation Details"]` (Nov 2026); legacy `xap-inline-dialog-container[role="dialog"]` |
| `.citation-tooltip-header` | Source title in tooltip |
| `.citation-tooltip-text` | Quote: `div.paragraph` children or `labs-tailwind-structural-element-view-v2` wrappers (both seen) |
| `.citation-tooltip-footer` | "View source" button |
| `.mat-mdc-menu-panel` / `.cdk-overlay-pane` | Open menu / popup overlay |

### Chat

| Selector | Used for |
|---|---|
| `chat-panel .chat-panel-content` | Chat scroll area |
| `.chat-message-pair` | Each Q/A pair |
| `.from-user-container .message-text-content` | User message |
| `.to-user-container .message-text-content` | AI response |
| `.date-separator` | Date headers between messages |
| `button.citation-marker` (inside chat) | Chat citations (shared selector with notes) |

### Formulas (KaTeX)

| Selector | Used for |
|---|---|
| `span[data-math]` (host of `.katex`) | **Original LaTeX** written by the model (Nov 2026). Exported verbatim |
| `annotation[encoding="application/x-tex"]` | KaTeX's own LaTeX copy. Absent on Gemini Notebook today |
| `.katex-display` | Display math → `$$…$$` |
| `.katex-html` | Rendered layout; only used by the fallback rebuild |
| `katex-base` / `katex-strut` / `katex-sizing` | Gemini's prefixed spellings of KaTeX's `base` / `strut` / `sizing` |

### Sources panel

| Selector | Used for |
|---|---|
| `.single-source-container` | Each source row |
| `mat-expansion-panel.notes-category-panel` | "Notes" group inside the Sources panel (Nov 2026). Its rows are notes (open `note-editor`), not in the Studio list — `isNoteSourceContainer` |
| `.scroll-area-desktop` | Scroll container (used in DOM health check) |

### Studio item more-menu items

The "Delete note?" popup is a **custom card** rendered inside `.cdk-overlay-pane`, not a
`mat-dialog-container`. Detection must cover both shapes — see `findConfirmDialogButton`.

## Citation hover protocol

Reading citation source + quote text requires hovering each marker and scraping the tooltip.
The tooltip is a singleton attached to `.cdk-overlay-container`. Multiple hovers race.

Single citation flow — `extractSingleCitationWithRetry`, the only hover routine (notes,
chat-wide and per-message chat extraction all call it):

```
1. scrollIntoView({behavior: 'instant', block: 'center'})
2. dispatch mouseenter + pointerenter (non-bubbling) — opens the popover
3. waitForElement(NLME.CITATION_TOOLTIP_SELECTOR)
4. Wait for opacity > 0.5 AND .citation-tooltip-text content
5. Read .citation-tooltip-header → source title, .citation-tooltip-text → quote markdown
6. dispatch mouseleave + mouseout
7. Wait until NLME.CITATION_TOOLTIP_SELECTOR matches nothing (100 ms × 20) — prevents
   the next citation reading the previous quote
```

Markdown keeps NotebookLM's citation numbers; `NLME.buildCitationEntries` builds the
Sources section from extracted sources plus a placeholder for markers that failed, and
`NLME.renumberCitationAnchors` makes occurrence anchors (`-1`, `-2`, …) follow document
order so every back-link resolves.

The page already holds every citation's text: hovering only renders the popover, and the
popup triggers Google analytics calls (`play.google.com/log`) that may be blocked locally.
No Gemini Notebook data request is made per hover.

Common failures:
- Tooltip never appears → marker is in a collapsed group. `expandCollapsedCitations` opens
  them during the chat scan; only click `NLME.isCollapsedCitationGroup` buttons.
- Tooltip appears but is empty → race; retry with longer wait (already 600ms ceiling).
- Tooltip from a previous hover persists → next hover's data is wrong. The close-wait at
  step 7 is the only thing preventing this.

`DOMHealthTracker` (in content.js) accumulates failures over an export — if too many, the
sidebar shows a "DOM may be drifting" warning dialog.

## KaTeX → LaTeX conversion

Entry point: `convertKatexNodeToLatex(node)` (sidebar.js). Called from two
Turndown rules (notes/sources rule and chat rule), both filter on
`SPAN.classList.contains('katex')`.

```
1. Exact source via NLME.mathSourceToMarkdown(): the host span's data-math
   (Gemini Notebook keeps the model's original LaTeX there, Nov 2026), else
   <annotation encoding="application/x-tex">. Verbatim. Done.
2. Otherwise, walk .katex-html recursively via katexRenderInline(el).
   Best effort: cannot recover \text{}, matrices, alignments exactly.
3. If walker returns empty, last-resort: textContent + unicodeToLatex map.
```

Gemini prefixes some KaTeX classes: `katex-base`, `katex-strut`, `katex-sizing`
(Nov 2026). The walker accepts both spellings.

`katexRenderInline` handles, by KaTeX class:

| Class | Handling |
|---|---|
| `strut` / `katex-strut` / `pstrut` / `vlist-s` | Skip (spacing artifacts) |
| `mfrac` | `\frac{num}{den}` — sub-render each from `.vlist` children by `top` |
| `sqrt` | `\sqrt{radicand}` |
| `mop` (named function) | `\ln` / `\log` / `\sin` / `\cos` / `\tan` / `\exp` / `\lim` / `\max` / `\min` / + 24 others |
| `mop` (big op) | `\sum` / `\int` / `\prod` (detected by Unicode symbol) |
| `mop.op-limits` | Big op with stacked limits → `\sum_{lo}^{hi}` (sub-render via `katexRenderOpLimits`) |
| `mbin` / `mrel` | Binary operator / relation → `unicodeToLatex(textContent)` with surrounding spaces |
| `mopen` / `mclose` | Parens, brackets → preserve textContent. If wraps `+msupsub`, recurse |
| `mpunct` | Commas, periods → preserve textContent |
| `mord` / `minner` | Variable / number. Recurse if it has a `.msupsub` child or wraps `.mfrac` / `.sqrt` |
| `mspace` | Single space |
| `msupsub` | Sub/super attached to previous atom. Two scripts: more negative `top` = sup. One script: `top + pstrut height` < 0 = sup (`NLME.classifyKatexScript`) |
| `base` / `katex-base` | Recurse |

`KATEX_UNICODE_MAP` covers 47 symbols (Greek, set theory, logic, arrows, basic ops). Single
source of truth for both Turndown rules.

When you see math export quality issues, the order of operations to debug:

1. Run 🩺: "Formulas carry LaTeX source" should be `[OK] n/n`. If so, the export copies
   `data-math` verbatim; compare with
   `[...document.querySelectorAll('.katex')].map(k => k.closest('[data-math]')?.dataset.math)`
   in the page console. Mismatches are escaping/whitespace issues in the Turndown rule.
2. If it is `[WARN]`, the reconstruction walker is responsible. Trace `katexRenderInline`
   for the offending span. It needs module scope, so paste the KaTeX section of sidebar.js
   into the page console (with an `NLME` stub) and run it on the live node.
3. Add a new handler class or extend `KATEX_UNICODE_MAP`. Lone sub/superscripts are
   classified by `NLME.classifyKatexScript` (`top + pstrut height`).

## Mindmap extraction

Since Nov 2026 mind maps are Studio artifacts (`flowchart` icon) that open in
`artifact-viewer`, usually inside a sandboxed `app-viewer iframe` on
`*.scf.usercontent.goog`. The content script cannot reach into that frame, so:

1. `handleArtifactDownload` opens the item and returns `method: 'mindmap_app_frame'`.
2. The sidebar (or `runBatchDownload`) sends `EXTRACT_MINDMAP_FRAME` to background.
3. `extractMindmapFromAppFrame(tabId)` injects `mindmap-extract.js` into all frames
   (`chrome.scripting.executeScript`, `allFrames: true`; needs the
   `*.scf.usercontent.goog` host permission), runs the extractor in the frame that has the
   map, then closes the viewer.
4. Mind maps rendered in the page itself (`mindmap-viewer`) still use the same extractor
   directly (`method: 'mindmap_extraction'`).

`mindmap-extract.js` defines `extractMindmapSVG(mindmapViewer)` (guarded by
`globalThis.__nlmeMindmap`, so re-injection is safe). Steps:

1. Find expand-all button (`button[mattooltip*="Expand all"]` |
   `button.expand-collapse-all-button-bottom` | `button[aria-label*="Expand all"]`).
   Click it. Wait for node count to stabilize (poll every 300ms × 20, exit after 3
   consecutive equal counts).
2. Iterate `g.node[role="treeitem"][aria-expanded="false"]`, dispatch click on the inner
   `circle` and also on the node itself (some renders only respond to one). 300ms between.
3. Second pass for nested collapsed nodes.
4. Clone the SVG (`mindmapViewer.querySelector('svg').cloneNode(true)`).
5. Copy computed styles inline on every `<text>` element so the saved SVG renders without
   depending on Google's CSS. Properties copied: `font-family`, `font-size`, `fill`,
   `text-anchor`, `dominant-baseline`.
6. Extract tree via `extractMindmapTreeData(svg)` (parses node text + parent-child links).
7. Return `{isMindmap: true, svgContent, treeData}`.

`generateMindmapHTML(svgContent, title)` in sidebar.js wraps SVG + tree into a standalone
HTML viewer based on `mindmap-template.html` (pan/zoom, expand/collapse, dark/light theme).
The template uses `{{TITLE}}` and `{{SVG_CONTENT}}` placeholders. `loadMindmapTemplate` is
called once on script init and cached.

## DOM health check

Two flavours:

- **Lightweight pre-export** — `CHECK_DOM_HEALTH` message with `{type}`. Checks 2–5 critical
  selectors per category. Returns `{healthy, issues, trackerIssues}`. Used inline in
  exportNotesAsMarkdown / exportSources to gate exports with a warning dialog.
- **Comprehensive** — `RUN_COMPREHENSIVE_HEALTH_CHECK`, run from the header 🩺 icon.
  Function: `runComprehensiveHealthCheck` (content.js).

Categories (each returns `{healthy, checks: [{name, selector, passed, critical, note, count?}]}`):

| Category | Function | Probes |
|---|---|---|
| `general` | `checkProjectTitleHealth` | Project title selectors; "Studio header close control" (needs an open viewer); "Formulas carry LaTeX source" (`NLME.mathSourceHealth`, `[WARN]` when any formula lacks `data-math`/annotation) |
| `notes` | `checkNotesHealth` | Detects list vs viewer mode, then probes accordingly; "Citation markers parse" in viewer mode |
| `sources` | `checkSourcesHealth` | `.single-source-container` (excluding Sources-panel notes), `.scroll-area-desktop` |
| `chat` | `checkChatHealth` | `chat-panel`, `.chat-message-pair`, user/AI containers |
| `citations` | `checkCitationWorkflow` | Non-destructive hover test against a sample marker |

Citation check can be skipped with `options.skipCitations` or `options.fastMode`.

Each `check` carries `critical` — when false, failures don't propagate to
`overallHealthy = false`. The report labels checks `[OK]`, `[FAIL]` (critical), `[WARN]`
(non-critical with `warning: true`: exports work with reduced fidelity) or `[INFO]`.

When you fix a drift, add a new check here so the next drift surfaces in the panel before
silent breakage. Pattern:

```js
checks.push({
  name: 'Human-readable name',
  selector: '.what-i-queried',
  passed: !!found,
  critical: true,  // false for informational
  note: found ? `Sample: "${textShort}"` : 'Selector missed'
});
```

Then register a recommendation in `runComprehensiveHealthCheck` if the failure should suggest
something specific.

## Studio tab internals

Already covered in [Export pipelines](#export-pipelines-deep), but the wiring:

- HTML: tab button + tab-content panel at the end of `sidebar.html`, both `hidden` by default.
- CSS: `.studio-scan-item`, `.studio-row-check`, `.studio-delete-btn` in `styles.css` near
  the end.
- Sidebar state: module-level `_studioItems = []` and `_studioTabId = null`. Populated by
  `scanStudioPage`. Indexes referenced by `idx` on row buttons; `idx` is the position in
  `_studioItems`, *not* `combinedIndex`.
- Buttons: `scan-studio-btn`, `studio-download-selected-btn`, `studio-delete-selected-btn`
  are wired once in `setupEventListeners`. Per-row buttons (`studio-download-btn`,
  `studio-delete-btn`) are wired inside `renderStudioList` after each scan.

Per-row Download routes to `handleStudioDownloadRow(idx, btn)` which dispatches by kind.
Status is shown via the row's `.download-status` span (⏳ → ✓ / ✗).

## Drift patterns Google has shipped

History of selector/structure changes we've coped with. Each entry says **what changed**,
**how it broke us**, and **how we fixed it**. Patterns repeat — when you see something
similar, look here first.

### 1. Chat panel adopts `<labs-tailwind-doc-viewer>` (Apr–May 2026)

- **Before**: AI chat replies rendered via a different component. Only the open-note viewer
  had a `<labs-tailwind-doc-viewer>` element on screen.
- **After**: Chat AI replies share the same `<labs-tailwind-doc-viewer>` /
  `<element-list-renderer>` / `<labs-tailwind-structural-element-view-v2>` /
  `<button class="citation-marker xap-inline-dialog">` tree.
- **Symptom**: `document.querySelector('labs-tailwind-doc-viewer')` returned the chat one
  (chat-panel is before studio-panel in DOM order). Note exports got chat-side citations
  with sources from the chat history. Citation hovers landed on chat markers.
- **Fix**: scope the wait-race in `extractNoteContent` to `<studio-panel>`. See
  sidebar.js `extractNoteContent` viewer race.

### 2. ProseMirror replaces Quill in note editor (Apr 2026)

- **Before**: Notes opened into `<rich-text-editor>` containing `.ql-editor` (Quill).
- **After**: Some notes (especially newer types) open into `<rich-text-editor>` containing
  `.prosemirror-editor .ProseMirror`.
- **Symptom**: Wait race timed out, exports failed with "Content not found".
- **Fix**: added `'rich-text-editor .ProseMirror'` to the wait race. The downstream `else`
  branch (`content.innerHTML`) handles ProseMirror notes adequately (no citation extraction
  yet — none seen in the wild).

### 3. Notebook title selector breaks (Mar–May 2026)

- **Before**: chat scan used `.notebook-title`.
- **After**: title moved into `.title-label-inner` (with various wrappers). `.notebook-title`
  returns nothing.
- **Symptom**: chat export filenames became `NotebookLM-Chat-chat-{timestamp}.zip` because
  the code fell back to the hardcoded default `"NotebookLM Chat"`.
- **Fix**: chat scan now uses the same selector list as `GET_PROJECT_NAME`. Added to health
  check `general` category.

### 4. Studio item card structure refresh (Apr 2026)

- **Before / after**: `artifact-library-note` card structure unchanged for mindmaps;
  notes regained their existing icons. The change was in the content viewer DOM (see
  #2), not the list cards.

### 5. KaTeX renders without `<annotation>` (May–Jun 2026)

- **Before**: KaTeX nodes carried the MathML annotation with the original LaTeX.
- **After**: HTML-only render — only `.katex-html` is present.
- **Symptom**: Math export degrades to `unicodeToLatex(textContent)` and loses
  parentheses, sub/superscripts, function names.
- **Fix**: full HTML walker `katexRenderInline` with msupsub / mopen / mclose / mpunct /
  named-function handling. Superseded as the main path by `data-math` (#9); the walker is
  now the fallback.

### 6. Citation marker uses `mat-icon` instead of `span` (Apr 2026)

- **Before**: collapsed-citation indicators were `span` with `...` text.
- **After**: `<mat-icon>` with `more_horiz` text (or `aria-label="Show additional citations"`).
- **Fix**: citation processing now matches both.

### 7. Product renamed and domain moved (Aug 2026)

- **Before**: app served from `notebooklm.google.com`, branded "NotebookLM".
- **After**: `notebook.google.com`, branded "Gemini Notebook". The old host 301s to the
  new one. Same Angular build — `labs-tailwind-root`, `mat-*` components unchanged.
- **Symptom**: content script never injected (manifest `matches` missed the new host) and
  every sidebar action showed "Please open NotebookLM first" from the 9 inline
  `tab.url.includes('notebooklm.google.com')` gates.
- **Fix**: `NOTEBOOK_HOSTS` + `isNotebookUrl()` defined per-context in sidebar.js,
  background.js, and content.js; both hosts listed in manifest `host_permissions`,
  `content_scripts.matches`, and `web_accessible_resources.matches`. Download-source
  checks in background.js/injected.js match `'notebook'`, which still substring-matches
  legacy `notebooklm` URLs.
- **Note**: adding `host_permissions` to an installed unpacked extension requires
  toggling it off/on in `chrome://extensions/` — the reload icon alone does not grant them.

### 8. Popover citations, header close, Sources-panel notes (Nov 2026)

- **Changed**: citation markers lost `ng-star-inserted`/`xap-inline-dialog`; the tooltip
  became an `nb-popover` in `.citation-tooltip-panel`; mind maps/reports/tables open in
  `artifact-viewer`, which Escape no longer closes — the close button moved to the Studio
  panel header; notes use the `article` icon; mind maps became Studio artifacts; a "Notes"
  group appeared in the Sources panel; new types Flashcards (`copy`) and Quiz (`quiz`);
  slide decks offer PDF and PowerPoint downloads.
- **Symptom**: notes exported with no citations, viewers stayed open after mind map /
  report / table exports, Sources export timed out on notes, unknown artifact types.
- **Fix**: `takeout-shared.js` selectors/helpers (PR #2).

### 9. Formula source, prefixed KaTeX classes, two-state citation groups (Nov 2026)

Found while checking real exports after #8; the export bugs below predate it.

- **Formulas**: every KaTeX host span carries the model's original LaTeX as `data-math`;
  KaTeX classes `base` / `strut` / `sizing` appear as `katex-base` / `katex-strut` /
  `katex-sizing`. The walker had turned fractions into `1−p1` (it read a `mord > mfrac`
  wrapper's flat text) and lone subscripts into superscripts (`top < -1` ignored the
  pstrut). **Fix**: export `data-math` verbatim (`NLME.mathSourceToMarkdown`); walker fixes
  kept as fallback; health check "Formulas carry LaTeX source".
- **Citation groups**: an opened group's button says "Hide additional citations"; the
  expander matched both states, so a second scan closed every group. **Fix**:
  `NLME.isCollapsedCitationGroup`.
- **Back-links**: the list rule re-runs Turndown on each `<li>`, double-counting citation
  occurrences (423 of 1,406 back-links broken). **Fix**: `NLME.renumberCitationAnchors`
  after conversion.

### Spotting drift early

- If every tab says "Please open NotebookLM first" → the host gates are stale; check
  `NOTEBOOK_HOSTS` and the manifest `matches` entries.
- If exports start producing wrong filenames → check the title selector chain
  (`GET_PROJECT_NAME` and `scanChat`).
- If exports fail with "Content not found" → check the viewer wait race in
  `extractNoteContent`.
- If citations are wrong → first run the comprehensive health check; second, inspect the
  open citation tooltip element to see if `.citation-tooltip-header` / `.citation-tooltip-text`
  changed.
- If math is garbled → run 🩺; "Formulas carry LaTeX source" tells you whether `data-math`
  is still present.
- If chat citation counts drop between exports → check the citation group button labels
  ("Show/Hide additional citations").

## Known issues and latent bugs

These are deliberate non-fixes or known limitations. Don't "fix" them without checking the
chat history for context — the fix often introduces a different regression.

### 1. Duplicate-named items: delete still resolves to the first match

Exports are fixed (Nov 2026): notes, reports, tables and mind maps resolve with
`NLME.pickByIndexThenTitle` (scanned index while its title matches, else title).
`deleteStudioItem` / bulk delete still resolve by label, so deleting the second of two
same-titled items hits the first. A fix covering delete was tried in June and **reverted at
the user's request** — re-do only after talking with them.

### 2. Citation extraction limited to Tailwind viewer

`extractTailwindNoteContent` does the citation hover loop. Other viewers (ProseMirror, Quill,
markdown-editor-legacy) fall to the "else" branch (`{html: content.innerHTML, sources: []}`)
with no citation enrichment. Acceptable today because ProseMirror notes seen so far don't
contain `button.citation-marker`. If that changes, mirror the hover loop for ProseMirror.

### 3. Chat citation contamination if studio-panel missing

The `studioPanel || document` fallback in `extractNoteContent` is defensive but means that
if `<studio-panel>` somehow isn't rendered yet, we re-introduce the chat shadowing bug. If
we ever see this in the wild, wait for `<studio-panel>` explicitly before starting the
race.

### 4. Sidebar width fix vs body cap

`body` still has `max-width: 400px` in styles.css. We override it via `.sidebar-mode
{ max-width: none; width: 100%; }`, which works because class specificity > tag specificity
on the same element. If you ever remove the `.sidebar-mode` class from body, the cap
reappears.

### 5. Per-batch bulk delete settle delay is 1s

Set in `handleStudioBulkDelete`. If you see "target not found in fresh scan" warnings under
heavy load, bump to 1500ms.

### 6. ZIP export doesn't fan out per-source for mindmaps when exported via Notes tab

The Notes tab bundles mindmaps inside the `mindmaps/` folder of the notes ZIP. The Studio
tab exports each mindmap as 3 loose files (SVG + JSON + HTML). This asymmetry is intentional
(matches "no ZIP" Studio contract) but worth knowing.

### 7. Flashcards and Quiz are not exportable

They have no Download item in the More menu. They are listed but disabled in the
Artifacts tab. Rows in the Studio tab are still clickable and fail with an error.

### 8. Follow-ups from the PR #2 review (deferred, minor)

- `resolveArtifactItem`'s title fallback only searches items with a More button.
- The source-header close fallback accepts an unlabeled `collapse_content` button.
- The list rule still converts each `<li>` twice; harmless now that anchors are
  renumbered, but any new per-node counter in a Turndown rule will double-count.
- "With images" export variants are byte-identical to the plain ones when no citation has
  images.

### 9. Export pacing

Exports run sequentially with no deliberate pause. Since Milestone 1 every wait is a
condition poll (content text stable, viewer gone, list back) instead of a fixed sleep;
`_index.md` ends with an "Export statistics" block (`NLME.createPhaseTimer`) to measure it.
Text-based readiness matters: a source viewer's shell settles before its text arrives. It makes no extra
data requests per hover, but at that volume it looks automated in Google's UI analytics.
A pause-between-items setting was discussed and not built.

## Recipes

### "A NotebookLM update broke X"

1. Open NotebookLM, run the 🩺 health check from the sidebar header.
2. Look at failures by category. Note the selectors that broke.
3. Find the broken selectors in `content.js` (search for the exact string).
4. Add the new selector to the wait race / query, keeping the old one as a fallback (so
   users on older accounts don't break).
5. Add or update the corresponding check in `runComprehensiveHealthCheck` so future drift
   surfaces.
6. Sanity-test by exporting one item of each affected type.
7. Commit with a message like `Update DOM selectors for {area}` (see `c508bb0` for style).

### "Add a new export setting"

1. Add the default to the `settings` object in sidebar.js.
2. Add the checkbox to the appropriate `.setting-section` in sidebar.html.
3. Add load/save lines in `loadSettings` / `saveSettings`.
4. Reference where the setting affects behavior.
5. Bonus: if it gates a UI element's visibility, add a helper like `applyStudioTabVisibility`
   and call from both load and save.

### "Add a new export pipeline / file type"

1. Add a detection function in content.js (`scanForX`) and a message type
   (`SCAN_X`/`EXTRACT_X`).
2. Wire the message in the content-script dispatcher.
3. Add a tab in sidebar.html OR add a row type in Studio's `scanStudioItems`.
4. Add the orchestrator in sidebar.js (`exportX(selected)`).
5. Add health-check probes for the new selectors.
6. Test from a clean reload.

### "Convert a new math/HTML pattern"

Only needed when 🩺 shows formulas without `data-math`; otherwise the source is copied.

1. Find a representative DOM example, paste it into a scratch file.
2. Add a class handler in `katexRenderInline` (or whichever Turndown rule is responsible).
3. Add unicode mappings to `KATEX_UNICODE_MAP` if needed.
4. Verify by exporting the source/note that contains the pattern, open the resulting
   `.md` file.

### "Add a new menu action to studio rows (like Convert to Source)"

1. The menu options listed by NotebookLM are: Convert to source, Convert all notes to
   source, Export to Docs, Export to Sheets, Delete (and Download for non-notes).
2. To add (for example) a "Convert to source" button: use the existing
   `findMenuItemByText('convert to source')` pattern in content.js.
3. Add a new message type (e.g. `CONVERT_STUDIO_ITEM_TO_SOURCE`) following the
   `DELETE_STUDIO_ITEM` pattern.
4. Wire a UI button in the Studio row template (sidebar.js `renderStudioList`).
5. Mirror the confirm flow if NotebookLM shows a confirmation dialog for that action.

### "Diagnose: an export hangs"

1. Open DevTools on the NotebookLM tab → Console. Look for the last `[NotebookLM Takeout]`
   log line.
2. The most common hang is the viewer wait-race timing out. Check whether
   `<studio-panel>` exists in the DOM and whether one of the viewer elements is inside it.
3. The second most common is a citation hover never resolving — check whether
   `NLME.CITATION_TOOLTIP_SELECTOR` (`.citation-tooltip-panel`) ever appears.
4. Cancel the export via the on-page overlay's Cancel button to recover state.

### "I want to test against the latest NotebookLM without affecting prod"

There is no "prod"; the extension is sideloaded. Use a separate Chrome profile if you want
to keep your real notebook untouched while iterating.

## Testing and verification

Unit tests cover the DOM-free helpers in `takeout-shared.js` (76 tests, `node --test
tests/`). Everything that touches the page is verified in Chrome. When a fix is DOM-only,
verify it live: replicate the changed function in the page console (via Claude in Chrome
or DevTools) and compare before/after on real elements, then confirm with a real export.

Export checks that catch real bugs (scripted against the unzipped export):
- every `href="#…src-N"` has a matching `<a id>`, and every Sources back-link
  (`#…cite-ref-N-1`) has a target;
- no duplicate anchor ids, no empty quotes, no repeated quote within one answer;
- formula count equals `.katex` count on the page, and each formula equals its `data-math`;
- chat citation total equals the numbered `button.citation-marker` count after expansion.

### Smoke check (after any non-trivial change)

1. Reload extension.
2. Open a notebook with: a regular note, a mindmap, a source, an artifact (any kind), and
   some chat history.
3. Run the 🩺 health check. All categories should pass.
4. Export one source. Open the resulting `.md`, confirm content + citations look right.
5. Export one note (Notes tab). Confirm `.md` has citations and `## Sources` block.
6. Export one mind map (Artifacts tab). Confirm the ZIP has SVG + JSON + HTML and the
   viewer closed.
7. Export one artifact of each type. Confirm files land with correct prefix and extension.
8. Export chat. Confirm filename uses the real project title.

### Studio tab check (when touching Studio code)

1. Enable Show Studio tab in Settings.
2. Switch to Studio → Scan Studio. Confirm the list mirrors NotebookLM's right column.
3. Row download for each kind: artifact, note, mindmap.
4. Row delete on a disposable note. Confirm the sidebar confirm appears, NotebookLM's
   dialog auto-confirms, the row disappears, and the rescan completes.
5. Bulk select 2–3 items → Download Selected. Confirm sequential downloads with status.
6. Bulk delete 2–3 items. Confirm 1s settle delay between deletes.
7. Disable Show Studio tab. Confirm the tab disappears and a non-studio tab activates.

### Syntax and unit tests

```bash
for f in sidebar.js content.js background.js injected.js mindmap-extract.js takeout-shared.js; do node --check "$f"; done
node --test tests/
```

`node --check` prints nothing and exits 0; `node --test` reports `# fail 0`.

## Conventions in this codebase

- **No build step.** Plain ES2020+ JS. Don't introduce TypeScript or bundlers without
  user discussion.
- **Tests**: DOM-free logic goes in `takeout-shared.js` with a `node:test` test in
  `tests/`; DOM behaviour gets manual smoke checks.
- **Logger**: `logger.info/warn/error/download` in sidebar.js. Content uses raw `console.log`
  with `[NotebookLM Takeout]` prefix.
- **Filenames**: `[{PREFIX}]_{sanitized-title}.{ext}` for individual files,
  `{project-title}-{kind}-{timestamp}.zip` for batched. `sanitizeFilename` lives in
  sidebar.js.
- **Module-scoped helpers** (KaTeX, downloadBlob, exportSingleNote) go above `let
  currentTabId = null`. Per-Turndown-rule helpers go inside `createTurndownService` or
  the rule's `replacement`.
- **DOM scope**: always scope viewer queries to `<studio-panel>` when reading note/source
  content. The chat panel renders the same components.
- **Selector fallbacks**: when you change a selector, keep the old one in a fallback list
  for users still on older Google rollouts.
- **Comments**: only when WHY is non-obvious. The codebase has some comments that explain
  WHAT — don't add more. Comment on drift fixes ("Google moved X to Y in {date}") because
  that's load-bearing context.
- **No emojis in code or commits**, except the existing icons in the sidebar UI.
- **No attribution trailers.** Do not add `Co-Authored-By`, model names, or
  "Generated with ..." footers to commit messages or PR bodies. Plain messages only.
  (Commits before Aug 2026 carry a `Co-Authored-By` trailer; that convention is retired.)

## Git workflow

- Main branch: `main`.
- Remote: `origin` → `git@github.com-personal:bearspear/notebooklm-takeout.git`.
- Recent commit style (see `git log --oneline -10`):
  - Short imperative subject (50–72 chars).
  - Body with grouped bullet sections when the change spans multiple areas.
  - No trailer (see Conventions).
- Don't `git add -A`. Stage explicit paths.
- `popup.js.backup`, `.claude/`, `docs/`, `icons/README.md`, `TECHNICAL.md` are
  untracked. Don't accidentally commit them; talk to the user if you think they should be
  tracked. (`popup.html.backup` is tracked.)
- Work on a branch and open a PR against `main`; PRs are squash-merged.
- Push: `bearspear/notebooklm-takeout` on GitHub via the SSH host alias
  `github.com-personal` (`~/.ssh/config`; don't change it). ssh-agent offers a work key
  first, so pushes can fail as the wrong account. Push with
  `GIT_SSH_COMMAND="ssh -o IdentitiesOnly=yes -o IdentityAgent=none" git push`, or add
  `IdentitiesOnly yes` to that host (the user's call).
- PRs must be opened as **bearspear**: `gh auth switch --user bearspear`, then switch back
  to the user's default account afterwards.

---

**Last refreshed**: 2026-11-02 (Milestone 1, v1.2.0). After significant drift events or pipeline rewrites, update
this file. It is the single document an agent should read before doing anything in this
repo.
