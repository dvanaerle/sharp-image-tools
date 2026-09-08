# 05: README and first real run against V:

**What to build:** Documentation and a verified first export. The README gains a Channable section covering how to run it, every CLI flag, the input-entry model, the rule model with the crop-window semantics, and the read-only guarantee. Then the tool is run for real against the network share in three steps: `--only Ledspots --dry-run`, `--only Ledspots` (12 files), then one full category. Output is checked for dimensions and format, and the input folders are confirmed untouched.

**Blocked by:** 04 (Run control: concurrency, resume, limit, only, dry-run, summary, report).

**Status:** ready-for-agent

- [ ] README documents `npm run build:channable`, `--config`, `--concurrency`, `--limit`, `--only`, `--dry-run`, `--force`, `--report`, the input-entry model and the rule model.
- [ ] `--only Ledspots --dry-run` prints 12 plan lines and writes nothing.
- [ ] `--only Ledspots` writes 12 files under the Verlichting category folder; `-1` to `-6` files are 1500x844 JPEG.
- [ ] One full category (Terrasoverkappingen or Carport) completes with the summary reporting zero failures; a spot check confirms `-0` files are 1500x1500 and other files are at most 1500 wide.
- [ ] A before/after listing (names, sizes, mtimes) of the processed `Origineel` folders is identical, confirming nothing on V: was created, modified or removed.
- [ ] Ignored files listed by the summary match the expected non-SKU set (energy labels, detail photos, loose renders, Thumbs.db, PSD).
