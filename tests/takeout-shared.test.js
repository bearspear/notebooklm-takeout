const test = require('node:test');
const assert = require('node:assert/strict');
const NLME = require('../takeout-shared.js');

test('resolveArtifactType prefers a button label that names a type', () => {
  assert.equal(NLME.resolveArtifactType({ iconText: 'format_list_bulleted', buttonLabel: 'Data Table' }), 'Data Table');
  assert.equal(NLME.resolveArtifactType({ iconText: 'tablet', buttonLabel: 'Slide Deck' }), 'Slides');
});

test('resolveArtifactType ignores the generic "Artifact" label and falls back to the icon', () => {
  assert.equal(NLME.resolveArtifactType({ iconText: 'copy', buttonLabel: 'Artifact' }), 'Flashcards');
  assert.equal(NLME.resolveArtifactType({ iconText: 'quiz' }), 'Quiz');
});

test('resolveArtifactType passes unknown icons through and defaults to Unknown', () => {
  assert.equal(NLME.resolveArtifactType({ iconText: 'brand_new_icon' }), 'brand_new_icon');
  assert.equal(NLME.resolveArtifactType({}), 'Unknown');
});

test('isDownloadableType rejects Flashcards and Quiz only', () => {
  assert.equal(NLME.isDownloadableType('Flashcards'), false);
  assert.equal(NLME.isDownloadableType('Quiz'), false);
  assert.equal(NLME.isDownloadableType('Slides'), true);
});

test('NOTE_ICONS includes the Nov 2026 article icon', () => {
  assert.equal(NLME.NOTE_ICONS.includes('article'), true);
});

test('isCitationExpander detects collapsed-group buttons only', () => {
  assert.equal(NLME.isCitationExpander({ iconText: 'more_horiz' }), true);
  assert.equal(NLME.isCitationExpander({ ariaLabel: 'Show additional citations' }), true);
  assert.equal(NLME.isCitationExpander({ iconText: '', ariaLabel: '1: Donald E. Scott' }), false);
});

test('parseCitationIndex accepts digits only', () => {
  assert.equal(NLME.parseCitationIndex(' 12 '), '12');
  assert.equal(NLME.parseCitationIndex('more_horiz'), null);
  assert.equal(NLME.parseCitationIndex(''), null);
});

test('CITATION_TOOLTIP_SELECTOR covers the Nov 2026 popover and the legacy dialog', () => {
  assert.match(NLME.CITATION_TOOLTIP_SELECTOR, /\.citation-tooltip-panel/);
  assert.match(NLME.CITATION_TOOLTIP_SELECTOR, /xap-inline-dialog-container/);
});

test('buildCitationEntries gives an unextracted marker a placeholder at its own number', () => {
  const entries = NLME.buildCitationEntries(
    [{ sourceIndex: '1', text: 'A' }, { sourceIndex: '3', text: 'C' }],
    ['1', '2', '3']
  );
  assert.deepEqual(entries.map(e => [e.number, e.text, e.missing]), [
    ['1', 'A', false],
    ['2', '(citation details unavailable)', true],
    ['3', 'C', false]
  ]);
});

test('buildCitationEntries sorts numerically regardless of extraction order', () => {
  const entries = NLME.buildCitationEntries(
    [{ sourceIndex: '3', text: 'C' }, { sourceIndex: '1', text: 'A' }],
    ['3', '1']
  );
  assert.deepEqual(entries.map(e => e.number), ['1', '3']);
});

test('buildCitationEntries returns nothing for a note without citations', () => {
  assert.deepEqual(NLME.buildCitationEntries([], []), []);
});

test('pickByIndexThenTitle keeps the clicked duplicate', () => {
  assert.equal(NLME.pickByIndexThenTitle(['A', 'B', 'A'], 2, 'A'), 2);
});

test('pickByIndexThenTitle follows the title when the list shifted', () => {
  assert.equal(NLME.pickByIndexThenTitle(['A', 'B', 'C'], 0, 'B'), 1);
});

test('pickByIndexThenTitle falls back to the index when the title is gone', () => {
  assert.equal(NLME.pickByIndexThenTitle(['A', 'B'], 1, 'Z'), 1);
});

test('pickByIndexThenTitle returns -1 when nothing is usable', () => {
  assert.equal(NLME.pickByIndexThenTitle(['A'], 5, 'Z'), -1);
  assert.equal(NLME.pickByIndexThenTitle([], 0, 'A'), -1);
});

test('countFailedExtractions counts structured source errors by type', () => {
  assert.equal(NLME.countFailedExtractions([
    { type: 'extraction_failed' }, { type: 'missing_summary' }, { type: 'extraction_error' }
  ]), 2);
});

test('countFailedExtractions counts note error strings by message', () => {
  assert.equal(NLME.countFailedExtractions([
    '[A] Failed to extract: x', '[B] Exception during extraction: y', '[C] Citation 2: timeout'
  ]), 2);
});

test('countFailedExtractions handles no errors', () => {
  assert.equal(NLME.countFailedExtractions([]), 0);
});

test('ISSUES_URL points at this project', () => {
  assert.equal(NLME.ISSUES_URL, 'https://github.com/bearspear/notebooklm-takeout/issues');
});

const slideMenu = ['share Share', 'edit Rename', 'drive_pdfDownload PDF Document (.pdf)', 'drive_ms_powerpointDownload PowerPoint (.pptx)', 'play_arrowStart slideshow', 'delete Delete'];
const audioMenu = ['share Share', 'edit Rename', 'save_alt Download', 'delete Delete'];

test('pickDownloadMenuIndex honours the PowerPoint preference', () => {
  assert.equal(NLME.pickDownloadMenuIndex(slideMenu, 'pptx'), 3);
});

test('pickDownloadMenuIndex honours the PDF preference', () => {
  assert.equal(NLME.pickDownloadMenuIndex(slideMenu, 'pdf'), 2);
});

test('pickDownloadMenuIndex falls back to the only Download item', () => {
  assert.equal(NLME.pickDownloadMenuIndex(audioMenu, 'pptx'), 2);
});

test('pickDownloadMenuIndex returns -1 without a Download item', () => {
  assert.equal(NLME.pickDownloadMenuIndex(['share Share'], 'pdf'), -1);
});

test('buildCitationEntries omits placeholders when citations were never extracted', () => {
  const entries = NLME.buildCitationEntries([], ['1', '2'], { placeholders: false });
  assert.deepEqual(entries, []);
});

test('buildCitationEntries without placeholders still lists extracted sources', () => {
  const entries = NLME.buildCitationEntries([{ sourceIndex: '2', text: 'B' }], ['1', '2'], { placeholders: false });
  assert.deepEqual(entries.map(e => e.number), ['2']);
});

test('renumberCitationAnchors numbers occurrences in document order per message and source', () => {
  const md = 'a<a id="msg-0-cite-ref-8-2" href="#msg-0-src-8">[8]</a> b<a id="msg-0-cite-ref-8-5" href="#msg-0-src-8">[8]</a>' +
    ' c<a id="msg-1-cite-ref-8-3" href="#msg-1-src-8">[8]</a> d<a id="msg-0-cite-ref-9-4" href="#msg-0-src-9">[9]</a>';
  assert.equal(NLME.renumberCitationAnchors(md),
    'a<a id="msg-0-cite-ref-8-1" href="#msg-0-src-8">[8]</a> b<a id="msg-0-cite-ref-8-2" href="#msg-0-src-8">[8]</a>' +
    ' c<a id="msg-1-cite-ref-8-1" href="#msg-1-src-8">[8]</a> d<a id="msg-0-cite-ref-9-1" href="#msg-0-src-9">[9]</a>');
});

test('renumberCitationAnchors handles note anchors without a message prefix', () => {
  const md = '<a id="cite-ref-3-2" href="#src-3">[3]</a><a id="note-x-cite-ref-3-7" href="#note-x-src-3">[3]</a>';
  assert.equal(NLME.renumberCitationAnchors(md),
    '<a id="cite-ref-3-1" href="#src-3">[3]</a><a id="note-x-cite-ref-3-1" href="#note-x-src-3">[3]</a>');
});

test('renumberCitationAnchors leaves back-links in the Sources section untouched', () => {
  const md = '**[[3]](#msg-0-cite-ref-3-1)** Title';
  assert.equal(NLME.renumberCitationAnchors(md), md);
});

test('isCollapsedCitationGroup matches only groups that are still collapsed', () => {
  assert.equal(NLME.isCollapsedCitationGroup({ iconText: 'more_horiz', ariaLabel: 'Show additional citations' }), true);
  assert.equal(NLME.isCollapsedCitationGroup({ iconText: '...' }), true);
  assert.equal(NLME.isCollapsedCitationGroup({ ariaLabel: 'Show additional citations' }), true);
});

test('isCollapsedCitationGroup never matches an expanded group (clicking it would collapse it)', () => {
  assert.equal(NLME.isCollapsedCitationGroup({ iconText: 'unfold_less', ariaLabel: 'Hide additional citations' }), false);
  assert.equal(NLME.isCollapsedCitationGroup({ ariaLabel: 'Hide additional citations' }), false);
  assert.equal(NLME.isCollapsedCitationGroup({ iconText: '3' }), false);
});

test('classifyKatexScript reads a lone script relative to its pstrut', () => {
  // Measured on notebook.google.com (Nov 2026): E = mc^2 and DM_{total}
  assert.equal(NLME.classifyKatexScript({ top: -3.063, pstrutHeight: 2.7 }), 'sup');
  assert.equal(NLME.classifyKatexScript({ top: -2.55, pstrutHeight: 2.7, hasDepth: true }), 'sub');
});

test('classifyKatexScript falls back to the vlist depth marker without a pstrut', () => {
  assert.equal(NLME.classifyKatexScript({ top: -2.55, hasDepth: true }), 'sub');
  assert.equal(NLME.classifyKatexScript({ top: -3.063, hasDepth: false }), 'sup');
});

test('mathSourceToMarkdown copies the original LaTeX from data-math verbatim', () => {
  assert.equal(NLME.mathSourceToMarkdown({ dataMath: '1 + p + p^2 + p^3... = \\frac{1}{1-p}' }), '$1 + p + p^2 + p^3... = \\frac{1}{1-p}$');
  assert.equal(NLME.mathSourceToMarkdown({ dataMath: 'DM_{total} = DM_{MW}', display: true }), '$$DM_{total} = DM_{MW}$$');
});

test('mathSourceToMarkdown prefers data-math over the KaTeX annotation and trims whitespace', () => {
  assert.equal(NLME.mathSourceToMarkdown({ dataMath: '  -1 ', annotation: 'x' }), '$-1$');
  assert.equal(NLME.mathSourceToMarkdown({ annotation: ' \\frac{1}{2} ' }), '$\\frac{1}{2}$');
});

test('mathSourceToMarkdown returns null when no source is available', () => {
  assert.equal(NLME.mathSourceToMarkdown({}), null);
  assert.equal(NLME.mathSourceToMarkdown({ dataMath: '   ' }), null);
});

test('mathSourceHealth passes when every formula carries its LaTeX source', () => {
  const r = NLME.mathSourceHealth({ total: 27, withSource: 27 });
  assert.equal(r.passed, true);
  assert.match(r.note, /27\/27/);
});

test('mathSourceHealth warns when formulas lack a LaTeX source', () => {
  const r = NLME.mathSourceHealth({ total: 27, withSource: 24 });
  assert.equal(r.passed, false);
  assert.match(r.note, /3 of 27/);
  assert.match(r.note, /rebuilt/);
});

test('mathSourceHealth passes with nothing to check when the page has no formulas', () => {
  const r = NLME.mathSourceHealth({ total: 0, withSource: 0 });
  assert.equal(r.passed, true);
  assert.match(r.note, /No formulas/);
});

test('cleanOcrArtifacts keeps paragraph breaks and list lines', () => {
  const t = 'Para one.\n\nPara two.\n- a\n- b';
  assert.equal(NLME.cleanOcrArtifacts(t), t);
});

test('cleanOcrArtifacts keeps markdown tables', () => {
  const t = '| a | b |\n|---|---|\n| 1 | 2 |';
  assert.equal(NLME.cleanOcrArtifacts(t), t);
});

test('cleanOcrArtifacts leaves fenced code untouched', () => {
  const t = '```\nx  =  1 ~~~\n```';
  assert.equal(NLME.cleanOcrArtifacts(t), t);
});

test('cleanOcrArtifacts keeps ~~strikethrough~~', () => {
  assert.equal(NLME.cleanOcrArtifacts('a ~~b~~ c'), 'a ~~b~~ c');
});

test('cleanOcrArtifacts strips OCR tildes', () => {
  assert.equal(NLME.cleanOcrArtifacts('word ~~~ next :~: end =~ x'), 'word next end x');
});

test('cleanOcrArtifacts collapses horizontal runs and 3+ newlines', () => {
  assert.equal(NLME.cleanOcrArtifacts('a  \t b\n\n\n\nc'), 'a b\n\nc');
});

function fakeClock(times) {
  let i = 0;
  return () => times[i++];
}

test('createPhaseTimer sums repeated phases', () => {
  const t = NLME.createPhaseTimer(fakeClock([0, 10, 10, 40]));
  t.start('a'); t.end('a');
  t.start('a'); t.end('a');
  assert.deepEqual(t.totals().a, { count: 2, ms: 40 });
});

test('createPhaseTimer merge adds totals from another context', () => {
  const t = NLME.createPhaseTimer(fakeClock([0, 5]));
  t.start('a'); t.end('a');
  t.merge({ a: { count: 3, ms: 30 }, b: { count: 1, ms: 7 } });
  assert.deepEqual(t.totals(), { a: { count: 4, ms: 35 }, b: { count: 1, ms: 7 } });
});

