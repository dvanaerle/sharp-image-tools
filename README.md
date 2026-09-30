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

## Output Behavior (root config)

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
| `--limit N` | none | Stop after N files have been written. Skipped files do not count, so repeated limited runs walk through the batch. Has no effect under `--dry-run`. |
| `--only <text>` | none | Only process input entries whose path or category contains `<text>` (case-insensitive). With the root config it filters on the image path relative to `inputDir`. |
| `--name <text>` | none | Only process files whose basename contains `<text>`, e.g. `--name -0` for the main images. Combines with `--only`; it does not change what is reported as ignored. |
| `--dry-run` | off | Print the plan per file (rule, crop window, output size, output path) and write nothing. Files a real run would skip are shown as up to date. |
| `--report <path>` | none | Write a per-file CSV: source, output, rule, source size, output size, aspect, fit, status. No report is produced without the flag. |

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
extension, and `category`, tested case-insensitively as a substring of the
input entry's category label. A rule without matchers is the default. A rule
that an earlier rule fully shadows is reported at startup. A file that matches
no rule is skipped.

| Key | Default | Meaning |
| --- | --- | --- |
| `width` | required | Width of the output file. |
| `aspect` | `"source"` | `"source"` for the full frame, or a `"w:h"` ratio (`"1:1"`, `"4:3"`, ...) for the largest window of that ratio that fits the source. |
| `fit` | `"none"` | `"product"` chooses `aspect` and `left` per product instead of using the values above. See below. |
| `ladder` | `["1:1", "5:4", "4:3", "3:2", "16:9"]` | Aspects `fit: "product"` may choose from, tightest first. |
| `fitMargin` | `0` | Extra space to leave around the product, as a fraction of the frame width. |
| `zoom` | `1` | Divides the crop window; `1.25` on a 1080 window gives 864. Must be `>= 1`. |
| `top`, `left` | `0.5` | Anchor of the window inside the source: `0` = top/left edge, `0.5` = centre, `1` = bottom/right edge. |
| `upscale` | `false` | Allow enlarging the window to `width`. |

The crop window starts as the largest box of the target aspect that fits the
source (1080x1080 for `1:1` on 1920x1080; the full frame for `source`), `zoom`
shrinks it, `top`/`left` place it, then it is scaled to `width` wide at its own
ratio, upscaling only when `upscale` is true. **Every output is a plain crop of
the source**: nothing is ever padded, barred, stretched or otherwise altered.

The shipped rule set is:

```js
{ endsWith: "-0", fit: "product", ladder: [...], width: 1500, upscale: true },
{ width: 1500 },
```

so a `-1` file from 1920x1080 becomes 1500x844, and a `-0` file is framed
around the product as described next.

### Fitting the main image to the product

A square is what Google Shopping wants, and the largest square that fits an HD
frame is 1080 of its 1920 px. Most products fit that, but only once the square
stops being centred on the frame: a 3x2.5 carport is about 1045 px wide and
sits left of centre, so a centred crop clips its roof while an offset one holds
it whole. The widest products fit no square at all, so `fit: "product"` walks
the `ladder` and takes the tightest format that holds the whole product:

```
1500x1500 (1:1)    most carports and verandas
1500x1200 (5:4)    10 to 12 m carports
1500x1125 (4:3)    12 m carports at full depth
```

The product is found per **source folder**, not per file: the colour variants
in one size folder share a scene and a geometry, so the box is the median of
the plausible detections across them, which is far steadier than detecting per
file. The detector looks for the roof slab, the one large region that is
bright, almost colourless, smooth and not running off the bottom of the frame.
Part of the roof is usually in the shadow of the house and too dim to pass that
test on its own, so the bright part only seeds the search and the region then
grows outwards through dimmer pixels connected to it.

It is a heuristic and it misses some scenes, typically where a big cream wall
or a sunlit driveway outshines the roof. So **review each category before
trusting it**:

```bash
node crop-and-resize.js --config configs/channable.js   --only "Standaard Klassiek Carport" --name -0 --report run.csv
node contact-sheet.js "google-channable-export/Carport Standaard Klassiek"   --name -0 --report run.csv --out sheet.jpg --tile 210 --cols 8 --max 40
```

The sheet draws every tile at its real aspect and labels it with its source
folder, so a clipped roof or an unexpected format is obvious. Folders where
nothing plausible was found are named in a startup warning and fall back to the
framing the rule itself asks for.

Correct what is wrong with `fitOverrides`, which is matched against the source
path by case-insensitive substring, first match winning:

```js
const fitOverrides = [
  { match: "Carport 11x2.5/", aspect: "5:4", left: 0.267 },
];
```

Write the match with a trailing slash to pin it to one folder: `Carport 11x3`
on its own also matches `Carport 11x3.5`. Separators are normalised, so forward
slashes work against the backslash paths on V:. Either `aspect` or `left` may
be given on its own.

The end-of-run summary reports how many images kept a square, the count per
format, how many came from overrides and how many had no product detected.

### Read-only guarantee

Input folders are only ever read. Before any write the run resolves the output
root and refuses to start if it equals or lies inside any input path, and it
refuses to start if two sources would land on the same output path.

## Contact sheets

`contact-sheet.js` renders a grid of an exported folder so a whole category can
be judged at a glance, without opening hundreds of files:

```bash
npm run sheet -- "google-channable-export/Carport Standaard Klassiek"   --name -0 --out sheet.jpg
```

| Flag | Default | Effect |
| --- | --- | --- |
| `--out <path>` | `contact-sheet.jpg` | Where to write the sheet. |
| `--name <text>` | none | Only include files whose basename contains `<text>`. |
| `--tile N` | `300` | Tile size in pixels. |
| `--cols N` | `6` | Tiles per row. |
| `--max N` | `60` | Most tiles to draw, spread evenly over the folder rather than taken from the front. |
| `--report <csv>` | none | A report from `--report`: tiles are then grouped and labelled by their source folder, which is the handle `fitOverrides` matches on. |

Tiles are drawn at their real aspect on a grey background, so anything clipped
at an edge and any image that is not square both stand out. The tool only ever
reads the folder it is pointed at.

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

- `rootDir` — folder that holds one subfolder per product, or a flat folder
  of images (for example `./01_input/levergebied`).
- `sourceFolderNames` — source folder names tried in order, case-insensitive
  (defaults to `Origineel`).
- `outputFolderName` — destination folder name inside each product folder
  (defaults to `Gecomprimeerd`).
- `preserveDimensions` — when `true`, only re-encode at the quality settings in
  `outputConfig`; width and height stay the same. Flat folders always land in
  `02_compressed/<folder-name>/`.
- `width` / `height` — output size when `preserveDimensions` is off (defaults
  to `640` x `360`). Images are scaled to fill and center-cropped to exactly
  this size.

Keeps the original format (`jpg`/`png`) and reuses the quality settings in
`outputConfig`. The source folder is only ever read from — never modified or
overwritten.
