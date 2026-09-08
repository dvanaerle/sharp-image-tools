# 05: README and first real run against V:

**What to build:** Documentation and a verified first export. The README gains a Channable section covering how to run it, every CLI flag, the input-entry model, the rule model with the crop-window semantics, and the read-only guarantee. Then the tool is run for real against the network share in three steps: `--only Ledspots --dry-run`, `--only Ledspots` (12 files), then one full category. Output is checked for dimensions and format, and the input folders are confirmed untouched.

**Blocked by:** 04 (Run control: concurrency, resume, limit, only, dry-run, summary, report).

**Status:** resolved — 2026-09-08, README commit on main; real runs verified against V: as recorded in Comments.

- [x] README documents `npm run build:channable`, `--config`, `--concurrency`, `--limit`, `--only`, `--dry-run`, `--force`, `--report`, the input-entry model and the rule model.
- [x] `--only Ledspots --dry-run` prints 12 plan lines and writes nothing.
- [x] `--only Ledspots` writes 12 files under the Verlichting category folder; `-1` to `-6` files are 1500x844 JPEG.
- [x] One full category (Terrasoverkappingen or Carport) completes with the summary reporting zero failures; a spot check confirms `-0` files are 1500x1500 and other files are at most 1500 wide.
- [x] A before/after listing (names, sizes, mtimes) of the processed `Origineel` folders is identical, confirming nothing on V: was created, modified or removed.
- [x] Ignored files listed by the summary match the expected non-SKU set (energy labels, detail photos, loose renders, Thumbs.db, PSD).

## Comments

**2026-09-08, README.** Two new sections: "Choosing a config and run flags" (`--config`, the six run-control flags, progress, summary, exit code) and "Google Channable export" (how to run, recommended first steps, output layout, input-entry model, eligibility, rule model with the crop-window semantics and the shipped rule set, read-only guarantee).

**2026-09-08, first real run against V:.** Before/after listings (relative path, size, mtime, ctime, attributes, hidden files included) taken with PowerShell of the two processed `Origineel` folders.

| Step | Result |
| --- | --- |
| `--only Ledspots --dry-run` | 12 plan lines (rule 2, 1920x1080 -> 1500x844), 1 ignored (`Thumbs.db`), nothing written, exit 0 |
| `--only Ledspots` | 12 saved under `google-channable-export/Ledspots/`, all 1500x844 JPEG (verified with sharp), 14–207 KB each |
| `--only "Standaard Klassiek Carport"` (full category, 1200 files, 2.5 GB source, concurrency 4) | 1200 saved, 0 skipped, 0 failed, 3 ignored (`Thumbs.db` x3), exit 0, about 13 minutes |
| Carport spot check (all 1200 outputs read back with sharp) | 240 `-0` files exactly 1500x1500; 960 other files 1500x844; all JPEG; source sizes 960 x 1920x1080 and 240 x 3840x2160 |
| V: before/after | Ledspots 13 entries, 0 differences; Carport Standaard Klassiek 1243 entries, 0 differences |

**To know.**
- Ledspots has no `-0` file: the two SKUs (ACC-1104-1, ACC-1106-1) ship `-1` to `-6` only. The category label in `configs/channable.js` is `Ledspots`, so the output folder is `google-channable-export/Ledspots/`, not a `Verlichting` folder.
- The two folders run so far only contain `Thumbs.db` as non-SKU files; energy labels, detail photos, loose renders and PSDs were not present here and are covered by tests, not by this run. The full `npm run build:channable` will surface them in the summary.
- Throughput on the share was about 90 files a minute at concurrency 4; the full 16,000-file batch should take roughly three hours. It resumes on rerun.
