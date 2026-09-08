# Google Channable export

Status: spec written, not started (2026-09-08)

## Problem Statement

Tuinmaximaal's product renders live on a network share (`V:\Gumax®\02. Beeldbank\02. Renders\01. Webshop afbeeldingen`) in 20 `Origineel` folders, roughly 16,000 JPGs at 1920x1080 and 3840x2160. Google Shopping, fed through Channable, wants a square main image at 500x500 CSS pixels rendered at 3x (1500x1500), and additional images at a sensible width. Today there is no way to produce that set: the tool processes one local input folder, matches presets by folder name only, runs strictly sequentially, cannot resume, and has no notion of "crop this SKU family differently from that one". The existing `Feed afbeeldingen` sibling folders were produced by hand at 1920x1080 and are not square.

The source folders must be treated as strictly read-only. Nothing in any `Origineel` folder may be created, changed or removed.

## Solution

A second, self-contained config (`configs/channable.js`) that the existing CLI can be pointed at with `--config`. It lists the 20 read-only V: paths, each tagged with a category label, and a rule list matched against the filename:

- Files whose basename ends in `-0` (the main image per SKU + colour) are cropped to the largest square that fits, then scaled to 1500x1500.
- Every other SKU image is downscaled to at most 1500 wide at its own ratio, never upscaled.
- A rule may target a filename prefix (`BUN-1413081-`) and adjust the crop with `zoom`, `top`, `left` and `aspect`, so one SKU family can be framed differently from another.
- Only files with a SKU prefix (`BUN-`, `CAR-`, `ACC-`, `SUN-`) are processed. Everything else (`3m.jpg`, `*-energielabel.jpg`, `*-detailfoto.jpg`, `Thumbs.db`, `.psd`) is ignored and listed in the end-of-run summary.

Output lands locally in `google-channable-export/<category>/<original-basename>.<ext>`, format preserved (JPG stays JPG, PNG stays PNG), no watermark, no overlay, no renaming. The run is resumable (skip when output is newer than source), parallel, limitable, filterable per category, and has a dry-run mode. The tool itself is reorganised into `src/` modules with tests on the pure planning logic and an end-to-end test through the run entrypoint, so the 16,000-file batch is not the first place the maths is exercised.

## User Stories

