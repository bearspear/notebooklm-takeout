# NotebookLM Takeout

A Chrome extension for exporting all your content from Google's NotebookLM, including audio overviews, slide decks, infographics, notes, and source documents.

## 🌟 Features

### Export Everything
- **Audio Overviews** - Download generated audio discussions as MP3 files
- **Slide Decks** - Export presentation slides as images or PDFs
- **Infographics** - Save visual summaries and diagrams
- **Reports** - Download reports as formatted markdown with proper headings and tables
- **Notes** - Export AI-generated notes as markdown with citations preserved
- **Sources** - Download your uploaded source documents with full content extraction

### Batch Operations
- **Batch Download** - Select and download multiple artifacts at once
- **ZIP Export** - Automatically package multiple files into organized ZIP archives
- **Progress Tracking** - Real-time progress bars and status updates
- **Cancellable Exports** - Cancel long-running exports with protective overlay

### Smart Features
- **Citation Extraction** - Preserves all source citations and references in exported notes
- **Markdown Conversion** - Converts HTML content to clean, readable markdown
- **Table Support** - Properly formats tables in markdown exports
- **Mindmap Export** - Exports mindmaps as SVG and JSON files
- **Auto-Naming** - Intelligently names files based on content
- **Tab Organization** - Clean interface with Sources, Notes, and Artifacts tabs

## 📦 Installation

### From Source (Developer Mode)

1. **Download the Extension**
   ```bash
   git clone <repository-url>
   cd notebooklm-takeout
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)

3. **Load the Extension**
   - Click "Load unpacked"
   - Select the extension folder
   - The extension icon should appear in your toolbar

4. **Verify Installation**
   - Open [NotebookLM](https://notebooklm.google.com)
   - Click the extension icon in your toolbar
   - The sidebar should open showing the export interface

## 🚀 Usage

### Quick Start

1. **Open NotebookLM**
   - Navigate to https://notebooklm.google.com
   - Open any notebook with content

2. **Open the Extension**
   - Click the NotebookLM Takeout icon in your Chrome toolbar
   - The sidebar will open on the right side of the page

3. **Choose What to Export**
   - Click the **Sources**, **Notes**, or **Artifacts** tab
   - Select the items you want to export
   - Click the export button

### Exporting Sources

**Sources** are the documents you've uploaded to NotebookLM (PDFs, markdown files, web pages, etc.).

1. Click the **Sources** tab
2. Click **Scan Sources** to detect all uploaded documents
3. Select the sources you want to export (or use "Select all sources")
4. Click **Export Selected Sources**
5. Wait for extraction to complete
6. Files download as:
   - Single source: `source-name.md`
   - Multiple sources: `notebooklm-sources-[timestamp].zip`

**What's Included:**
- Source document title
- Summary (if available)
- Key topics
- Full content converted to markdown

### Exporting Notes

**Notes** are AI-generated notes created by NotebookLM.

1. Click the **Notes** tab
2. Notes are automatically scanned
3. Select the notes you want to export (or use "Select All")
4. Click **Export Notes**
5. Wait for extraction (includes citation extraction)
6. Files download as:
   - Single note: `note-title.md`
   - Multiple notes: `notebooklm-notes-[timestamp].zip`

**What's Included:**
- Note title
- Full note content in markdown
- Preserved headings and formatting
- Tables converted to markdown tables
- Citations with source references
- Mindmaps exported as SVG and JSON

**Citation Format:**
```markdown
# Note Title

