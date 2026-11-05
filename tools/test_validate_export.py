"""Tests for tools/validate_export.py. Run: python3 -I -m unittest discover -s tools -v"""
import io
import json
import os
import shutil
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout

import validate_export as ve

FM = '---\ntitle: "Notes — Demo"\nnotebook: "Demo"\nexporter: "NotebookLM Takeout 1.7.0"\nexported: "2026-11-03T20:29:50.834Z"\nkind: "index"\ncategory: "notes"\n---\n\n'


def make_export(root, files=None, manifest=None, drop=(), audit=None, index=None, version='1.7.0'):
    """Write a minimal notes export under root; returns root."""
    files = dict(files or {'notes/A.md': '# A\n\nBody[^1]\n\n[^1]: **Src** — quote\n', 'combined-notes.md': '# All\n'})
    files['_index.md'] = index if index is not None else FM + '# Notes\n\n- [A](notes/A.md)\n- [All](combined-notes.md)\n'
    files['_audit.md'] = audit if audit is not None else '# Notes Export Audit\n\n- items: 1 of 1\n- citations: 1 of 1\n'
    os.makedirs(root, exist_ok=True)
    for rel, text in files.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
    m = {
        'exporter': f'NotebookLM Takeout {version}', 'exported': '2026-11-03T20:29:50.834Z',
        'notebook': {'title': 'Demo', 'id': 'abc', 'url': 'https://example.invalid/notebook/abc'},
        'kind': 'notes', 'part': 1, 'totalParts': 1, 'partial': False, 'counts': {'notes': 1}, 'errorCount': 0,
        'files': [{'path': rel, 'bytes': os.path.getsize(os.path.join(root, rel))} for rel in sorted(files)],
    }
    m.update(manifest or {})
    with open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(m, f)
    for rel in drop:
        os.remove(os.path.join(root, rel))
    return root


def zip_dir(src, zpath):
    with zipfile.ZipFile(zpath, 'w') as z:
        for d, _, fs in os.walk(src):
            for f in fs:
                full = os.path.join(d, f)
                z.write(full, os.path.relpath(full, src))
    return zpath


def codes(report):
    return sorted({f.code for f in report.findings})


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def check(self, *paths):
        with redirect_stdout(io.StringIO()):
            return ve.validate_paths(list(paths))


