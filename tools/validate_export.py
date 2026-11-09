#!/usr/bin/env python3
"""Validate NotebookLM Takeout exports, and compare an export against a baseline.

Usage:
  python3 -I tools/validate_export.py EXPORT [EXPORT ...] [-v]
  python3 -I tools/validate_export.py CANDIDATE --baseline BASELINE [--allow REGEX ...] [--max-diff N]

EXPORT is a ZIP, an extracted export folder, a Full Takeout folder, or a single .md download.
Give every part of a split export together so the set can be checked. Exit code 1 when any
check fails (or, with --baseline, when the export differs from the baseline).

Standard library only. ZIPs are extracted to a private temp folder after their member names
are checked; nothing next to the input is written.
"""
import argparse
import atexit
import difflib
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass, field
from urllib.parse import unquote

IGNORED_NAMES = {'.DS_Store', 'Thumbs.db'}
IGNORED_DIRS = {'__MACOSX'}
MAX_UNZIPPED_BYTES = 4 * 1024 ** 3
TEXT_EXT = ('.md', '.txt', '.json', '.html', '.csv', '.svg')
SENTINELS = ('', '')

_temp_dirs = []


@atexit.register
def _cleanup():
    for d in _temp_dirs:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- findings

@dataclass
class Finding:
    level: str  # 'fail' | 'warn' | 'info'
    code: str
    detail: str

    def __str__(self):
        return f'{self.level.upper():4} {self.code}: {self.detail}'


@dataclass
class Report:
    label: str
    kind: str = '?'
    version: str = None
    part: int = 1
    total_parts: int = 1
    notebook: str = ''
    root: str = None
    partial: bool = False
    files: list = field(default_factory=list)
    findings: list = field(default_factory=list)

    def add(self, level, code, detail):
        self.findings.append(Finding(level, code, detail))

    @property
    def status(self):
        levels = {f.level for f in self.findings}
        return 'FAIL' if 'fail' in levels else 'WARN' if 'warn' in levels else 'PASS'


# ---------------------------------------------------------------- input handling

def _unsafe_member(name):
    n = name.replace('\\', '/')
    return n.startswith('/') or re.match(r'^[A-Za-z]:', n) or '..' in n.split('/')


def extract_zip(path):
    """Extract to a private temp dir. Returns (dir, None) or (None, reason)."""
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            bad = [i.filename for i in infos if _unsafe_member(i.filename)]
            links = [i.filename for i in infos if (i.external_attr >> 16) & 0o170000 == 0o120000]
            if bad or links:
                return None, f'refused to extract: unsafe member names {(bad + links)[:3]}'
            if sum(i.file_size for i in infos) > MAX_UNZIPPED_BYTES:
                return None, 'refused to extract: more than 4 GB uncompressed'
            d = tempfile.mkdtemp(prefix='nlme-validate-')
            _temp_dirs.append(d)
            z.extractall(d)
            return d, None
    except zipfile.BadZipFile as e:
        return None, f'not a readable ZIP: {e}'


def _walk_files(root, skip_dirs=()):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in IGNORED_DIRS and os.path.join(d, x) not in skip_dirs]
        for f in files:
            if f not in IGNORED_NAMES:
                yield os.path.relpath(os.path.join(d, f), root).replace(os.sep, '/')


def export_roots(top):
    """Directories holding a manifest.json, outermost first."""
    roots = []
    for d, dirs, files in os.walk(top):
        dirs[:] = sorted(x for x in dirs if x not in IGNORED_DIRS)
        if 'manifest.json' in files:
            roots.append(d)
    return roots


def is_images_package(top):
    """A Full Takeout's images ZIP: only image files, under <root>/images/. It has no manifest."""
    files = list(_walk_files(top))
    return bool(files) and all(IMAGE_FILE_RE.search(rel) for rel in files)


def _read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def _version(exporter):
    m = re.search(r'(\d+\.\d+\.\d+)', exporter or '')
    return m.group(1) if m else None


def _version_at_least(v, floor):
    if not v:
        return False
    return tuple(int(x) for x in v.split('.')) >= tuple(int(x) for x in floor.split('.'))


def front_matter(text):
    """Return (dict, body) for a leading --- block, or (None, text)."""
    m = re.match(r'---\n(.*?)\n---\n?', text, re.S)
    if not m:
        return None, text
    data = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(':')
        if sep:
            data[k.strip()] = v.strip().strip('"')
    return data, text[m.end():]


