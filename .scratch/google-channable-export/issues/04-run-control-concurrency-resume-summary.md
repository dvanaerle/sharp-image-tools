# 04: Run control: concurrency, resume, limit, only, dry-run, summary, report

**What to build:** A 16,000-file batch that can be run, interrupted and resumed safely. `--concurrency N` (default 4) processes images in parallel. Skip-existing is the default: an output is skipped when it exists and is not older than its source; `--force` rewrites regardless. `--limit N` stops after N written files. `--only <substring>` restricts the run to input entries whose path or category label contains the substring. `--dry-run` prints the plan per file (rule matched, crop window, output size, output path) and writes nothing. Progress prints a running `n / total`. The end-of-run summary prints counts of written, skipped, ignored and failed files and the full list of ignored and failed paths. `--report <path>` writes an opt-in per-file CSV (source, output, rule, source size, output size, status); no manifest is produced without it.

**Blocked by:** 03 (Channable config: --config, multi-input model, read-only guard, rule engine).

**Status:** resolved — 2026-09-08, commit 7933c10 and the review follow-up on main. Shipped as specified; see Comments.

- [x] `--concurrency 4` processes four images at a time; output is identical to a sequential run.
- [x] A second run over unchanged inputs writes nothing and reports every file as skipped; touching a source makes only that file rewrite; `--force` rewrites everything.
- [x] `--limit 5` writes at most five files and stops; skipped files do not count toward the limit.
- [x] `--only Ledspots` processes only the input entries whose path or category contains `Ledspots`.
- [x] `--dry-run` prints one plan line per eligible file and leaves the output folder untouched.
- [x] Progress shows `n / total` during the run; the summary at the end shows per-status counts and lists every ignored and failed path.
- [x] `--report out.csv` writes one row per file with source, output, rule, source size, output size and status; without the flag no report file is created.
- [x] `run()` returns the same summary the console prints, and each flag is covered by an end-to-end test at the `run()` seam.
- [x] `npm run build` (root config) still works and accepts the same flags.

## Comments

**2026-09-08, implementation notes.** New modules: `src/run-control.js` (option defaults and validation, `--only` matching, mtime freshness check, write budget for `--limit`, bounded-concurrency map, `n / total` progress, and the shared `runBatch` loop) and `src/summary.js` (one summary envelope for both modes, console summary, CSV report). `src/cli.js` parses `--concurrency`, `--limit`, `--only`, `--dry-run`, `--force`, `--report` in both `--flag value` and `--flag=value` form; unknown flags still abort. Rule mode now logs one line per finished file instead of a block per file, so concurrent output stays readable. Both modes return `{ mode, outputDir, sourceCount, outputs, ignored, failed, counts, dryRun }` plus `inputDir` or `inputs`; `counts` is always `{ saved, skipped, failed, ignored, planned }`, which resolves the shared-envelope note from ticket 03. Verified against V: with `--only Ledspots --dry-run`: 12 planned, 1 ignored (`Thumbs.db`), nothing written. Tests: 45 passing.

**Shipped differently / to know.**
- `--only` is case-insensitive. In preset mode it filters on the image path relative to `inputDir`, since that mode has no input entries.
- `--limit` counts write attempts: a write that fails still spends one unit, so at most N files are ever written. In-flight images that lose the last slot are reported `skipped (limit)`; sources never started are left out of `outputs`, so `counts` may sum to less than `sourceCount` on a limited run. `--limit` has no effect under `--dry-run`.
- A dry run over a populated output still prints a plan for every eligible file and reports the ones a real run would skip as `skipped (up-to-date)`.
- The CSV has one row per output plus one per ignored file. Rows for files skipped as up to date in rule mode have empty size cells, because the source is never opened. The `rule` column is the 1-based rule number in rule mode and the preset key in preset mode.
- Preset mode also reports non-image files as `ignored` now, and keeps its detailed per-image logging, which interleaves when `--concurrency` is above 1.
- The entrypoint exits non-zero when any file failed. Not in the ticket; small operator convenience, easy to drop.

**Code review (2026-09-08), left for a human call.** README does not yet document `--config` or the new flags (ticket 05). Status strings are compared in several places (`describeEntry`, `countStatuses`, `printSummary`); a single status table would centralise them. `mapConcurrent` rejects on the first worker throw while other lanes finish unobserved; workers catch internally today, so this is latent. The input-nested-inside-output guard from ticket 03's review is still open.
