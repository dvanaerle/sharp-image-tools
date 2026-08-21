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