class ValidateTests(Base):
    def test_clean_export_passes(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e')))
        self.assertEqual(r.status, 'PASS', [str(f) for f in r.findings])
        self.assertEqual(r.version, '1.7.0')
        self.assertEqual(r.kind, 'notes')

    def test_zip_is_extracted_and_checked(self):
        src = make_export(os.path.join(self.tmp, 'e'))
        [r] = self.check(zip_dir(src, os.path.join(self.tmp, 'Demo-notes.zip')))
        self.assertEqual(r.status, 'PASS', [str(f) for f in r.findings])

    def test_zip_with_path_traversal_is_refused(self):
        z = os.path.join(self.tmp, 'evil.zip')
        with zipfile.ZipFile(z, 'w') as zf:
            zf.writestr('../escape.md', 'x')
        [r] = self.check(z)
        self.assertEqual(r.status, 'FAIL')
        self.assertIn('unsafe-zip', codes(r))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.tmp), 'escape.md')))

    def test_missing_listed_file_fails(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), drop=['notes/A.md']))
        self.assertEqual(r.status, 'FAIL')
        self.assertIn('missing-file', codes(r))

    def test_size_mismatch_fails(self):
        root = make_export(os.path.join(self.tmp, 'e'))
        with open(os.path.join(root, 'combined-notes.md'), 'a', encoding='utf-8') as f:
            f.write('extra')
        [r] = self.check(root)
        self.assertIn('size-mismatch', codes(r))
        self.assertEqual(r.status, 'FAIL')

    def test_unlisted_file_warns(self):
        root = make_export(os.path.join(self.tmp, 'e'))
        with open(os.path.join(root, 'stray.md'), 'w') as f:
            f.write('x')
        with open(os.path.join(root, '.DS_Store'), 'w') as f:
            f.write('x')
        [r] = self.check(root)
        self.assertEqual(r.status, 'WARN')
        self.assertEqual([f.detail for f in r.findings if f.code == 'unlisted-file'], ['stray.md'])

    def test_audit_shortfall_fails_and_surplus_is_info(self):
        audit = '# Audit\n\n- items: 1 of 2\n- formulas: 12 of 9\n- Citations from cache: 0 of 1 items\n'
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), audit=audit))
        self.assertEqual(r.status, 'FAIL')
        short = [f for f in r.findings if f.code == 'audit-short']
        self.assertEqual(len(short), 1)
        self.assertIn('items: 1 of 2', short[0].detail)
        self.assertIn('audit-surplus', codes(r))
        self.assertEqual([f.level for f in r.findings if f.code == 'audit-surplus'], ['info'])

    def test_partial_export_reports_reason_from_errors_md(self):
        files = {'notes/A.md': '# A\n', 'combined-notes.md': '# All\n', 'errors.md': '# Errors\n\n## CANCELLED (1)\n\n- Cancelled by user after 2 of 148 notes; the rest were not exported\n'}
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files=files, manifest={'partial': True, 'errorCount': 1}))
        self.assertEqual(r.status, 'WARN')
        p = [f for f in r.findings if f.code == 'partial']
        self.assertEqual(len(p), 1)
        self.assertIn('Cancelled by user after 2 of 148 notes', p[0].detail)

    def test_partial_without_errors_md_fails(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), manifest={'partial': True, 'errorCount': 1}))
        self.assertIn('errors-missing', codes(r))
        self.assertEqual(r.status, 'FAIL')

    def test_links_with_balanced_parentheses_are_valid(self):
        files = {'notes/x-(S1)-y.md': '# A\n', 'notes/x-(No%2C-Filters).md': '# B\n'}
        index = FM + '- [a](notes/x-(S1)-y.md)\n- [b](notes/x-(No%2C-Filters).md)\n- [c](notes/Gone-(1).md)\n'
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files=files, index=index))
        self.assertEqual([f.detail for f in r.findings if f.code == 'broken-link'], ['_index.md \u2192 notes/Gone-(1).md'])

    def test_broken_index_links_fail_in_md_and_html(self):
        files = {'notes/A.md': '# A\n', '_index.html': '<a href="notes/A.md">A</a> <a href="notes/Gone.md">x</a> <a href="https://x.invalid/">w</a>'}
        index = FM + '- [A](notes/A.md)\n- [B](notes/B%20c.md)\n- [web](https://example.invalid/)\n- [anchor](#top)\n'
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files=files, index=index))
        broken = sorted(f.detail for f in r.findings if f.code == 'broken-link')
        self.assertEqual(broken, ['_index.html → notes/Gone.md', '_index.md → notes/B c.md'])
        self.assertEqual(r.status, 'FAIL')

    def test_missing_front_matter_fails_from_1_7_0_only(self):
        index = '# Notes\n\n- [A](notes/A.md)\n'
        [new] = self.check(make_export(os.path.join(self.tmp, 'new'), index=index))
        [old] = self.check(make_export(os.path.join(self.tmp, 'old'), index=index, version='1.6.0'))
        self.assertIn('front-matter-missing', codes(new))
        self.assertNotIn('front-matter-missing', codes(old))
        self.assertEqual(old.version, '1.6.0')

    def test_footnote_text_that_is_not_a_marker(self):
        body = ('# A\n\nPlain words.\n\n'
                '\\[^1\\]: an escaped definition from a source\n\n'
                'See \\[^2\\] in the text.\n\n'
                '> A quote keeps its own marker.[^3] And another.[^4]\n\n'
                'A real one[^9].\n')
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files={'notes/A.md': body}))
        got = {(f.code, f.detail) for f in r.findings if f.code.startswith('footnote')}
        self.assertEqual(got, {('footnote-undefined', 'notes/A.md: [^9]')})

    def test_footnote_problems(self):
        text = ('# A\n\nOne[^1] two[^2] three[^9]\n\n```\nnot a ref [^7]\n```\n\n'
                '[^1]: **S** — q\n[^1]: **S** — dup\n[^2]: **T** — q\n[^3]: **U** — unused\n')
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files={'notes/A.md': text}))
        got = {(f.code, f.detail) for f in r.findings if f.code.startswith('footnote')}
        self.assertIn(('footnote-undefined', 'notes/A.md: [^9]'), got)
        self.assertIn(('footnote-duplicate', 'notes/A.md: [^1]'), got)
        self.assertIn(('footnote-unused', 'notes/A.md: [^3]'), got)
        self.assertNotIn(('footnote-undefined', 'notes/A.md: [^7]'), got)
        self.assertEqual(r.status, 'FAIL')

    def test_sentinel_characters_fail(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files={'notes/A.md': '# A\n\nx[^1]\n\n[^1]: d\n'}))
        self.assertIn('sentinel', codes(r))

    def test_part_set_complete_and_incomplete(self):
        p1 = make_export(os.path.join(self.tmp, 'Demo-notes-T1-part1of2'), manifest={'part': 1, 'totalParts': 2})
        p2 = make_export(os.path.join(self.tmp, 'Demo-notes-T1-part2of2'), manifest={'part': 2, 'totalParts': 2})
        reports = self.check(p1, p2)
        self.assertTrue(all('part-missing' not in codes(r) for r in reports))
        [only] = self.check(p1)
        self.assertIn('part-missing', codes(only))
        self.assertIn('part 2 of 2', [f.detail for f in only.findings if f.code == 'part-missing'][0])

    def test_browser_renamed_part_still_groups(self):
        p1 = make_export(os.path.join(self.tmp, 'D-notes-T-part1of2'), manifest={'part': 1, 'totalParts': 2})
        p2 = make_export(os.path.join(self.tmp, 'D-notes-T-part2of2 (1)'), manifest={'part': 2, 'totalParts': 2},
                         files={'notes/B.md': '# B\n', 'combined-notes.md': '# All\n'})
        reports = self.check(p1, p2)
        self.assertEqual([f.detail for r in reports for f in r.findings if f.code == 'part-missing'], [])

    def test_same_file_in_two_parts_warns(self):
        p1 = make_export(os.path.join(self.tmp, 'D-notes-T-part1of2'), manifest={'part': 1, 'totalParts': 2})
        p2 = make_export(os.path.join(self.tmp, 'D-notes-T-part2of2'), manifest={'part': 2, 'totalParts': 2},
                         files={'notes/A.md': '# A again\n', 'notes/B.md': '# B\n', 'combined-notes.md': '# All\n'})
        reports = self.check(p1, p2)
        dup = [f for r in reports for f in r.findings if f.code == 'duplicate-across-parts']
        self.assertEqual([(f.level, f.detail) for f in dup], [('warn', 'notes/A.md is in part 1 and part 2 (merging the parts keeps only one)')])

    def test_javascript_leftovers_fail(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), files={'notes/A.md': '# A\n\nTitle: [object Object]\n'}))
        self.assertIn('js-leftover', codes(r))
        self.assertEqual(r.status, 'FAIL')

    def test_takeout_folder_checks_each_category(self):
        root = os.path.join(self.tmp, 'Demo takeout T', 'Demo')
        make_export(os.path.join(root, 'notes'))
        make_export(os.path.join(root, 'chat'), files={'chat.md': '# Chat\n'}, manifest={'kind': 'chat'}, drop=['chat.md'])
        tfm = FM.replace('kind: "index"\ncategory: "notes"', 'kind: "takeout"')
        with open(os.path.join(root, '_index.md'), 'w', encoding='utf-8') as f:
            f.write(tfm + '| Notes | 1 of 1 | 0 | complete | notes/ |\n')
        with open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump({'exporter': 'NotebookLM Takeout 1.7.0', 'kind': 'takeout', 'part': 1, 'totalParts': 1, 'partial': False,
                       'errorCount': 0, 'files': [{'path': '_index.md', 'bytes': os.path.getsize(os.path.join(root, '_index.md'))}],
                       'categories': []}, f)
        reports = self.check(os.path.join(self.tmp, 'Demo takeout T'))
        kinds = sorted(r.kind for r in reports)
        self.assertEqual(kinds, ['chat', 'notes', 'takeout'])
        chat = [r for r in reports if r.kind == 'chat'][0]
        self.assertIn('missing-file', codes(chat))
        takeout = [r for r in reports if r.kind == 'takeout'][0]
        self.assertNotIn('unlisted-file', codes(takeout))

    def test_single_markdown_file(self):
        p = os.path.join(self.tmp, 'Demo-chat.md')
        with open(p, 'w', encoding='utf-8') as f:
            f.write('---\nexporter: "NotebookLM Takeout 1.7.0"\n---\n\nHi[^1-1]\n\n[^1-1]: **S** — q\n')
        [r] = self.check(p)
        self.assertEqual(r.status, 'PASS', [str(f) for f in r.findings])
        self.assertEqual(r.version, '1.7.0')

    def test_not_an_export(self):
        d = os.path.join(self.tmp, 'empty')
        os.makedirs(d)
        [r] = self.check(d)
        self.assertEqual(r.status, 'FAIL')
        self.assertIn('no-manifest', codes(r))


