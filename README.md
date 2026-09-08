# Sharp Image Tools

Batch crop/resize images with optional overlay and watermark support.

## Install

```bash
npm install
```

## Use

1. Put source images in `01_input/` (subfolders are supported).
2. Run:

```bash
npm run build
```

3. Find processed images in `02_output/` (folder structure is preserved).

## Supported Input Formats

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

## Output Behavior

- Exports optimized PNG for `.png` inputs.
- Exports JPEG for non-PNG inputs (`.jpg`, `.jpeg`, `.webp`).
- Adds dimensions to filenames (example: `hero-1200x675.jpg`).
- Applies folder-based size presets when folder names match:
  - `tm-showrooms`
  - `tm-blogs`

## Quick Configuration

Edit `config.js`:

- `formats` for default sizes/crop position.
- `folderSizePresets` for folder-specific sizes.
- `watermarkConfig.enabled` to turn watermarking on/off.
- `overlayConfig.enabled` to turn gradient overlay on/off.

### Retina scales

Set the 1x (CSS/display) size and list multipliers — no hand-calculated dimensions:

```js
{ width: 897, height: 536, scales: [1, 2, 3] }
```

Outputs `897×536` (`@1x`), `1794×1072` (`@2x`), `2691×1608` (`@3x`).
With `suffix: "tablet"` → `name-tablet@1x.jpg`, `name-tablet@2x.jpg`, …
Omit `scales` for a single output at the given size (no `@Nx` in the filename).

## Choosing a config and run flags

`npm run build` runs `crop-and-resize.js` with the root `config.js`. Any other
config file can be selected with `--config`:

```bash
node crop-and-resize.js --config configs/channable.js
```

Every run, in either mode, accepts these flags (`--flag value` or
`--flag=value`; anything unrecognised aborts before reading a single file):

| Flag | Default | Effect |
| --- | --- | --- |
| `--concurrency N` | `4` | Images processed in parallel. Output is identical to a sequential run. |
| `--force` | off | Rewrite outputs that are already up to date. Without it an output is skipped when it exists and is not older than its source, so an interrupted run can simply be started again. |
| `--limit N` | none | Stop after N files have been written. Skipped files do not count, so repeated limited runs walk through the batch. |
| `--only <text>` | none | Only process input entries whose path or category contains `<text>` (case-insensitive). With the root config it filters on the image path relative to `inputDir`. |
| `--dry-run` | off | Print the plan per file (rule, crop window, output size, output path) and write nothing. Files a real run would skip are shown as up to date. |
| `--report <path>` | none | Write a per-file CSV: source, output, rule, source size, output size, status. No report is produced without the flag. |

Progress prints a running `n / total`. The run ends with a summary of saved,
skipped, failed and ignored counts, followed by the full list of failed and
ignored paths. The process exits non-zero when any file failed.

## Google Channable export

`configs/channable.js` produces the Google Shopping image set from the product
renders on the V: share. Run it with:

```bash
npm run build:channable
```

which is `node crop-and-resize.js --config configs/channable.js`. Recommended
first steps on a fresh machine:

```bash
node crop-and-resize.js --config configs/channable.js --only Ledspots --dry-run
node crop-and-resize.js --config configs/channable.js --only Ledspots
node crop-and-resize.js --config configs/channable.js --only "Standaard Klassiek Carport"
npm run build:channable
```

Output lands in `google-channable-export/<category>/<source-basename>.<ext>`.
The filename is the source basename unchanged, JPG stays JPG and PNG stays PNG
(WebP sources are written as JPG). No watermark, no overlay, no renaming, no
dimensions in filenames. JPEG quality 80 with mozjpeg.

### Inputs

`inputs` is an ordered list of `{ path, category }` entries. Each `path` is one
`Origineel` folder, searched recursively, so folders that nest per-size
subfolders are covered. `category` becomes the output subfolder name.

Only files whose extension is jpg, jpeg, png or webp **and** whose basename
starts with one of the `skuPrefixes` (`BUN-`, `CAR-`, `ACC-`, `SUN-`) are
processed. Everything else (`3m.jpg`, `*-energielabel.jpg`, `*-detailfoto.jpg`,
`Thumbs.db`, `.psd`) is reported as ignored and never opened.

### Rules

`rules` is an ordered list; the first rule whose matchers all pass wins.
Matchers are `startsWith` and `endsWith`, tested against the basename without
extension. A rule without matchers is the default. A rule that an earlier rule
fully shadows is reported at startup. A file that matches no rule is skipped.

| Key | Default | Meaning |
| --- | --- | --- |
| `width` | required | Exact side for `aspect: "1:1"`; maximum width for `aspect: "source"`. |
| `aspect` | `"source"` | `"1:1"` for the largest centred square that fits the source, `"source"` for the full frame. |
| `zoom` | `1` | Divides the crop window; `1.25` on a 1080 window gives 864. Must be `>= 1`. |
| `top`, `left` | `0.5` | Anchor of the window inside the source: `0` = top/left edge, `0.5` = centre, `1` = bottom/right edge. |
| `upscale` | `false` | Allow enlarging the window to `width`. |

The crop window starts as the largest box of the target aspect that fits the
source (1080x1080 for `1:1` on 1920x1080; the full frame for `source`), `zoom`
shrinks it, `top`/`left` place it, then it is scaled to `width` x `width` for
`1:1` or to at most `width` wide at the source ratio for `source`, upscaling
only when `upscale` is true.

The shipped rule set is:

```js
{ endsWith: "-0", aspect: "1:1", width: 1500, upscale: true }, // main image
{ width: 1500 },                                                 // everything else
```

so a `-0` file from 1920x1080 becomes 1500x1500 from the centred 1080x1080
window, and a `-1` file becomes 1500x844. To frame one SKU family differently,
add a rule with `startsWith` above the square rule.

### Read-only guarantee

Input folders are only ever read. Before any write the run resolves the output
root and refuses to start if it equals or lies inside any input path, and it
refuses to start if two sources would land on the same output path.

## Compress (per-subfolder pass)

For an image bank laid out as one folder per product, each containing a source
folder (`Origineel`), compress every product's images into a sibling
`Gecomprimeerd` folder:

```
<rootDir>\
  Product A\
    Origineel\        <- source
    Gecomprimeerd\    <- created, compressed copies
  Product B\
    Origineel\
    Gecomprimeerd\
```

Run:

```bash
npm run compress
```

Configure it under `compressConfig` in `config.js`:

- `rootDir` — folder that holds one subfolder per product.
- `sourceFolderNames` — source folder names tried in order, case-insensitive
  (defaults to `Origineel`).
- `outputFolderName` — destination folder name (defaults to `Gecomprimeerd`).
- `width` / `height` — output size (defaults to `640` x `360`). Images are
  scaled to fill and center-cropped to exactly this size.

Keeps the original format (`jpg`/`png`) and reuses the quality settings in
`outputConfig`. The source folder is only ever read from — never modified or
overwritten.
