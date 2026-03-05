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

- Exports JPEG files.
- Adds dimensions to filenames (example: `hero-1200x675.jpg`).
- Applies folder-based size presets when folder names match:
  - `home`
  - `schuifwand`
  - `verlichting`
  - `category`

## Quick Configuration

Edit `crop-and-resize.js`:

- `formats` for default sizes/crop position.
- `folderSizePresets` for folder-specific sizes.
- `watermarkConfig.enabled` to turn watermarking on/off.
- `overlayConfig.enabled` to turn gradient overlay on/off.
