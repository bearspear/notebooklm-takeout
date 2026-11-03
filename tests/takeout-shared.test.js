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

test('uniqueFilenames suffixes repeated names before the extension', () => {
  assert.deepEqual(
    NLME.uniqueFilenames(['The-Electric-Universe.pdf', 'The-Electric-Universe.pdf', 'The-Electric-Universe.pdf']),
    ['The-Electric-Universe.pdf', 'The-Electric-Universe (2).pdf', 'The-Electric-Universe (3).pdf']
  );
});

test('uniqueFilenames leaves distinct names and extensionless names usable', () => {
  assert.deepEqual(NLME.uniqueFilenames(['Map.svg', 'Map.json', 'README', 'README']), ['Map.svg', 'Map.json', 'README', 'README (2)']);
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
  assert.equal(r.message, 'Exported 7 of 10 notes (3 failed, see errors.txt)');
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
  assert.equal(r.message, 'No notes exported (10 failed, see errors.txt)');
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

test('formatErrorsTxt lists every error and the issues link', () => {
  const txt = NLME.formatErrorsTxt({ title: 'Artifacts', generatedAt: '11/2/2026, 1:00 PM', errors: ['Deck A: Download was not captured', 'Map B: Item changed'] });
  assert.match(txt, /^# Artifacts Error Report/);
  assert.match(txt, /- Deck A: Download was not captured/);
  assert.match(txt, /- Map B: Item changed/);
  assert.match(txt, /11\/2\/2026, 1:00 PM/);
  assert.ok(txt.includes(NLME.ISSUES_URL));
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
