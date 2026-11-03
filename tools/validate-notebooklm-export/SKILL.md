---
name: validate-notebooklm-export
description: Use when asked to validate, check or verify NotebookLM Takeout exports (Gemini Notebook notes, sources, chat, artifacts or Full Takeout ZIPs, folders or .md files, often in ~/Downloads), to say whether an export is complete or correct, to explain a PARTIAL export, or to compare a new export with an older one or a baseline (A/B after an extension change).
---

# Validate NotebookLM Takeout exports

## Overview

The extension repo ships a checker that knows the export format. Run it first; it replaces ad-hoc unzip/diff/grep scripts and gives the same verdict every time.

```bash
V=~/Downloads/notebooklm-exporter/tools/validate_export.py
python3 -I $V EXPORT [EXPORT ...]          # check; EXPORT = .zip, folder, Full Takeout folder or .md
python3 -I $V NEW --baseline OLD           # check NEW, then compare it with OLD
python3 -I $V NEW --baseline OLD --allow 'REGEX'   # accept a known, intended change
```

If `$V` is missing, look for `tools/validate_export.py` in the current repo or ask where the extension lives. Do not rebuild it from scratch.

## Rules that matter

- **Give every part of a split export in one run** (`…-part1of2.zip …-part2of2.zip`): part completeness and files repeated across parts are only checked within one run.
- **Never extract with macOS `unzip`.** It fails on UTF-8 names ("Illegal byte sequence"). The tool extracts with Python `zipfile` into a private temp dir and refuses unsafe names.
- **Never write into ~/Downloads.** Run from anywhere; the tool reads only.
- **Comparing:** one candidate per `--baseline`. Pair exports by kind and part (notes part 1 with notes part 1).

## Reading the output

Each export gets `PASS`, `WARN` or `FAIL`, its kind, the extension version that wrote it, and findings. Exit code 1 means a FAIL or a baseline difference.

| Code | Meaning | What to tell the user |
|---|---|---|
| `missing-file`, `size-mismatch` | manifest and files disagree | export damaged or incomplete: re-export |
| `audit-short` (FAIL) | page showed more than was written | items lost: re-export or Retry |
| `audit-short` (WARN), `partial` | cancelled export | incomplete by design; quote the `partial` reason |
| `audit-surplus` (info) | more written than counted | normal from 1.7.0 (formulas in quotes) |
| `broken-link`, `front-matter-missing` | index problem | report the file and target |
| `footnote-*`, `sentinel`, `js-leftover` | converter bug | report as an extension bug with the file |
| `part-missing` | a part was not given or never written | ask for it, or say the export was cancelled |
| `duplicate-across-parts` | same item file in two parts | merging parts loses one; likely a naming bug |
| `unlisted-file` | stray file | usually harmless; mention it |

Baseline compare: `identical` and `front matter only` are fine; `allowed` matched `--allow`; `different`, `missing`, `extra` need explaining. Run details (dates, version, statistics, sizes that changed only with the date) are already ignored. A deleted note shows as `missing`; a different ⚙️ setting (footnotes, citation detail) shows as `different`. Check the setting before calling it a regression.

## Answering the user

1. One verdict per export (table), worst first.
2. Each WARN/FAIL in plain words with the file name.
3. What the tool cannot know: whether the counts match the live notebook today, and whether quote text matches the sources.

Go deeper (hand checks) only for a FAIL you must explain, or when the user asks.