class CompareTests(Base):
    def compare(self, base, cand):
        with redirect_stdout(io.StringIO()):
            return ve.compare_paths(base, cand)

    def test_identical_apart_from_run_details(self):
        b = make_export(os.path.join(self.tmp, 'b'), files={'notes/A.md': '# A\n\nExported: 11/3/2026, 12:40:36 PM\n'})
        c = make_export(os.path.join(self.tmp, 'c'), files={'notes/A.md': '# A\n\nExported: 11/3/2026, 2:04:14 PM\n'},
                        manifest={'exported': '2026-11-03T22:00:00.000Z', 'exporter': 'NotebookLM Takeout 1.7.1'})
        res = self.compare(b, c)
        self.assertEqual(res.different, [], res.different)
        self.assertEqual((res.missing, res.extra), ([], []))
        self.assertTrue(res.ok)

    def test_front_matter_only_difference_is_its_own_class(self):
        b = make_export(os.path.join(self.tmp, 'b'), index='# Notes\n\n- [A](notes/A.md)\n', version='1.6.0')
        c = make_export(os.path.join(self.tmp, 'c'))
        c_index = os.path.join(c, '_index.md')
        with open(c_index, 'w', encoding='utf-8') as f:
            f.write(FM + '# Notes\n\n- [A](notes/A.md)\n')
        res = self.compare(b, c)
        self.assertEqual(res.front_matter_only, ['_index.md'])
        self.assertEqual(res.different, [])
        self.assertTrue(res.ok)

    def test_content_change_missing_and_extra_fail(self):
        b = make_export(os.path.join(self.tmp, 'b'), files={'notes/A.md': '# A\nold\n', 'notes/B.md': '# B\n'})
        c = make_export(os.path.join(self.tmp, 'c'), files={'notes/A.md': '# A\nnew\n', 'notes/C.md': '# C\n'})
        res = self.compare(b, c)
        self.assertIn('notes/A.md', res.different)
        self.assertEqual(res.missing, ['notes/B.md'])
        self.assertEqual(res.extra, ['notes/C.md'])
        self.assertFalse(res.ok)

    def test_allow_pattern_accepts_matching_changes(self):
        b = make_export(os.path.join(self.tmp, 'b'), files={'notes/A.md': '# A\nx2x^2x2\n'})
        c = make_export(os.path.join(self.tmp, 'c'), files={'notes/A.md': '# A\n$x^2$\n'})
        with redirect_stdout(io.StringIO()):
            res = ve.compare_paths(b, c, allow=[r'\$[^$]+\$', r'x2x\^2x2'])
        self.assertEqual(res.different, [])
        self.assertEqual(res.allowed, ['notes/A.md'])
        self.assertTrue(res.ok)

    def test_index_html_file_sizes_are_not_compared(self):
        row = '<li><a href="notes/A.md">A</a> <span class="type">Markdown · {} </span></li>'
        b = make_export(os.path.join(self.tmp, 'b'), files={'notes/A.md': '# A\n', 'combined-notes.md': '# All\n', '_index.html': row.format('477 B')})
        c = make_export(os.path.join(self.tmp, 'c'), files={'notes/A.md': '# A\n', 'combined-notes.md': '# All\n', '_index.html': row.format('1.2 KB')})
        res = self.compare(b, c)
        self.assertNotIn('_index.html', res.different)
        self.assertTrue(res.ok)

    def test_manifest_bytes_follow_content_not_timestamps(self):
        b = make_export(os.path.join(self.tmp, 'b'), files={'notes/A.md': '# A\n\nExported: 11/3/2026, 12:40:36 PM\n'})
        c = make_export(os.path.join(self.tmp, 'c'), files={'notes/A.md': '# A\n\nExported: 11/3/2026, 2:04:14 PM\nmore\n'})
        res = self.compare(b, c)
        self.assertIn('notes/A.md', res.different)
        self.assertIn('manifest.json', res.different)