test('formatTimingSummary lists phases and total', () => {
  const md = NLME.formatTimingSummary({ a: { count: 2, ms: 3000 } }, 192000);
  assert.match(md, /^## Export statistics/);
  assert.match(md, /a: 2 × 1\.50 s avg/);
  assert.match(md, /Total: 3 m 12 s/);
});

test('createSettleGate lets only the newest settle finish', () => {
  const gate = NLME.createSettleGate();
  const first = gate.begin(false);
  assert.equal(first.current(), true);
  const second = gate.begin(false);
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
});

test('createSettleGate hands a rescan the discarded settle owed to the newer one', () => {
  const gate = NLME.createSettleGate();
  const first = gate.begin(true); // switched notebook: owes a rescan
  assert.equal(first.owesRescan, true);
  // A second navigation inside the same notebook discards the first settle but inherits the rescan
  const second = gate.begin(false);
  assert.equal(first.current(), false);
  assert.equal(second.owesRescan, true);
  second.settled();
  // Once settled, nothing is owed any more
  assert.equal(gate.begin(false).owesRescan, false);
});

test('createSettleGate: a stale settle cannot clear the debt', () => {
  const gate = NLME.createSettleGate();
  const first = gate.begin(true);
  const second = gate.begin(false);
  first.settled(); // stale: no effect
  assert.equal(gate.begin(false).owesRescan, true);
  second.settled();
});

test('createJobLock allows one job at a time', () => {
  const lock = NLME.createJobLock();
  assert.equal(lock.tryAcquire('notes'), true);
  assert.equal(lock.tryAcquire('chat'), false);
  assert.equal(lock.current(), 'notes');
});

test('createJobLock release frees the lock', () => {
  const lock = NLME.createJobLock();
  lock.tryAcquire('notes');
  lock.release('notes');
  assert.equal(lock.tryAcquire('chat'), true);
});

test('createJobLock ignores release by a non-owner', () => {
  const lock = NLME.createJobLock();
  lock.tryAcquire('notes');
  lock.release('chat');
  assert.equal(lock.current(), 'notes');
});

test('summarizeExportOutcome reports a full success', () => {
  assert.deepEqual(NLME.summarizeExportOutcome({ kind: 'notes', selected: 10, exported: 10, failed: 0, cancelled: false }),
    { level: 'success', message: 'Exported 10 of 10 notes', partial: false });
});

test('summarizeExportOutcome reports partial failures', () => {
  const r = NLME.summarizeExportOutcome({ kind: 'notes', selected: 10, exported: 7, failed: 3, cancelled: false });
  assert.equal(r.level, 'warning');
  assert.equal(r.message, 'Exported 7 of 10 notes (3 failed, see errors.md)');
  assert.equal(r.partial, false);
});

test('summarizeExportOutcome reports a cancelled export as partial', () => {
  const r = NLME.summarizeExportOutcome({ kind: 'notes', selected: 10, exported: 4, failed: 0, cancelled: true });
  assert.equal(r.level, 'warning');
  assert.equal(r.message, 'Cancelled: exported 4 of 10 notes');
  assert.equal(r.partial, true);
});

test('summarizeExportOutcome reports when nothing was exported', () => {
  const r = NLME.summarizeExportOutcome({ kind: 'notes', selected: 10, exported: 0, failed: 10, cancelled: false });
  assert.equal(r.level, 'error');
  assert.equal(r.message, 'No notes exported (10 failed, see errors.md)');
});

const DL = 'https://contribution.usercontent.google.com/download?c=abc&filename=deck.pdf';

test('shouldIntercept is false when not armed', () => {
  const arm = NLME.createInterceptArm(3000);
  assert.equal(arm.shouldIntercept(DL, 1000), false);
});

test('arm then shouldIntercept true once, then false', () => {
  const arm = NLME.createInterceptArm(3000);
  arm.arm(1000);
  assert.equal(arm.shouldIntercept(DL, 1500), true);
  assert.equal(arm.shouldIntercept(DL, 1600), false);
});

test('arm expires after windowMs', () => {
  const arm = NLME.createInterceptArm(3000);
  arm.arm(1000);
  assert.equal(arm.shouldIntercept(DL, 4001), false);
});

test('non-download URL never intercepted even when armed', () => {
  const arm = NLME.createInterceptArm(3000);
  arm.arm(1000);
  assert.equal(arm.shouldIntercept('https://notebook.google.com/notebook/x', 1100), false);
  assert.equal(arm.shouldIntercept(DL, 1200), true);
});

test('isNotebookDownloadUrl rejects lookalike hosts', () => {
  assert.equal(NLME.isNotebookDownloadUrl('https://evil.com/?q=contribution.usercontent.google.com'), false);
  assert.equal(NLME.isNotebookDownloadUrl(DL), true);
  assert.equal(NLME.isNotebookDownloadUrl('https://lh3.googleusercontent.com/notebooklm/abc=d'), true);
  assert.equal(NLME.isNotebookDownloadUrl('not a url'), false);
});

test('titlesMatch ignores whitespace and ellipsis style', () => {
  assert.equal(NLME.titlesMatch('The  Electric…', 'The Electric...'), true);
});

test('titlesMatch accepts a truncated title ending in an ellipsis', () => {
  assert.equal(NLME.titlesMatch('Halton Arp Quasar…', 'Halton Arp Quasar Model Verified'), true);
});

test('titlesMatch rejects different titles', () => {
  assert.equal(NLME.titlesMatch('A', 'B'), false);
});

test('pickByIndexThenTitleStrict keeps the index when it matches', () => {
  assert.equal(NLME.pickByIndexThenTitleStrict(['A', 'B', 'A'], 2, 'A'), 2);
});

test('pickByIndexThenTitleStrict follows the title when the list shifted', () => {
  assert.equal(NLME.pickByIndexThenTitleStrict(['X', 'A', 'B'], 0, 'A'), 1);
});

test('pickByIndexThenTitleStrict throws when the title is gone', () => {
  assert.throws(() => NLME.pickByIndexThenTitleStrict(['A', 'B'], 1, 'Z'), /Item changed/);
});

test('pickFreshIntercept ignores URLs from before the click', () => {
  const entries = [{ url: 'old', timestamp: 5 }, { url: 'new', timestamp: 12 }];
  assert.equal(NLME.pickFreshIntercept(entries, 10), 'new');
  assert.equal(NLME.pickFreshIntercept(entries, 20), null);
});

test('extensionFromDownloadUrl reads the filename parameter', () => {
  assert.equal(NLME.extensionFromDownloadUrl('https://contribution.usercontent.google.com/download?c=x&filename=Testing_Cosmology.pptx&opi=1'), '.pptx');
  assert.equal(NLME.extensionFromDownloadUrl('https://contribution.usercontent.google.com/download?filename=Deck.pdf'), '.pdf');
});

test('extensionFromDownloadUrl returns empty when the URL names no file', () => {
  assert.equal(NLME.extensionFromDownloadUrl('https://lh3.googleusercontent.com/notebooklm/abc=d'), '');
  assert.equal(NLME.extensionFromDownloadUrl('not a url'), '');
});

test('downloadFolderPath joins folder and filename', () => {
  assert.equal(NLME.downloadFolderPath('New Physics', '[slides]_Deck.pptx'), 'New Physics/[slides]_Deck.pptx');
});

test('downloadFolderPath strips characters a folder name cannot hold', () => {
  assert.equal(NLME.downloadFolderPath('A/B: C*?"<>|', 'f.md'), 'A B C/f.md');
});

test('downloadFolderPath without a usable folder returns the bare filename', () => {
  assert.equal(NLME.downloadFolderPath('', 'f.md'), 'f.md');
  assert.equal(NLME.downloadFolderPath(' .. ', 'f.md'), 'f.md');
});

test('stability tracker needs equal consecutive lengths', () => {
  const t = NLME.createStabilityTracker({ checks: 2 });
  assert.equal(t.push(10), false);
  assert.equal(t.push(20), false);
  assert.equal(t.push(20), true);
});

test('stability tracker never stable below minLength', () => {
  const t = NLME.createStabilityTracker({ checks: 2, minLength: 50 });
  assert.equal(t.push(10), false);
  assert.equal(t.push(10), false);
});

test('cancellationNote says how far the export got and what is missing', () => {
  const note = NLME.cancellationNote({ kind: 'messages', done: 4, total: 17 });
  assert.match(note, /Cancelled by user after 4 of 17 messages/);
  assert.match(note, /not exported/);
});

test('cancellationNote mentions citations only for exports that have them', () => {
  assert.match(NLME.cancellationNote({ kind: 'notes', done: 1, total: 3 }), /incomplete citations/);
  const note = NLME.cancellationNote({ kind: 'sources', done: 2, total: 4 });
  assert.doesNotMatch(note, /citations/);
  assert.match(note, /Cancelled by user after 2 of 4 sources/);
  assert.match(note, /not exported/);
});

test('distinctVariants lists the versions actually written, in order', () => {
  const files = [
    { variant: 'base' }, { variant: 'plusMeta' },
    { variant: 'base' }, { variant: 'plusMeta' }, { variant: 'withImages' }
  ];
  assert.deepEqual(NLME.distinctVariants(files), ['base', 'plusMeta', 'withImages']);
  assert.deepEqual(NLME.distinctVariants([]), []);
});

test('normalizeExportError handles note strings, objects and cancellation notes', () => {
  assert.deepEqual(NLME.normalizeExportError('[Deck A] Failed to extract: x'),
    { type: 'error', item: 'Deck A', message: 'Failed to extract: x', detail: '' });
  assert.deepEqual(NLME.normalizeExportError({ source: 'S', type: 'missing_summary', message: 'm' }),
    { type: 'missing_summary', item: 'S', message: 'm', detail: '' });
  assert.deepEqual(NLME.normalizeExportError({ userQuestion: 'Q', type: 'citation_failed', message: 'm', stack: 'st' }),
    { type: 'citation_failed', item: 'Q', message: 'm', detail: 'st' });
  assert.equal(NLME.normalizeExportError(NLME.cancellationNote({ kind: 'messages', done: 4, total: 17 })).type, 'cancelled');
});

test('buildErrorReport groups mixed errors without throwing', () => {
  const report = NLME.buildErrorReport({
    title: 'Chat Export',
    generatedAt: '11/3/2026, 9:00 AM',
    errors: ['plain text', { userQuestion: 'Why?', type: 'citation_failed', message: 'Popover did not close' },
      NLME.cancellationNote({ kind: 'messages', done: 4, total: 17 })]
  });
  assert.match(report, /^# Chat Export Error Report/);
  assert.match(report, /## CANCELLED \(1\)/);
  assert.match(report, /- Why\?: Popover did not close/);
  assert.match(report, /- plain text/);
});

test('buildErrorReport prints summary stats', () => {
  const report = NLME.buildErrorReport({ title: 'Chat Export', errors: [], stats: { 'Total Messages': 17 } });
  assert.match(report, /- Total Messages: 17/);
});

test('isNotebookUrl matches hosts exactly', () => {
  assert.equal(NLME.isNotebookUrl('https://notebook.google.com/notebook/x'), true);
  assert.equal(NLME.isNotebookUrl('https://notebooklm.google.com/'), true);
  assert.equal(NLME.isNotebookUrl('https://www.google.com/search?q=notebook.google.com'), false);
  assert.equal(NLME.isNotebookUrl(undefined), false);
});

test('sanitizeFilename keeps emoji pairs whole at the cut', () => {
  const out = NLME.sanitizeFilename('a'.repeat(99) + '😀x', 100);
  assert.ok(out.endsWith('😀'), out.slice(-4));
  assert.doesNotMatch(out, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test('sanitizeFilename avoids reserved and empty names', () => {
  assert.equal(NLME.sanitizeFilename('CON'), '_CON');
  assert.equal(NLME.sanitizeFilename('name.'), 'name');
  assert.equal(NLME.sanitizeFilename('\u0001'), 'untitled');
});

test('artifactTypePrefix maps known and unknown types', () => {
  assert.equal(NLME.artifactTypePrefix('Slides'), 'slides');
  assert.equal(NLME.artifactTypePrefix('Mind Map'), 'mind-map');
  assert.equal(NLME.artifactTypePrefix('Weird Thing'), 'weird-thing');
});

test('exportTimestamp formats a fixed date', () => {
  assert.equal(NLME.exportTimestamp(new Date('2026-11-03T10:20:30.456Z')), '2026-11-03T10-20-30');
});

test('escapeHtml escapes quotes', () => {
  assert.equal(NLME.escapeHtml('"a" & <b>'), '&quot;a&quot; &amp; &lt;b&gt;');
  assert.equal(NLME.escapeHtml("it's"), 'it&#39;s');
});

test('isAllowedDownloadUrl accepts Gemini Notebook download hosts', () => {
  assert.equal(NLME.isAllowedDownloadUrl('https://contribution.usercontent.google.com/download?filename=a.pdf'), true);
  assert.equal(NLME.isAllowedDownloadUrl('https://lh3.googleusercontent.com/notebooklm/x'), true);
});

test('isAllowedDownloadUrl rejects other hosts and schemes', () => {
  assert.equal(NLME.isAllowedDownloadUrl('https://drive.google.com/uc?id=1'), false);
  assert.equal(NLME.isAllowedDownloadUrl('http://contribution.usercontent.google.com/x'), false);
  assert.equal(NLME.isAllowedDownloadUrl('https://evil.com/?q=googleusercontent.com'), false);
  assert.equal(NLME.isAllowedDownloadUrl('blob:chrome-extension://abc/123'), false);
});

test('isNotebookDownload rejects a Drive download from another tab', () => {
  assert.equal(NLME.isNotebookDownload({ url: 'https://drive.usercontent.google.com/download?id=1', referrer: 'https://drive.google.com/' }), false);
  assert.equal(NLME.isNotebookDownload({ url: 'https://contribution.usercontent.google.com/download?c=x', referrer: 'https://notebook.google.com/' }), true);
  assert.equal(NLME.isNotebookDownload({ url: 'https://contribution.usercontent.google.com/download?c=x', referrer: '' }), true);
  assert.equal(NLME.isNotebookDownload({ url: 'https://lh3.googleusercontent.com/x', referrer: 'https://mail.google.com/' }), false);
});

const suffixes = list => list.map(v => v.suffix);

test('noteVariants always includes base', () => {
  assert.deepEqual(suffixes(NLME.noteVariants({}, { hasQuotes: false, hasImages: false })), ['']);
});

test('noteVariants skips code blocks without quotes', () => {
  assert.deepEqual(suffixes(NLME.noteVariants({ exportNoteCodeBlocks: true }, { hasQuotes: false, hasImages: false })), ['']);
});

test('noteVariants keeps differing variants', () => {
  const v = NLME.noteVariants({ exportNoteBase: true, exportNoteCodeBlocks: true, exportNoteWithImages: true, exportNoteCodeBlocksWithImages: true },
    { hasQuotes: true, hasImages: true });
  assert.deepEqual(suffixes(v), ['', '-code-blocks', '-with-images']);
  assert.deepEqual(v[1], { suffix: '-code-blocks', codeBlocks: true, images: false });
  assert.deepEqual(v[2], { suffix: '-with-images', codeBlocks: false, images: true });
});

test('sourceVariants needs images for image variants', () => {
  const all = { exportSourceBase: true, exportSourcePlusMeta: true, exportSourceWithImages: true, exportSourcePlusMetaWithImages: true };
  assert.deepEqual(suffixes(NLME.sourceVariants(all, { hasImages: false })), ['', '-plus-meta']);
  assert.deepEqual(suffixes(NLME.sourceVariants(all, { hasImages: true })), ['', '-plus-meta', '-with-images', '-plus-meta-with-images']);
});

test('fenceFor outgrows backtick runs in the quote', () => {
  assert.equal(NLME.fenceFor('a ```js x``` b'), '````');
  assert.equal(NLME.fenceFor('plain'), '```');
  assert.equal(NLME.fenceFor('````` five'), '``````');
});

test('toBlockquote prefixes every line', () => {
  assert.equal(NLME.toBlockquote('a\n\nb'), '> a\n>\n> b');
  assert.equal(NLME.toBlockquote('- item\n- item 2'), '> - item\n> - item 2');
});

test('citationTitleFromAriaLabel strips the number prefix', () => {
  assert.equal(NLME.citationTitleFromAriaLabel('3: Donald E. Scott: Indeed, Our Sun is Electric', 3), 'Donald E. Scott: Indeed, Our Sun is Electric');
  assert.equal(NLME.citationTitleFromAriaLabel('12: ZFC', '12'), 'ZFC');
});

test('citationTitleFromAriaLabel falls back to Source N', () => {
  assert.equal(NLME.citationTitleFromAriaLabel('', 4), 'Source 4');
  assert.equal(NLME.citationTitleFromAriaLabel(null, 4), 'Source 4');
  assert.equal(NLME.citationTitleFromAriaLabel('4:', 4), 'Source 4');
});

test('buildSourcesIndex links each same-titled source to its own file', () => {
  const md = NLME.buildSourcesIndex([
    { title: 'Electric Universe', files: [{ label: 'Base', path: 'sources/Electric-Universe.md' }] },
    { title: 'Electric Universe', files: [{ label: 'Base', path: 'sources/Electric-Universe (2).md' }] }
  ]);
  assert.match(md, /### 1\. Electric Universe/);
  assert.match(md, /### 2\. Electric Universe/);
  assert.ok(md.includes('(sources/Electric-Universe.md)'));
  assert.ok(md.includes('(sources/Electric-Universe%20(2).md)'));
});

test('buildSourcesIndex never throws on odd characters', () => {
  const md = NLME.buildSourcesIndex([{ title: 'Ω \ud83d', files: [{ label: 'Base', path: 'sources/\ud83d-x.md' }] }]);
  assert.match(md, /### 1\./);
});

test('auditExport passes when everything was written', () => {
  const r = NLME.auditExport({ expected: { items: 10, citations: 246 }, written: { items: 10, citations: 246 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['- items: 10 of 10', '- citations: 246 of 246']);
});

test('auditExport flags missing citations', () => {
  const r = NLME.auditExport({ expected: { items: 17, citations: 294 }, written: { items: 17, citations: 280 } });
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => l.includes('280 of 294') && l.startsWith('- ⚠️')));
});

test('diffAudit returns what one part added to the run-wide audit', () => {
  const before = { expected: { items: 3, citations: 10, formulas: 1 }, written: { items: 3, citations: 9, formulas: 1 }, cacheHits: 2, cachedItems: 3 };
  const now = { expected: { items: 5, citations: 14, formulas: 1 }, written: { items: 4, citations: 12, formulas: 1 }, cacheHits: 3, cachedItems: 4 };
  assert.deepEqual(NLME.diffAudit(now, before), {
    expected: { items: 2, citations: 4, formulas: 0 }, written: { items: 1, citations: 3, formulas: 0 }, cacheHits: 1, cachedItems: 1
  });
  // No earlier snapshot: the whole audit
  assert.deepEqual(NLME.diffAudit(now, undefined), now);
});

test('partAudit gives one part its own item counts and keeps the rest of the diff', () => {
  const before = { expected: { items: 3, formulas: 1 }, written: { items: 3, formulas: 1 }, cacheHits: 0, cachedItems: 0 };
  const now = { expected: { items: 10, formulas: 3 }, written: { items: 7, formulas: 3 }, cacheHits: 0, cachedItems: 0 };
  // Part 2 attempted 3 sources (one failed) and wrote 2
  const part = NLME.partAudit(now, before, { attempted: 3, written: 2 });
  assert.deepEqual(part.expected, { items: 3, formulas: 2 });
  assert.deepEqual(part.written, { items: 2, formulas: 2 });
  // The run-wide audit is not modified
  assert.equal(now.expected.items, 10);
  // First part: no snapshot
  assert.equal(NLME.partAudit(now, undefined, { attempted: 4, written: 4 }).expected.items, 4);
});

test('unknownStudioIcons lists only unmapped icons', () => {
  assert.deepEqual(NLME.unknownStudioIcons(['tablet', 'copy', 'new_shape', 'article', 'new_shape', '']), ['new_shape']);
});

test('noteHasImages finds images in citation quotes, not only the body', () => {
  assert.equal(NLME.noteHasImages({ html: '<p>text</p>', sources: [{ quote: 'See ![fig](data:image/png;base64,AA)' }] }), true);
  assert.equal(NLME.noteHasImages({ html: '<p><img src="x"></p>', sources: [] }), true);
  assert.equal(NLME.noteHasImages({ html: '<p>text</p>', sources: [{ quote: 'plain' }] }), false);
});

test('countMarkdownFormulas counts each formula once in the final Markdown', () => {
  assert.equal(NLME.countMarkdownFormulas('a $x^2$ b $$\\frac{1}{2}$$ c $y$'), 3);
  assert.equal(NLME.countMarkdownFormulas('costs $5 and $10 today'), 0);
  assert.equal(NLME.countMarkdownFormulas(''), 0);
});

test('countMarkdownFormulas counts a formula touching a word, not a price', () => {
  assert.equal(NLME.countMarkdownFormulas('turn $x$rad and $MV /ME$ then $0.815$.'), 3);
  assert.equal(NLME.countMarkdownFormulas('$400 and $500'), 0);
  assert.equal(NLME.countMarkdownFormulas('word$x$ and (a $y$)'), 2);
});

test('pickDownloadMenuIndex can refuse a format the menu lacks', () => {
  const pdfOnly = ['share Share', 'drive_pdfDownload PDF Document (.pdf)', 'delete Delete'];
  assert.equal(NLME.pickDownloadMenuIndex(pdfOnly, 'pptx'), 1);
  assert.equal(NLME.pickDownloadMenuIndex(pdfOnly, 'pptx', { exact: true }), -1);
  assert.equal(NLME.pickDownloadMenuIndex(slideMenu, 'pptx', { exact: true }), 3);
  // neither PowerPoint nor PDF listed: no fall-through to the first Download item
  assert.equal(NLME.pickDownloadMenuIndex(audioMenu, 'pptx', { exact: true }), -1);
  assert.equal(NLME.pickDownloadMenuIndex(['save_alt Download', 'delete Delete'], 'pptx', { exact: true }), -1);
});

test('citationCoverage counts distinct markers against sources actually read', () => {
  const sources = [{ sourceIndex: '1', text: 'A', quote: 'q' }, { sourceIndex: '2', text: 'B', quote: '' }, { sourceIndex: '3', text: '', quote: '' }];
  assert.deepEqual(NLME.citationCoverage({ markerNumbers: ['1', '2', '3', '3'], sources, needQuotes: true }), { expected: 3, written: 1 });
  assert.deepEqual(NLME.citationCoverage({ markerNumbers: ['1', '2', '3'], sources, needQuotes: false }), { expected: 3, written: 2 });
});

test('groupCitationEntries puts all numbers of one source on one line, in first-seen order', () => {
  const groups = NLME.groupCitationEntries([
    { number: '1', text: 'Invent math' }, { number: '2', text: 'Invent math' },
    { number: '3', text: 'ZFC angels' }, { number: '4', text: 'Invent math' }
  ]);
  assert.deepEqual(groups, [
    { text: 'Invent math', numbers: ['1', '2', '4'] },
    { text: 'ZFC angels', numbers: ['3'] }
  ]);
});

test('groupCitationEntries keeps unavailable placeholders apart from real sources', () => {
  const groups = NLME.groupCitationEntries([
    { number: '1', text: '(citation details unavailable)', missing: true },
    { number: '2', text: '(citation details unavailable)', missing: true },
    { number: '3', text: 'A' }
  ]);
  assert.deepEqual(groups.map(g => g.numbers), [['1', '2'], ['3']]);
});

test('markWindowedQuote marks cut transcript windows only', () => {
  const mid = 'vanished from physics ' + 'x'.repeat(980) + ' his tra';
  assert.equal(NLME.markWindowedQuote(mid), '\u2026' + mid + '\u2026');
  const sentence = 'The ' + 'y'.repeat(990) + ' end.';
  assert.equal(NLME.markWindowedQuote(sentence), sentence);
  assert.equal(NLME.markWindowedQuote('short quote'), 'short quote');
});

test('markWindowedQuote keeps an ordered-list marker at the start', () => {
  const body = 'foo bar baz '.repeat(90);
  const dot = '1. ' + body + 'end.';
  assert.equal(NLME.markWindowedQuote(dot), dot);
  const paren = '12) ' + body + 'end.';
  assert.equal(NLME.markWindowedQuote(paren), paren);
  // The tail mark still applies; a plain digit start still gets the head mark
  assert.equal(NLME.markWindowedQuote('1. ' + body + 'cut'), '1. ' + body + 'cut\u2026');
  assert.equal(NLME.markWindowedQuote('2024 ' + body + 'end.'), '\u20262024 ' + body + 'end.');
});

test('markWindowedQuote marks one side at a time and honours min', () => {
  const startsMid = 'and then ' + 'x'.repeat(990) + ' end.';
  assert.equal(NLME.markWindowedQuote(startsMid), '\u2026' + startsMid);
  const endsMid = 'Start ' + 'x'.repeat(990) + ' mid';
  assert.equal(NLME.markWindowedQuote(endsMid), endsMid + '\u2026');
  assert.equal(NLME.markWindowedQuote('1 digit start and end 2', { min: 5 }), '\u20261 digit start and end 2\u2026');
  assert.equal(NLME.markWindowedQuote(''), '');
  assert.equal(NLME.markWindowedQuote(null), '');
});

test('markWindowedQuote ignores image Markdown when measuring', () => {
  const img = '![chart](data:image/png;base64,' + 'A'.repeat(3000) + ')';
  assert.equal(NLME.markWindowedQuote('short quote\n\n' + img), 'short quote\n\n' + img);
  assert.equal(NLME.markWindowedQuote(img), img);
  assert.equal(NLME.markWindowedQuote('and then a short one ' + img + ' end'), 'and then a short one ' + img + ' end');
  // A genuinely long window with an image still gets its mark
  const mid = 'vanished from physics ' + 'x'.repeat(980) + ' his tra';
  assert.equal(NLME.markWindowedQuote(mid + img), '\u2026' + mid + img);
});

test('jobRecordMode keeps a pending record of another kind', () => {
  const pending = NLME.newJobRecord({ id: 't-1', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { notes: ['a', 'b'] }, now: 1 });
  assert.equal(NLME.jobRecordMode(pending, 'sources'), 'update');
  assert.equal(NLME.jobRecordMode(pending, 'takeout'), 'create');
  const failedOnly = NLME.markJobItems(NLME.markJobItems(pending, 'notes', ['a'], { now: 2 }), 'notes', ['b'], { failed: true, now: 3 });
  assert.equal(NLME.jobRecordMode(failedOnly, 'sources'), 'update');
  const finished = NLME.markJobItems(NLME.markJobItems(pending, 'notes', ['a'], { now: 2 }), 'notes', ['b'], { now: 3 });
  assert.equal(NLME.jobRecordMode(finished, 'sources'), 'create');
  // A Full Takeout supersedes partial tab-export records
  const notesPending = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal(NLME.jobRecordMode(notesPending, 'takeout'), 'create');
  assert.equal(NLME.jobRecordMode(notesPending, 'sources'), 'update');
  assert.equal(NLME.jobRecordMode(undefined, 'sources'), 'create');
  assert.equal(NLME.jobRecordMode(null, 'sources'), 'create');
  assert.equal(NLME.jobRecordMode('junk', 'sources'), 'create');
  assert.equal(NLME.jobRecordMode({ kind: 'takeout', remaining: 'x', failed: {} }, 'sources'), 'create');
  assert.equal(NLME.jobRecordMode({ kind: 'takeout', remaining: { notes: ['a'] } }, 'sources'), 'create');
});

test('resumeBannerView words a stopped export and a finished one with failures', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a', 'b', 'c', 'd'] }, now: 1 });
  const stopped = NLME.markJobItems(r, 'notes', ['a'], { now: 2 });
  assert.deepEqual(NLME.resumeBannerView(stopped), {
    text: 'An earlier Notes export stopped at 1 of 4.', actionLabel: 'Resume (3 left)', failedOnly: false });
  let failedOnly = r;
  for (const k of ['a', 'b']) failedOnly = NLME.markJobItems(failedOnly, 'notes', [k], { now: 2 });
  for (const k of ['c', 'd']) failedOnly = NLME.markJobItems(failedOnly, 'notes', [k], { failed: true, now: 3 });
  assert.deepEqual(NLME.resumeBannerView(failedOnly), {
    text: 'An earlier Notes export finished with 2 failed.', actionLabel: 'Retry (2)', failedOnly: true });
  const takeout = NLME.newJobRecord({ id: 't-1', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal(NLME.resumeBannerView(NLME.markJobItems(takeout, 'notes', ['a'], { failed: true, now: 2 })).text,
    'An earlier Export everything finished with 1 failed.');
});

test('groupedSourcesMarkdown writes one line per source with every number anchored', () => {
  const entries = [{ number: '1', text: 'A' }, { number: '2', text: 'B' }, { number: '3', text: 'A' }];
  assert.equal(NLME.groupedSourcesMarkdown(entries, 'msg-0-'),
    '<a id="msg-0-src-1"></a><a id="msg-0-src-3"></a>\n**[[1]](#msg-0-cite-ref-1-1) [[3]](#msg-0-cite-ref-3-1)** A\n\n' +
    '<a id="msg-0-src-2"></a>\n**[[2]](#msg-0-cite-ref-2-1)** B\n\n');
  assert.equal(NLME.groupedSourcesMarkdown([], ''), '');
});

test('frontMatter quotes strings so any title stays valid YAML', () => {
  const fm = NLME.frontMatter({ title: 'Gödel: "proof" # 1\n---', count: 3, draft: false, tags: ['a', 'b'], empty: '', none: null });
  assert.equal(fm, '---\ntitle: "Gödel: \\"proof\\" # 1\\n---"\ncount: 3\ndraft: false\ntags: ["a","b"]\n---\n\n');
  assert.equal(NLME.frontMatter({ a: '', b: undefined }), '');
});

test('uniqueStems gives repeats -2, -3 and treats case-only differences as repeats', () => {
  assert.deepEqual(NLME.uniqueStems(['A', 'a', 'B', 'A', 'x/y']), ['A', 'a-2', 'B', 'A-3', 'x-y']);
  assert.deepEqual(NLME.uniqueStems(['', '']), ['untitled', 'untitled-2']);
});

test('uniqueStems treats stem+variant names as taken', () => {
  assert.deepEqual(NLME.uniqueStems(['Diagram', 'Diagram with images'], ['-with-images']), ['Diagram', 'Diagram-with-images-2']);
  assert.deepEqual(NLME.uniqueStems(['Diagram with images', 'Diagram'], ['-with-images']), ['Diagram-with-images', 'Diagram-2']);
  assert.deepEqual(NLME.uniqueStems(['Summary', 'summary CODE blocks'], ['-code-blocks']), ['Summary', 'summary-CODE-blocks-2']);
});

test('uniqueStems with taken numbers a name used in an earlier part', () => {
  const taken = new Set();
  const first = NLME.uniqueStems(["Arcturus's"], [], [], { taken });
  const second = NLME.uniqueStems(['Arcturus\u2019s'], [], [], { taken });
  assert.notEqual(first[0], second[0]);
  assert.equal(second[0], `${first[0]}-2`);
  assert.deepEqual(NLME.uniqueStems(['Other'], [], [], { taken }), ['Other']);
});

test('uniqueStems with taken also holds variant names', () => {
  const taken = new Set();
  NLME.uniqueStems(['Diagram'], ['-with-images'], [], { taken });
  assert.deepEqual(NLME.uniqueStems(['Diagram with images'], ['-with-images'], [], { taken }), ['Diagram-with-images-2']);
  assert.deepEqual(NLME.uniqueStems(['diagram'], ['-with-images'], [], { taken }), ['diagram-2']);
  // reserved names stay per call
  assert.deepEqual(NLME.uniqueStems(['errors'], [], ['errors'], { taken }), ['errors-2']);
  assert.deepEqual(NLME.uniqueStems(['errors'], [], [], { taken }), ['errors']);
});

test('uniqueStems without taken is unchanged', () => {
  assert.deepEqual(NLME.uniqueStems(['A', 'a']), ['A', 'a-2']);
  assert.deepEqual(NLME.uniqueStems(['A'], [], [], { taken: null }), ['A']);
  assert.deepEqual(NLME.uniqueStems(['A']), ['A']);
});

test('uniqueStems keeps reserved names free for package files', () => {
  assert.deepEqual(NLME.uniqueStems(['errors', 'Errors', 'Combined Notes'], [], ['errors', 'combined-notes']),
    ['errors-2', 'Errors-3', 'Combined-Notes-2']);
  assert.deepEqual(NLME.uniqueStems(['combined-notes'], ['-with-images'], ['combined-notes-with-images', 'combined-notes']),
    ['combined-notes-2']);
  assert.deepEqual(NLME.uniqueStems(['ERRORS'], [], ['errors']), ['ERRORS-2']);
  assert.deepEqual(NLME.uniqueStems(['errors']), ['errors']); // no reserved names: as before
});

test('exportMeta and notebookIdFromUrl describe the notebook', () => {
  const url = 'https://notebook.google.com/notebook/62d6e344-2fa7-42ed-b3ef-236f3007fdc3';
  assert.equal(NLME.notebookIdFromUrl(url), '62d6e344-2fa7-42ed-b3ef-236f3007fdc3');
  assert.equal(NLME.notebookIdFromUrl('https://example.com/'), '');
  assert.deepEqual(NLME.exportMeta({ notebookTitle: 'New Math', tabUrl: url, version: '1.4.0', exportedAt: new Date('2026-11-03T01:02:03Z') }), {
    notebook: 'New Math', notebook_url: url, notebook_id: '62d6e344-2fa7-42ed-b3ef-236f3007fdc3',
    exporter: 'NotebookLM Takeout 1.4.0', exported: '2026-11-03T01:02:03.000Z'
  });
});

test('buildManifest lists files with byte sizes and the notebook', () => {
  const meta = { notebook: 'N', notebook_url: 'u', notebook_id: 'i', exporter: 'NotebookLM Takeout 1.4.0', exported: 'T' };
  const m = NLME.buildManifest({ meta, kind: 'notes', files: [
    { path: 'notes/A.md', data: 'ü', title: 'A', variant: 'base', itemKind: 'note' },
    { path: 'audio/X.m4a', url: 'https://x' },
    { path: 'b.bin', data: new Uint8Array(5) }
  ], counts: { notes: 1 }, errorCount: 2 });
  assert.deepEqual(m.notebook, { title: 'N', url: 'u', id: 'i' });
  assert.equal(m.kind, 'notes'); assert.equal(m.partial, false); assert.equal(m.errorCount, 2);
  assert.deepEqual(m.files.map(f => f.bytes), [2, null, 5]);
  assert.equal(m.files[0].variant, 'base');
});

test('categoryIndexFrontMatter gives a category _index.md the same block as items, with kind index', () => {
  const meta = { notebook: 'N: Math', notebook_url: 'https://x/notebook/i', notebook_id: 'i', exporter: 'NotebookLM Takeout 1.7.0', exported: '2026-11-03T10:00:00.000Z' };
  assert.equal(NLME.categoryIndexFrontMatter(meta, { title: 'Notes \u2014 N: Math', category: 'notes' }),
    '---\n' +
    'title: "Notes \u2014 N: Math"\n' +
    'notebook: "N: Math"\n' +
    'notebook_url: "https://x/notebook/i"\n' +
    'notebook_id: "i"\n' +
    'exporter: "NotebookLM Takeout 1.7.0"\n' +
    'exported: "2026-11-03T10:00:00.000Z"\n' +
    'kind: "index"\n' +
    'category: "notes"\n' +
    '---\n\n');
  // A part of a split export says which one
  assert.match(NLME.categoryIndexFrontMatter(meta, { title: 'T', category: 'sources', part: 2 }), /category: "sources"\npart: 2\n---/);
});

test('buildManifest uses the size read after a url entry was downloaded', () => {
  const meta = { notebook: 'N', notebook_url: 'u', notebook_id: 'i', exporter: 'x', exported: 'T' };
  const m = NLME.buildManifest({ meta, kind: 'artifacts', files: [
    { path: 'slides/Deck.pptx', url: 'https://x', bytes: 2048 },
    { path: 'slides/Other.pdf', url: 'https://y', bytes: null },
    { path: 'slides/Third.pdf', url: 'https://z' }
  ] });
  assert.deepEqual(m.files.map(f => f.bytes), [2048, null, null]);
});

test('downloadSizeStatus reads fileSize only from a completed download', () => {
  assert.deepEqual(NLME.downloadSizeStatus({ state: 'complete', fileSize: 1234 }), { done: true, bytes: 1234 });
  // Chrome reports -1 when it does not know
  assert.deepEqual(NLME.downloadSizeStatus({ state: 'complete', fileSize: -1 }), { done: true, bytes: null });
  assert.deepEqual(NLME.downloadSizeStatus({ state: 'complete' }), { done: true, bytes: null });
  assert.deepEqual(NLME.downloadSizeStatus({ state: 'in_progress', fileSize: 10 }), { done: false, bytes: null });
  assert.deepEqual(NLME.downloadSizeStatus({ state: 'interrupted', fileSize: 10 }), { done: true, bytes: null });
  // Not found (erased from history): nothing more to wait for
  assert.deepEqual(NLME.downloadSizeStatus(undefined), { done: true, bytes: null });
});

test('zipName matches the existing pattern, with PARTIAL and parts', () => {
  assert.equal(NLME.zipName({ notebook: 'New Math', kind: 'notes', timestamp: 'T' }), 'New-Math-notes-T.zip');
  assert.equal(NLME.zipName({ notebook: 'a/b', kind: 'takeout-notes', timestamp: 'T', partial: true, part: 2, totalParts: 3 }), 'a-b-takeout-notes-T-PARTIAL-part2of3.zip');
});

test('artifactFolder and extensionFor', () => {
  assert.equal(NLME.artifactFolder('Audio Overview'), 'audio');
  assert.equal(NLME.artifactFolder('Mind Map'), 'mind-maps');
  assert.equal(NLME.artifactFolder('Flashcards'), 'flashcards');
  assert.equal(NLME.extensionFor({ url: 'https://contribution.usercontent.google.com/d?filename=Deck.pptx', mime: 'application/pdf' }), '.pptx');
  assert.equal(NLME.extensionFor({ mime: 'audio/mp4' }), '.m4a');
  assert.equal(NLME.extensionFor({ type: 'Video Overview' }), '.mp4');
  assert.equal(NLME.extensionFor({}), '');
});

test('extensionFor keeps a real URL path extension that no list knows, lower-cased', () => {
  assert.equal(NLME.extensionFor({ url: 'https://x/y/photo.JPEG' }), '.jpeg');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/photo.JPEG?size=large' }), '.jpeg');
  // A real URL extension beats the type guess; a known one also beats the MIME,
  // an unlisted one (.php, .def) does not
  assert.equal(NLME.extensionFor({ url: 'https://x/y/photo.jpeg', type: 'Infographic' }), '.jpeg');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/page.php', mime: 'image/png' }), '.png');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/page.php', type: 'Infographic' }), '.php');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/deck.pdf', mime: 'audio/mp4' }), '.pdf');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/photo.JPEG', mime: 'audio/mp4' }), '.m4a');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/noext', type: 'Infographic' }), '.png');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/a.pptx?filename=Deck.pdf' }), '.pdf');
  // No extension (or not one): today's result
  assert.equal(NLME.extensionFor({ url: 'https://x/y/noext' }), '');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/noext', type: 'Video Overview' }), '.mp4');
  assert.equal(NLME.extensionFor({ url: 'https://x/y.z/noext' }), '');
  assert.equal(NLME.extensionFor({ url: 'https://x/y/archive.toolongext' }), '');
  assert.equal(NLME.extensionFor({ url: 'not a url' }), '');
});

test('artifactStems makes stems unique per type folder only', () => {
  const items = [
    { type: 'Report', label: 'Overview' },
    { type: 'Slides', label: 'Overview' },
    { type: 'Report', label: 'overview' },
    { type: 'Data Table', label: 'Prices' },
    { type: 'Data Table', label: 'Prices references' }
  ];
  assert.deepEqual(NLME.artifactStems(items), ['Overview', 'Overview', 'overview-2', 'Prices', 'Prices-references-2']);
});

test('withRealExtension swaps a guessed known extension for the real one', () => {
  assert.equal(NLME.withRealExtension('Folder/Deck.pdf', '.pptx'), 'Folder/Deck.pptx');
  assert.equal(NLME.withRealExtension('Deck.pdf', '.PDF'), 'Deck.pdf');
  assert.equal(NLME.withRealExtension('Deck', '.pptx'), 'Deck.pptx');
  assert.equal(NLME.withRealExtension('Deck', ''), 'Deck');
  // Unknown extensions never replace a known one, and unknown endings stay
  assert.equal(NLME.withRealExtension('Deck.pdf', '.goog'), 'Deck.pdf');
  assert.equal(NLME.withRealExtension('Talk v1.10', '.m4a'), 'Talk v1.10');
});

test('buildRootIndex lists every category with its status and links errors', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'NotebookLM Takeout 1.4.0', exported: 'T' };
  const md = NLME.buildRootIndex({ meta, errorsFile: 'errors.md', categories: [
    { name: 'Sources', folder: 'sources', status: 'done', selected: 12, exported: 12, failed: 0, zips: ['a.zip'] },
    { name: 'Notes', folder: 'notes', status: 'partial', selected: 10, exported: 4, failed: 0, zips: ['b.zip'] },
    { name: 'Chat', folder: 'chat', status: 'skipped', selected: 17, exported: 0, failed: 0, zips: [] },
    { name: 'Artifacts', folder: 'artifacts', status: 'empty', selected: 0, exported: 0, failed: 0, zips: [] }
  ] });
  assert.match(md, /^---\n/);
  assert.match(md, /# Takeout — New Math/);
  assert.match(md, /\| Sources \| 12 of 12 \| 0 \| complete \| sources\/ \|/);
  assert.match(md, /\| Notes \| 4 of 10 \| 0 \| partial \(cancelled\) \| notes\/ \|/);
  assert.match(md, /\| Chat \| 0 of 17 \| 0 \| skipped \(cancelled earlier\) \| — \|/);
  assert.match(md, /\| Artifacts \| 0 of 0 \| 0 \| none in notebook \| — \|/);
  assert.match(md, /\[errors\.md\]\(errors\.md\)/);
  assert.match(md, /Unzip every ZIP into the same folder/);
});