Main content here with citation references[1](#src-1).

## Sources

1. <a id="src-1"></a> **Source Title**
   > "Quoted text from source..."
```

### Exporting Artifacts

**Artifacts** include audio overviews, slide decks, infographics, and reports.

1. Click the **Artifacts** tab
2. Artifacts are automatically scanned
3. Select artifacts by type (Audio, Slides, Infographics, Reports)
4. Click individual download buttons or **Download All**
5. Enable **ZIP mode** (optional) to package all downloads

**Artifact Types:**
- **Audio Overview** 🔊 - MP3 audio files of AI discussions
- **Slides** 📊 - Presentation slides as images/PDF
- **Infographic** 📈 - Visual summaries and diagrams
- **Report** 📄 - Detailed reports as markdown

### Batch Download with ZIP

1. Enable the **ZIP checkbox** in the Artifacts tab
2. Select multiple artifacts
3. Click **Download All**
4. All files are packaged into a single ZIP archive
5. Organized folder structure inside ZIP

### Cancel Long-Running Exports

When exporting many items:
1. A protective overlay appears on the NotebookLM page
2. Shows current progress (e.g., "Extracting 5/20: filename.md")
3. Click **Cancel Export** button to stop
4. Partial results are still saved

## 🎨 Interface Guide

### Sidebar Layout

```
┌─────────────────────────────┐
│  NotebookLM Takeout         │
│  Export audio, slides, etc  │
├─────────────────────────────┤
│ Status: ⚫ Ready             │
│ [🔄 Refresh] [Auto]         │
├─────────────────────────────┤
│ [Sources] [Notes] [Artifacts]│
├─────────────────────────────┤
│                             │
│  □ Select All (10)          │
│                             │
│  □ Source 1.pdf             │
│  □ Source 2.md              │
│  ...                        │
│                             │
│  [Scan Sources]             │
│  [Export Selected]          │
│                             │
├─────────────────────────────┤
│ ⚙️ Settings                 │
└─────────────────────────────┘
```

### Settings

Access settings via the ⚙️ icon:

- **Always use ZIP for batch downloads** - Automatically create ZIP files
- **Show download notifications** - Display toast notifications
- **Auto-refresh interval** - Set refresh rate (5-60 seconds)

## 🔧 Technical Details

### Architecture

```
┌─────────────────────────────────────┐
│  Chrome Extension Components        │
├─────────────────────────────────────┤
│                                     │
│  sidebar.html/js/css               │
│  └─ User interface & controls       │
│                                     │
│  content.js                         │
│  └─ DOM manipulation & extraction   │
│                                     │
│  background.js                      │
│  └─ Download management & messaging │
│                                     │
│  injected.js                        │
│  └─ Page context access             │
│                                     │
└─────────────────────────────────────┘
```

### Technologies Used

- **Chrome Extensions API** - Manifest V3
- **TurndownService** - HTML to Markdown conversion
- **JSZip** - ZIP file creation
- **Chrome Side Panel API** - Persistent sidebar
- **MutationObserver** - DOM monitoring
- **Chrome Downloads API** - File downloads

### Permissions Required

```json
{
  "permissions": [
    "activeTab",      // Access current tab
    "storage",        // Save settings
    "downloads",      // Download files
    "scripting",      // Inject scripts
    "sidePanel",      // Side panel UI
    "tabs"            // Tab management
  ],
  "host_permissions": [
    "https://notebooklm.google.com/*"
  ]
}
```

### Data Privacy

- ✅ All processing happens locally in your browser
- ✅ No data is sent to external servers
- ✅ No analytics or tracking
- ✅ Source code is open and auditable
- ✅ Works entirely offline (after initial page load)

## 🐛 Troubleshooting

### Extension Not Appearing

**Problem:** Extension icon doesn't show or sidebar won't open

**Solutions:**
1. Refresh the NotebookLM page
2. Reload the extension in `chrome://extensions/`
3. Check that you're on `notebooklm.google.com`
4. Disable and re-enable the extension

### No Items Found

**Problem:** "No sources/notes found" message appears

**Solutions:**
1. Ensure you have content in your notebook
2. Click the **Refresh** button
3. Switch tabs (Sources → Notes → Sources)
4. Reload the NotebookLM page

### Download Failed

**Problem:** Downloads fail or files are corrupted

**Solutions:**
1. Check browser download permissions
2. Ensure sufficient disk space
3. Try downloading one item at a time
4. Disable other download manager extensions
5. Clear browser cache and reload

### Citations Not Extracting

**Problem:** Exported notes missing citations

**Solutions:**
1. Wait longer during export (citations take time to load)
2. Export notes one at a time instead of batch
3. Check browser console for errors (F12)
4. Ensure notes are in Tailwind format (newer notes)

### Batch Export Stops After First Item

**Problem:** Only first item exports in batch mode

**Solutions:**
1. Increase wait times between exports (already set to 3s)
2. Check console for "Previous note viewer still open" errors
3. Try exporting smaller batches (5-10 items)
4. Reload extension and retry

### Export Overlay Won't Dismiss

**Problem:** Protective overlay stays on screen

**Solutions:**
1. Press ESC key
2. Reload the NotebookLM page
3. Click outside the overlay
4. Reload the extension

## 📊 Performance Notes

### Export Speed

- **Audio/Slides/Infographics:** ~1-2 seconds per item
- **Reports:** ~2-3 seconds (includes content extraction)
- **Notes (without citations):** ~2-3 seconds
- **Notes (with citations):** ~5-15 seconds (1-1.5s per citation)
- **Sources:** ~3-5 seconds (depends on content size)

### Batch Export Recommendations

- **Small batches (1-10 items):** Fast, reliable
- **Medium batches (10-25 items):** ~2-5 minutes
- **Large batches (25+ items):** ~10-30 minutes, may need monitoring

**Tips for Large Exports:**
- Export in smaller batches
- Use ZIP mode to organize files
- Don't switch tabs during export
- Keep NotebookLM tab focused
- Monitor progress overlay

## 🛠️ Development

### Building from Source

```bash
# Clone repository
git clone <repository-url>
cd notebooklm-takeout

# No build step required - pure JavaScript extension
# Load directly in Chrome as described in Installation
```

### Project Structure

```
notebooklm-takeout/
├── manifest.json           # Extension manifest
├── sidebar.html           # Sidebar UI
├── sidebar.js             # Sidebar logic
├── styles.css             # Sidebar styles
├── content.js             # Content script
├── content-styles.css     # Content styles
├── background.js          # Service worker
├── injected.js            # Page context script
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── jszip.min.js          # ZIP library
├── turndown.min.js       # Markdown converter
└── README.md             # This file
```

### Key Functions

**sidebar.js:**
- `scanSourcesPage()` - Detect uploaded sources
- `scanNotesPage()` - Detect AI-generated notes
- `scanPage()` - Detect artifacts
- `exportSources()` - Export source documents
- `exportNotesAsMarkdown()` - Export notes with citations
- `downloadAllArtifacts()` - Batch artifact download
- `convertToMarkdown()` - HTML to markdown conversion

**content.js:**
- `scanForSources()` - Find source elements in DOM
- `scanForNotes()` - Find note elements in DOM
- `extractSourceContent()` - Extract source document content
- `extractNoteContent()` - Extract note content
- `extractTailwindNoteContent()` - Extract notes with citations
- `extractReportContent()` - Extract report content
- `navigateBackToNotesList()` - Close panels/viewers

**background.js:**
- Download interception and management
- Message routing between components
- Batch download coordination

### Adding New Features

1. **Add new export type:**
   - Add detection in `content.js` (e.g., `scanForNewType()`)
   - Add extraction in `content.js` (e.g., `extractNewTypeContent()`)
   - Add UI tab in `sidebar.html`
   - Add export logic in `sidebar.js`

2. **Modify extraction logic:**
   - Update selectors in `content.js`
   - Adjust wait times for loading
   - Update markdown conversion in `convertToMarkdown()`

3. **Change UI:**
   - Edit `sidebar.html` for structure
   - Edit `styles.css` for styling
   - Edit `sidebar.js` for behavior

### Testing

1. **Load extension in developer mode**
2. **Open DevTools** (F12) on both:
   - NotebookLM page (content script logs)
   - Extension sidebar (sidebar script logs)
3. **Test each export type:**
   - Sources (single + batch)
   - Notes (single + batch, with/without citations)
   - Artifacts (each type individually)
   - Batch downloads with ZIP
4. **Test error cases:**
   - Empty notebook
   - Network errors
   - Cancel during export
   - Very large batches

### Debugging

**Console Logs:**
All logs are prefixed with `[NotebookLM Takeout]`

**Enable verbose logging:**
```javascript
// In sidebar.js or content.js
const DEBUG = true;
```

**Common issues:**
- `waitForElement timeout` → Element selector changed
- `Note not found at index X` → Index mismatch (fixed)
- `Previous note viewer still open` → Navigation failed (fixed)
- `Citation extraction failed` → Side panel didn't load

## 📝 Version History

### v1.0.0 (Current)
- Initial release
- Export sources, notes, and artifacts
- Batch download with ZIP support
- Citation extraction for notes
- Markdown conversion with table support
- Protective overlay during exports
- Cancellable operations
- Auto-refresh and settings

### Planned Features
- [ ] Export to multiple formats (PDF, DOCX, etc.)
- [ ] Custom export templates
- [ ] Search and filter exports
- [ ] Export scheduling/automation
- [ ] Cloud storage integration
- [ ] Export history tracking
- [ ] Incremental exports (only new items)

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Contribution Guidelines

- Follow existing code style
- Add comments for complex logic
- Test thoroughly before submitting
- Update README if adding features
- Keep commits focused and atomic

## 📄 License

This project is licensed under the MIT License - see LICENSE file for details.

## ⚠️ Disclaimer

This is an unofficial third-party extension and is not affiliated with, endorsed by, or connected to Google or NotebookLM. Use at your own risk.

- This extension accesses content from NotebookLM for export purposes only
- All data processing occurs locally in your browser
- Respect copyright and terms of service when exporting content
- Ensure you have rights to export and use the content

## 🙏 Acknowledgments

- **TurndownService** - HTML to Markdown conversion
- **JSZip** - ZIP file generation
- **Google NotebookLM** - The amazing tool this extension enhances
- **Chrome Extensions Documentation** - Comprehensive API docs

## 📞 Support

- **Issues:** Report bugs or request features via GitHub Issues
- **Discussions:** Ask questions in GitHub Discussions
- **Documentation:** See this README and inline code comments

## 🔗 Links

- [NotebookLM](https://notebooklm.google.com)
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [TurndownService](https://github.com/mixmark-io/turndown)
- [JSZip](https://stuk.github.io/jszip/)

---

**Made with ❤️ for the NotebookLM community**

*Star this project if you find it useful!*
