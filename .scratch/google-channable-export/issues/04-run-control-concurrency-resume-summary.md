# 04: Run control: concurrency, resume, limit, only, dry-run, summary, report

**What to build:** A 16,000-file batch that can be run, interrupted and resumed safely. `--concurrency N` (default 4) processes images in parallel. Skip-existing is the default: an output is skipped when it exists and is not older than its source; `--force` rewrites regardless. `--limit N` stops after N written files. `--only <substring>` restricts the run to input entries whose path or category label contains the substring. `--dry-run` prints the plan per file (rule matched, crop window, output size, output path) and writes nothing. Progress prints a running `n / total`. The end-of-run summary prints counts of written, skipped, ignored and failed files and the full list of ignored and failed paths. `--report <path>` writes an opt-in per-file CSV (source, output, rule, source size, output size, status); no manifest is produced without it.

**Blocked by:** 03 (Channable config: --config, multi-input model, read-only guard, rule engine).

**Status:** ready-for-agent

- [ ] `--concurrency 4` processes four images at a time; output is identical to a sequential run.
- [ ] A second run over unchanged inputs writes nothing and reports every file as skipped; touching a source makes only that file rewrite; `--force` rewrites everything.
- [ ] `--limit 5` writes at most five files and stops; skipped files do not count toward the limit.
- [ ] `--only Ledspots` processes only the input entries whose path or category contains `Ledspots`.
- [ ] `--dry-run` prints one plan line per eligible file and leaves the output folder untouched.
- [ ] Progress shows `n / total` during the run; the summary at the end shows per-status counts and lists every ignored and failed path.
- [ ] `--report out.csv` writes one row per file with source, output, rule, source size, output size and status; without the flag no report file is created.
- [ ] `run()` returns the same summary the console prints, and each flag is covered by an end-to-end test at the `run()` seam.
- [ ] `npm run build` (root config) still works and accepts the same flags.