test('buildRootIndex shows a folder only where files were written, part folders included', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const md = NLME.buildRootIndex({ meta, categories: [
    { name: 'Sources', folder: 'sources', status: 'failed', selected: 3, exported: 0, failed: 3, zips: [] },
    { name: 'Notes', folder: 'notes', status: 'done', selected: 60, exported: 60, failed: 0, zips: ['b1.zip', 'b2.zip'], parts: 2 },
    { name: 'Chat', folder: 'chat', status: 'skipped', selected: 17, exported: 0, failed: 0, zips: [] },
    { name: 'Artifacts', folder: 'artifacts', status: 'partial', selected: 9, exported: 2, failed: 0, zips: ['c.zip'], parts: 1 }
  ] });
  assert.match(md, /\| Sources \| 0 of 3 \| 3 \| failed \(see errors\) \| — \|/);
  assert.match(md, /\| Notes \| 60 of 60 \| 0 \| complete \| notes\/part-1\/ … notes\/part-2\/ \|/);
  assert.match(md, /\| Chat \| 0 of 17 \| 0 \| skipped \(cancelled earlier\) \| — \|/);
  assert.match(md, /\| Artifacts \| 2 of 9 \| 0 \| partial \(cancelled\) \| artifacts\/part-1\/ \|/);
  assert.doesNotMatch(md, /\| notes\/ \|/);
});

test('buildRootIndex links the folder of an errors-only package (folder mode: no zips, nothing exported)', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const categories = [
    // One batch, every item failed: the errors-only package is a written package
    { name: 'Sources', folder: 'sources', status: 'failed', selected: 3, exported: 0, failed: 3, zips: [], parts: 0, packages: 1 },
    // A part that was written before the category failed
    { name: 'Notes', folder: 'notes', status: 'failed', selected: 60, exported: 0, failed: 0, zips: [], parts: 1, packages: 1 },
    // Nothing reached the disk
    { name: 'Chat', folder: 'chat', status: 'failed', selected: 5, exported: 0, failed: 0, zips: [], parts: 0, packages: 0 }
  ];
  const md = NLME.buildRootIndex({ meta, categories });
  assert.match(md, /\| Sources \| 0 of 3 \| 3 \| failed \(see errors\) \| sources\/ \|/);
  assert.match(md, /\| Notes \| 0 of 60 \| 0 \| failed \(see errors\) \| notes\/part-1\/ \|/);
  assert.match(md, /\| Chat \| 0 of 5 \| 0 \| failed \(see errors\) \| — \|/);
  const html = NLME.buildRootIndexHtml({ meta, categories });
  assert.match(html, /href="sources\/_index\.html"/);
  assert.match(html, /href="notes\/part-1\/_index\.html"/);
  assert.doesNotMatch(html, /href="chat\//);
});

test('uniqueStems treats the NFC and NFD spellings of a name as one name', () => {
  const composed = 'Caf\u00e9';
  const decomposed = 'Cafe\u0301';
  assert.notEqual(composed, decomposed);
  const s = NLME.uniqueStems([composed, decomposed]);
  assert.notEqual(s[0].normalize('NFC'), s[1].normalize('NFC'));
  assert.equal(s[1].normalize('NFC'), 'Caf\u00e9-2');
  // Case still folds, variant suffixes and reserved names too
  assert.equal(NLME.uniqueStems(['CAF\u00c9', decomposed])[1].normalize('NFC'), 'Caf\u00e9-2');
  assert.equal(NLME.uniqueStems([decomposed], [], ['caf\u00e9'])[0].normalize('NFC'), 'Caf\u00e9-2');
  const withSuffix = NLME.uniqueStems([composed + ' plus', decomposed], [' plus']);
  assert.notEqual(withSuffix[0].normalize('NFC'), withSuffix[1].normalize('NFC'));
});

test('chatSelectedCount counts the messages the page showed, not only the readable ones', () => {
  assert.equal(NLME.chatSelectedCount({ messagePairs: [], stats: { pairsInDom: 3 } }), 3);
  assert.equal(NLME.chatSelectedCount({ messagePairs: [{}, {}], stats: { pairsInDom: 5 } }), 5);
  assert.equal(NLME.chatSelectedCount({ messagePairs: [{}, {}], stats: {} }), 2);
  assert.equal(NLME.chatSelectedCount({ messagePairs: [{}] }), 1);
  assert.equal(NLME.chatSelectedCount({ messagePairs: [] }), 0);
});

test('chatScanIsEmpty only when nothing was skipped', () => {
  assert.equal(NLME.chatScanIsEmpty({ messagePairs: [], stats: {} }), true);
  assert.equal(NLME.chatScanIsEmpty({ messagePairs: [] }), true);
  assert.equal(NLME.chatScanIsEmpty({ messagePairs: [], stats: { skipped: ['q1'] } }), false);
  assert.equal(NLME.chatScanIsEmpty({ messagePairs: [], stats: { skipped: [], collapsedRemaining: 2 } }), false);
  assert.equal(NLME.chatScanIsEmpty({ messagePairs: [{ userMessage: 'q', aiResponseHTML: 'a' }], stats: {} }), false);
});

test('takeoutCategoryStatus marks a run with no exports but errors as failed', () => {
  assert.equal(NLME.takeoutCategoryStatus({ selected: 0, exported: 0, failed: 0, errorCount: 3 }), 'failed');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 4, exported: 0, failed: 0, errorCount: 3 }), 'failed');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 4, exported: 0, failed: 4, errorCount: 4 }), 'failed');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 5, exported: 5, failed: 0, errorCount: 0 }), 'done');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 5, exported: 3, failed: 2, errorCount: 2 }), 'done');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 5, exported: 2, failed: 0, errorCount: 1, cancelled: true }), 'partial');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 5, exported: 0, failed: 0, errorCount: 1, cancelled: true }), 'partial');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 5, exported: 2, failed: 0, errorCount: 1, stopped: true }), 'stopped');
  assert.equal(NLME.takeoutCategoryStatus({ selected: 0, exported: 0, failed: 0, errorCount: 0 }), 'empty');
});

test('buildIndexHtml groups files by folder and encodes links', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'NotebookLM Takeout 1.4.0', exported: 'T' };
  const html = NLME.buildIndexHtml({ meta, heading: 'Notes — New Math', files: [
    { path: 'notes/A b.md', title: 'A <script>b', variant: 'base', data: 'hello' },
    { path: 'notes/A b-code-blocks.md', title: 'A b', variant: 'code-blocks' },
    { path: 'mind-maps/[mind-map]_M#1.svg' },
    { path: 'slides/D.pdf', url: 'https://x/d.pdf' },
    { path: 'combined-notes.md', title: 'Combined' },
    { path: 'manifest.json' },
    { path: '_index.html' }
  ] });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Notes — New Math<\/title>/);
  assert.match(html, /href="notes\/A%20b\.md"/);
  assert.match(html, /href="mind-maps\/%5Bmind-map%5D_M%231\.svg"/);
  assert.match(html, /<h2>notes<\/h2>/);
  assert.match(html, /<h2>mind-maps<\/h2>/);
  assert.match(html, /<h2>Files<\/h2>/);
  assert.doesNotMatch(html, /href="_index\.html"/);
  assert.match(html, /href="manifest\.json"/); // footer link only
  assert.equal(html.split('href="manifest.json"').length, 2);
  assert.match(html, /A &lt;script&gt;b/);
  assert.match(html, /<span class="type">Markdown · 5 B<\/span>/);
  assert.match(html, /<span class="type">PDF<\/span>/);
  assert.match(html, /<span class="type">SVG image<\/span>/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /https?:\/\/[^"' ]*\.(css|js)/);
});

