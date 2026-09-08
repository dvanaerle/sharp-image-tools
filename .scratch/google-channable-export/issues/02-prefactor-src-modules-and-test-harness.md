# 02: Prefactor: split into src modules behind a run() entrypoint, add test harness

**What to build:** The same tool, reorganised so the next tickets are small. `npm run build` behaves exactly as today for every existing preset, but the logic now lives in focused modules under a `src/` folder (config loading, input discovery, crop planning, watermark placement, output naming, image pipeline, run orchestration) with the root scripts reduced to thin entrypoints. A programmatic `run(config, options)` function processes a config object and returns a summary of what it did. `npm test` runs Node's built-in test runner. The first end-to-end test generates small fixture images with sharp in a temp folder, runs them through an existing-style folder preset via `run()`, and asserts on the files produced. Unit tests cover the helpers that are already pure (resize-crop plan, output filename, scale expansion, watermark placement). `compress.js` imports the output-format helper from its new module.

**Blocked by:** 01 (Housekeeping and compress.js fix).

**Status:** ready-for-agent

- [ ] `npm run build` on the current `01_input` layout produces the same files with the same dimensions and names as before the refactor (verified by a before/after listing on at least one preset folder).
- [ ] `run(config, options)` exists, takes a config object rather than reading the root config itself, and returns a summary with per-status counts.
- [ ] Root `crop-and-resize.js` and `compress.js` are thin entrypoints; no processing logic remains in them.
- [ ] `npm test` runs `node --test` and passes; no new dependency added.
- [ ] An end-to-end test creates fixture images in a temp directory, runs `run()` against them with a folder preset, and asserts output existence, dimensions and format.
- [ ] Unit tests cover the resize-crop plan, output filename, scale expansion and watermark placement helpers.
- [ ] CommonJS is retained; `sharp` is still the only runtime dependency.
