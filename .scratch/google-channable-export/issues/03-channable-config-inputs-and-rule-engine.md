# 03: Channable config: --config, multi-input model, read-only guard, rule engine

**What to build:** `npm run build:channable` produces the Google Channable image set. The CLI accepts `--config <path>`; without it the root config loads and nothing changes. The Channable config, in a `configs/` folder, lists the 20 read-only V: `Origineel` folders as ordered input entries, each with a category label, discovered recursively so the 11 folders that nest per-size subfolders are covered. Output goes to `google-channable-export/<category>/<source-basename>.<ext>`, format preserved (JPG stays JPG, PNG stays PNG), no watermark, no overlay, no renaming, no dimensions in filenames, JPEG quality 80 with mozjpeg.

Eligibility: only files whose basename starts with a configured SKU prefix (`BUN-`, `CAR-`, `ACC-`, `SUN-`) and whose extension is jpg/jpeg/png/webp are processed; everything else (`3m.jpg`, `*-energielabel.jpg`, `*-detailfoto.jpg`, `Thumbs.db`, `.psd`) is ignored and counted in the summary, never opened.

Rules: an ordered list, first match wins, matchers `startsWith` and `endsWith` against the basename without extension, a rule without matchers is the default. Rule outputs: `width`, `aspect` (`1:1` or `source`), `zoom`, `top`, `left`, `upscale`. The crop window starts as the largest box of the target aspect that fits the source (1080x1080 for `1:1` on 1920x1080, full frame for `source`), `zoom` divides it, `top`/`left` anchor it (0 edge, 0.5 centre, 1 opposite edge), then it is scaled to `width`x`width` for `1:1` or to at most `width` wide at source ratio for `source`, upscaling only when `upscale` is true. Startup warns when a rule is fully shadowed by an earlier one. The shipped Channable rule set is the `-0` square rule (1500x1500, upscale on) above the default (max width 1500), with a commented prefix-rule example.

Safety: before any write the tool aborts if the output root resolves inside or equal to any input path, and if two sources would map to the same output path.

**Blocked by:** 02 (Prefactor: split into src modules behind a run() entrypoint, add test harness).

**Status:** resolved — 2026-09-08, commits 4ebd630 and the review follow-up on main. Shipped as specified; see Comments.

- [x] `node crop-and-resize.js` without `--config` behaves exactly as before; `--config <path>` loads the given config; `npm run build:channable` is wired to the Channable config.
- [x] The Channable config lists all 20 V: paths with category labels, including the Carport 01 `Origineel\Nieuwe map` path, and discovery recurses into nested subfolders.
- [x] Output lands in one folder per category label under `google-channable-export/`, filename identical to the source basename, extension by preserved format.
- [x] A `-0` file from a 1920x1080 source becomes exactly 1500x1500 from the centred 1080x1080 window; from a 3840x2160 source it becomes 1500x1500 from the 2160x2160 window; a 1920x1079 source still yields 1500x1500.
- [x] A non-`-0` SKU file from 1920x1080 becomes 1500x844 (source ratio, no crop); a source narrower than 1500 is not upscaled.
- [x] A prefix rule with `zoom`, `top`, `left` and `aspect` changes the window as specified; `zoom` 1 never crops beyond what the aspect forces.
- [x] Non-SKU files, `.psd` and `.db` files are ignored, never opened, and counted in the run summary.
- [x] Watermark and overlay are off, and naming normalisation is off, for the Channable config regardless of root-config defaults.
- [x] A rule fully shadowed by an earlier rule produces a startup warning.
- [x] The run aborts before writing when the output root is inside an input path or when two sources collide on an output path.
- [x] End-to-end tests at the `run()` seam cover square rule, default rule, prefix rule, ignored files, format preservation, read-only guard and collision abort using generated fixture images; unit tests cover rule matching, shadow detection and crop-window maths.

## Comments

**2026-09-08, implementation notes.** New modules: `src/cli.js` (`--config`, unknown flags rejected), `src/rules.js` (first-match `startsWith`/`endsWith`, shadow detection, SKU eligibility), `src/crop-window.js` (aspect/zoom/top/left/upscale window maths), `src/run-rules.js` (rule-mode runner, read-only guard, collision abort, ignored list). `normalizeConfig` now dispatches on `inputs` (rule mode) versus `inputDir` (preset mode). `configs/channable.js` lists the 20 `Origineel` paths verified to exist on V: (read-only listing). Verified with full-size fixtures through the real CLI: 1920x1080 `-0` gives 1500x1500, `-1` gives 1500x844. Tests: 36 passing.

**Shipped differently / to know.** Eligible `.webp` sources are encoded as JPEG and written as `.jpg` (webp output is out of scope per the PRD). `zoom` below 1 is rejected at config load. A file matching no rule is reported `skipped` (`no-rule`) without being opened; the config does not force a default rule.

**Code review (2026-09-08), left for a human call.** Rule defaults live in both `normalizeRule` and `createCropWindow` (the latter so unit tests can pass raw rules). Rule-mode summary returns `inputs`/`ruleIndex`/`category` where preset mode returns `inputDir`/`presetKey`; ticket 04's summary work should decide on a shared envelope. The read-only guard rejects an output root inside an input, but not an input nested inside the output root (e.g. `outputDir: "."`); consider tightening in 04 or 05.