test('buildIndexHtml groups flattened files by itemKind', () => {
  const meta = { notebook: 'NB', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const html = NLME.buildIndexHtml({ meta, heading: 'Takeout', files: [
    { path: 'A.md', itemKind: 'note' },
    { path: 'mind-maps/M.svg', itemKind: 'mindmap' },
    { path: 'S.md', itemKind: 'source' },
    { path: 'combined-notes.md', itemKind: 'combined-notes' },
    { path: 'slides/D.pdf' }
  ] });
  const heading = name => html.indexOf(`<h2>${name}</h2>`);
  assert.ok(heading('Notes') >= 0 && heading('Sources') >= 0 && heading('Mind maps') >= 0 && heading('Combined') >= 0);
  // Fixed order, then the path-grouped rest
  assert.ok(heading('Notes') < heading('Sources') && heading('Sources') < heading('Mind maps')
    && heading('Mind maps') < heading('Combined') && heading('Combined') < heading('slides'));
  const group = name => html.slice(heading(name), html.indexOf('</ul>', heading(name)));
  assert.match(group('Notes'), /href="A\.md"/);
  assert.match(group('Mind maps'), /href="mind-maps\/M\.svg"/);
  assert.match(group('Combined'), /href="combined-notes\.md"/);
  // An entry without itemKind still groups by its first path segment
  assert.match(group('slides'), /href="slides\/D\.pdf"/);
  // The spelling in the plan works too
  assert.match(NLME.buildIndexHtml({ meta, heading: 'T', files: [{ path: 'm.svg', itemKind: 'mind-map' }] }), /<h2>Mind maps<\/h2>/);
});

test('buildIndexHtml groups source-urls files with the sources', () => {
  const meta = { notebook: 'NB', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const html = NLME.buildIndexHtml({ meta, heading: 'Sources', files: [
    { path: 'sources/S.md', itemKind: 'source' },
    { path: 'sources/youtube-urls.txt', itemKind: 'source-urls' },
    { path: 'sources/youtube-urls.raw.txt', itemKind: 'source-urls' }
  ] });
  assert.equal((html.match(/<h2>/g) || []).length, 1);
  assert.match(html, /<h2>Sources<\/h2>/);
  assert.doesNotMatch(html, /<h2>sources<\/h2>/);
  assert.match(html, /youtube-urls\.raw\.txt/);
});

test('buildIndexHtml reads sensibly for a tab export under notes/ and sources/', () => {
  const meta = { notebook: 'NB', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const html = NLME.buildIndexHtml({ meta, heading: 'Notes', files: [
    { path: 'notes/A.md', itemKind: 'note' },
    { path: 'notes/A-code-blocks.md', itemKind: 'note', variant: 'code-blocks' },
    { path: 'sources/S.md', itemKind: 'source' },
    { path: 'errors.md' }
  ] });
  assert.equal(html.split('<h2>Notes</h2>').length, 2); // one Notes group, not notes/ plus Notes
  assert.match(html, /<h2>Sources<\/h2>/);
  assert.doesNotMatch(html, /<h2>notes<\/h2>/);
  assert.match(html, /href="notes\/A-code-blocks\.md"/);
});

test('fileTypeLabel names common export types', () => {
  assert.equal(NLME.fileTypeLabel('a.md'), 'Markdown');
  assert.equal(NLME.fileTypeLabel('deck.PPTX'), 'PowerPoint');
  assert.equal(NLME.fileTypeLabel('x.m4a'), 'Audio');
  assert.equal(NLME.fileTypeLabel('t.csv'), 'CSV');
  assert.equal(NLME.fileTypeLabel('m.svg'), 'SVG image');
  assert.equal(NLME.fileTypeLabel('f.xyz'), 'XYZ');
  assert.equal(NLME.fileTypeLabel('noext'), 'File');
  assert.equal(NLME.fileTypeLabel('dir.v2/noext'), 'File');
});

test('buildIndexHtml links the notebook and extra links', () => {
  const meta = { notebook: 'New Math', notebook_url: 'https://notebook.google.com/notebook/x', notebook_id: 'x', exporter: 'E', exported: 'T' };
  const html = NLME.buildIndexHtml({ meta, heading: 'Notes — New Math', files: [{ path: 'a.md' }], links: [{ href: 'errors.md', label: 'Errors' }, { href: '_index.md', label: 'Markdown index' }] });
  assert.match(html, /<a href="https:\/\/notebook\.google\.com\/notebook\/x"/);
  assert.match(html, /href="errors\.md"[^>]*>Errors</);
  assert.match(html, /href="_index\.md"/);
});

test('buildRootIndexHtml links each category\'s index', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const html = NLME.buildRootIndexHtml({ meta, errorsFile: 'errors.md', categories: [
    { name: 'Sources', folder: 'sources', status: 'done', selected: 12, exported: 12, failed: 0, zips: ['a.zip'] },
    { name: 'Notes', folder: 'notes', status: 'partial', selected: 10, exported: 4, failed: 0, zips: ['b.zip'], parts: 2 },
    { name: 'Chat', folder: 'chat', status: 'skipped', selected: 17, exported: 0, failed: 0, zips: [] },
    { name: 'Artifacts', folder: 'artifacts', status: 'empty', selected: 0, exported: 0, failed: 0, zips: [] }
  ] });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /href="sources\/_index\.html"/);
  assert.match(html, /href="notes\/part-1\/_index\.html"/);
  assert.match(html, /href="notes\/part-2\/_index\.html"/);
  assert.match(html, /partial \(cancelled\)/);
  assert.match(html, /none in notebook/);
  assert.doesNotMatch(html, /artifacts\/_index\.html/);
  assert.doesNotMatch(html, /chat\/_index\.html/); // skipped: nothing written
  assert.match(html, /<td>—<\/td>/);
  assert.match(html, /href="errors\.md"/);
  assert.match(html, /href="manifest\.json"/);
  assert.match(html, /href="_index\.md"/);
});

test('buildRootIndexHtml links part-1 when a multi-batch category wrote only its first batch', () => {
  const meta = { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'E', exported: 'T' };
  const html = NLME.buildRootIndexHtml({ meta, categories: [
    { name: 'Notes', folder: 'notes', status: 'partial', selected: 60, exported: 20, failed: 0, zips: ['b.zip'], parts: 1 }
  ] });
  assert.match(html, /href="notes\/part-1\/_index\.html"/);
  assert.doesNotMatch(html, /href="notes\/_index\.html"/);
});

test('prefixExportErrors puts the category in front of every error and keeps its type', () => {
  const errors = NLME.prefixExportErrors('Notes', [
    '[Algebra] Failed to extract: timeout',
    'Cancelled by user after 4 of 10 notes; the rest were not exported',
    { source: 'Paper.pdf', type: 'missing_summary', message: 'No summary' }
  ]);
  const report = NLME.buildErrorReport({ title: 'Takeout', errors });
  assert.match(report, /## ERROR \(1\)\n\n- Notes: Algebra: Failed to extract: timeout/);
  assert.match(report, /## CANCELLED \(1\)\n\n- Notes: Cancelled by user after 4 of 10 notes/);
  assert.match(report, /## MISSING SUMMARY \(1\)\n\n- Notes: Paper\.pdf: No summary/);
});

test('summarizeTakeoutOutcome gives one message for every category', () => {
  const cat = (name, status, selected, exported, extra = {}) =>
    ({ name, folder: name.toLowerCase(), status, selected, exported, failed: 0, zips: [], errorCount: 0, ...extra });
  const ok = NLME.summarizeTakeoutOutcome({ categories: [
    cat('Sources', 'done', 12, 12), cat('Notes', 'done', 10, 10), cat('Chat', 'done', 17, 17), cat('Artifacts', 'done', 5, 5)
  ] });
  assert.deepEqual(ok, { level: 'success', message: 'Takeout: sources 12/12, notes 10/10, chat 17/17, artifacts 5/5' });

  const cancelled = NLME.summarizeTakeoutOutcome({ categories: [
    cat('Sources', 'done', 12, 11, { failed: 1, errorCount: 1 }), cat('Notes', 'partial', 10, 4, { errorCount: 1 }),
    cat('Chat', 'skipped', 17, 0), cat('Artifacts', 'empty', 0, 0)
  ] });
  assert.equal(cancelled.level, 'warning');
  assert.equal(cancelled.message, 'Takeout: sources 11/12, notes 4/10 partial, chat skipped, artifacts none (see errors.md)');

  const audit = NLME.summarizeTakeoutOutcome({ auditOk: false, categories: [cat('Sources', 'done', 1, 1)] });
  assert.equal(audit.level, 'warning');
  assert.match(audit.message, /some content is missing, see _audit\.md/);

  const nothing = NLME.summarizeTakeoutOutcome({ categories: [
    cat('Sources', 'done', 3, 0, { failed: 3, errorCount: 3 }), cat('Notes', 'failed', 0, 0, { errorCount: 1 }), cat('Chat', 'empty', 0, 0)
  ] });
  assert.equal(nothing.level, 'error');
  assert.equal(nothing.message, 'Takeout: sources 0/3, notes failed, chat none (see errors.md)');
  assert.match(NLME.summarizeTakeoutOutcome({ categories: [cat('Sources', 'failed', 3, 0, { failed: 3, errorCount: 3 })] }).message,
    /^Takeout: sources 0\/3 failed \(see errors\.md\)$/);

  // A cancel before anything was written is a warning, not an error
  assert.equal(NLME.summarizeTakeoutOutcome({ categories: [cat('Sources', 'partial', 3, 0), cat('Notes', 'skipped', 2, 0)] }).level, 'warning');
  // An empty notebook is no failure
  assert.equal(NLME.summarizeTakeoutOutcome({ categories: [cat('Sources', 'empty', 0, 0)] }).level, 'info');
});

test('mimeForPath types files by extension', () => {
  assert.equal(NLME.mimeForPath('notes/A.md'), 'text/markdown');
  assert.equal(NLME.mimeForPath('manifest.json'), 'application/json');
  assert.equal(NLME.mimeForPath('t/X.CSV'), 'text/csv');
  assert.equal(NLME.mimeForPath('x.html'), 'text/html');
  assert.equal(NLME.mimeForPath('m.svg'), 'image/svg+xml');
  assert.equal(NLME.mimeForPath('r.txt'), 'text/plain');
  assert.equal(NLME.mimeForPath('audio/a.m4a'), 'application/octet-stream');
  assert.equal(NLME.mimeForPath('noext'), 'application/octet-stream');
});

test('singleArtifactPackage bundles data tables and mind maps like before', () => {
  const table = NLME.singleArtifactPackage({
    type: 'Data Table',
    title: 'Q3 Sales: Plan',
    files: [
      { path: '[data-table]_Q3-Sales-Plan.csv', data: 'a,b' },
      { path: '[data-table]_Q3-Sales-Plan.json', data: '{}' },
      { path: '[data-table]_Q3-Sales-Plan.html', data: '<table/>' },
      { path: '[data-table]_Q3-Sales-Plan-references.txt', data: '[1] x' }
    ]
  });
  assert.equal(table.zipName, '[data-table]_Q3-Sales-Plan.zip');
  assert.deepEqual(table.entries.map(e => e.path),
    ['Q3-Sales-Plan.csv', 'Q3-Sales-Plan.json', 'Q3-Sales-Plan.html', 'references.txt']);
  assert.equal(table.entries[0].data, 'a,b');
  assert.equal(table.entries[3].data, '[1] x');

  const map = NLME.singleArtifactPackage({
    type: 'Mind Map',
    title: 'Big Ideas',
    files: [
      { path: '[mind-map]_Big-Ideas.svg', data: '<svg/>' },
      { path: '[mind-map]_Big-Ideas.json', data: '{}' },
      { path: '[mind-map]_Big-Ideas.html', data: '<html/>' }
    ]
  });
  assert.equal(map.zipName, '[mind-map]_Big-Ideas.zip');
  assert.deepEqual(map.entries.map(e => e.path),
    ['[mind-map]_Big-Ideas.svg', '[mind-map]_Big-Ideas.json', '[mind-map]_Big-Ideas.html']);
  assert.equal(map.entries[1].data, '{}');

  // A lone CSV (no footnotes, no structured data) stays a plain file
  assert.equal(NLME.singleArtifactPackage({
    type: 'Data Table', title: 'T', files: [{ path: '[data-table]_T.csv', data: 'a' }]
  }), null);
  // Other types are never bundled
  assert.equal(NLME.singleArtifactPackage({
    type: 'Report', title: 'R', files: [{ path: 'a.md' }, { path: 'b.md' }]
  }), null);
});

test('chatCitationMode follows Citation detail with quotes as default', () => {
  assert.equal(NLME.chatCitationMode({ citationDetail: 'titles' }), 'titles');
  assert.equal(NLME.chatCitationMode({ citationDetail: 'none' }), 'none');
  assert.equal(NLME.chatCitationMode({}), 'quotes');
  assert.equal(NLME.chatCitationMode({ citationDetail: 'bogus' }), 'quotes');
  assert.equal(NLME.takeoutChatFullCitations, undefined);
});

test('slideFormatsFor gives both formats only when asked', () => {
  assert.deepEqual(NLME.slideFormatsFor('Slides', { both: true }), ['pdf', 'pptx']);
  assert.deepEqual(NLME.slideFormatsFor('Slides', { both: true, preferred: 'pptx' }), ['pdf', 'pptx']);
  assert.deepEqual(NLME.slideFormatsFor('Slides', { preferred: 'pptx' }), ['pptx']);
  assert.deepEqual(NLME.slideFormatsFor('Slides'), ['pdf']);
  assert.deepEqual(NLME.slideFormatsFor('Report', { both: true }), [null]);
  assert.deepEqual(NLME.slideFormatsFor('Report'), [null]);
});

test('extensionFor guesses the requested slide format when nothing else says', () => {
  assert.equal(NLME.extensionFor({ type: 'Slides', format: 'pptx' }), '.pptx');
  assert.equal(NLME.extensionFor({ type: 'Slides', format: 'pdf' }), '.pdf');
  assert.equal(NLME.extensionFor({ type: 'Slides' }), '.pdf');
  assert.equal(NLME.extensionFor({ type: 'Infographic', format: 'pptx' }), '.png');
});

const by = { titleOf: i => i.title, typeOf: i => i.type };
const items = [
  { title: 'Zeta', type: 'Note' }, { title: 'café notes', type: 'Note' },
  { title: 'Atom', type: 'Mindmap' }, { title: 'item 10', type: 'Note' }, { title: 'item 2', type: 'Note' }
];

test('listView matches case- and accent-insensitively', () => {
  assert.deepEqual(NLME.listView(items, { query: 'CAFE' }, by).indices, [1]);
  assert.deepEqual(NLME.listView(items, { query: 'item note' }, by).indices, [3, 4]);
});
test('listView filters by type chips and reports all types', () => {
  const v = NLME.listView(items, { types: ['Mindmap'] }, by);
  assert.deepEqual(v.indices, [2]);
  assert.deepEqual(v.types, [{ type: 'Note', count: 4 }, { type: 'Mindmap', count: 1 }]);
});
test('listView sorts by title numerically and by type', () => {
  assert.deepEqual(NLME.listView(items, { sort: 'title' }, by).indices, [2, 1, 4, 3, 0]);
  assert.deepEqual(NLME.listView(items, { sort: 'type' }, by).indices, [0, 1, 3, 4, 2]);
  assert.deepEqual(NLME.listView(items, { sort: 'bogus' }, by).indices, [0, 1, 2, 3, 4]);
});
test('listItemKeys keeps duplicate titles distinct', () => {
  const keys = NLME.listItemKeys([{ title: 'Summary', type: 'Note' }, { title: 'Summary', type: 'Note' }], by);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.equal(keys[1], 'Note\u0000Summary#2');
});
test('pruneSelection drops keys that are not visible', () => {
  assert.deepEqual([...NLME.pruneSelection(new Set(['a', 'b', 'c']), ['a', 'c'])], ['a', 'c']);
});
test('listSummary counts shown and selected', () => {
  assert.equal(NLME.listSummary({ shown: 12, total: 149, selected: 3 }), '12 of 149 shown · 3 selected');
});
test('listStateKey is per notebook and tab', () => {
  assert.equal(NLME.listStateKey('abc', 'notes'), 'nlme.list.abc.notes');
});
test('restoreListState keeps a saved state over a rescan', () => {
  const s = NLME.restoreListState({ query: 'atom', types: ['Mindmap', 'Gone'], sort: 'title', selected: ['k1', 'k9'] },
    { keys: ['k1', 'k2'], types: ['Note', 'Mindmap'], defaultSelected: 'all' });
  assert.equal(s.query, 'atom'); assert.equal(s.sort, 'title');
  assert.deepEqual(s.types, ['Mindmap']); // 'Gone' no longer exists
  assert.deepEqual([...s.selected], ['k1']); // 'k9' no longer exists
});
test('restoreListState falls back to the tab default', () => {
  assert.deepEqual([...NLME.restoreListState(null, { keys: ['a', 'b'], defaultSelected: 'all' }).selected], ['a', 'b']);
  assert.deepEqual([...NLME.restoreListState({ sort: 1 }, { keys: ['a'], defaultSelected: 'none' }).selected], []);
});

test('restoreListState gives items new since the save the tab default', () => {
  const saved = { selected: ['a'], known: ['a', 'b'] };
  assert.deepEqual([...NLME.restoreListState(saved, { keys: ['a', 'b', 'c'], defaultSelected: 'all' }).selected].sort(), ['a', 'c']);
  assert.deepEqual([...NLME.restoreListState(saved, { keys: ['a', 'b', 'c'], defaultSelected: 'none' }).selected], ['a']);
});
test('restoreListState without known keeps the saved selection as an allow-list', () => {
  const s = NLME.restoreListState({ selected: ['a'] }, { keys: ['a', 'b'], defaultSelected: 'all' });
  assert.deepEqual([...s.selected], ['a']);
  const bad = NLME.restoreListState({ selected: ['a'], known: 'nope' }, { keys: ['a', 'b'], defaultSelected: 'all' });
  assert.deepEqual([...bad.selected], ['a']);
});

test('combineRetryOutcomes merges the retried categories into one outcome', () => {
  const c = NLME.combineRetryOutcomes({ steps: [
    { name: 'Sources', message: 'Exported 2 of 3 sources (1 failed, see errors.md)', level: 'warning', saved: ['s.zip'], errors: ['[A] boom'], failedItems: [{ id: 'a' }] },
    { name: 'Notes', message: 'Exported 2 of 2 notes', level: 'success', saved: ['n.zip'], errors: [], failedItems: [] }
  ] });
  assert.equal(c.level, 'warning'); // the worst of the categories, not the last
  assert.deepEqual(c.lines, ['Sources: Exported 2 of 3 sources (1 failed, see errors.md)', 'Notes: Exported 2 of 2 notes']);
  assert.deepEqual(c.saved, ['s.zip', 'n.zip']);
  assert.deepEqual(c.errors.map(e => [e.type, e.title, e.message]), [['error', 'Sources: A', 'boom']]);
  assert.deepEqual(c.remaining, { Sources: [{ id: 'a' }], Notes: [] });
  assert.equal(c.remainingCount, 1);
  assert.match(c.message, /^Retry finished/);
  assert.match(c.message, /1 still failed/);
});
test('combineRetryOutcomes is a success only when every category is and nothing was skipped', () => {
  const ok = { name: 'Notes', message: 'Exported 1 of 1 notes', level: 'success', saved: [], errors: [], failedItems: [] };
  assert.equal(NLME.combineRetryOutcomes({ steps: [ok] }).level, 'success');
  assert.equal(NLME.combineRetryOutcomes({ steps: [ok, { ...ok, level: 'error' }] }).level, 'error');
  const stopped = NLME.combineRetryOutcomes({ steps: [ok], notRun: [{ name: 'Artifacts', failedItems: [1, 2] }] });
  assert.equal(stopped.level, 'warning');
  assert.match(stopped.message, /^Retry stopped before artifacts/);
  assert.equal(stopped.remainingCount, 2); // the skipped category's items still failed
  assert.deepEqual(stopped.remaining.Artifacts, [1, 2]);
  assert.equal(NLME.combineRetryOutcomes({ steps: [ok, { ...ok, level: 'error' }] }).remainingCount, 0);
});

test('groupErrorsForPanel groups by type and caps entries', () => {
  const errs = ['[A] boom', { type: 'message_skipped', message: 'm1' }, '[B] bang', { type: 'message_skipped', message: 'm2' }];
  const g = NLME.groupErrorsForPanel(errs, { perGroup: 1 });
  assert.deepEqual(g.map(x => [x.heading, x.count, x.entries.length, x.more]), [['Error', 2, 1, 1], ['Message skipped', 2, 1, 1]]);
  assert.deepEqual(g[0].entries[0], { item: 'A', message: 'boom' });
});
test('composeOutcome adds the error note and audit note as warnings', () => {
  const o = NLME.composeOutcome({ kind: 'messages', selected: 3, result: { exported: 3, failed: 0, cancelled: false }, auditOk: false, errorNote: '2 citation error(s), see errors.md' });
  assert.equal(o.level, 'warning');
  assert.match(o.message, /\(2 citation error\(s\), see errors\.md\) — some content is missing, see _audit\.md$/);
});
test('composeOutcome leaves the error note off a cancelled run', () => {
  const o = NLME.composeOutcome({ kind: 'notes', selected: 4, result: { exported: 2, failed: 0, cancelled: true }, errorNote: 'x' });
  assert.doesNotMatch(o.message, /\(x\)/);
});

test('takeoutZipChoice uses takeoutZip when it is a boolean, else autoZip', () => {
  assert.equal(NLME.takeoutZipChoice({ takeoutZip: true, autoZip: false }), true);
  assert.equal(NLME.takeoutZipChoice({ takeoutZip: false, autoZip: true }), false);
  assert.equal(NLME.takeoutZipChoice({ autoZip: true }), true);
  assert.equal(NLME.takeoutZipChoice({}), false);
});

test('zipName with an unknown total uses a -partN suffix', () => {
  assert.equal(NLME.zipName({ notebook: 'NB', kind: 'artifacts', timestamp: 'T', part: 2, totalParts: null }), 'NB-artifacts-T-part2.zip');
  assert.equal(NLME.zipName({ notebook: 'NB', kind: 'artifacts', timestamp: 'T', partial: true, part: 3, totalParts: null }), 'NB-artifacts-T-PARTIAL-part3.zip');
  assert.equal(NLME.zipName({ notebook: 'NB', kind: 'artifacts', timestamp: 'T', part: 1, totalParts: 1 }), 'NB-artifacts-T.zip');
  assert.equal(NLME.zipName({ notebook: 'NB', kind: 'artifacts', timestamp: 'T', part: 2, totalParts: 3 }), 'NB-artifacts-T-part2of3.zip');
});

test('filesByteSize sums the data size of each file entry', () => {
  assert.equal(NLME.filesByteSize([]), 0);
  assert.equal(NLME.filesByteSize(undefined), 0);
  assert.equal(NLME.filesByteSize([
    { path: 'a', data: new Blob(['12345']) },
    { path: 'b', data: new ArrayBuffer(10) },
    { path: 'c', data: new Uint8Array(7) },
    { path: 'd', data: 'abc' },
    { path: 'e', data: { size: 100 } },
    { path: 'f', url: 'https://x/y' },
    { path: 'g' }
  ]), 5 + 10 + 7 + 3 + 100);
});

test('fnv1a is stable 8-digit hex', () => {
  assert.equal(NLME.fnv1a(''), '811c9dc5');
  assert.equal(NLME.fnv1a('a'), 'e40c292c');
  assert.match(NLME.fnv1a('Gemini Notebook'), /^[0-9a-f]{8}$/);
});
test('citationCacheKey normalises whitespace', () => {
  const a = NLME.citationCacheKey({ kind: 'note', text: ' A  b\n c ', numbers: [1, 2] });
  const b = NLME.citationCacheKey({ kind: 'note', text: 'A b c', numbers: [1, 2] });
  assert.equal(a, b);
  assert.match(a, /^note:[0-9a-f]{8}:5:1\.2$/);
});
test('citationCacheKey changes when the text or the citation numbers change', () => {
  const base = { kind: 'note', text: 'Same text', numbers: [1, 2] };
  const k = NLME.citationCacheKey(base);
  assert.notEqual(k, NLME.citationCacheKey({ ...base, text: 'Same text!' }));
  assert.notEqual(k, NLME.citationCacheKey({ ...base, numbers: [1, 2, 3] }));
  assert.notEqual(k, NLME.citationCacheKey({ ...base, kind: 'chat' }));
});
test('cacheGet returns a copy or null', () => {
  const bucket = NLME.cachePut(null, 'k', [{ text: 'T', quote: 'Q' }], { now: 1 });
  const got = NLME.cacheGet(bucket, 'k');
  assert.deepEqual(got, [{ text: 'T', quote: 'Q' }]);
  got[0].quote = 'changed';
  assert.equal(NLME.cacheGet(bucket, 'k')[0].quote, 'Q');
  assert.equal(NLME.cacheGet(bucket, 'missing'), null);
  assert.equal(NLME.cacheGet('garbage', 'k'), null);
});
test('cachePut prunes oldest entries to stay under the cap', () => {
  const s = q => [{ text: 'T', quote: q }];
  let b = NLME.cachePut(null, 'a', s('x'.repeat(40)), { now: 1, maxBytes: 150 });
  b = NLME.cachePut(b, 'b', s('y'.repeat(40)), { now: 2, maxBytes: 150 });
  b = NLME.cachePut(b, 'c', s('z'.repeat(40)), { now: 3, maxBytes: 150 });
  assert.deepEqual(Object.keys(b.entries).sort(), ['b', 'c']);
  const big = NLME.cachePut(b, 'huge', s('w'.repeat(500)), { now: 4, maxBytes: 150 });
  assert.deepEqual(Object.keys(big.entries).sort(), ['b', 'c']);
});
test('pruneCitationBuckets keeps the most recent notebooks', () => {
  const meta = [{ key: 'nlme.cite.a', at: 5 }, { key: 'nlme.cite.b', at: 9 }, { key: 'nlme.cite.c', at: 1 }];
  assert.deepEqual(NLME.pruneCitationBuckets(meta, { keep: 2 }), ['nlme.cite.c']);
});
test('pruneListStates counts a notebook once, however many tabs it saved', () => {
  const k = (id, tab) => `nlme.list.${id}.${tab}`;
  const meta = [
    { key: k('a-1', 'notes'), at: 5 }, { key: k('a-1', 'sources'), at: 1 }, { key: k('a-1', 'generated'), at: 2 }, { key: k('a-1', 'chat'), at: 3 },
    { key: k('b-2', 'notes'), at: 9 },
    { key: k('c-3', 'notes'), at: 4 }, { key: k('c-3', 'sources'), at: 2 }
  ];
  // Newest per notebook: b-2 (9), a-1 (5), c-3 (4); keep 2 drops all of c-3
  assert.deepEqual(NLME.pruneListStates(meta, { keep: 2 }).sort(), [k('c-3', 'notes'), k('c-3', 'sources')]);
  // Under the cap: nothing to remove
  assert.deepEqual(NLME.pruneListStates(meta), []);
  assert.deepEqual(NLME.pruneListStates(null), []);
});
test('pruneListStates drops states without a timestamp first and never the current notebook', () => {
  const meta = [{ key: 'nlme.list.old.notes' }, { key: 'nlme.list.new.notes', at: 7 }, { key: 'nlme.list.mid.notes', at: 3 }];
  assert.deepEqual(NLME.pruneListStates(meta, { keep: 2 }), ['nlme.list.old.notes']);
  // The current notebook counts toward the cap but is never returned
  assert.deepEqual(NLME.pruneListStates(meta, { keep: 1, keepId: 'old' }).sort(), ['nlme.list.mid.notes', 'nlme.list.new.notes']);
  assert.deepEqual(NLME.pruneListStates(meta, { keep: 1, keepId: 'old' }).includes('nlme.list.old.notes'), false);
});
test('citationCacheBucketKey is per notebook', () => {
  assert.equal(NLME.citationCacheBucketKey('abc'), 'nlme.cite.abc');
});

// --- citation cache storage wrappers (fake chrome.storage.local) ---
function fakeStorage(initial = {}, { failGet = false, failSet = false } = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (failGet) throw new Error('get failed');
      if (keys === null || keys === undefined) return { ...data };
      const out = {};
      for (const k of [].concat(keys)) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) {
      if (failSet) throw new Error('quota');
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; }
  };
}
const srcs = [{ index: 1, text: 'T', quote: 'Q', href: '', sourceIndex: 1 }];

test('citationCacheWrite then citationCacheRead round-trips and keeps order', async () => {
  const st = fakeStorage();
  const two = [{ index: 1, text: 'A', quote: 'a', sourceIndex: 3 }, { index: 2, text: 'B', quote: 'b', sourceIndex: 1 }];
  assert.equal(await NLME.citationCacheWrite(st, 'nb1', 'note:k', two, { now: 10 }), true);
  assert.deepEqual(await NLME.citationCacheRead(st, 'nb1', 'note:k'), two);
  assert.equal(await NLME.citationCacheRead(st, 'nb1', 'note:other'), null);
  assert.equal(await NLME.citationCacheRead(st, 'nb2', 'note:k'), null);
  assert.deepEqual(st.data['nlme.cite.meta'], { 'nlme.cite.nb1': 10 });
});

test('citationCacheWrite prunes old notebooks and removes their buckets', async () => {
  const st = fakeStorage();
  for (let i = 1; i <= 4; i++) await NLME.citationCacheWrite(st, 'nb' + i, 'k', srcs, { now: i, keep: 2 });
  assert.deepEqual(Object.keys(st.data).filter(k => k !== 'nlme.cite.meta').sort(), ['nlme.cite.nb3', 'nlme.cite.nb4']);
  assert.deepEqual(Object.keys(st.data['nlme.cite.meta']).sort(), ['nlme.cite.nb3', 'nlme.cite.nb4']);
});

test('citation cache helpers never throw on storage errors or a missing notebook id', async () => {
  const bad = fakeStorage({}, { failGet: true, failSet: true });
  assert.equal(await NLME.citationCacheRead(bad, 'nb', 'k'), null);
  assert.equal(await NLME.citationCacheWrite(bad, 'nb', 'k', srcs, { now: 1 }), false);
  assert.equal(await NLME.citationCacheClear(bad), false);
  const ok = fakeStorage();
  assert.equal(await NLME.citationCacheRead(ok, '', 'k'), null);
  assert.equal(await NLME.citationCacheWrite(ok, '', 'k', srcs, { now: 1 }), false);
  assert.equal(await NLME.citationCacheRead(null, 'nb', 'k'), null);
  assert.equal(await NLME.citationCacheWrite(undefined, 'nb', 'k', srcs, { now: 1 }), false);
  assert.deepEqual(ok.data, {});
});

test('versionLess compares dotted versions numerically', () => {
  assert.equal(NLME.versionLess('1.6.0', '1.7.0'), true);
  assert.equal(NLME.versionLess('1.7.0', '1.7.0'), false);
  assert.equal(NLME.versionLess('1.7.1', '1.7.0'), false);
  assert.equal(NLME.versionLess('1.9.0', '1.10.0'), true);
  assert.equal(NLME.versionLess('1.6', '1.6.1'), true);
  assert.equal(NLME.versionLess('1.7', '1.7.0'), false);
  assert.equal(NLME.versionLess('0.9.9', '1.0.0'), true);
});

test('versionLess treats a missing or malformed version as not older', () => {
  assert.equal(NLME.versionLess(undefined, '1.7.0'), false);
  assert.equal(NLME.versionLess('', '1.7.0'), false);
  assert.equal(NLME.versionLess('abc', '1.7.0'), false);
  assert.equal(NLME.versionLess('1.6.0', undefined), false);
});

test('shouldClearCitationCache fires only on an update from before 1.7.0 to 1.7.0 or later', () => {
  const clear = (details, current) => NLME.shouldClearCitationCache(details, current);
  assert.equal(clear({ reason: 'update', previousVersion: '1.6.0' }, '1.7.0'), true);
  assert.equal(clear({ reason: 'update', previousVersion: '1.5.2' }, '1.7.1'), true);
  // Fresh install: the cache is empty anyway
  assert.equal(clear({ reason: 'install' }, '1.7.0'), false);
  assert.equal(clear({ reason: 'install', previousVersion: '1.6.0' }, '1.7.0'), false);
  // Already on 1.7.0 or later: a reload or a later update keeps the cache
  assert.equal(clear({ reason: 'update', previousVersion: '1.7.0' }, '1.7.0'), false);
  assert.equal(clear({ reason: 'update', previousVersion: '1.7.0' }, '1.7.1'), false);
  // An update that stays before 1.7.0 has no new converter
  assert.equal(clear({ reason: 'update', previousVersion: '1.5.0' }, '1.6.0'), false);
  // browser update / shared module update / missing details
  assert.equal(clear({ reason: 'chrome_update' }, '1.7.0'), false);
  assert.equal(clear(undefined, '1.7.0'), false);
  // No previousVersion on an update: cannot say it is older
  assert.equal(clear({ reason: 'update' }, '1.7.0'), false);
});

test('citationCacheClear removes every nlme.cite.* key and nothing else', async () => {
  const st = fakeStorage({ settings: { a: 1 }, 'nlme.cite.nb1': { entries: {} }, 'nlme.cite.meta': { 'nlme.cite.nb1': 1 }, 'nlme.other': 1 });
  assert.equal(await NLME.citationCacheClear(st), true);
  assert.deepEqual(Object.keys(st.data).sort(), ['nlme.other', 'settings']);
});

test('citationCacheClear lists keys with getKeys instead of loading all of storage', async () => {
  const st = fakeStorage({ settings: { a: 1 }, 'nlme.cite.nb1': { entries: {} }, 'nlme.cite.meta': {}, 'nlme.other': 1 });
  const plainGet = st.get;
  st.get = async keys => { if (keys === null || keys === undefined) throw new Error('get(null) must not be used'); return plainGet(keys); };
  st.getKeys = async () => Object.keys(st.data);
  assert.equal(await NLME.citationCacheClear(st), true);
  assert.deepEqual(Object.keys(st.data).sort(), ['nlme.other', 'settings']);
});

test('citationCacheClear without getKeys removes the buckets the meta map lists, then the meta', async () => {
  const st = fakeStorage({ settings: { a: 1 }, 'nlme.cite.nb1': { entries: {} }, 'nlme.cite.nb2': { entries: {} },
    'nlme.cite.meta': { 'nlme.cite.nb1': 1, 'nlme.cite.nb2': 2 }, 'nlme.other': 1 });
  const plainGet = st.get;
  st.get = async keys => { if (keys === null || keys === undefined) throw new Error('get(null) must not be used'); return plainGet(keys); };
  assert.equal(await NLME.citationCacheClear(st), true);
  assert.deepEqual(Object.keys(st.data).sort(), ['nlme.other', 'settings']);
});

test('citationCacheClear falls back to get(null) only when nothing else tells the keys', async () => {
  const st = fakeStorage({ settings: { a: 1 }, 'nlme.cite.nb1': { entries: {} } });
  assert.equal(await NLME.citationCacheClear(st), true);
  assert.deepEqual(Object.keys(st.data), ['settings']);
});

test('citationSourcesComplete accepts only full sets with quotes', () => {
  const ok = [{ text: 'A', quote: 'a' }, { text: 'B', quote: 'b' }];
  assert.equal(NLME.citationSourcesComplete(ok, 2), true);
  assert.equal(NLME.citationSourcesComplete(ok, 3), false);
  assert.equal(NLME.citationSourcesComplete([{ text: 'A', quote: '' }], 1), false);
  assert.equal(NLME.citationSourcesComplete([{ text: '', quote: 'a' }], 1), false);
  assert.equal(NLME.citationSourcesComplete([], 0), false);
  assert.equal(NLME.citationSourcesComplete(null, 1), false);
});

test('citationCacheRead lists an unlisted bucket in the meta map', async () => {
  const st = fakeStorage({ 'nlme.cite.nb1': { entries: { k: { sources: srcs, at: 1, bytes: 10 } } } });
  assert.deepEqual(await NLME.citationCacheRead(st, 'nb1', 'k'), srcs);
  assert.ok(typeof st.data['nlme.cite.meta']['nlme.cite.nb1'] === 'number');
  const before = st.data['nlme.cite.meta']['nlme.cite.nb1'];
  await NLME.citationCacheRead(st, 'nb1', 'k');
  assert.equal(st.data['nlme.cite.meta']['nlme.cite.nb1'], before);
  const empty = fakeStorage();
  await NLME.citationCacheRead(empty, 'nb9', 'k');
  assert.deepEqual(empty.data, {});
});

test('citation cache limits are 10 MB per notebook and 20 notebooks', () => {
  assert.equal(NLME.CITE_MAX_BYTES_PER_NOTEBOOK, 10 * 1024 * 1024);
  assert.equal(NLME.CITE_KEEP_NOTEBOOKS, 20);
});

test('jobRecord helpers track remaining and failed keys', () => {
  let r = NLME.newJobRecord({ id: 'notes-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a', 'b', 'c'] }, now: 1 });
  assert.equal(NLME.jobRemainingCount(r), 3);
  r = NLME.markJobItem(r, 'notes', 'a', { now: 2 });
  r = NLME.markJobItem(r, 'notes', 'b', { failed: true, now: 3 });
  assert.deepEqual(r.remaining.notes, ['c']);
  assert.deepEqual(r.failed.notes, ['b']);
  assert.equal(NLME.jobRemainingCount(r), 2);
  assert.equal(r.updatedAt, 3);
  r = NLME.markJobItem(r, 'notes', 'c', { now: 4 });
  assert.equal(NLME.jobRecordFinished(r), false); // 'b' is still failed
  r = NLME.markJobItem(r, 'notes', 'b', { now: 5 }); // a later success clears the failure
  assert.deepEqual(r.failed.notes, []);
  assert.equal(NLME.jobRecordFinished(r), true);
});

