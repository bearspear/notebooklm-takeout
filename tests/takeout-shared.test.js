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