if __name__ == '__main__':
    unittest.main()


class PartialTests(Base):
    def partial(self, name, **manifest):
        files = {'notes/A.md': '# A\n', 'combined-notes.md': '# All\n',
                 'errors.md': '# Errors\n\n## CANCELLED (1)\n\n- Cancelled by user after 2 of 148 notes\n'}
        audit = '# Audit\n\n- ⚠️ items: 2 of 148\n'
        return make_export(os.path.join(self.tmp, name), files=files, audit=audit,
                           manifest={'partial': True, 'errorCount': 1, **manifest})

    def test_cancelled_export_shortfall_is_a_warning(self):
        [r] = self.check(self.partial('e'))
        self.assertEqual(r.status, 'WARN', [str(f) for f in r.findings])
        short = [f for f in r.findings if f.code == 'audit-short']
        self.assertEqual([(f.level, f.detail) for f in short], [('warn', 'items: 2 of 148 (export was cancelled)')])

    def test_cancelled_split_export_has_no_later_parts(self):
        [r] = self.check(self.partial('X-notes-T-PARTIAL-part1of2', part=1, totalParts=2))
        self.assertEqual([f.level for f in r.findings if f.code == 'part-missing'], ['info'])
        self.assertEqual(r.status, 'WARN')


def viewer_html(data):
    """A stand-in for viewer.html: the data block is written the way escapeJson writes it."""
    blob = json.dumps(data).replace('</', '<\\/')
    return f'<!doctype html><title>Viewer</title><script id="data" type="application/json">{blob}</script><script>var x=1;</script>'