test('jobRecord helpers replace and clear by id', () => {
  assert.equal(NLME.jobRecordKey('nb'), 'nlme.job.nb');
  const r = NLME.newJobRecord({ id: 'takeout-9', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { sources: ['s'], notes: [], artifacts: ['x'] }, now: 9 });
  assert.deepEqual(Object.keys(r.remaining), ['sources', 'notes', 'artifacts']);
  assert.deepEqual(r.failed, { sources: [], notes: [], artifacts: [] });
  assert.equal(r.startedAt, 9);
  assert.equal(NLME.jobRemainingCount(r), 2);
});

test('markJobItem does not change the record it is given', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a', 'b'] }, now: 1 });
  const next = NLME.markJobItem(r, 'notes', 'a', { failed: true, now: 2 });
  assert.deepEqual(r.remaining.notes, ['a', 'b']);
  assert.deepEqual(r.failed.notes, []);
  assert.deepEqual(next.remaining.notes, ['b']);
  assert.deepEqual(next.failed.notes, ['a']);
});

test('markJobItem tolerates a category the record does not have', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  const next = NLME.markJobItem(r, 'sources', 'z', { failed: true, now: 2 });
  assert.deepEqual(next.failed.sources, ['z']);
  assert.deepEqual(next.remaining.notes, ['a']);
});

test('markJobItems marks only keys the record holds', () => {
  const r = NLME.newJobRecord({ id: 'takeout-1', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { sources: ['s1', 's2'], notes: ['n1'] }, now: 1 });
  const failedOnce = NLME.markJobItems(r, 'sources', ['s1', 'zzz'], { failed: true, now: 2 });
  assert.deepEqual(failedOnce.remaining.sources, ['s2']);
  assert.deepEqual(failedOnce.failed.sources, ['s1']); // 'zzz' is not in the record: ignored
  assert.deepEqual(failedOnce.remaining.notes, ['n1']); // other categories untouched
  const cleared = NLME.markJobItems(failedOnce, 'sources', ['s1', 's2'], { now: 3 });
  assert.deepEqual(cleared.failed.sources, []);
  assert.equal(NLME.jobRemainingCount(cleared), 1);
  assert.equal(cleared.updatedAt, 3);
});

test('markJobItems returns the same record when nothing matches', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal(NLME.markJobItems(r, 'notes', ['x'], { now: 2 }), r);
  assert.equal(NLME.markJobItems(r, 'sources', ['a'], { now: 2 }), r);
  assert.equal(NLME.markJobItems(r, 'notes', [], { now: 2 }), r);
});

test('matchResumeItems reports keys that no longer exist', () => {
  const by = { titleOf: i => i.title, typeOf: i => i.type };
  const items = [{ title: 'A', type: 'Note' }, { title: 'B', type: 'Note' }];
  const keys = NLME.listItemKeys(items, by);
  const r = NLME.matchResumeItems([keys[1], 'Note\u0000Gone'], items, by);
  assert.deepEqual(r.matched, [items[1]]);
  assert.deepEqual(r.missing, ['Note\u0000Gone']);
});

test('matchResumeItems keeps duplicates apart by their #n suffix and returns scan order', () => {
  const by = { titleOf: i => i.title, typeOf: i => i.type };
  const items = [{ title: 'A', type: 'Note', id: 1 }, { title: 'A', type: 'Note', id: 2 }, { title: 'B', type: 'Note', id: 3 }];
  const keys = NLME.listItemKeys(items, by);
  const r = NLME.matchResumeItems([keys[2], keys[1]], items, by);
  assert.deepEqual(r.matched.map(i => i.id), [2, 3]);
  assert.deepEqual(r.missing, []);
  // Only one "A" left: its "#2" is gone, never matched to the first
  const fewer = [items[0], items[2]];
  const r2 = NLME.matchResumeItems([keys[1]], fewer, by);
  assert.deepEqual(r2.matched, []);
  assert.deepEqual(r2.missing, [keys[1]]);
});

test('matchResumeItems ignores repeated keys and empty input', () => {
  const by = { titleOf: i => i.title, typeOf: i => i.type };
  const items = [{ title: 'A', type: 'T' }];
  const key = NLME.listItemKeys(items, by)[0];
  assert.deepEqual(NLME.matchResumeItems([key, key], items, by), { matched: items, missing: [] });
  assert.deepEqual(NLME.matchResumeItems([], items, by), { matched: [], missing: [] });
  assert.deepEqual(NLME.matchResumeItems(['x', 'x'], [], by), { matched: [], missing: ['x'] });
  assert.deepEqual(NLME.matchResumeItems(null, null, by), { matched: [], missing: [] });
});

test('jobResumeKeys lists remaining then failed keys of a category without repeats', () => {
  const r = { remaining: { notes: ['a', 'b'] }, failed: { notes: ['b', 'c'], sources: ['s'] } };
  assert.deepEqual(NLME.jobResumeKeys(r, 'notes'), ['a', 'b', 'c']);
  assert.deepEqual(NLME.jobResumeKeys(r, 'sources'), ['s']);
  assert.deepEqual(NLME.jobResumeKeys(r, 'artifacts'), []);
});

test('newJobRecord stores total, the number of keys it started with', () => {
  const r = NLME.newJobRecord({ id: 't-1', kind: 'takeout', label: 'Full Takeout', notebookId: 'nb', keysByCategory: { sources: ['s1', 's2'], notes: ['n'], artifacts: [] }, now: 1 });
  assert.equal(r.total, 3);
});

test('jobResumeProgress gives done and total, tolerating a record without total', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a', 'b', 'c', 'd'] }, now: 1 });
  const part = NLME.markJobItems(r, 'notes', ['a'], { now: 2 });
  assert.deepEqual(NLME.jobResumeProgress(part), { done: 1, total: 4, left: 3 });
  const old = { ...part }; delete old.total;
  assert.deepEqual(NLME.jobResumeProgress(old), { done: 0, total: 3, left: 3 });
});

test('jobKeyTitle shows the title part of a key', () => {
  assert.equal(NLME.jobKeyTitle('Note\u0000My note'), 'My note');
  assert.equal(NLME.jobKeyTitle('Note\u0000My note#2'), 'My note#2');
  assert.equal(NLME.jobKeyTitle('plain'), 'plain');
});

test('combineRetryOutcomes names a resume and lists keys that are gone', () => {
  const ok = { name: 'Notes', message: '3 notes', level: 'success', saved: ['n.zip'], errors: [], failedItems: [] };
  const c = NLME.combineRetryOutcomes({ steps: [ok], verb: 'Resume', extraErrors: [{ type: 'not_found', title: 'Notes', message: 'X is no longer in the notebook' }] });
  assert.equal(c.message, 'Resume finished');
  assert.equal(c.level, 'warning');
  assert.equal(c.errors.length, 1);
  assert.equal(c.errors[0].type, 'not_found');
  const stopped = NLME.combineRetryOutcomes({ steps: [ok], notRun: [{ name: 'Artifacts', failedItems: [1] }], verb: 'Resume' });
  assert.match(stopped.message, /^Resume stopped before artifacts/);
  // Default verb unchanged
  assert.equal(NLME.combineRetryOutcomes({ steps: [ok] }).message, 'Retry finished');
});

test('combineRetryOutcomes with no step run still reports the extra errors', () => {
  const c = NLME.combineRetryOutcomes({ steps: [], verb: 'Resume', extraErrors: [{ type: 'not_found', title: 'Notes', message: 'X is no longer in the notebook' }] });
  assert.equal(c.errors.length, 1);
  assert.equal(c.remainingCount, 0);
});