1. As a feed manager, I want a 1500x1500 square main image per SKU and colour, so that Google Shopping shows the product without letterboxing.
2. As a feed manager, I want the square crop to use the largest square the source allows, so that no more of the render is trimmed than necessary.
3. As a feed manager, I want additional images (`-1` to `-6`) downscaled to at most 1500 wide at their own ratio, so that they stay sharp without being cropped.
4. As a feed manager, I want output filenames identical to the source basenames, so that the Channable feed can map SKU to image by name.
5. As a feed manager, I want no watermark or gradient overlay on Channable images, so that the feed passes Google's image policy.
6. As a feed manager, I want to frame one SKU family (filename prefix) tighter or with a different anchor than another, so that products that sit differently in the render are centred correctly.
7. As a feed manager, I want a rule list evaluated top to bottom with first match winning, so that I can reason about which rule applies by reading the config once.
8. As a feed manager, I want a warning at startup when a rule can never match because an earlier rule shadows it, so that a misordered config is caught before 16,000 files are written.
9. As a feed manager, I want files that are not SKU images ignored and listed at the end, so that energy labels and loose renders are not silently resized into the feed.
10. As a feed manager, I want PSD and `Thumbs.db` files ignored without an error, so that the run is not noisy.
11. As a feed manager, I want JPG sources to stay JPG and PNG sources to stay PNG, so that no format decision is taken on my behalf.
12. As an operator, I want to run `npm run build:channable` and have it pick up the Channable config, so that I do not have to edit the homepage config to run the feed.
13. As an operator, I want `npm run build` to behave exactly as before, so that the homepage and campaign batches are unaffected.
14. As an operator, I want to pass `--config <path>` to choose any config file, so that further channel configs can be added the same way.
15. As an operator, I want the tool to read the V: folders directly, so that I do not have to copy 16,000 files locally first.
16. As an operator, I want a hard guarantee that the tool never writes into an input folder, so that the read-only rule on V: holds even with a mistyped config.
17. As an operator, I want the run to abort before writing anything if two sources would produce the same output path, so that flattening per category cannot silently overwrite a file.
18. As an operator, I want already-processed files skipped when the output is newer than the source, so that a re-run after an interruption only does the remaining work.
19. As an operator, I want `--force` to overwrite regardless, so that I can regenerate after a rule change.
20. As an operator, I want `--concurrency N` to process several images in parallel, so that a 16,000-file run finishes in a reasonable time.
21. As an operator, I want `--limit N` to stop after N written files, so that I can check a small batch before committing to the full run.
22. As an operator, I want `--only <substring>` to restrict the run to inputs whose path or category matches, so that I can process one category at a time.
23. As an operator, I want `--dry-run` to print the plan per file (rule matched, crop window, output size and path) without writing, so that I can verify rules against real filenames.
24. As an operator, I want progress output with a running count, so that I can see a long batch is alive.
25. As an operator, I want an end-of-run summary with counts of written, skipped, ignored and failed files and the paths of the ignored and failed ones, so that problems do not scroll off screen.
26. As an operator, I want `--report <path>` to write a per-file CSV (source, output, rule, source size, output size, status), so that I can audit rule matching when needed, without it being produced on every run.
27. As an operator, I want output grouped into one folder per category label rather than mirroring the 40 size-subfolders per product line, so that the export stays browsable.
28. As an operator, I want `google-channable-export/` ignored by git, so that thousands of images never end up in a commit.
29. As a developer, I want the processing code split into focused modules (config loading, input discovery, rule matching, crop planning, watermark, output naming, pipeline, CLI, run), so that each can be read and changed in isolation.
30. As a developer, I want unit tests on the pure planning functions (rule matching, crop window, output naming, shadowed-rule detection), so that the maths is verified without touching images.
31. As a developer, I want an end-to-end test that runs the tool on a temp folder of generated fixture images and asserts on the files produced, so that the CLI and pipeline are covered at the seam an operator actually uses.
32. As a developer, I want `npm test` to run those tests with Node's built-in test runner, so that no new dependency is added.
33. As a developer, I want `compress.js` to work again (it currently imports a function the main module does not export), so that the older compression pass is not left broken by the refactor.
34. As a developer, I want the current uncommitted homepage/campaign changes committed before the refactor begins, so that the refactor is reviewable as its own diff.
35. As a developer, I want the README to document the Channable run, the CLI flags and the rule model, so that the next person can run it without reading the code.

## Implementation Decisions

**Config selection.** The CLI accepts `--config <path>`; without it, the root `config.js` is loaded and behaviour is unchanged. `package.json` gains `build:channable` and `test` scripts. The Channable config lives in a `configs/` folder.

**Input model.** The Channable config declares an ordered list of input entries, each `{ path, category }`. Paths are the 20 V: `Origineel` folders as given (Carport 01 points at `Origineel\Nieuwe map`). Discovery is recursive, so the 11 folders that nest `[Standard Classic] Veranda 10x2.5`-style subfolders are covered. No auto-discovery of `Origineel` folders.

**Read-only guarantee.** Inputs are only ever opened for reading. Before any write the tool resolves the output root and refuses to run if it lies inside, or equals, any input path. The existing sibling folders on V: (`Feed afbeeldingen`, `Gumax watermerk`) are not read or written.

**File eligibility.** A file is eligible when its extension is jpg/jpeg/png/webp and its basename starts with one of the configured SKU prefixes (`BUN-`, `CAR-`, `ACC-`, `SUN-`). Everything else is reported as ignored. `.psd` and `.db` are never opened.

**Rule model.** `rules` is an ordered array; the first rule whose matchers all pass wins. Matchers: `startsWith`, `endsWith`, both optional, tested against the basename without extension. A rule with no matchers is the default. Rule outputs: `width` (max width, or exact width when `aspect` is set), `aspect` (`"1:1"` or `"source"`, default source), `zoom` (default 1), `top` / `left` (0 to 1, default 0.5), `upscale` (default false; the square rule sets it true). Startup validation warns when a rule is fully shadowed by an earlier one (same or broader matchers).

**Crop window ("viewbox") semantics.** The window starts as the largest box of the target aspect that fits inside the source: for `1:1` on 1920x1080 that is 1080x1080, for `source` it is the full frame. `zoom` divides both window dimensions (zoom 1.25 on 1080 gives 864). `top` / `left` position the window within the source using the anchor convention already in the tool (0 = top/left edge, 0.5 = centre, 1 = bottom/right edge). The window is then resized to the output size: exactly `width` x `width` for `1:1`; for `source`, scaled so width is `min(width, windowWidth)` unless `upscale` is true. This composes with, and does not replace, the existing `top`/`left`/`resizeWidth` mechanics used by the homepage presets.