# ---------------------------------------------------------------- checks

def _strip_code(text):
    text = re.sub(r'^(```|~~~).*?^\1[^\n]*$', '', text, flags=re.S | re.M)
    return re.sub(r'`[^`\n]*`', '', text)


# The viewer's formula rule (viewer/viewer-app.js findMath): $$..$$, or an inline span that
# opens at a "$" not followed by whitespace and closes at the first "$" not preceded by
# whitespace and not followed by a digit, on one line. tests/fixtures/math-spans.json pins both.
_VIEWER_MATH = re.compile(r'\$\$[\s\S]+?\$\$|\$(?!\s)(?:[^$\n]*?[^\s$])\$(?!\d)')


def viewer_math_spans(text):
    return [m.group(0) for m in _VIEWER_MATH.finditer(text)]


def _undrawn_math(text):
    """TeX-looking $..$ spans the viewer would leave as raw text."""
    rest = _VIEWER_MATH.sub(lambda m: ' ' * len(m.group(0)), text)
    out = []
    for m in re.finditer(r'\$([^$\n]+)\$', rest):
        inner = m.group(1)
        if re.search(r'\\[A-Za-z]|[\^_{]', inner) or re.fullmatch(r'[A-Za-z0-9]+', inner):
            out.append(m.group(0))
    return out


def check_markdown(report, rel, text):
    for s in SENTINELS:
        if s in text:
            report.add('fail', 'sentinel', f'{rel}: internal marker U+{ord(s):04X} left in the output')
            break
    if '[object ' in text:
        report.add('fail', 'js-leftover', f'{rel}: contains "[object …]" (a JavaScript value written as text)')
    body = _strip_code(text)
    defs = re.findall(r'^\[\^([^\]\s\\]+)\]:', body, re.M)
    # A quote holds its source's own text, and \\[^1\\] is written out: neither is a marker
    prose = '\n'.join(line for line in body.split('\n') if not line.lstrip().startswith('>'))
    refs = set(re.findall(r'(?<!\\)\[\^([^\]\s\\]+)\](?!:)', re.sub(r'^\[\^[^\]\s]+\]:', '', prose, flags=re.M)))
    seen = set()
    for d in defs:
        if d in seen:
            report.add('fail', 'footnote-duplicate', f'{rel}: [^{d}]')
        seen.add(d)
    for r in sorted(refs - seen):
        report.add('fail', 'footnote-undefined', f'{rel}: [^{r}]')
    for d in sorted(seen - refs):
        report.add('info', 'footnote-unused', f'{rel}: [^{d}]')
    for f in _undrawn_math(body):
        report.add('fail', 'viewer-math-raw', f'{rel}: the viewer would show {f} as raw text')


def check_links(report, root, rel):
    text = _read(os.path.join(root, rel))
    pattern = r'href="([^"]+)"' if rel.endswith('.html') else r'\]\(((?:[^()\s]|\([^()\s]*\))+)\)'
    base = os.path.dirname(os.path.join(root, rel))
    for target in re.findall(pattern, text):
        if target.startswith('#') or re.match(r'^[a-zA-Z][\w+.-]*:', target):
            continue
        raw = target.split('#', 1)[0]
        path = unquote(raw)
        # a name may hold a literal %2C, so the link as written counts too
        if path and not any(os.path.exists(os.path.join(base, p)) for p in (path, raw)):
            report.add('fail', 'broken-link', f'{rel} → {path}')


def check_audit(report, text, partial=False):
    for name, n, m in re.findall(r'^- ([^:\n]+): ([\d,]+) of ([\d,]+)', text, re.M):
        name = re.sub(r'^[^\w]+', '', name).strip()
        if 'cache' in name.lower():
            continue
        n, m = int(n.replace(',', '')), int(m.replace(',', ''))
        line = f'{name}: {n} of {m}'
        if n < m and partial:
            report.add('warn', 'audit-short', f'{line} (export was cancelled)')
        elif n < m:
            report.add('fail', 'audit-short', line)
        elif n > m:
            report.add('info', 'audit-surplus', f'{line} (more written than the page showed, e.g. formulas in quotes)')