test('jobRecordUsable accepts only a whole record of this notebook with items left', () => {
  const r = NLME.newJobRecord({ id: 'n-1', kind: 'notes', label: 'Notes', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal(NLME.jobRecordUsable(r, 'nb'), true);
  assert.equal(NLME.jobRecordUsable(r, 'other'), false);
  assert.equal(NLME.jobRecordUsable(r, ''), false);
  assert.equal(NLME.jobRecordUsable(NLME.markJobItems(r, 'notes', ['a'], { now: 2 }), 'nb'), false); // nothing left
  assert.equal(NLME.jobRecordUsable(null, 'nb'), false);
  assert.equal(NLME.jobRecordUsable({ notebookId: 'nb', remaining: { notes: 'a' }, failed: {} }, 'nb'), false);
  assert.equal(NLME.jobRecordUsable({ notebookId: 'nb', remaining: [], failed: {} }, 'nb'), false);
  assert.equal(NLME.jobRecordUsable({ notebookId: 'nb', id: 'x' }, 'nb'), false);
});

test('planResume: a scan that matches nothing proves nothing is gone', () => {
  const by = { titleOf: i => i.title, typeOf: i => i.type };
  const items = [{ title: 'Other', type: 'Note' }];
  const r = NLME.planResume(['Note\u0000A', 'Note\u0000B'], items, by);
  assert.deepEqual(r, { matched: [], missing: [], unknown: ['Note\u0000A', 'Note\u0000B'] });
});

test('planResume: with matches, absent keys are missing', () => {
  const by = { titleOf: i => i.title, typeOf: i => i.type };
  const items = [{ title: 'A', type: 'Note' }, { title: 'B', type: 'Note' }];
  const r = NLME.planResume(['Note\u0000A', 'Note\u0000Gone'], items, by);
  assert.deepEqual(r.matched, [items[0]]);
  assert.deepEqual(r.missing, ['Note\u0000Gone']);
  assert.deepEqual(r.unknown, []);
});

test('planResume decides missing per region when regionOfType is given', () => {
  const SRC = 'Note (Sources panel)';
  const by = { titleOf: i => i.title, typeOf: i => i.type, regionOfType: t => (t === SRC ? 'sources' : 'studio') };
  // Only the Sources-panel notes were drawn: Studio keys are unknown, not missing
  const onlySourcePanel = [{ title: 'S1', type: SRC }];
  const keys = ['Note\u0000Studio1', `${SRC}\u0000S1`, `${SRC}\u0000S-gone`];
  const r = NLME.planResume(keys, onlySourcePanel, by);
  assert.deepEqual(r.matched, onlySourcePanel);
  assert.deepEqual(r.unknown, ['Note\u0000Studio1']);
  assert.deepEqual(r.missing, [`${SRC}\u0000S-gone`]);
  // Both regions drawn: a gone Studio key is missing
  const both = [{ title: 'S1', type: SRC }, { title: 'Other', type: 'Note' }];
  const r2 = NLME.planResume(keys, both, by);
  assert.deepEqual(r2.missing.sort(), ['Note\u0000Studio1', `${SRC}\u0000S-gone`].sort());
  assert.deepEqual(r2.unknown, []);
});

test('groupErrorsForPanel lists panel-only resume errors in full', () => {
  const errs = Array.from({ length: 25 }, (_, i) => ({ type: 'not_found', title: 'Notes', message: `n${i} is no longer in the notebook` }));
  const g = NLME.groupErrorsForPanel(errs);
  assert.equal(g[0].entries.length, 25);
  assert.equal(g[0].more, 0);
  const real = NLME.groupErrorsForPanel(Array.from({ length: 25 }, (_, i) => `[x${i}] boom`));
  assert.equal(real[0].more, 5);
});

test('resumeBannerText says export unless the label is a takeout', () => {
  assert.equal(NLME.resumeBannerLabel({ kind: 'notes', label: 'Notes' }), 'Notes export');
  assert.equal(NLME.resumeBannerLabel({ kind: 'takeout', label: 'Export everything' }), 'Export everything');
  assert.equal(NLME.resumeBannerLabel({ kind: 'takeout', label: 'Full Takeout' }), 'Export everything', 'a record from before 1.9.3');
  assert.equal(NLME.resumeBannerLabel({}), 'export');
});

test('isNotesHeaderText matches the Notes group header only', () => {
  assert.equal(NLME.isNotesHeaderText('Notes'), true);
  assert.equal(NLME.isNotesHeaderText('  Notes \n'), true);
  assert.equal(NLME.isNotesHeaderText('Notes (3)'), true);
  assert.equal(NLME.isNotesHeaderText('Notes(12)'), true);
  assert.equal(NLME.isNotesHeaderText('Notes and Papers'), false);
  assert.equal(NLME.isNotesHeaderText('Notes on Physics'), false);
  assert.equal(NLME.isNotesHeaderText('keyboard_arrow_downNotes'), false);
  assert.equal(NLME.isNotesHeaderText('Sources'), false);
  assert.equal(NLME.isNotesHeaderText(''), false);
  assert.equal(NLME.isNotesHeaderText(null), false);
});

test('studioTargetMatches needs the exact label', () => {
  assert.equal(NLME.studioTargetMatches('  My note \n', 'My note'), true);
  assert.equal(NLME.studioTargetMatches('My note 2', 'My note'), false);
  assert.equal(NLME.studioTargetMatches('', 'My note'), false);
  assert.equal(NLME.studioTargetMatches(null, 'My note'), false);
  assert.equal(NLME.studioTargetMatches('My note', ''), false);
  assert.equal(NLME.studioTargetMatches('My note', undefined), false);
});

test('NLME.MSG is frozen and maps each type name to itself', () => {
  assert.equal(Object.isFrozen(NLME.MSG), true);
  assert.equal(NLME.MSG.EXTRACT_NOTE, 'EXTRACT_NOTE');
  for (const [key, value] of Object.entries(NLME.MSG)) assert.equal(value, key);
});

// ---- Milestone 3d Task 5: footnote citations and Obsidian-friendly names ----

test('footnoteLabel is unique per item in combined output', () => {
  // Single-item files: the plain citation number
  assert.equal(NLME.footnoteLabel(0, 3), '3');
  assert.equal(NLME.footnoteLabel(4, 3, { combined: false }), '3');
  // Combined files: item number first, so note 1's [1] and note 2's [1] differ
  assert.equal(NLME.footnoteLabel(0, 1, { combined: true }), '1-1');
  assert.equal(NLME.footnoteLabel(1, 1, { combined: true }), '2-1');
  const labels = [];
  for (let item = 0; item < 4; item++) for (let n = 1; n <= 12; n++) labels.push(NLME.footnoteLabel(item, n, { combined: true }));
  assert.equal(new Set(labels).size, labels.length);
  // 1-11 vs 11-1 never collide (the item part always ends at the first dash)
  assert.notEqual(NLME.footnoteLabel(0, 11, { combined: true }), NLME.footnoteLabel(10, 1, { combined: true }));
});

test('footnoteLabel keeps a label a footnote can carry', () => {
  assert.equal(NLME.footnoteLabel(0, 'a b]^'), 'a-b-');
});

test('footnoteDefinition writes title and quote inline, continuation lines indented by 4 spaces', () => {
  assert.equal(NLME.footnoteDefinition('2', 'Source A', 'one line'), '[^2]: **Source A** — one line');
  assert.equal(NLME.footnoteDefinition('2', 'Source A', 'first\nsecond\n\nthird'),
    '[^2]: **Source A** — first\n    second\n\n    third');
  assert.equal(NLME.footnoteDefinition('2', 'Source A', ''), '[^2]: **Source A**');
  assert.equal(NLME.footnoteDefinition('2', '', 'only a quote'), '[^2]: only a quote');
  assert.equal(NLME.footnoteDefinition('2', 'A\nB', null), '[^2]: **A B**');
});

test('footnoteDefinitions writes one definition per entry, even for titles-only sources', () => {
  const entries = [
    { number: '1', text: 'Same', quote: '' },
    { number: '2', text: 'Same', quote: '' },
    { number: '3', text: '(citation details unavailable)', quote: '', missing: true }
  ];
  const out = NLME.footnoteDefinitions(entries, n => `x${n}`);
  assert.equal(out, '[^x1]: **Same**\n\n[^x2]: **Same**\n\n[^x3]: **(citation details unavailable)**\n\n');
  assert.equal(NLME.footnoteDefinitions([], n => n), '');
  // A repeated number still gets one definition
  assert.equal(NLME.footnoteDefinitions([{ number: '1', text: 'A' }, { number: '1', text: 'B' }], n => n), '[^1]: **A**\n\n');
});

test('obsidianSafeName strips link-breaking characters into single spaces', () => {
  assert.equal(NLME.obsidianSafeName('[mind-map] Title'), 'mind-map Title');
  assert.equal(NLME.obsidianSafeName('A#B^C|D\\E:F*G?H"I<J>K'), 'A B C D E F G H I J K');
  assert.equal(NLME.obsidianSafeName('a ## b'), 'a b');
  assert.equal(NLME.obsidianSafeName('Plain name'), 'Plain name');
  assert.equal(NLME.obsidianSafeName(null), '');
});

test('obsidianSafeName keeps names unique through uniqueStems', () => {
  const stems = NLME.uniqueStems(['A#B', 'A B', 'A[B]'], [], [], { obsidian: true });
  assert.equal(new Set(stems.map(s => s.toLowerCase())).size, 3);
  assert.equal(stems.every(s => !/[\[\]#^|\\:*?"<>]/.test(s)), true);
  // Brackets survive sanitizeFilename, so the option does change them
  assert.deepEqual(NLME.uniqueStems(['A[1]']), ['A[1]']);
  assert.deepEqual(NLME.uniqueStems(['A[1]'], [], [], { obsidian: true }), ['A-1']);
});

test('uniqueStems without the obsidian option is unchanged', () => {
  assert.deepEqual(NLME.uniqueStems(['A#B', 'A B']), ['A-B', 'A-B-2']);
  assert.deepEqual(NLME.uniqueStems(['A#B', 'A B'], [], [], {}), ['A-B', 'A-B-2']);
});

test('prefixedStem keeps [prefix]_ names, and turns them into "prefix - " for Obsidian', () => {
  assert.equal(NLME.prefixedStem('NOTE', 'My Note'), '[NOTE]_My-Note');
  assert.equal(NLME.prefixedStem('mind-map', 'A: B'), '[mind-map]_A-B');
  assert.equal(NLME.prefixedStem('NOTE', 'My Note', { obsidian: true }), 'note - My-Note');
  assert.equal(NLME.prefixedStem('mind-map', 'A[1] #b', { obsidian: true }), 'mind-map - A-1-b');
});

test('singleArtifactPackage renames the same way with the obsidian option', () => {
  const files = [{ path: 'x.svg' }, { path: 'x.json' }];
  const off = NLME.singleArtifactPackage({ type: 'Mind Map', title: 'Map', files });
  assert.equal(off.zipName, '[mind-map]_Map.zip');
  assert.equal(off.entries[0].path, '[mind-map]_Map.svg');
  const on = NLME.singleArtifactPackage({ type: 'Mind Map', title: 'Map', files, obsidian: true });
  assert.equal(on.zipName, 'mind-map - Map.zip');
  assert.equal(on.entries[1].path, 'mind-map - Map.json');
  const table = NLME.singleArtifactPackage({ type: 'Data Table', title: 'T[1]', files: [{ path: 'a.csv' }, { path: 'a-references.txt' }], obsidian: true });
  assert.equal(table.zipName, 'data-table - T-1.zip');
  assert.equal(table.entries[0].path, 'T-1.csv');
});

test('artifactStems with the obsidian option strips link-breaking characters', () => {
  const items = [{ type: 'Report', label: 'R[1]' }, { type: 'Report', label: 'R 1' }];
  assert.deepEqual(NLME.artifactStems(items), ['R[1]', 'R-1']);
  assert.deepEqual(NLME.artifactStems(items, { obsidian: true }), ['R-1', 'R-1-2']);
});

test('groupedSourcesMarkdown is unchanged without footnotes', () => {
  const entries = [{ number: '1', text: 'A' }, { number: '2', text: 'A' }];
  assert.equal(NLME.groupedSourcesMarkdown(entries, 'x-'),
    '<a id="x-src-1"></a><a id="x-src-2"></a>\n**[[1]](#x-cite-ref-1-1) [[2]](#x-cite-ref-2-1)** A\n\n');
});

test('footnoteDefinition escapes * in the title and trims continuation indentation', () => {
  assert.equal(NLME.footnoteDefinition('1', 'A*B*', 'q'), '[^1]: **A\\*B\\*** — q');
  assert.equal(NLME.footnoteDefinition('1', 'T', 'first\n      deep\n\tTab'), '[^1]: **T** — first\n    deep\n    Tab');
});

test('DEFAULT_SETTINGS pins the shipped defaults and cannot be changed', () => {
  const d = NLME.DEFAULT_SETTINGS;
  assert.ok(Object.isFrozen(d));
  assert.equal(d.autoZip, false);
  assert.equal(d.showNotifications, true);
  assert.equal(d.refreshInterval, 10);
  assert.equal(d.exportSourceBase, true);
  assert.equal(d.exportSourcePlusMeta, true);
  assert.equal(d.exportSourceWithImages, false);
  assert.equal(d.exportSourcePlusMetaWithImages, false);
  assert.equal(d.exportNoteBase, true);
  assert.equal(d.exportNoteCodeBlocks, true);
  assert.equal(d.exportNoteWithImages, false);
  assert.equal(d.sourcesPerZip, 25);
  assert.equal(d.notesPerZip, 25);
  assert.equal(d.cleanOCRArtifacts, true);
  assert.equal('showStudioTab' in d, false);
  assert.equal(d.slidesFormat, 'pdf');
  assert.equal(d.citationDetail, 'quotes');
  assert.equal(d.reuseCitations, true);
  assert.equal(d.citationStyle, 'links');
  assert.equal(d.obsidianNames, false);
  assert.equal(d.exportPreset, 'archive');
  assert.equal(d.customImages, true);
  assert.ok('takeoutZip' in d);
  assert.equal(d.takeoutZip, undefined);
});

test('resetSettings returns fresh defaults and keeps only the Full Takeout ZIP choice', () => {
  const current = { ...NLME.DEFAULT_SETTINGS, autoZip: true, citationStyle: 'footnotes', obsidianNames: true, sourcesPerZip: 7, takeoutZip: true };
  const reset = NLME.resetSettings(current);
  assert.deepEqual(reset, { ...NLME.DEFAULT_SETTINGS, takeoutZip: true });
  assert.ok(!Object.isFrozen(reset));
  reset.autoZip = true;
  assert.equal(NLME.DEFAULT_SETTINGS.autoZip, false);
  assert.deepEqual(NLME.resetSettings({}), { ...NLME.DEFAULT_SETTINGS });
  assert.deepEqual(NLME.resetSettings(undefined), { ...NLME.DEFAULT_SETTINGS });
});

// ---- viewer.html link in the root index ----
const viewerIndexArgs = {
  meta: { notebook: 'New Math', notebook_url: '', notebook_id: '', exporter: 'NotebookLM Takeout 1.8.0', exported: 'T' },
  errorsFile: 'errors.md',
  categories: [{ name: 'Notes', folder: 'notes', status: 'done', selected: 1, exported: 1, failed: 0, zips: [], parts: 0, packages: 1 }]
};

test('buildRootIndex links viewer.html when set', () => {
  const md = NLME.buildRootIndex({ ...viewerIndexArgs, viewerFile: 'viewer.html' });
  assert.match(md, /\[[^\]]*viewer[^\]]*\]\(viewer\.html\)/i);
  assert.ok(md.indexOf('(viewer.html)') < md.indexOf('| Category |'), 'first, before the table');
});

test('buildRootIndexHtml links viewer.html when set', () => {
  const html = NLME.buildRootIndexHtml({ ...viewerIndexArgs, viewerFile: 'viewer.html' });
  assert.ok(html.includes('<a href="viewer.html">'));
  assert.ok(html.indexOf('href="viewer.html"') < html.indexOf('href="_index.md"'), 'first of the links');
});

test('buildRootIndex and buildRootIndexHtml are unchanged when viewerFile is null', () => {
  assert.equal(NLME.buildRootIndex({ ...viewerIndexArgs, viewerFile: null }), NLME.buildRootIndex(viewerIndexArgs));
  assert.equal(NLME.buildRootIndexHtml({ ...viewerIndexArgs, viewerFile: null }), NLME.buildRootIndexHtml(viewerIndexArgs));
  assert.doesNotMatch(NLME.buildRootIndex(viewerIndexArgs), /viewer/i);
  assert.doesNotMatch(NLME.buildRootIndexHtml(viewerIndexArgs), /viewer/i);
});

// ---- download namer (folder-mode names survive a worker restart) ----
function fakeSession(opts = {}) {
  const data = {};
  return {
    data,
    log: [],
    async set(o) { this.log.push('set'); if (opts.setFails) throw new Error('x'); Object.assign(data, o); },
    async get(k) { this.log.push('get'); if (opts.getFails) throw new Error('x'); return k in data ? { [k]: data[k] } : {}; },
    async remove(ks) { this.log.push('remove'); for (const k of [].concat(ks)) delete data[k]; }
  };
}
const blobItem = (url, extra = {}) => ({ url, byExtensionId: 'ext', ...extra });
const spy = () => { const calls = []; const f = (...a) => calls.push(a); f.calls = calls; return f; };
const tick = () => new Promise(r => setTimeout(r, 0));

test('namer: a stored name applies after the Map is emptied', async () => {
  const st = fakeSession();
  const n1 = NLME.createDownloadNamer(st, 'ext');
  await n1.register('blob:a', 'T/x.md');
  const n2 = NLME.createDownloadNamer(st, 'ext'); // simulated restart
  const suggest = spy();
  assert.equal(n2.handle(blobItem('blob:a'), suggest), true);
  await tick();
  assert.deepEqual(suggest.calls, [[{ filename: 'T/x.md', conflictAction: 'uniquify' }]]);
  assert.deepEqual(st.data, {});
});

test('namer: no stored name suggests once with no arguments', async () => {
  const n = NLME.createDownloadNamer(fakeSession(), 'ext');
  const suggest = spy();
  assert.equal(n.handle(blobItem('blob:none'), suggest), true);
  await tick();
  assert.deepEqual(suggest.calls, [[]]);
});

test('namer: a rejected storage read still suggests once', async () => {
  const n = NLME.createDownloadNamer(fakeSession({ getFails: true }), 'ext');
  const suggest = spy();
  n.handle(blobItem('blob:a'), suggest);
  await tick();
  assert.deepEqual(suggest.calls, [[]]);
});

test('namer: a Map hit suggests synchronously and clears storage', async () => {
  const st = fakeSession();
  const n = NLME.createDownloadNamer(st, 'ext');
  await n.register('blob:a', 'T/x.md');
  const suggest = spy();
  assert.equal(n.handle(blobItem('blob:a'), suggest), true);
  assert.deepEqual(suggest.calls, [[{ filename: 'T/x.md', conflictAction: 'uniquify' }]]);
  await tick();
  assert.deepEqual(st.data, {});
});

test('namer: register resolves after the storage write; a failed write keeps the Map entry', async () => {
  let finishWrite;
  const written = [];
  const slow = { set: items => new Promise(resolve => { finishWrite = () => { written.push(items); resolve(); }; }) };
  let registered = false;
  const p = NLME.createDownloadNamer(slow, 'ext').register('blob:a', 'T/x.md').then(() => { registered = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(registered, false);
  finishWrite();
  await p;
  assert.equal(registered, true);
  assert.equal(Object.values(written[0])[0], 'T/x.md');
  const bad = NLME.createDownloadNamer(fakeSession({ setFails: true }), 'ext');
  await bad.register('blob:b', 'T/y.md');
  const suggest = spy();
  bad.handle(blobItem('blob:b'), suggest);
  assert.equal(suggest.calls[0][0].filename, 'T/y.md');
});

test('namer: no timer expires a registered name', async () => {
  const realSet = globalThis.setTimeout;
  let timers = 0;
  globalThis.setTimeout = (...a) => { timers++; return realSet(...a); };
  try {
    const n = NLME.createDownloadNamer(fakeSession(), 'ext');
    await n.register('blob:a', 'T/x.md');
    assert.equal(timers, 0);
  } finally { globalThis.setTimeout = realSet; }
});

test('namer: downloads that are not this extension\'s blobs never read storage', async () => {
  const st = fakeSession();
  const n = NLME.createDownloadNamer(st, 'ext');
  const suggest = spy();
  assert.equal(n.handle({ url: 'https://notebook.google.com/f.pdf', byExtensionId: 'ext' }, suggest), false);
  assert.equal(n.handle({ url: 'blob:z', byExtensionId: 'other' }, suggest), false);
  assert.equal(n.handle({ url: 'blob:z' }, suggest), false);
  assert.deepEqual(st.log, []);
  assert.deepEqual(suggest.calls, []);
});

test('relaxBracketEscapes frees plain bracketed text, so math viewers do not read \\[ as a formula', () => {
  const relax = NLME.relaxBracketEscapes;
  assert.equal(relax('\\[Resolution #1\\] UPON MOTION'), '[Resolution #1] UPON MOTION');
  assert.equal(relax('see \\[a\\] and \\[b\\_c\\].'), 'see [a] and [b\\_c].');
  assert.equal(relax('no brackets'), 'no brackets');
});

test('relaxBracketEscapes keeps the escape wherever the brackets could become Markdown', () => {
  const relax = NLME.relaxBracketEscapes;
  for (const text of [
    '\\[a\\](b)',          // link
    '\\[a\\]\\[b\\]',      // reference link: the first pair is followed by [
    '\\[a\\]: url',        // link definition
    '\\[^1\\]',            // footnote
    '\\[\\[wiki\\]\\]',    // Obsidian link
    '\\[ \\] task',        // task list box
    '\\[x\\] task',
    '\\[X\\] task',
    '\\[\\]',              // empty
    '\\[unclosed',
    'closed\\]'
  ]) {
    assert.equal(relax(text).includes('\\['), text.includes('\\['), text);
    assert.equal(relax(text).includes('\\]'), text.includes('\\]'), text);
  }
  assert.equal(relax('\\[\\[wiki\\]\\]'), '\\[\\[wiki\\]\\]');
  // Only the last of a run is free of what follows it
  assert.equal(relax('\\[a\\]\\[b\\]'), '\\[a\\][b]');
  // An escaped backslash before the bracket stays as it was
  assert.equal(relax('\\\\\\[a\\]'), '\\\\\\[a\\]');
});

test('relaxBracketEscapes stays linear on unclosed brackets', () => {
  const text = '\\[a '.repeat(200000);
  const start = Date.now();
  assert.equal(NLME.relaxBracketEscapes(text), text);
  assert.ok(Date.now() - start < 1000);
});

test('an infographic Download URL on lh3.google.com counts as a notebook download', () => {
  const url = 'https://lh3.google.com/notebooklm/ABzcPv0h8c6NkZCA157';
  assert.equal(NLME.isNotebookDownloadUrl(url), true);
  assert.equal(NLME.isAllowedDownloadUrl(url), true);
  const arm = NLME.createInterceptArm(3000);
  arm.arm(1000);
  assert.equal(arm.shouldIntercept(url, 1100), true);
  for (const other of ['https://lh3.google.com/rd-notebooklm/x', 'https://lh3.google.com/photos/x',
    'http://lh3.google.com/notebooklm/x', 'https://lh3.google.com.evil.com/notebooklm/x', 'https://evil.com/notebooklm/x']) {
    assert.equal(NLME.isNotebookDownloadUrl(other), false, other);
    assert.equal(NLME.isAllowedDownloadUrl(other), false, other);
  }
});

test('isPriceRangeFragment spots a price range the page drew as math', () => {
  for (const tex of ['3-', '1-', '15,000-', '1.5 -', '3–', '5 to', '5 million to', '2 or']) {
    assert.equal(NLME.isPriceRangeFragment(tex), true, tex);
  }
  for (const tex of ['0.815', '3-x', '3-4', 'x-', '\\frac{1}{2}-', '', null]) {
    assert.equal(NLME.isPriceRangeFragment(tex), false, String(tex));
  }
});

test('listItemMarkdown keeps a nested list inside its item', () => {
  const item = NLME.listItemMarkdown;
  assert.equal(item('*', '**Building:** search\n* _Alberta:_ gym\n* _Fatima:_ green'),
    '* **Building:** search\n  * _Alberta:_ gym\n  * _Fatima:_ green\n');
  // The inner lines line up with the item's text, whatever the marker's width
  assert.equal(item('10.', 'one\n* two'), '10. one\n    * two\n');
  // Two levels down, an already indented line moves with its parent
  assert.equal(item('*', 'a\n* b\n  * c'), '* a\n  * b\n    * c\n');
  // A blank line stays empty
  assert.equal(item('*', 'a\n\nb'), '* a\n\n  b\n');
  assert.equal(item('1.', 'plain'), '1. plain\n');
});
test('a notice is listed in errors.md but is not counted as an error', () => {
  const notice = { type: 'info', title: 'Deck', message: 'no PowerPoint version offered for this deck; the PDF was saved' };
  assert.equal(NLME.countExportErrors([notice, '[Item] failed', { type: 'viewer', message: 'x' }]), 2);
  assert.equal(NLME.countExportErrors([notice]), 0);
  assert.equal(NLME.countExportErrors(NLME.prefixExportErrors('Artifacts', [notice])), 0);
  const report = NLME.buildErrorReport({ title: 'Takeout', errors: [notice] });
  assert.match(report, /^Errors: 0$/m);
  assert.match(report, /^## INFO \(1\)$/m);
  assert.match(report, /^- Deck: no PowerPoint version offered/m);
});

test('notebookEmoji takes the emoji from the cover, without its picker text', () => {
  assert.equal(NLME.notebookEmoji('♾️ \n   \n   Search results\n   No emoji found\n  Recently used\n Loading'), '♾️');
  assert.equal(NLME.notebookEmoji('  👨‍👩‍👧‍👦 \n Search results'), '👨‍👩‍👧‍👦');
  assert.equal(NLME.notebookEmoji('🇨🇦'), '🇨🇦');
  assert.equal(NLME.notebookEmoji('Search results'), '');
  assert.equal(NLME.notebookEmoji('<b>'), '');
  assert.equal(NLME.notebookEmoji(''), '');
  assert.equal(NLME.notebookEmoji(null), '');
});

test('takeoutFolderName trims a long notebook name, never the timestamp', () => {
  const ts = '2026-11-05T16-50-12';
  const long = 'Lunar Pockets Basin-Bound Hydrology and Atmosphere in Lorber';
  const name = NLME.takeoutFolderName(long, ts);
  assert.ok(name.endsWith(` takeout ${ts}`));
  assert.ok(name.length <= 80);
  assert.ok(name.startsWith('Lunar Pockets'));
  assert.equal(NLME.downloadFolderPath(name, 'f.md'), `${name}/f.md`);
  // A short name is as it always was
  assert.equal(NLME.takeoutFolderName('New Math', ts), `New Math takeout ${ts}`);
  // No half emoji, and no space or dot left before the suffix
  const emoji = NLME.takeoutFolderName('a'.repeat(52) + '😀😀', ts);
  assert.equal(emoji, `${'a'.repeat(52)} takeout ${ts}`);
  assert.equal(NLME.takeoutFolderName(`${'b'.repeat(50)} . extra words here`, ts), `${'b'.repeat(50)} takeout ${ts}`);
});

test('themeAttr maps the theme setting to the data-theme attribute', () => {
  assert.equal(NLME.themeAttr('auto'), null);
  assert.equal(NLME.themeAttr('dark'), 'dark');
  assert.equal(NLME.themeAttr('light'), 'light');
  assert.equal(NLME.themeAttr('nonsense'), null);
  assert.equal(NLME.themeAttr(undefined), null);
  assert.equal(NLME.themeValue('dark'), 'dark');
  assert.equal(NLME.themeValue('nonsense'), 'auto');
  assert.equal(NLME.DEFAULT_SETTINGS.theme, 'auto');
});

test('headerName shows the notebook name only on a notebook page', () => {
  const nb = 'https://notebooklm.google.com/notebook/62d6e344-2fa7-42ed-b3ef-236f3007fdc3';
  assert.equal(NLME.headerName('', 'X'), 'Open a notebook');
  assert.equal(NLME.headerName('https://example.com/', 'X'), 'Open a notebook');
  assert.equal(NLME.headerName('https://notebooklm.google.com/', 'X'), 'Open a notebook');
  assert.equal(NLME.headerName(nb, 'New Physics'), 'New Physics');
  assert.equal(NLME.headerName(nb, ''), 'NotebookLM');
});

test('actionLabel', () => {
  assert.equal(NLME.actionLabel(12, 'note'), 'Export 12 notes');
  assert.equal(NLME.actionLabel(1, 'source'), 'Export 1 source');
  assert.equal(NLME.actionLabel(0, 'note'), 'Select notes to export');
  assert.equal(NLME.actionLabel(1400, 'message'), 'Export 1,400 messages');
  assert.equal(NLME.actionLabel(3, 'artifact', 'Download'), 'Download 3 artifacts');
});

test('generatedExportPlan splits by kind and skips what cannot download', () => {
  const plan = NLME.generatedExportPlan([
    { kind: 'artifact', moreIndex: 2, label: 'Deck', type: 'Slides', details: '', downloadable: true },
    { kind: 'artifact', moreIndex: 3, label: 'Audio', type: 'Audio', details: 'Generating', downloadable: false },
    { kind: 'note', kindIndex: 0, label: 'N1', type: 'Note' },
    { kind: 'source-note', sourceIndex: 4, label: 'N2', type: 'Note (Sources panel)' }
  ]);
  assert.deepEqual(plan.artifacts.map(a => a.index), [2]);
  assert.deepEqual(plan.notes.map(n => n.title), ['N1', 'N2']);
  assert.equal(plan.notes[1].index, -1);
  assert.equal(plan.notes[1].sourceIndex, 4);
  assert.equal(plan.skipped.length, 1);
});

test('a selection of only unavailable items exports nothing', () => {
  const plan = NLME.generatedExportPlan([{ kind: 'artifact', moreIndex: 1, label: 'A', type: 'Audio', downloadable: false }]);
  assert.equal(plan.artifacts.length + plan.notes.length, 0);
});

test('generatedExportPlan gives each side the shape its exporter reads', () => {
  const plan = NLME.generatedExportPlan([
    { kind: 'artifact', combinedIndex: 5, kindIndex: 1, moreIndex: 2, label: 'Deck', type: 'Slides', details: '3 sources', downloadable: true },
    { kind: 'note', combinedIndex: 6, kindIndex: 0, label: 'N1', type: 'Note', details: '' }
  ]);
  assert.deepEqual(plan.artifacts, [{ index: 2, label: 'Deck', type: 'Slides', details: '3 sources', disabled: false }]);
  assert.deepEqual(plan.notes, [{ index: 0, title: 'N1', type: 'Note' }]);
});

test('generatedExportPlan skips a kind it does not know instead of guessing', () => {
  const plan = NLME.generatedExportPlan([{ kind: 'something-new', label: 'X', type: 'X' }, null]);
  assert.equal(plan.artifacts.length + plan.notes.length, 0);
  assert.equal(plan.skipped.length, 1);
});

test('generatedExportPlan carries the job key as _listKey, for Retry and Resume', () => {
  const plan = NLME.generatedExportPlan([
    { kind: 'artifact', moreIndex: 2, label: 'Deck', type: 'Slides', downloadable: true, jobKey: 'Slides\u0000Deck#2' },
    { kind: 'note', kindIndex: 1, label: 'N1', type: 'Note', jobKey: 'Note\u0000N1#2' },
    { kind: 'note', kindIndex: 2, label: 'N2', type: 'Note' }
  ]);
  assert.equal(plan.artifacts[0]._listKey, 'Slides\u0000Deck#2');
  assert.equal(plan.notes[0]._listKey, 'Note\u0000N1#2');
  assert.equal('_listKey' in plan.notes[1], false);
  // Non-enumerable, as on the tab lists: a copy of the item does not carry it
  assert.equal(Object.keys(plan.artifacts[0]).includes('_listKey'), false);
});

test('generatedSignature changes with everything a row acts on, and with nothing else', () => {
  const tab = { id: 1, url: 'https://notebook.google.com/notebook/a' };
  const item = { kind: 'artifact', combinedIndex: 0, kindIndex: 0, moreIndex: 0, label: 'Deck', type: 'Slides', details: '', downloadable: true, untitled: false, jobKey: 'k' };
  const base = NLME.generatedSignature(tab, [item]);
  assert.equal(NLME.generatedSignature({ ...tab }, [{ ...item }]), base);
  const changes = [
    { combinedIndex: 1 }, { kindIndex: 1 }, { moreIndex: 1 }, { sourceIndex: 1 }, { kind: 'note' }, { label: 'Other' }, { type: 'Report' },
    { details: 'Generating' }, { downloadable: false }, { untitled: true }, { jobKey: 'other' }
  ];
  for (const change of changes) {
    assert.notEqual(NLME.generatedSignature(tab, [{ ...item, ...change }]), base, JSON.stringify(change));
  }
  assert.notEqual(NLME.generatedSignature({ ...tab, id: 2 }, [item]), base);
  assert.notEqual(NLME.generatedSignature({ ...tab, url: tab.url + 'b' }, [item]), base);
});

test('an artifact with no More button is not exported: its index would resolve by title to another row', () => {
  // pickByIndexThenTitleStrict(['Deck'], -1, 'Deck') is 0: the ready item of that title
  assert.equal(NLME.pickByIndexThenTitleStrict(['Deck'], -1, 'Deck'), 0);
  const plan = NLME.generatedExportPlan([
    { kind: 'artifact', moreIndex: -1, label: 'Deck', type: 'Slides', downloadable: true },
    { kind: 'artifact', moreIndex: 0, label: 'Deck', type: 'Slides', downloadable: true }
  ]);
  assert.deepEqual(plan.artifacts.map(a => a.index), [0]);
  assert.deepEqual(plan.skipped.map(i => i.moreIndex), [-1]);
});

test('the row check and the export plan share one rule', () => {
  const rows = [
    { kind: 'artifact', moreIndex: 0, label: 'A', type: 'Slides', downloadable: true },
    { kind: 'artifact', moreIndex: -1, label: 'B', type: 'Slides', downloadable: true },
    { kind: 'artifact', moreIndex: 2, label: 'C', type: 'Quiz', downloadable: false },
    { kind: 'artifact', moreIndex: -1, label: 'D', type: 'Quiz', downloadable: false },
    { kind: 'note', kindIndex: 0, label: 'E', type: 'Note' },
    { kind: 'source-note', sourceIndex: 1, label: 'F', type: 'Note (Sources panel)' }
  ];
  const skipped = NLME.generatedExportPlan(rows).skipped;
  assert.deepEqual(rows.filter(NLME.isStudioItemUnavailable), skipped);
  assert.deepEqual(skipped.map(i => i.label), ['B', 'C', 'D']);
});

test('an unavailable row says why it cannot download', () => {
  assert.equal(NLME.studioItemUnavailableReason({ kind: 'artifact', moreIndex: 2, type: 'Quiz', downloadable: false }), 'Quiz export not supported yet');
  assert.equal(NLME.studioItemUnavailableReason({ kind: 'artifact', moreIndex: -1, type: 'Slides', downloadable: true }), 'Not ready to download yet');
  assert.equal(NLME.studioItemUnavailableReason({ kind: 'artifact', moreIndex: 0, type: 'Slides', downloadable: true }), '');
  assert.equal(NLME.studioItemUnavailableReason({ kind: 'note', kindIndex: 0, type: 'Note' }), '');
  assert.equal(NLME.isStudioItemUnavailable(null), false);
});

test('Generated rows carry the keys Resume finds again, not keys in the merged list', () => {
  const items = [
    { kind: 'artifact', label: 'X', type: 'Report' },
    { kind: 'note', kindIndex: 0, label: 'X', type: 'Note' },
    { kind: 'artifact', label: 'X', type: 'Report' },
    { kind: 'note', kindIndex: 1, label: 'Item 4', type: 'Note' } // untitled: the Notes scan calls it "Note 2"
  ];
  const notes = [{ index: 0, title: 'X', type: 'Note' }, { index: 1, title: 'Note 2', type: 'Note' }];
  const keys = NLME.listItemKeys(notes, { titleOf: n => n.title, typeOf: n => n.type });
  notes.forEach((n, i) => { n._listKey = keys[i]; });
  NLME.stampGeneratedJobKeys(items, notes);
  assert.deepEqual(items.map(i => i.jobKey), ['Report\u0000X', 'Note\u0000X', 'Report\u0000X#2', 'Note\u0000Note 2']);

  // The notes scan failed: keys from the rows, still over each side alone
  const again = items.map(({ jobKey, ...rest }) => rest);
  NLME.stampGeneratedJobKeys(again, []);
  assert.deepEqual(again.map(i => i.jobKey), ['Report\u0000X', 'Note\u0000X', 'Report\u0000X#2', 'Note\u0000Item 4']);
});

test('a Generated export headline counts everything not exported, Retry and Resume alike', () => {
  // Cancel partway through the artifacts: 3 of 5 artifacts left unstarted, 2 notes not run, nothing failed
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Artifacts', exported: 2, stopped: true, failedItems: [] }],
    notRun: [{ name: 'Notes', failedItems: [{}, {}] }],
    total: 7
  }), 'Export stopped before notes — 5 of 7 items not exported');
  // Cancel partway through the notes, the last side
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Artifacts', exported: 2 }, { name: 'Notes', exported: 1, stopped: true }],
    notRun: [],
    total: 4
  }), 'Export stopped — 1 of 4 items not exported');
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Artifacts', exported: 2 }, { name: 'Notes', exported: 1 }],
    notRun: [],
    total: 4
  }), 'Export finished — 1 of 4 items not exported');
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Artifacts', exported: 2 }, { name: 'Notes', exported: 2 }],
    notRun: [],
    total: 4
  }), 'Export finished');
});