def make_takeout(root, studio, version='1.8.0', viewer=True, artifacts=('artifacts/slides/Deck.pdf',), raw=None):
    """A Full Takeout root: index files, viewer.html and an artifacts folder."""
    files = {'_index.md': FM.replace('"index"', '"takeout"') + '# Takeout\n'}
    if viewer:
        files['viewer.html'] = raw if raw is not None else viewer_html({'notebook': 'Demo', 'studio': studio})
    for rel in artifacts:
        files[rel] = 'x'
    os.makedirs(root, exist_ok=True)
    for rel, text in files.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
    m = {
        'exporter': f'NotebookLM Takeout {version}', 'exported': '2026-11-03T20:29:50.834Z',
        'notebook': {'title': 'Demo', 'id': 'abc', 'url': 'https://example.invalid/n/abc'},
        'kind': 'takeout', 'part': 1, 'totalParts': 1, 'partial': False, 'counts': {}, 'errorCount': 0,
        'files': [{'path': rel, 'bytes': os.path.getsize(os.path.join(root, rel))}
                  for rel in sorted(files)],
    }
    with open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(m, f)
    return root


class ViewerTests(Base):
    def run_viewer(self, studio, **kw):
        [r] = self.check(make_takeout(os.path.join(self.tmp, 't'), studio, **kw))
        return r

    def test_viewer_ok(self):
        studio = [{'kind': 'slides', 'title': 'Deck', 'files': {'pdf': 'artifacts/slides/Deck.pdf'}}, {'kind': 'note', 'title': 'N'}]
        r = self.run_viewer(studio)
        self.assertEqual(codes(r), [], [str(f) for f in r.findings])

    def test_viewer_link_is_url_decoded(self):
        r = self.run_viewer([{'kind': 'slides', 'files': {'pdf': 'artifacts/slides/My%20Deck%20%C3%A9.pdf'}}],
                            artifacts=('artifacts/slides/My Deck é.pdf',))
        self.assertEqual(codes(r), [], [str(f) for f in r.findings])

    def test_viewer_link_outside_root_is_allowed_when_it_exists(self):
        out = os.path.join(self.tmp, 'Saved.pdf')
        with open(out, 'w') as f:
            f.write('x')
        r = self.run_viewer([{'kind': 'slides', 'files': {'pdf': 'artifacts/slides/../../../Saved.pdf'}}])
        self.assertEqual(codes(r), [], [str(f) for f in r.findings])

    def test_viewer_broken_link(self):
        r = self.run_viewer([{'kind': 'slides', 'files': {'pdf': 'artifacts/slides/Gone.pdf'}}])
        self.assertEqual(r.status, 'FAIL')
        self.assertEqual([f.detail for f in r.findings if f.code == 'viewer-broken-link'], ['artifacts/slides/Gone.pdf'])

    IMG = 'images/0123456789abcdef.jpg'

    def image_takeout(self, data, images=()):
        root = make_takeout(os.path.join(self.tmp, 't'), [], raw=viewer_html(data))
        for rel in images:
            p = os.path.join(root, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write('x')
        return root

    def test_viewer_images_ok_and_not_unlisted(self):
        data = {'notebook': 'Demo', 'studio': [{'kind': 'note', 'md': f'![a]({self.IMG})'}]}
        [r] = self.check(self.image_takeout(data, [self.IMG]))
        self.assertEqual(codes(r), [], [str(f) for f in r.findings])

    def test_viewer_broken_image_link(self):
        for data in ({'studio': [{'kind': 'note', 'md': f'x ![a]({self.IMG}) y'}]},
                     {'studio': [], 'sources': [{'title': 'S', 'md': f'![]({self.IMG})'}]},
                     {'studio': [], 'pairs': [{'q': 'Q', 'a': f'![]({self.IMG})'}]},
                     {'studio': [], 'cites': [{'t': 'T', 'q': '', 'imgs': [self.IMG]}]}):
            with self.subTest(data=data):
                [r] = self.check(self.image_takeout(data))
                self.assertEqual([f.detail for f in r.findings if f.code == 'viewer-broken-link'], [self.IMG])
                shutil.rmtree(os.path.join(self.tmp, 't'))

    def test_viewer_image_links_are_checked_beside_any_category_folder(self):
        for folder in ('sources', 'notes', 'chat'):
            with self.subTest(folder=folder):
                root = os.path.join(self.tmp, folder)
                make_takeout(root, [{'kind': 'note', 'md': f'![a]({self.IMG})'}], artifacts=(f'{folder}/x.bin',))
                [r] = self.check(root)
                self.assertEqual([f.detail for f in r.findings if f.code == 'viewer-broken-link'], [self.IMG])

    def test_viewer_media_links_still_need_artifacts(self):
        r = self.run_viewer([{'kind': 'slides', 'files': {'pdf': 'artifacts/slides/Deck.pdf'}}], artifacts=('notes/x.bin',))
        self.assertNotIn('viewer-broken-link', codes(r))

    def test_viewer_image_links_are_skipped_in_an_unmerged_zip(self):
        r = self.run_viewer([{'kind': 'note', 'md': f'![a]({self.IMG})'}], artifacts=())
        self.assertNotIn('viewer-broken-link', codes(r))

    def test_viewer_text_that_only_looks_like_an_image_is_not_a_link(self):
        r = self.run_viewer([{'kind': 'note', 'md': 'see ![fig](images/fig1.png)'}])
        self.assertEqual(codes(r), [])

    def test_images_outside_a_takeout_stay_unlisted(self):
        root = make_export(os.path.join(self.tmp, 'n'))
        p = os.path.join(root, 'images', '0123456789abcdef.jpg')
        os.makedirs(os.path.dirname(p))
        with open(p, 'w', encoding='utf-8') as f:
            f.write('x')
        [r] = self.check(root)
        self.assertIn('unlisted-file', codes(r))

    def test_images_zip_is_recognised(self):
        p = os.path.join(self.tmp, 'Demo-takeout-images-T.zip')
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('Demo/' + self.IMG, 'x')
        [r] = self.check(p)
        self.assertEqual((r.status, r.kind), ('PASS', 'images'), [str(f) for f in r.findings])

    def test_other_zip_without_manifest_still_fails(self):
        p = os.path.join(self.tmp, 'Other.zip')
        with zipfile.ZipFile(p, 'w') as z:
            z.writestr('Demo/images/photo.jpg', 'x')
        [r] = self.check(p)
        self.assertEqual(codes(r), ['no-manifest'])

    def test_viewer_bad_data(self):
        for raw in ('<!doctype html><p>no data</p>',
                    '<script id="data" type="application/json">{not json</script>',
                    '<script id="data" type="application/json">{"notebook": "x"}</script>'):
            with self.subTest(raw=raw):
                shutil.rmtree(os.path.join(self.tmp, 't'), ignore_errors=True)
                r = self.run_viewer([], raw=raw)
                self.assertEqual(r.status, 'FAIL')
                self.assertIn('viewer-invalid', codes(r))

    def test_unmerged_zip_without_artifacts_skips_link_checks(self):
        r = self.run_viewer([{'kind': 'slides', 'files': {'pdf': 'artifacts/slides/Deck.pdf'}}], artifacts=())
        self.assertEqual(codes(r), [], [str(f) for f in r.findings])

    def test_takeout_without_viewer_from_1_8(self):
        r = self.run_viewer([], viewer=False)
        self.assertEqual(r.status, 'WARN')
        self.assertEqual(codes(r), ['viewer-missing'])

    def test_takeout_without_viewer_before_1_8_is_fine(self):
        r = self.run_viewer([], viewer=False, version='1.7.0')
        self.assertEqual(codes(r), [])

    def test_version_compare_is_numeric(self):
        r = self.run_viewer([], viewer=False, version='1.10.0')
        self.assertEqual(codes(r), ['viewer-missing'])
        shutil.rmtree(os.path.join(self.tmp, 't'))
        r = self.run_viewer([], viewer=False, version='1.7.9')
        self.assertEqual(codes(r), [])

    def test_category_export_needs_no_viewer(self):
        [r] = self.check(make_export(os.path.join(self.tmp, 'e'), version='1.8.0'))
        self.assertNotIn('viewer-missing', codes(r))
