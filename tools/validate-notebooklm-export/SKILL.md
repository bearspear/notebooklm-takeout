---
name: validate-notebooklm-export
description: Use when asked to validate, check or verify NotebookLM (not Claude chat) Takeout exports — Gemini Notebook notes, sources, chat, artifacts or Full Takeout ZIPs, folders or .md files, often in ~/Downloads — to say whether an export is complete or correct, to explain a PARTIAL export, or to compare a new export with an older one or a baseline (A/B after an extension change).
---

# Validate NotebookLM Takeout exports

## Overview

The extension repo ships a checker that knows the export format. Run it first instead of ad-hoc unzip/diff/grep.

**Not for** Claude/claude.ai Takeout exports (use validate-export) or merging part ZIPs (use merge-notebooklm-exports).

```bash
V=~/Downloads/notebooklm-exporter/tools/validate_export.py   # = ../validate_export.py from this skill's folder
python3 -I $V EXPORT [EXPORT ...]                 # check; EXPORT = .zip, folder, Full Takeout folder or .md
python3 -I $V EXPORT -v                           # also show info notes (hidden by default)
python3 -I $V NEW --baseline OLD                  # check NEW, then compare it with OLD
python3 -I $V NEW --baseline OLD --allow 'REGEX'  # accept a known change (repeatable)
```

If `$V` is missing, the repo is elsewhere or on a branch without `tools/`: find `tools/validate_export.py` or ask. Do not rebuild it.

Exit code: 1 on any FAIL or baseline difference; WARN alone exits 0; 2 means wrong arguments.

## Common mistakes

- **Parts checked one at a time.** Give every part of a split export in one run (`…-part1of2.zip …-part2of2.zip`); part completeness and files repeated across parts are only checked within one run.
- **Extracting with macOS `unzip`.** It fails on UTF-8 names. The tool extracts with `zipfile` into a private temp dir (deleted on exit) and refuses unsafe names, symlinks and archives over 4 GB.
- **Writing into ~/Downloads.** The tool writes nothing next to its input; keep it that way.
- **Comparing split exports.** `--baseline` takes one candidate: compare part 1 with part 1, and so on. First check all NEW parts together without `--baseline`; then ignore the `part-missing` WARN the per-part compare runs print. The baseline itself is not checked.

## Finding codes

| Code (level) | Meaning | Tell the user |
|---|---|---|
| `missing-file`, `size-mismatch` (FAIL) | manifest and files disagree | damaged or incomplete: re-export |
| `manifest-invalid`, `manifest-incomplete` (FAIL) | manifest.json unreadable or lacks exporter/kind/files | damaged: re-export |
| `no-manifest`, `not-found` (FAIL) | not a NotebookLM Takeout export, or wrong path | check the path |
| `bad-zip`, `unsafe-zip` (FAIL) | unreadable, unsafe or over 4 GB | download again; don't extract by hand |
| `audit-short` (FAIL) | page showed more than was written | items lost: re-export or Retry |
| `audit-short` (WARN), `partial` (WARN) | cancelled export | incomplete by design; quote the `partial` reason |
| `export-errors` (WARN) | finished with logged errors | quote the error; those items may be missing |
| `errors-missing` (FAIL) | errors reported but no errors.md | incomplete: re-export |
| `broken-link`, `front-matter-missing` (FAIL) | index problem | name the file and target |
| `footnote-undefined`, `footnote-duplicate`, `sentinel`, `js-leftover` (FAIL) | converter bug | report as an extension bug, with the file |
| `part-missing` (WARN; info if never written after a cancel) | a part not given | ask for it. If all were given, look for renamed files |
| `duplicate-across-parts` (WARN) | same item file in two parts | merging parts loses one; likely a naming bug |
| `unlisted-file` (WARN), `unknown-exporter` (WARN) | stray file; no version in manifest | usually harmless; mention it |
| `viewer-invalid`, `viewer-broken-link` (FAIL) | viewer.html data unreadable, or it links a file that is not there | damaged or incomplete: re-export; for a broken link, check the ZIPs were unzipped into one folder and artifacts/ is complete |
| `viewer-missing` (WARN) | Full Takeout from 1.8.0 without viewer.html | the viewer failed to build or save; errors.md says why |
| `audit-surplus`, `footnote-unused` (info, `-v`) | more written than counted; unused footnote | expected (e.g. formulas in quotes); mention only if asked |

**Baseline compare:** `identical` and `front matter only` are fine; `allowed` matched `--allow`; `different`, `missing`, `extra` need explaining. Dates, versions and statistics are already ignored. A deleted note shows as `missing`, a renamed one as `missing` plus `extra`; a different ⚙️ setting (footnotes, citation detail) shows as `different`. Rule those out before calling it a regression.

## Answering the user

1. One verdict per export (table), worst first.
2. Each WARN/FAIL in plain words with the file name.
3. What the tool cannot know: whether counts match the live notebook today, and whether quote text matches the sources.

Go deeper (hand checks) only for a FAIL you must explain, or when the user asks.