**Channable rule set.** Two rules: `{ endsWith: "-0", aspect: "1:1", width: 1500, upscale: true }` and the default `{ width: 1500 }`. Prefix-specific rules are added above these as needed; the config ships with a commented example.

**Output.** Root `google-channable-export/`, one subfolder per category label, filename = source basename + extension derived from the preserved format. Format is kept per source. JPEG quality 80 with mozjpeg, PNG settings reuse the existing `outputConfig`. No watermark, no overlay, naming normalisation off, dimensions never appended to filenames. A collision check over the full plan runs before the first write and aborts on any duplicate output path.

**Run control.** `--concurrency` (default 4), `--limit`, `--only`, `--dry-run`, `--force`, `--report`. Skip-existing is the default: an output is skipped when it exists and its mtime is not older than the source's. Progress prints a running `n / total`. The summary prints counts per status and the full list of ignored and failed paths.

**Module split.** `crop-and-resize.js` and `compress.js` remain as thin entrypoints. Logic moves to `src/`: config loading and validation, input discovery, eligibility and rule matching, crop planning (pure), watermark placement (pure parts, existing), output naming (pure, existing), image pipeline (sharp), CLI argument parsing, and a `run(config, options)` orchestrator that returns the summary. `compress.js` imports the output-format helper from its new module, fixing the current missing-export bug. CommonJS stays; `sharp` remains the only runtime dependency.

**Housekeeping.** Commit the current working-tree changes first. Add `google-channable-export/` and `.playwright-mcp/` to `.gitignore`. Commit `docs/` and `.scratch/`.

## Testing Decisions

A good test exercises the behaviour an operator or a config author sees, not the internal shape of the code. Tests assert on output files (existence, dimensions, format), on the returned run summary, and on the plan a rule set produces for a given filename and source size. Tests never assert on intermediate sharp calls or private helper names.

**Seam 1, the run entrypoint (primary).** `run(config, options)` is called with a config object whose inputs point at a temp directory of small fixture images generated with sharp in the test (e.g. 192x108 and 384x216 to stand in for HD and 4K, with scaled-down rule widths). Assertions: the square rule yields exact NxN files, the default rule yields max-width files at source ratio without upscaling, non-SKU files are ignored and reported, PSD/db files are untouched, format is preserved, resume skips unchanged outputs and `--force` rewrites them, `--limit` stops at N, `--only` filters, `--dry-run` writes nothing, output collisions abort before any write, an output root inside an input aborts. This single seam covers the CLI options, discovery, rules, pipeline and summary together.

**Seam 2, pure planning (secondary, cheap).** Unit tests on rule matching (order, first-match, shadow warning), crop-window maths (aspect, zoom, anchors, upscale flag, odd sizes like 1920x1079) and output naming. These exist because the maths is where an off-by-one costs 16,000 files, and they run in milliseconds.

**Runner.** Node's built-in `node:test` with `node --test`, wired to `npm test`. Prior art: none in this repo; the existing `module.exports` on the main script (planning helpers exposed for reuse) is the closest thing to a test hook and is the natural home for seam 2.

## Out of Scope

- Uploading or hosting the exported images, and building the Channable feed itself.
- Writing into `Feed afbeeldingen` or any other folder on V:.
- Changing the homepage, campaign or compression presets beyond the export fix.
- Auto-discovery of `Origineel` folders.
- TypeScript, ESM migration, or new runtime dependencies.
- Per-file crop overrides for the Channable set (prefix rules cover the stated need; a per-file override can reuse the existing `imagePositionOverrides` mechanism later if required).
- WebP or AVIF output.

## Further Notes

- Survey of the 20 folders (2026-09-08, read-only metadata scan): 6,187 files in the 9 flat folders, about 1,450 per nested folder in the 11 nested ones; dimensions 1920x1080 and 3840x2160 mixed within a folder, outliers 1920x1079, 3862x2172, and nine distinct sizes in Bamboo decking; all flat-folder filenames unique; every folder has a `Thumbs.db`.
- Colour codes seen in filenames: 51, 71, 91. Index suffixes seen: `-0` to `-6`. Bamboo decking uses `ACC-30000-0001_01` (underscore index, no `-N`), so it falls under the default rule.
- Recommended first real run: `--only Ledspots --dry-run`, then `--only Ledspots` (12 files), then one full category.
