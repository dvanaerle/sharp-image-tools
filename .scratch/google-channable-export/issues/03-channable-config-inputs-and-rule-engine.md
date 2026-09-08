# 03: Channable config: --config, multi-input model, read-only guard, rule engine

**What to build:** `npm run build:channable` produces the Google Channable image set. The CLI accepts `--config <path>`; without it the root config loads and nothing changes. The Channable config, in a `configs/` folder, lists the 20 read-only V: `Origineel` folders as ordered input entries, each with a category label, discovered recursively so the 11 folders that nest per-size subfolders are covered. Output goes to `google-channable-export/<category>/<source-basename>.<ext>`, format preserved (JPG stays JPG, PNG stays PNG), no watermark, no overlay, no renaming, no dimensions in filenames, JPEG quality 80 with mozjpeg.

Eligibility: only files whose basename starts with a configured SKU prefix (`BUN-`, `CAR-`, `ACC-`, `SUN-`) and whose extension is jpg/jpeg/png/webp are processed; everything else (`3m.jpg`, `*-energielabel.jpg`, `*-detailfoto.jpg`, `Thumbs.db`, `.psd`) is ignored and counted in the summary, never opened.

Rules: an ordered list, first match wins, matchers `startsWith` and `endsWith` against the basename without extension, a rule without matchers is the default. Rule outputs: `width`, `aspect` (`1:1` or `source`), `zoom`, `top`, `left`, `upscale`. The crop window starts as the largest box of the target aspect that fits the source (1080x1080 for `1:1` on 1920x1080, full frame for `source`), `zoom` divides it, `top`/`left` anchor it (0 edge, 0.5 centre, 1 opposite edge), then it is scaled to `width`x`width` for `1:1` or to at most `width` wide at source ratio for `source`, upscaling only when `upscale` is true. Startup warns when a rule is fully shadowed by an earlier one. The shipped Channable rule set is the `-0` square rule (1500x1500, upscale on) above the default (max width 1500), with a commented prefix-rule example.

Safety: before any write the tool aborts if the output root resolves inside or equal to any input path, and if two sources would map to the same output path.

**Blocked by:** 02 (Prefactor: split into src modules behind a run() entrypoint, add test harness).

**Status:** ready-for-agent

- [ ] `node crop-and-resize.js` without `--config` behaves exactly as before; `--config <path>` loads the given config; `npm run build:channable` is wired to the Channable config.
- [ ] The Channable config lists all 20 V: paths with category labels, including the Carport 01 `Origineel\Nieuwe map` path, and discovery recurses into nested subfolders.
- [ ] Output lands in one folder per category label under `google-channable-export/`, filename identical to the source basename, extension by preserved format.
- [ ] A `-0` file from a 1920x1080 source becomes exactly 1500x1500 from the centred 1080x1080 window; from a 3840x2160 source it becomes 1500x1500 from the 2160x2160 window; a 1920x1079 source still yields 1500x1500.
- [ ] A non-`-0` SKU file from 1920x1080 becomes 1500x844 (source ratio, no crop); a source narrower than 1500 is not upscaled.
- [ ] A prefix rule with `zoom`, `top`, `left` and `aspect` changes the window as specified; `zoom` 1 never crops beyond what the aspect forces.
- [ ] Non-SKU files, `.psd` and `.db` files are ignored, never opened, and counted in the run summary.
- [ ] Watermark and overlay are off, and naming normalisation is off, for the Channable config regardless of root-config defaults.
- [ ] A rule fully shadowed by an earlier rule produces a startup warning.
- [ ] The run aborts before writing when the output root is inside an input path or when two sources collide on an output path.
- [ ] End-to-end tests at the `run()` seam cover square rule, default rule, prefix rule, ignored files, format preservation, read-only guard and collision abort using generated fixture images; unit tests cover rule matching, shadow detection and crop-window maths.
