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