const quiz = { kind: 'artifact', moreIndex: 1, label: 'Quiz A', type: 'Quiz', downloadable: false };
const cards = { kind: 'artifact', moreIndex: 2, label: 'Cards B', type: 'Flashcards', downloadable: false };

test('a Generated headline names what the export cannot take', () => {
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Notes', exported: 3 }], notRun: [], total: 3, skipped: [quiz, cards]
  }), "Export finished — 2 of 5 items can't be exported");
  // Failed or unstarted items on top of the skipped ones
  assert.equal(NLME.generatedExportMessage({
    steps: [{ name: 'Artifacts', exported: 1, stopped: true }], notRun: [{ name: 'Notes', failedItems: [{}] }], total: 3, skipped: [quiz]
  }), "Export stopped before notes — 3 of 4 items not exported, 1 of them can't be exported");
});

test('a Generated outcome with skipped items reads as incomplete, on one side or two', () => {
  const step = (name, exported) => ({ name, message: 'ok', level: 'success', saved: [`${name}.zip`], errors: [], failedItems: [], exported });
  const one = NLME.generatedExportOutcome({ steps: [step('Notes', 2)], notRun: [], total: 2, skipped: [quiz, cards] });
  assert.equal(one.level, 'warning');
  assert.equal(one.message, "Export finished — 2 of 4 items can't be exported");
  assert.deepEqual(one.lines, ['Notes: ok', "Can't be exported (2): Quiz A, Cards B"]);
  assert.deepEqual(one.saved, ['Notes.zip']);
  assert.deepEqual(one.remaining, { Notes: [] }); // a Retry never tries them

  const two = NLME.generatedExportOutcome({ steps: [step('Artifacts', 1), step('Notes', 1)], notRun: [], total: 2, skipped: [quiz] });
  assert.equal(two.level, 'warning');
  assert.equal(two.lines.length, 3);
  // An error level is not lowered
  const bad = NLME.generatedExportOutcome({ steps: [{ ...step('Notes', 0), level: 'error' }], notRun: [], total: 1, skipped: [quiz] });
  assert.equal(bad.level, 'error');
});

test('a Generated outcome with nothing skipped is what it was', () => {
  const steps = [{ name: 'Artifacts', message: 'a', level: 'success', saved: [], errors: [], failedItems: [], exported: 1 },
    { name: 'Notes', message: 'n', level: 'success', saved: [], errors: [], failedItems: [], exported: 1 }];
  const out = NLME.generatedExportOutcome({ steps, notRun: [], total: 2 });
  assert.equal(out.level, 'success');
  assert.equal(out.message, 'Export finished');
  assert.deepEqual(out.lines, ['Artifacts: a', 'Notes: n']);
});

test('generatedActionLabel says what the action leaves out', () => {
  const note = { kind: 'note', kindIndex: 0, label: 'N', type: 'Note' };
  const label = items => NLME.generatedActionLabel(NLME.generatedExportPlan(items));
  assert.equal(label([]), 'Select items to export');
  assert.equal(label([note]), 'Export 1 item');
  assert.equal(label([note, note]), 'Export 2 items');
  assert.equal(label([note, quiz, cards]), "Export 1 item · 2 can't be exported");
  assert.equal(label([quiz]), "1 can't be exported");
});

test('bulkDeletePlan skips untitled items and titles shared by two Studio items', () => {
  const dupA = { kind: 'note', label: 'Dup', combinedIndex: 0 };
  const dupB = { kind: 'artifact', label: 'Dup', combinedIndex: 1 };
  const solo = { kind: 'artifact', label: 'Solo', combinedIndex: 2 };
  const blank = { kind: 'note', label: 'Untitled note', untitled: true, combinedIndex: 3 };
  const srcNote = { kind: 'source-note', label: 'Dup', sourceIndex: 4 };
  const all = [dupA, dupB, solo, blank, srcNote];

  const plan = NLME.bulkDeletePlan([dupB, solo, blank, srcNote], all);
  assert.deepEqual(plan.deletable, [solo, srcNote]);
  assert.equal(plan.skippedUntitled, 1);
  assert.equal(plan.skippedDuplicate, 1);
});

test('bulkDeletePlan treats a title as shared even when only one copy is ticked, and ignores outer spaces', () => {
  const a = { kind: 'note', label: 'Dup', combinedIndex: 0 };
  const b = { kind: 'note', label: ' Dup ', combinedIndex: 1 };
  assert.deepEqual(NLME.bulkDeletePlan([a], [a, b]).deletable, []);
});

test('bulkDeletePlan leaves a Sources-panel note with a shared title deletable: it goes by its index', () => {
  const a = { kind: 'source-note', label: 'Dup', sourceIndex: 1 };
  const b = { kind: 'source-note', label: 'Dup', sourceIndex: 2 };
  assert.deepEqual(NLME.bulkDeletePlan([a, b], [a, b]).deletable, [a, b]);
});

test('bulkDeleteSkipText names each kind of skip', () => {
  assert.equal(NLME.bulkDeleteSkipText({ skippedUntitled: 0, skippedDuplicate: 0 }), '');
  assert.equal(NLME.bulkDeleteSkipText({ skippedUntitled: 2, skippedDuplicate: 0 }), '2 untitled item(s)');
  assert.equal(NLME.bulkDeleteSkipText({ skippedUntitled: 2, skippedDuplicate: 1 }), '2 untitled item(s) and 1 item(s) with a shared title');
});

test('openingView: Home on a new notebook, last list within one', () => {
  assert.equal(NLME.openingView(null, 'a'), 'home');
  assert.equal(NLME.openingView({ notebookId: 'b', view: 'notes' }, 'a'), 'home');
  assert.equal(NLME.openingView({ notebookId: 'a', view: 'notes' }, 'a'), 'notes');
  assert.equal(NLME.openingView({ notebookId: 'a', view: 'artifacts' }, 'a'), 'home'); // a retired tab
});

test('openingView: every list reopens, anything unknown means Home', () => {
  for (const view of ['sources', 'notes', 'studio', 'chat']) {
    assert.equal(NLME.openingView({ notebookId: 'a', view }, 'a'), view);
  }
  assert.equal(NLME.openingView({ notebookId: 'a', view: 'home' }, 'a'), 'home');
  assert.equal(NLME.openingView({ notebookId: 'a', view: 'constructor' }, 'a'), 'home');
  assert.equal(NLME.openingView({ notebookId: 'a' }, 'a'), 'home');
  assert.equal(NLME.openingView('notes', 'a'), 'home');
  assert.equal(NLME.openingView({ notebookId: '', view: 'notes' }, ''), 'home'); // not on a notebook
});

test('panelOpenView: a resumable export opens Home whatever was stored', () => {
  const stored = { notebookId: 'a', view: 'notes' };
  assert.equal(NLME.panelOpenView(stored, 'a', false), 'notes');
  assert.equal(NLME.panelOpenView(stored, 'a', true), 'home');
  assert.equal(NLME.panelOpenView(null, 'a', true), 'home');
});

test('latest gate: a slower older scan is dropped', () => {
  const gate = NLME.createLatestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isLatest(first), false);
  assert.equal(gate.isLatest(second), true);
});

test('homeCountText: an unknown count never reads as a number, Chat offers Load', () => {
  assert.equal(NLME.homeCountText('sources', null), '—');
  assert.equal(NLME.homeCountText('studio', undefined), '—');
  assert.equal(NLME.homeCountText('notes', 0), '0');
  assert.equal(NLME.homeCountText('notes', 1234), '1,234');
  assert.equal(NLME.homeCountText('chat', null), 'Load');
  assert.equal(NLME.homeCountText('chat', 12), '12');
});

test('homeCountRead: a 0 is held back until the attempts run out, then believed', () => {
  assert.deepEqual(NLME.homeCountRead({ found: 40, attemptsLeft: 2 }), { show: 40, retry: false, zeroConfirmed: false, failed: false });
  assert.deepEqual(NLME.homeCountRead({ found: 0, attemptsLeft: 2 }), { show: null, retry: true, zeroConfirmed: false, failed: false });
  assert.deepEqual(NLME.homeCountRead({ found: 0, attemptsLeft: 0 }), { show: 0, retry: false, zeroConfirmed: true, failed: false });
});

test('homeCountRead: a list already proved empty is not re-read', () => {
  assert.deepEqual(NLME.homeCountRead({ found: 0, confirmedZero: true, attemptsLeft: 2 }), { show: 0, retry: false, zeroConfirmed: true, failed: false });
  assert.equal(NLME.homeCountRead({ found: 3, confirmedZero: true, attemptsLeft: 2 }).show, 3);
});

test('homeCountRead: a failed read is never a number', () => {
  assert.deepEqual(NLME.homeCountRead({ found: null, attemptsLeft: 1 }), { show: null, retry: true, zeroConfirmed: false, failed: true });
  assert.deepEqual(NLME.homeCountRead({ found: null, attemptsLeft: 0 }), { show: null, retry: false, zeroConfirmed: false, failed: true });
});

test('homeCountText: nothing but a dash off a notebook, whatever is kept', () => {
  assert.equal(NLME.homeCountText('sources', 40, false), '—');
  assert.equal(NLME.homeCountText('chat', null, false), '—');
  assert.equal(NLME.homeCountText('sources', 40, true), '40');
});

test('homeNotice: says what Home needs, most basic first', () => {
  assert.equal(NLME.homeNotice({ onSite: false, onNotebook: false, itemOpen: true, readFailed: true }), 'open-site');
  assert.equal(NLME.homeNotice({ onSite: true, onNotebook: false, itemOpen: true }), 'open-notebook');
  assert.equal(NLME.homeNotice({ onSite: true, onNotebook: true, itemOpen: true, readFailed: true }), 'item-open');
  assert.equal(NLME.homeNotice({ onSite: true, onNotebook: true, readFailed: true }), 'read-failed');
  assert.equal(NLME.homeNotice({ onSite: true, onNotebook: true }), '');
});

test('loadWithRetry: tries once more, and says whether a load succeeded', async () => {
  let calls = 0;
  const waits = [];
  const sleep = async ms => { waits.push(ms); };
  assert.equal(await NLME.loadWithRetry(async () => { calls++; }, { sleep, waitMs: 500 }), true);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
  calls = 0;
  assert.equal(await NLME.loadWithRetry(async () => { if (++calls === 1) throw new Error('down'); }, { sleep, waitMs: 500 }), true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [500]);
  calls = 0;
  assert.equal(await NLME.loadWithRetry(async () => { calls++; throw new Error('down'); }, { sleep, waitMs: 500 }), false);
  assert.equal(calls, 2);
});

// ---- Presets, run settings and the estimate ----

test('presets', () => {
  assert.deepEqual(NLME.presetOverrides('archive'), { citationDetail: 'quotes', obsidianNames: false, exportNoteWithImages: true, exportSourceWithImages: true });
  assert.deepEqual(NLME.presetOverrides('ai'), { citationDetail: 'titles', obsidianNames: false, exportNoteWithImages: false, exportSourceWithImages: false });
  assert.deepEqual(NLME.presetOverrides('custom', { citationDetail: 'none', obsidianNames: true, images: false }),
    { citationDetail: 'none', obsidianNames: true, exportNoteWithImages: false, exportSourceWithImages: false });
});

test('old settings keep their meaning', () => {
  assert.equal(NLME.migratePreset({}), 'archive');
  assert.equal(NLME.migratePreset({ citationDetail: 'quotes' }), 'archive');
  assert.equal(NLME.migratePreset({ citationDetail: 'titles' }), 'custom');
  assert.equal(NLME.migratePreset({ obsidianNames: true }), 'custom');
});

test('migratePreset: only a non-default citation detail or Obsidian names leave Archive', () => {
  assert.equal(NLME.migratePreset({ citationDetail: 'none' }), 'custom');
  assert.equal(NLME.migratePreset({ citationDetail: 'quotes', obsidianNames: false, exportNoteWithImages: false }), 'archive');
  assert.equal(NLME.migratePreset(undefined), 'archive');
});

test('run overrides never reach saved settings', () => {
  const saved = { citationDetail: 'quotes', refreshInterval: 10 };
  const { run, persistable } = NLME.applyRunSettings(saved, { citationDetail: 'titles' });
  assert.equal(run.citationDetail, 'titles');
  assert.deepEqual(persistable({ ...run, refreshInterval: 30 }), { citationDetail: 'quotes', refreshInterval: 30 });
});

test('applyRunSettings leaves its input alone and drops a key the saved settings never had', () => {
  const saved = { refreshInterval: 10 };
  const { run, persistable } = NLME.applyRunSettings(saved, { exportNoteWithImages: true });
  assert.equal(saved.exportNoteWithImages, undefined);
  assert.equal(run.exportNoteWithImages, true);
  assert.deepEqual(persistable(run), { refreshInterval: 10 });
});

test('estimate', () => {
  const counts = { notes: 171, chat: 193, sources: 142, generated: 46 };
  assert.equal(NLME.formatEstimate(NLME.estimateSeconds(counts, 'quotes')), 'about 44 min');
  assert.equal(NLME.formatEstimate(20), 'under 30 sec');
  assert.equal(NLME.formatEstimate(60), 'about 1 min');
});

test('estimateSeconds uses the rate of the citation detail', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  close(NLME.estimateSeconds({ notes: 10, chat: 10 }, 'titles'), 10 * 0.3 + 10 * 0.2);
  close(NLME.estimateSeconds({ notes: 10, chat: 10 }, 'none'), 10 * 0.1 + 10 * 0.1);
  close(NLME.estimateSeconds({ sources: 10, generated: 10 }, 'none'), 10 * 2 + 10 * 4);
  close(NLME.estimateSeconds({ notes: 1, chat: 1 }, 'something-new'), 7 + 5);
  close(NLME.estimateSeconds({ notes: 1, chat: 1 }), 7 + 5);
});

test('estimateSeconds counts an unknown or missing count as 0', () => {
  assert.equal(NLME.estimateSeconds({}, 'quotes'), 0);
  assert.equal(NLME.estimateSeconds(undefined, 'quotes'), 0);
  assert.equal(NLME.estimateSeconds({ notes: null, chat: undefined, sources: NaN, generated: -4 }, 'quotes'), 0);
  assert.equal(NLME.estimateSeconds({ notes: 'many', sources: 1 }, 'quotes'), 2);
});

test('formatEstimate never says a negative or NaN time', () => {
  for (const s of [NaN, undefined, null, -5, Infinity, -Infinity]) assert.equal(NLME.formatEstimate(s), 'under 30 sec');
  assert.equal(NLME.formatEstimate(29), 'under 30 sec');
  assert.equal(NLME.formatEstimate(30), 'about 1 min');
  assert.equal(NLME.formatEstimate(2630), 'about 44 min');
});

test('runOverrides follows the preset, with the stored values as Custom', () => {
  const stored = { citationDetail: 'none', obsidianNames: true, customImages: false };
  assert.deepEqual(NLME.runOverrides({ ...stored, exportPreset: 'archive' }), NLME.presetOverrides('archive'));
  assert.deepEqual(NLME.runOverrides({ ...stored, exportPreset: 'ai' }), NLME.presetOverrides('ai'));
  assert.deepEqual(NLME.runOverrides({ ...stored, exportPreset: 'custom' }),
    { citationDetail: 'none', obsidianNames: true, exportNoteWithImages: false, exportSourceWithImages: false });
  assert.deepEqual(NLME.runOverrides(NLME.DEFAULT_SETTINGS), NLME.presetOverrides('archive'));
});

test('a migrated titles user gets the Full Takeout of today: their citations, image copies on', () => {
  const stored = { citationDetail: 'titles' };
  const settings = { ...NLME.DEFAULT_SETTINGS, ...stored, exportPreset: NLME.migratePreset(stored) };
  assert.deepEqual(NLME.runOverrides(settings),
    { citationDetail: 'titles', obsidianNames: false, exportNoteWithImages: true, exportSourceWithImages: true });
});