def _first_error(text):
    section = None
    for line in text.splitlines():
        if line.startswith('## '):
            section = line[3:].strip().lower()
        elif line.startswith('- ') and section and section != 'summary':
            return line[2:].strip()
    return 'see errors.md'


VIEWER_DATA_RE = re.compile(r'<script id="data" type="application/json">(.*?)</script>', re.S)
# The builder's own names (NLMEViewer.extractImages), so a source that merely quotes
# ![fig](images/fig1.png) is not taken for a link
CATEGORY_DIRS = ('sources', 'notes', 'chat', 'artifacts')
IMAGE_NAME = r'images/[0-9a-f]{16}\.[a-z0-9]+'
VIEWER_IMAGE_RE = re.compile(r'(?<![\w/.-])' + IMAGE_NAME)
IMAGE_FILE_RE = re.compile(r'(?:^|/)' + IMAGE_NAME + '$')


def _strings(value):
    """Every string inside parsed JSON."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def check_viewer(report, root):
    """viewer.html (Full Takeout, from 1.8.0): its data must parse and its media and image links must exist.

    The data is read the way the page reads it: the text of the script element goes to a JSON
    parser (escapeJson only writes JSON escapes, so no other unescaping is needed). Links are
    URL-decoded and resolved from the takeout root; they may leave the root, because a folder-mode
    file saved by the browser sits beside it. Image links (images/<hash>.<ext>) sit anywhere in
    the text and are resolved from the root the same way. Media links are checked only when
    artifacts/ is next to viewer.html, image links when any category folder is (a merged tree or a
    folder takeout, which may have no artifacts): the index ZIP alone does not hold those files,
    so there the links are skipped.
    """
    path = os.path.join(root, 'viewer.html')
    if not os.path.isfile(path):
        if report.kind == 'takeout' and _version_at_least(report.version, '1.8.0'):
            report.add('warn', 'viewer-missing', 'no viewer.html (expected from 1.8.0; errors.md may say why)')
        return
    m = VIEWER_DATA_RE.search(_read(path))
    if not m:
        report.add('fail', 'viewer-invalid', 'viewer.html has no <script id="data" type="application/json"> block')
        return
    try:
        data = json.loads(m.group(1))
    except ValueError as e:
        report.add('fail', 'viewer-invalid', f'viewer.html data is not valid JSON: {e}')
        return
    studio = data.get('studio') if isinstance(data, dict) else None
    if not isinstance(studio, list):
        report.add('fail', 'viewer-invalid', 'viewer.html data has no "studio" list')
        return
    if os.path.isdir(os.path.join(root, 'artifacts')):
        for item in studio:
            files = item.get('files') if isinstance(item, dict) else None
            if not isinstance(files, dict):
                continue
            for link in files.values():
                if not isinstance(link, str) or not os.path.isfile(os.path.normpath(os.path.join(root, *unquote(link).split('/')))):
                    report.add('fail', 'viewer-broken-link', str(link))
    if not any(os.path.isdir(os.path.join(root, c)) for c in CATEGORY_DIRS):
        return
    for link in sorted({hit for text in _strings(data) for hit in VIEWER_IMAGE_RE.findall(text)}):
        if not os.path.isfile(os.path.join(root, *link.split('/'))):
            report.add('fail', 'viewer-broken-link', link)


def check_export(root, label, nested_roots):
    report = Report(label=label, root=root)
    try:
        m = json.loads(_read(os.path.join(root, 'manifest.json')))
    except ValueError as e:
        report.add('fail', 'manifest-invalid', f'manifest.json is not valid JSON: {e}')
        return report
    report.kind = m.get('kind', '?')
    report.version = _version(m.get('exporter'))
    report.part = m.get('part', 1) or 1
    report.total_parts = m.get('totalParts', 1) or 1
    report.notebook = (m.get('notebook') or {}).get('id', '') if isinstance(m.get('notebook'), dict) else ''
    report.partial = bool(m.get('partial'))
    for key in ('exporter', 'kind', 'files'):
        if key not in m:
            report.add('fail', 'manifest-incomplete', f'manifest.json has no "{key}"')
    if not report.version:
        report.add('warn', 'unknown-exporter', f'exporter is {m.get("exporter")!r}')

    files = m.get('files') or []
    report.files = [f.get('path', '') for f in files]
    listed = set()
    for f in files:
        rel = f.get('path', '')
        listed.add(rel)
        full = os.path.join(root, rel)
        if not os.path.isfile(full):
            report.add('fail', 'missing-file', rel)
        elif isinstance(f.get('bytes'), int) and f['bytes'] != os.path.getsize(full):
            report.add('fail', 'size-mismatch', f'{rel}: manifest {f["bytes"]}, file {os.path.getsize(full)}')
    skip = [r for r in nested_roots if r != root and r.startswith(root + os.sep)]
    for rel in sorted(set(_walk_files(root, skip)) - listed - {'manifest.json'}):
        # A takeout's images/ has no manifest of its own: nothing lists those files
        if not (report.kind == 'takeout' and rel.startswith('images/')):
            report.add('warn', 'unlisted-file', rel)

    if m.get('partial') or (m.get('errorCount') or 0) > 0:
        errors = os.path.join(root, 'errors.md')
        if not os.path.isfile(errors):
            report.add('fail', 'errors-missing', 'export reports errors but has no errors.md')
        elif m.get('partial'):
            report.add('warn', 'partial', _first_error(_read(errors)))
        else:
            report.add('warn', 'export-errors', f'{m.get("errorCount")} error(s): {_first_error(_read(errors))}')

    if os.path.isfile(os.path.join(root, '_audit.md')):
        check_audit(report, _read(os.path.join(root, '_audit.md')), bool(m.get('partial')))

    index = os.path.join(root, '_index.md')
    if os.path.isfile(index):
        fm, _ = front_matter(_read(index))
        if fm is None and _version_at_least(report.version, '1.7.0'):
            report.add('fail', 'front-matter-missing', '_index.md has no front matter (expected from 1.7.0)')
    check_viewer(report, root)
    for rel in ('_index.md', '_index.html'):
        if os.path.isfile(os.path.join(root, rel)):
            check_links(report, root, rel)

    for rel in sorted(set(_walk_files(root, skip))):
        if rel.endswith('.md'):
            check_markdown(report, rel, _read(os.path.join(root, rel)))
        elif rel.endswith(TEXT_EXT):
            text = _read(os.path.join(root, rel))
            if any(s in text for s in SENTINELS):
                report.add('fail', 'sentinel', f'{rel}: internal marker left in the output')
    return report


def check_single_markdown(path):
    report = Report(label=os.path.basename(path), kind='markdown', root=os.path.dirname(path))
    text = _read(path)
    fm, _ = front_matter(text)
    report.version = _version((fm or {}).get('exporter'))
    check_markdown(report, os.path.basename(path), text)
    return report


def check_part_sets(reports):
    groups = {}
    for r in reports:
        if r.total_parts > 1:
            # "…-part2of2 (1).zip": browsers add " (n)" to repeated downloads
            stem = re.sub(r'-part\d+of\d+( \(\d+\))?(\.zip)?$', '', r.label.split('/')[0])
            groups.setdefault((stem, r.kind, r.notebook, r.total_parts), []).append(r)
    for (stem, _, _, total), members in groups.items():
        have = {r.part for r in members}
        first_part = {}
        for r in sorted(members, key=lambda r: r.part):
            for path in r.files:
                if '/' not in path:
                    continue  # per-part files (_index, _audit, combined-*) repeat by design
                if path in first_part and first_part[path] != r.part:
                    r.add('warn', 'duplicate-across-parts',
                          f'{path} is in part {first_part[path]} and part {r.part} (merging the parts keeps only one)')
                first_part.setdefault(path, r.part)
        cancelled_at = min((r.part for r in members if r.partial), default=None)
        for p in range(1, total + 1):
            if p in have:
                continue
            if cancelled_at is not None and p > cancelled_at:
                members[0].add('info', 'part-missing', f'part {p} of {total} was never written: the export was cancelled ({stem})')
            else:
                members[0].add('warn', 'part-missing', f'part {p} of {total} not given ({stem})')


def validate_paths(paths, verbose=False):
    reports = []
    for p in paths:
        p = os.path.expanduser(p)
        name = os.path.basename(p.rstrip('/'))
        if os.path.isfile(p) and p.lower().endswith('.zip'):
            top, err = extract_zip(p)
            if err:
                r = Report(label=name)
                r.add('fail', 'unsafe-zip' if 'unsafe' in err or '4 GB' in err else 'bad-zip', err)
                reports.append(r)
                continue
        elif os.path.isfile(p) and p.lower().endswith('.md'):
            reports.append(check_single_markdown(p))
            continue
        elif os.path.isdir(p):
            top = p
        else:
            r = Report(label=name)
            r.add('fail', 'not-found', f'{p} is not a ZIP, folder or .md file')
            reports.append(r)
            continue
        roots = export_roots(top)
        if not roots and is_images_package(top):
            r = Report(label=name, kind='images')
            r.add('info', 'images-package', 'the images of a Full Takeout: unzip it with the others')
            reports.append(r)
            continue
        if not roots:
            r = Report(label=name)
            r.add('fail', 'no-manifest', 'no manifest.json found: not a NotebookLM Takeout export')
            reports.append(r)
            continue
        for root in roots:
            rel = os.path.relpath(root, top)
            label = name if rel == '.' else f'{name}/{rel}'
            reports.append(check_export(root, label, roots))
    check_part_sets(reports)
    print_reports(reports, verbose)
    return reports


def print_reports(reports, verbose):
    for r in reports:
        part = f'part {r.part}/{r.total_parts}' if r.total_parts > 1 else ''
        print(f'{r.status:4}  {r.kind:9} {r.version or "?":7} {part:10} {r.label}')
        infos = 0
        for f in r.findings:
            if f.level == 'info' and not verbose:
                infos += 1
                continue
            print(f'      {f}')
        if infos:
            print(f'      ({infos} info note(s); -v to show)')
    counts = {s: sum(r.status == s for r in reports) for s in ('PASS', 'WARN', 'FAIL')}
    print(f'\n{len(reports)} export(s): {counts["PASS"]} pass, {counts["WARN"]} warn, {counts["FAIL"]} fail')


# ---------------------------------------------------------------- compare

NORMALISERS = [
    (re.compile(r'^exported: ".*"$', re.M), 'exported: "<ts>"'),
    (re.compile(r'^exporter: ".*"$', re.M), 'exporter: "<ver>"'),
    (re.compile(r'^Generated: .*$', re.M), 'Generated: <ts>'),
    (re.compile(r'^- Exported: .*$', re.M), '- Exported: <ts>'),
    (re.compile(r'<p class="meta">.*?</p>', re.S), '<p class="meta"><meta></p>'),
    (re.compile(r'(Exported|Generated)( on|:)? \d{1,2}/\d{1,2}/\d{4},? [\d:]+ ?[AP]M', re.I), r'\1 <ts>'),
    (re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(\.\d+)?Z?'), '<iso>'),
    (re.compile(r'NotebookLM Takeout \d+\.\d+\.\d+'), 'NotebookLM Takeout <ver>'),
    # File sizes in index listings ("Text · 477 B"): every file is compared on its own
    (re.compile(r'( · )[\d.,]+ ?(?:B|KB|MB|GB)\b'), r'\1<size>'),
]
STATS = re.compile(r'## Export statistics\n.*?(?=\n## |\Z)', re.S)
RUN_FILES = ('_index.md', '_index.html', 'manifest.json', '_audit.md')


def normalise(text):
    text = STATS.sub('## Export statistics\n<stats>\n', text)
    for rx, rep in NORMALISERS:
        text = rx.sub(rep, text)
    return text


def _without(text, allow):
    for rx in allow:
        text = re.sub(rx, '', text)
    return text


@dataclass
class CompareResult:
    identical: list = field(default_factory=list)
    front_matter_only: list = field(default_factory=list)
    allowed: list = field(default_factory=list)
    different: list = field(default_factory=list)
    missing: list = field(default_factory=list)
    extra: list = field(default_factory=list)
    diffs: dict = field(default_factory=dict)

    @property
    def ok(self):
        return not (self.different or self.missing or self.extra)


def _tree(path):
    """Return {relpath: fullpath} for a ZIP, folder or single file."""
    path = os.path.expanduser(path)
    if os.path.isfile(path) and path.lower().endswith('.zip'):
        d, err = extract_zip(path)
        if err:
            raise SystemExit(f'{path}: {err}')
        path = d
    if os.path.isfile(path):
        return {'(file)': path}
    return {rel: os.path.join(path, rel) for rel in _walk_files(path)}


def _classify(res, rel, a, b, allow, max_diff):
    if a == b:
        res.identical.append(rel)
        return
    fa, body_a = front_matter(a)
    fb, body_b = front_matter(b)
    if (fa is not None or fb is not None) and body_a.lstrip('\n') == body_b.lstrip('\n'):
        res.front_matter_only.append(rel)
        return
    if allow and _without(a, allow) == _without(b, allow):
        res.allowed.append(rel)
        return
    res.different.append(rel)
    res.diffs[rel] = list(difflib.unified_diff(a.splitlines(), b.splitlines(), 'baseline', 'candidate', n=1, lineterm=''))[:max_diff]


def compare_paths(baseline, candidate, allow=None, max_diff=40):
    allow = [re.compile(a) for a in (allow or [])]
    base, cand = _tree(baseline), _tree(candidate)
    res = CompareResult()
    res.missing = sorted(set(base) - set(cand))
    res.extra = sorted(set(cand) - set(base))
    common = sorted(set(base) & set(cand))
    texts = {}
    for rel in common:
        if rel.endswith(TEXT_EXT) or rel == '(file)':
            texts[rel] = (normalise(_read(base[rel])), normalise(_read(cand[rel])))
        else:
            with open(base[rel], 'rb') as fa, open(cand[rel], 'rb') as fb:
                same = fa.read() == fb.read()
            (res.identical if same else res.different).append(rel)
    manifests = [r for r in texts if os.path.basename(r) == 'manifest.json']
    for rel in texts:
        if rel not in manifests:
            _classify(res, rel, *texts[rel], allow, max_diff)
    settled = set(res.identical) | set(res.front_matter_only) | set(res.allowed)
    for rel in manifests:
        prefix = os.path.dirname(rel)
        sides = []
        for side in (base, cand):
            try:
                m = json.loads(_read(side[rel]))
            except ValueError:
                sides.append(normalise(_read(side[rel])))
                continue
            m.pop('exported', None)
            m.pop('exporter', None)
            for f in m.get('files', []) if isinstance(m.get('files'), list) else []:
                p = f.get('path', '')
                full = f'{prefix}/{p}' if prefix else p
                if full in settled or p.endswith(RUN_FILES):
                    f.pop('bytes', None)
            sides.append(normalise(json.dumps(m, indent=2, sort_keys=True, ensure_ascii=False)))
        _classify(res, rel, sides[0], sides[1], allow, max_diff)
    for lst in (res.identical, res.front_matter_only, res.allowed, res.different):
        lst.sort()
    print_compare(res)
    return res


def print_compare(res):
    print(f'identical {len(res.identical)} · front matter only {len(res.front_matter_only)} · '
          f'allowed {len(res.allowed)} · different {len(res.different)} · '
          f'missing {len(res.missing)} · extra {len(res.extra)}')
    for title, items in (('Front matter only', res.front_matter_only), ('Allowed by --allow', res.allowed),
                         ('Missing from candidate', res.missing), ('Extra in candidate', res.extra)):
        if items:
            print(f'\n{title}:')
            for i in items:
                print(f'  {i}')
    for rel in res.different:
        print(f'\n=== DIFF {rel}')
        for line in res.diffs.get(rel, ['(binary files differ)']):
            print(f'  {line}')
    print('\nSAME as baseline (apart from run details)' if res.ok else '\nDIFFERS from baseline')


# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('paths', nargs='+', help='ZIP, export folder, Full Takeout folder or .md file')
    ap.add_argument('--baseline', help='compare the (single) export against this baseline export')
    ap.add_argument('--allow', action='append', default=[], metavar='REGEX',
                    help='with --baseline: text matching REGEX may differ (repeatable)')
    ap.add_argument('--max-diff', type=int, default=40, help='diff lines shown per file')
    ap.add_argument('-v', '--verbose', action='store_true', help='also show info notes')
    args = ap.parse_args(argv)
    reports = validate_paths(args.paths, args.verbose)
    failed = any(r.status == 'FAIL' for r in reports)
    if args.baseline:
        if len(args.paths) != 1:
            ap.error('--baseline compares exactly one export')
        print(f'\n--- compare with baseline {args.baseline}')
        failed = (not compare_paths(args.baseline, args.paths[0], args.allow, args.max_diff).ok) or failed
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