test('a job record round-trips its overrides through storage', () => {
  const overrides = NLME.presetOverrides('ai');
  const record = NLME.newJobRecord({ id: 'j', kind: 'takeout', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a', 'b'] }, now: 1, overrides });
  const stored = JSON.parse(JSON.stringify(NLME.markJobItems(record, 'notes', ['a'], { now: 2 })));
  assert.deepEqual(stored.overrides, overrides);
  assert.equal(NLME.jobRecordUsable(stored, 'nb'), true);
  assert.deepEqual(NLME.jobRecordOverrides(stored, { exportPreset: 'archive' }), overrides);
});

test('a record of a job that had no overrides holds none', () => {
  const record = NLME.newJobRecord({ id: 'j', kind: 'notes', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal('overrides' in record, false);
});

test('an old record stays usable and resumes on the settings of today, a takeout with its image copies', () => {
  const old = NLME.newJobRecord({ id: 'j', kind: 'notes', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal(NLME.jobRecordUsable(old, 'nb'), true);
  assert.deepEqual(NLME.jobRecordOverrides(old, NLME.DEFAULT_SETTINGS), {});
  const takeout = { ...old, kind: 'takeout' };
  assert.equal(NLME.jobRecordUsable(takeout, 'nb'), true);
  assert.deepEqual(NLME.jobRecordOverrides(takeout, NLME.DEFAULT_SETTINGS), NLME.presetOverrides('archive'));
  const titles = { ...NLME.DEFAULT_SETTINGS, citationDetail: 'titles', exportPreset: 'custom' };
  assert.deepEqual(NLME.jobRecordOverrides(takeout, titles).citationDetail, 'titles');
  assert.equal(NLME.jobRecordOverrides(takeout, titles).exportNoteWithImages, true);
});

test('a record holding something else as overrides counts as an old one', () => {
  const old = { kind: 'notes' };
  for (const overrides of [null, 'titles', ['titles'], 3]) assert.deepEqual(NLME.jobRecordOverrides({ ...old, overrides }, NLME.DEFAULT_SETTINGS), {});
});

// The panel's own code, in a sandbox: withRunSettings and everything that goes through it
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fnSource(file, name) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = src.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} not found in ${file}`);
  return src.slice(start, src.indexOf('\n}\n', start) + 3);
}

// The run state and saved-settings functions of sidebar-core.js. fields: values of
// the Settings panel, by element id. Anything else in `extra` is added to the sandbox.
function panel({ settings = NLME.resetSettings(), stored = true, fields = {}, extra = {}, code = '' } = {}) {
  const writes = [];
  const toasts = [];
  const sandbox = {
    NLME, console: { warn() {}, error() {}, log() {} }, Promise,
    showToast: text => toasts.push(text),
    updateChatCitationInfo() {}, applyTheme() {},
    retrySettingsLoad: async () => { throw new Error('a job must not reload settings'); },
    jobLock: { current: () => null },
    document: { getElementById: id => ({ checked: !!fields[id], value: fields[id] === undefined ? '' : fields[id] }) },
    chrome: { storage: { local: { set: async value => { writes.push(JSON.parse(JSON.stringify(value.settings))); } } } },
    ...extra
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    let settings = ${JSON.stringify(settings)};
    let settingsStored = ${stored};
    const SETTINGS_UNREAD_MESSAGE = 'unread';
    let currentRunOverrides = null;
    let runRestore = null;
    let runEdits = null;
    ${['realSettings', 'withRunSettings', 'rememberRunSettings', 'writeSettings', 'saveSettings', 'retryFor'].map(n => fnSource('sidebar-core.js', n)).join('\n')}
    ${code}
    this.current = () => settings;
    this.overrides = () => currentRunOverrides;
  `, sandbox);
  return { sandbox, writes, toasts };
}

const titlesRun = { citationDetail: 'titles', exportNoteWithImages: false };

test('withRunSettings swaps the settings for the whole job, async work included', async () => {
  const { sandbox } = panel();
  assert.equal(sandbox.overrides(), null);
  const seen = await sandbox.withRunSettings(titlesRun, async () => {
    const before = sandbox.current().citationDetail;
    await new Promise(resolve => setTimeout(resolve, 1));
    return [before, sandbox.current().citationDetail, { ...sandbox.overrides() }];
  });
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), ['titles', 'titles', titlesRun]);
  assert.equal(sandbox.current().citationDetail, 'quotes');
  assert.equal(sandbox.overrides(), null);
});

test('withRunSettings restores after a throw, sync or async', async () => {
  const { sandbox } = panel();
  await assert.rejects(sandbox.withRunSettings(titlesRun, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(sandbox.current().citationDetail, 'quotes');
  await assert.rejects(sandbox.withRunSettings(titlesRun, () => { throw new Error('bang'); }), /bang/);
  assert.equal(sandbox.current().citationDetail, 'quotes');
  assert.equal(sandbox.overrides(), null);
});

test('a nested run keeps the saved settings of the outer one', async () => {
  const { sandbox, writes } = panel({ fields: { 'citation-detail-select': 'quotes' } });
  // customImages: no Settings field writes it, so only the restore can bring it back
  await sandbox.withRunSettings({ citationDetail: 'titles', customImages: false }, async () => {
    await sandbox.withRunSettings({ obsidianNames: true }, async () => {
      assert.equal(sandbox.current().citationDetail, 'titles');
      assert.equal(sandbox.current().obsidianNames, true);
      assert.deepEqual({ ...sandbox.overrides() }, { citationDetail: 'titles', customImages: false, obsidianNames: true });
      assert.equal(sandbox.realSettings().citationDetail, 'quotes');
      assert.equal(sandbox.realSettings().obsidianNames, false);
      await sandbox.saveSettings();
      assert.equal(writes.at(-1).customImages, true);
    });
    await assert.rejects(sandbox.withRunSettings({ citationDetail: 'none' }, async () => { throw new Error('inner'); }), /inner/);
    assert.equal(sandbox.current().citationDetail, 'titles');
    assert.equal(sandbox.current().obsidianNames, false);
    assert.deepEqual({ ...sandbox.overrides() }, { citationDetail: 'titles', customImages: false });
  });
  assert.equal(sandbox.current().citationDetail, 'quotes');
  assert.equal(sandbox.current().customImages, true);
  assert.equal(sandbox.overrides(), null);
});

test('a save during a run stores the real settings, not the run values', async () => {
  const { sandbox, writes } = panel({ settings: { ...NLME.resetSettings(), exportNoteWithImages: false }, fields: { 'citation-detail-select': 'quotes' } });
  await sandbox.withRunSettings(NLME.presetOverrides('archive'), async () => {
    await sandbox.saveSettings();
    assert.equal(sandbox.current().exportNoteWithImages, true);
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].exportNoteWithImages, false);
  assert.equal(writes[0].exportSourceWithImages, false);
});

test('a setting changed during a job is written at once and takes effect after the job', async () => {
  const fields = { 'citation-detail-select': 'none', 'clean-ocr-artifacts-checkbox': false, 'refresh-interval-input': '30' };
  const { sandbox, writes } = panel({ fields });
  await sandbox.withRunSettings({ citationDetail: 'titles' }, async () => {
    await sandbox.saveSettings();
    // The job keeps its own: an overridden setting and a plain one
    assert.equal(sandbox.current().citationDetail, 'titles');
    assert.equal(sandbox.current().cleanOCRArtifacts, true);
    assert.equal(sandbox.current().refreshInterval, 10);
    assert.equal(writes[0].citationDetail, 'none');
    assert.equal(writes[0].cleanOCRArtifacts, false);
    assert.equal(writes[0].refreshInterval, 30);
  });
  assert.equal(sandbox.current().citationDetail, 'none');
  assert.equal(sandbox.current().cleanOCRArtifacts, false);
  assert.equal(sandbox.current().refreshInterval, 30);
});

test('a change to the value the job runs on still reaches storage', async () => {
  const { sandbox, writes } = panel({ fields: { 'citation-detail-select': 'titles' } });
  await sandbox.withRunSettings({ citationDetail: 'titles' }, () => sandbox.saveSettings());
  assert.equal(writes[0].citationDetail, 'titles');
  assert.equal(sandbox.current().citationDetail, 'titles');
});

test('the failed-load write block holds during a run, and no load runs under the job', async () => {
  const { sandbox, writes, toasts } = panel({ stored: false, fields: { 'citation-detail-select': 'none' } });
  await sandbox.withRunSettings({ citationDetail: 'titles' }, async () => {
    await sandbox.saveSettings();
    assert.equal(sandbox.current().citationDetail, 'titles');
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(toasts, ['unread']);
});

test('a blocked write loads again only when no job holds the lock', async () => {
  const blocked = lock => {
    const made = { loads: 0 };
    made.panel = panel({ stored: false, extra: {
      jobLock: { current: () => lock },
      retrySettingsLoad: async () => { made.loads++; return false; }
    } });
    return made;
  };
  // Held, with the run not begun yet: a load started here would land under the swap
  const held = blocked('Full Takeout');
  await held.panel.sandbox.writeSettings();
  assert.equal(held.loads, 0);
  assert.deepEqual(held.panel.toasts, ['unread']);
  const free = blocked(null);
  await free.panel.sandbox.writeSettings();
  assert.equal(free.loads, 1);
});

test('a theme change during a job goes by the real settings, not the job\'s', async () => {
  const theme = [];
  const { sandbox } = panel({
    settings: { ...NLME.resetSettings(), theme: 'dark' },
    code: fnSource('sidebar-core.js', 'applyTheme'),
    extra: {
      localStorage: { setItem() {} },
      document: { documentElement: { setAttribute: (name, value) => theme.push(value), removeAttribute: () => theme.push(null) } }
    }
  });
  await sandbox.withRunSettings({ theme: 'light' }, async () => sandbox.applyTheme());
  assert.deepEqual(theme, ['dark']);
});

test('the chat citation line goes by the real settings, not the job\'s', async () => {
  const line = { textContent: '' };
  const { sandbox } = panel({
    code: fnSource('sidebar-core.js', 'updateChatCitationInfo'),
    extra: { document: { getElementById: () => line } }
  });
  await sandbox.withRunSettings({ citationDetail: 'titles' }, async () => sandbox.updateChatCitationInfo());
  assert.match(line.textContent, /^Citations: Full quotes/);
});

test('retryFor keeps the run options after the run ended', async () => {
  const seen = [];
  const { sandbox } = panel({ extra: { runExclusive: (name, fn) => fn() } });
  const exportFn = async () => seen.push(sandbox.current().citationDetail);
  const retry = await sandbox.withRunSettings({ citationDetail: 'titles' }, async () => sandbox.retryFor([1], 'Job', exportFn));
  assert.equal(sandbox.current().citationDetail, 'quotes');
  await retry.run();
  assert.deepEqual(seen, ['titles']);
  assert.equal(sandbox.current().citationDetail, 'quotes');
  assert.equal(sandbox.overrides(), null);
});

test('retryFor outside a run runs on the settings of the moment', async () => {
  const seen = [];
  const { sandbox } = panel({ extra: { runExclusive: (name, fn) => fn() } });
  await sandbox.retryFor([1], 'Job', async () => seen.push(sandbox.overrides())).run();
  assert.deepEqual(seen, [null]);
});

test('a Retry refused by a busy lock changes nothing', async () => {
  const { sandbox } = panel({ extra: { runExclusive: async () => 'busy' } });
  const retry = await sandbox.withRunSettings({ citationDetail: 'titles' }, async () => sandbox.retryFor([1], 'Job', async () => {}));
  assert.equal(await retry.run(), 'busy');
  assert.equal(sandbox.current().citationDetail, 'quotes');
});

const TAKEOUT_RETRY = `
  const TAKEOUT_RETRY_STEPS = [{ name: 'Notes' }];
  const runChain = fn => fn();
  const runRetryChain = async () => { this.seen = [settings.citationDetail, settings.exportNoteWithImages, currentRunOverrides && { ...currentRunOverrides }]; return { steps: [{}], notRun: [] }; };
  const showTakeoutResults = (panel, failed, tabId) => { this.shown = takeoutRetry(failed, tabId, () => {}); };
  ${fnSource('sidebar-takeout.js', 'takeoutRetry')}
`;

test('the takeout Retry keeps the run options, and so does the Retry after it', async () => {
  const { sandbox } = panel({ code: TAKEOUT_RETRY, extra: {
    runExclusive: (name, fn) => fn(),
    NLME: { ...NLME, combineRetryOutcomes: () => ({ remaining: { Notes: ['b'] } }) }
  } });
  const overrides = NLME.presetOverrides('archive');
  const retry = await sandbox.withRunSettings(overrides, async () => sandbox.takeoutRetry({ Notes: ['a'] }, 1, () => {}));
  await retry.run();
  assert.equal(sandbox.seen[0], 'quotes');
  assert.equal(sandbox.seen[1], true);
  assert.deepEqual({ ...sandbox.seen[2] }, overrides);
  assert.equal(sandbox.current().exportNoteWithImages, false);
  sandbox.seen = null;
  await sandbox.shown.run(); // built inside the Retry
  assert.equal(sandbox.seen[1], true);
  assert.equal(sandbox.current().exportNoteWithImages, false);
});

test('a Generated Retry outside a run stays on Settings', async () => {
  const { sandbox } = panel({ code: TAKEOUT_RETRY, extra: {
    runExclusive: (name, fn) => fn(),
    NLME: { ...NLME, combineRetryOutcomes: () => ({ remaining: {} }) }
  } });
  await sandbox.takeoutRetry({ Notes: ['a'] }, 1, () => {}).run();
  assert.equal(sandbox.seen[1], false);
  assert.equal(sandbox.seen[2], null);
});

// resumeJob up to its first await: the record, then the settings the chain runs on
function resumeRun(settings) {
  return panel({ settings, code: `
    const runChain = fn => fn();
    const isNotebookUrl = () => true;
    ${fnSource('sidebar-takeout.js', 'resumeJob')}
  `, extra: {
    runExclusive: (name, fn) => fn(),
    chrome: { tabs: { query: async () => [] } }
  } });
}

async function settingsOnResume(sandbox, record) {
  let seen = null;
  sandbox.chrome.tabs.query = async () => {
    seen = { ...sandbox.current() };
    return [];
  };
  await sandbox.resumeJob(record);
  return seen;
}

test('Resume runs on the overrides in the record, not on the default of today', async () => {
  const { sandbox } = resumeRun({ ...NLME.resetSettings(), exportPreset: 'archive' });
  const record = NLME.newJobRecord({ id: 'j', kind: 'takeout', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1, overrides: NLME.presetOverrides('ai') });
  const seen = await settingsOnResume(sandbox, record);
  assert.equal(seen.citationDetail, 'titles');
  assert.equal(seen.exportNoteWithImages, false);
  assert.equal(sandbox.overrides(), null);
});

test('Resume of an old takeout record keeps its image copies, an old notes record stays on Settings', async () => {
  const { sandbox } = resumeRun(NLME.resetSettings());
  const old = NLME.newJobRecord({ id: 'j', kind: 'takeout', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 });
  assert.equal((await settingsOnResume(sandbox, old)).exportNoteWithImages, true);
  assert.equal((await settingsOnResume(sandbox, { ...old, kind: 'notes' })).exportNoteWithImages, false);
  assert.equal(sandbox.current().exportNoteWithImages, false);
});

test('startJobRecord stores the overrides of the run, and an update leaves them', async () => {
  const store = {};
  const { sandbox } = panel({ code: fnSource('sidebar-core.js', 'startJobRecord'), extra: {
    NLME: require('../takeout-job.js'), // createJobRecorder
    jobItemKeys: (category, items) => items,
    chrome: { storage: { local: {
      get: async key => (key in store ? { [key]: store[key] } : {}),
      set: async value => { Object.assign(store, JSON.parse(JSON.stringify(value))); },
      remove: async () => {}
    } } }
  } });
  const shell = { tab: { url: 'https://notebooklm.google.com/notebook/abc' } };
  const overrides = NLME.presetOverrides('ai');
  await sandbox.withRunSettings(overrides, () => sandbox.startJobRecord(shell, 'takeout', 'Full Takeout', { notes: ['a', 'b'] }));
  const key = NLME.jobRecordKey('abc');
  assert.deepEqual(store[key].overrides, overrides);
  await sandbox.withRunSettings({ citationDetail: 'none' }, () => sandbox.startJobRecord(shell, 'takeout', 'Retry', { notes: ['a'] }, { update: true }));
  assert.deepEqual(store[key].overrides, overrides);
  delete store[key];
  await sandbox.startJobRecord(shell, 'notes', 'Notes', { notes: ['a'] });
  assert.equal('overrides' in store[key], false);
});

test('Export everything runs on the sheet\'s choice, and reads its settings directly', () => {
  assert.match(fnSource('sidebar-takeout.js', 'openExportEverythingSheet'), /runExclusive\('Export everything', \(\) => withRunSettings\(overrides, \(\) => runFullTakeout\(\{ zip \}\)\)\)/);
  const src = fs.readdirSync(path.join(__dirname, '..')).filter(f => /^sidebar-.*\.js$/.test(f)).map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  assert.equal([...src.matchAll(/[^.]\brunFullTakeout\(\{ zip \}\)/g)].length, 1);
  const takeout = fnSource('sidebar-takeout.js', 'runFullTakeout');
  assert.doesNotMatch(takeout, /takeoutVariantSettings|variantSettings/);
  assert.doesNotMatch(takeout, /withRunSettings/);
  assert.equal(NLME.takeoutVariantSettings, undefined);
});

test('loadSettings migrates the preset from what was stored, and writes nothing', async () => {
  const load = stored => {
    const sets = [];
    const sandbox = {
      NLME, applySettingsToUi() {},
      chrome: { storage: { local: { get: async () => ({ settings: stored }), set: async value => sets.push(value) } } }
    };
    vm.createContext(sandbox);
    vm.runInContext(`let settings = NLME.resetSettings(); ${fnSource('sidebar-core.js', 'loadSettings')}; this.current = () => settings;`, sandbox);
    return sandbox.loadSettings().then(() => ({ settings: sandbox.current(), sets }));
  };
  assert.equal((await load({ citationDetail: 'titles' })).settings.exportPreset, 'custom');
  assert.equal((await load({ obsidianNames: true })).settings.exportPreset, 'custom');
  assert.equal((await load({ citationDetail: 'quotes' })).settings.exportPreset, 'archive');
  assert.equal((await load({ citationDetail: 'titles', exportPreset: 'ai' })).settings.exportPreset, 'ai');
  assert.equal((await load({ citationDetail: 'titles', exportPreset: 'archive' })).settings.exportPreset, 'archive');
  const migrated = await load({ citationDetail: 'titles' });
  assert.equal(migrated.settings.customImages, true);
  assert.deepEqual(migrated.sets, []);
});

// ---- The export sheet ----

test('the sheet opens on the default preset and the remembered Custom values', () => {
  const stored = { ...NLME.DEFAULT_SETTINGS, exportPreset: 'ai', citationDetail: 'none', obsidianNames: true, customImages: false, takeoutZip: true };
  assert.deepEqual(NLME.sheetChoice(stored), { preset: 'ai', citationDetail: 'none', obsidianNames: true, images: false, zip: true });
  assert.deepEqual(NLME.sheetChoice(NLME.DEFAULT_SETTINGS), { preset: 'archive', citationDetail: 'quotes', obsidianNames: false, images: true, zip: false });
  assert.equal(NLME.sheetChoice({ autoZip: true }).zip, true, 'takeoutZipChoice is the start');
  assert.equal(NLME.sheetChoice({ exportPreset: 'nonsense' }).preset, 'archive');
});

test('sheetOverrides: left alone, the sheet runs exactly the default', () => {
  const all = [
    NLME.DEFAULT_SETTINGS,
    { ...NLME.DEFAULT_SETTINGS, exportPreset: 'ai', takeoutZip: true },
    { ...NLME.DEFAULT_SETTINGS, exportPreset: 'custom', citationDetail: 'titles', obsidianNames: true, customImages: false },
    { ...NLME.DEFAULT_SETTINGS, exportPreset: 'custom', citationDetail: 'something-old' }
  ];
  for (const stored of all) {
    const run = NLME.sheetOverrides(NLME.sheetChoice(stored), stored);
    assert.deepEqual(run.overrides, NLME.runOverrides(stored));
    assert.equal(run.zip, NLME.takeoutZipChoice(stored));
  }
});

test('sheetOverrides: what each choice runs', () => {
  const stored = { ...NLME.DEFAULT_SETTINGS, citationDetail: 'none', obsidianNames: true, customImages: false };
  const start = NLME.sheetChoice(stored);
  assert.deepEqual(NLME.sheetOverrides({ ...start, preset: 'archive' }, stored).overrides, NLME.presetOverrides('archive'));
  assert.deepEqual(NLME.sheetOverrides({ ...start, preset: 'ai' }, stored).overrides, NLME.presetOverrides('ai'));
  assert.deepEqual(NLME.sheetOverrides({ ...start, preset: 'custom', citationDetail: 'titles', obsidianNames: false, images: true }, stored).overrides,
    NLME.presetOverrides('custom', { citationDetail: 'titles', obsidianNames: false, images: true }));
  assert.equal(NLME.sheetOverrides({ ...start, zip: true }, stored).zip, true);
  assert.equal(NLME.sheetOverrides({ ...start, zip: false }, { ...stored, takeoutZip: true }).zip, false);
});

test('sheetOverrides leaves the settings alone: a choice is for one run', () => {
  const stored = Object.freeze({ ...NLME.DEFAULT_SETTINGS, exportPreset: 'custom', citationDetail: 'titles' });
  const choice = { ...NLME.sheetChoice(stored), preset: 'ai', zip: true };
  NLME.sheetOverrides(choice, stored);
  assert.equal(stored.exportPreset, 'custom');
  assert.equal(stored.takeoutZip, undefined);
});

test('sheetOverrides gives the keys a run may set, so nothing else reaches a job', () => {
  const { overrides } = NLME.sheetOverrides({ preset: 'custom', citationDetail: 'none', obsidianNames: false, images: false, zip: true, theme: 'dark' }, {});
  assert.deepEqual(Object.keys(overrides).sort(), ['citationDetail', 'exportNoteWithImages', 'exportSourceWithImages', 'obsidianNames']);
});

test('estimateLine says what it left out', () => {
  assert.equal(NLME.estimateLine({ sources: 30, notes: 100, chat: null }, 'quotes'), 'Estimated time: about 13 min, not counting chat');
  assert.equal(NLME.estimateLine({ sources: 30, notes: 100, chat: 10 }, 'titles'), 'Estimated time: about 2 min');
  assert.equal(NLME.estimateLine({ sources: 3, notes: null, generated: null, chat: null }, 'quotes'), 'Estimated time: under 30 sec, not counting notes, generated items and chat');
  assert.equal(NLME.estimateLine({ sources: null, notes: 500, chat: undefined }, 'quotes'), 'Estimated time: about 58 min, not counting sources and chat');
});

test('estimateLine counts only what the run holds: a key that is absent is not missing', () => {
  assert.equal(NLME.estimateLine({ notes: 100 }, 'quotes'), 'Estimated time: about 12 min');
  assert.equal(NLME.estimateLine({ generated: 1 }, 'quotes'), 'Estimated time: under 30 sec');
});

test('estimateLine shows no number when nothing is known', () => {
  for (const counts of [undefined, null, {}, { sources: null, notes: null, generated: null, chat: null }, { notes: NaN }, { chat: -1 }]) {
    const line = NLME.estimateLine(counts, 'quotes');
    assert.equal(line, 'Estimated time: not known yet');
  }
});

test('estimateLine follows the citations', () => {
  const counts = { notes: 200 };
  assert.notEqual(NLME.estimateLine(counts, 'quotes'), NLME.estimateLine(counts, 'titles'));
});

test('homeEstimateCounts: Generated counts what is not a note, and chat only once loaded', () => {
  assert.deepEqual(NLME.homeEstimateCounts({ sources: 24, notes: 149, studio: 158 }, 219), { sources: 24, notes: 149, generated: 9, chat: 219 });
  assert.deepEqual(NLME.homeEstimateCounts({ sources: 24, notes: 149, studio: 158 }), { sources: 24, notes: 149, generated: 9, chat: null });
  assert.deepEqual(NLME.homeEstimateCounts({ sources: 24, notes: null, studio: 158 }), { sources: 24, notes: null, generated: null, chat: null });
  assert.deepEqual(NLME.homeEstimateCounts({ sources: null, notes: 5 }), { sources: null, notes: 5, generated: null, chat: null });
  assert.deepEqual(NLME.homeEstimateCounts({ notes: 9, studio: 3 }, 0), { sources: null, notes: 9, generated: 0, chat: 0 });
  assert.deepEqual(NLME.homeEstimateCounts(undefined), { sources: null, notes: null, generated: null, chat: null });
});

test('tabLeftPanelNotebook: only another notebook counts', () => {
  const url = id => `https://notebooklm.google.com/notebook/${id}?authuser=1`;
  assert.equal(NLME.tabLeftPanelNotebook(url('bbb'), 'aaa'), true);
  assert.equal(NLME.tabLeftPanelNotebook(url('aaa'), 'aaa'), false);
  assert.equal(NLME.tabLeftPanelNotebook(url('aaa'), ''), true, 'a panel that holds none');
  for (const other of ['https://notebooklm.google.com/', 'https://example.com/', 'chrome://newtab/', '', undefined, null]) {
    assert.equal(NLME.tabLeftPanelNotebook(other, 'aaa'), false, String(other));
  }
});

test('a job record keeps the save choice of its run, and an old one has none', () => {
  const base = { id: 'j', kind: 'takeout', label: 'L', notebookId: 'nb', keysByCategory: { notes: ['a'] }, now: 1 };
  assert.equal(NLME.jobRecordZip(NLME.newJobRecord({ ...base, zip: true })), true);
  assert.equal(NLME.jobRecordZip(NLME.newJobRecord({ ...base, zip: false })), false);
  const old = NLME.newJobRecord(base);
  assert.equal('zip' in old, false);
  assert.equal(NLME.jobRecordZip(old), undefined);
  assert.equal(NLME.jobRecordZip({ ...old, zip: 'yes' }), undefined);
  assert.equal(NLME.jobRecordZip(null), undefined);
  assert.equal(NLME.jobRecordZip(JSON.parse(JSON.stringify(NLME.newJobRecord({ ...base, zip: false })))), false);
});

test('the takeout Retry keeps the save choice of the run, and so does the Retry after it', async () => {
  const seen = [];
  const { sandbox } = panel({ code: `
    const TAKEOUT_RETRY_STEPS = [{ name: 'Notes' }];
    const runChain = fn => fn();
    const runRetryChain = async (items, tabId, verb, steps, zip) => { seen(zip); return { steps: [{}], notRun: [] }; };
    const showTakeoutResults = (panel, failed, tabId, zip) => { this.shown = takeoutRetry(failed, tabId, () => {}, zip); };
    ${fnSource('sidebar-takeout.js', 'takeoutRetry')}
  `, extra: {
    seen: zip => seen.push(zip),
    runExclusive: (name, fn) => fn(),
    NLME: { ...NLME, combineRetryOutcomes: () => ({ remaining: { Notes: ['b'] } }) }
  } });
  await sandbox.takeoutRetry({ Notes: ['a'] }, 1, () => {}, false).run();
  await sandbox.shown.run();
  assert.deepEqual(seen, [false, false]);
});

test('the Artifacts step of a chain takes the save choice; undefined leaves the default', async () => {
  const calls = [];
  const ctx = { downloadAllArtifacts: async (...args) => { calls.push(args); }, exportSources() {}, exportNotesAsMarkdown() {} };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'sidebar-takeout.js'), 'utf8');
  const at = src.indexOf('const TAKEOUT_RETRY_STEPS');
  vm.runInContext(`${src.slice(at, src.indexOf('];', at) + 2)}; this.steps = TAKEOUT_RETRY_STEPS;`, ctx);
  const artifacts = ctx.steps.find(step => step.name === 'Artifacts');
  await artifacts.run(['a'], 7, false);
  await artifacts.run(['a'], 7, undefined);
  assert.equal(calls[0][2].zip, false);
  assert.equal(calls[0][2].updateRecord, true);
  assert.equal(calls[1][2].zip, undefined);
});

test('startJobRecord stores the save choice beside the overrides, and an update leaves it', async () => {
  const store = {};
  const { sandbox } = panel({ code: fnSource('sidebar-core.js', 'startJobRecord'), extra: {
    NLME: { ...NLME, ...require('../takeout-job.js') },
    jobItemKeys: (category, items) => items,
    chrome: { storage: { local: {
      get: async key => (key in store ? { [key]: store[key] } : {}),
      set: async value => { Object.assign(store, JSON.parse(JSON.stringify(value))); },
      remove: async () => {}
    } } }
  } });
  const shell = { tab: { url: 'https://notebooklm.google.com/notebook/abc' } };
  const key = NLME.jobRecordKey('abc');
  await sandbox.startJobRecord(shell, 'takeout', 'Export everything', { notes: ['a', 'b'] }, { zip: false });
  assert.equal(store[key].zip, false);
  await sandbox.startJobRecord(shell, 'takeout', 'Retry', { notes: ['a'] }, { update: true, zip: true });
  assert.equal(store[key].zip, false);
  delete store[key];
  await sandbox.startJobRecord(shell, 'notes', 'Notes', { notes: ['a'] });
  assert.equal('zip' in store[key], false);
});
