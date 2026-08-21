"use strict";

const inputDir = "./01_input/tm-bamboo-decking";
const outputDir = "./02_compressed";

const includeDimensionsInFileName = false;
const formatsEnabled = true;

/*
  Folder-specific image sizes.

  The folder name is matched against image subfolders inside inputDir,
  and also against inputDir itself. So both of these use the "showrooms" preset:
  - images in 01_input/showrooms/ with inputDir "./01_input"
  - images directly in inputDir when inputDir is "./01_input/showrooms"

  Optional crop controls:
  - top: 0 = crop from top, 0.5 = center, 1 = bottom
  - left: 0 = crop from left, 0.5 = center, 1 = right

  Optional retina scales (set the 1x / CSS size, then list multipliers):
  - scales: [1, 2, 3]
    → 897×536, 1794×1072, 2691×1608 with suffixes @1x / @2x / @3x
    → with suffix: "hero" → hero@1x, hero@2x, hero@3x
  Omit `scales` for a single output at the given width×height (no @Nx).

  Optional output format override:
  - outputFormat: "jpeg" | "png" (default: keep source format — png stays png)

  Optional watermark overrides:
  - watermarkPosition: "top-left", "top-right", "bottom-left", "bottom-right", or "center"
  - watermarkMarginPercent: { x: 0.05, y: 0.045 }
  - watermarkMaxWidth: 576
  - watermarkMaxHeight: 576
  Size entries may also set watermarkMarginPercent / watermarkPosition /
  watermarkScale (and suffix) to override per output size.
*/
const folderSizePresets = {
  "tm-home": {
    sizes: [
      { width: 1200, height: 600 }
    ],
  },

  "tm-bamboo-decking": {
    sizes: [
      { width: 897, height: 505, scales: [2] }
    ],
  },
  "tm-showrooms": {
    sizes: [
      { width: 1200, height: 800 },
      { width: 384, height: 216 },
    ],
  },
  "losse-onderdelen": {
    sizes: [
      { width: 640, height: 360 },
    ],
  },
  "tm-blogs": {
    sizes: [
      { width: 1366, height: 768 },
      { width: 1080, height: 720 },
    ],
  },
  "showrooms": {
    sizes: [
      { width: 276, height: 264, left: 1, top: 0.5 }
    ],
    outputFormat: "jpeg",
  },
  // Home promo tiles (<picture> sources). CSS max → export @2x.
  // ≥1024 tablet 740×370 · ≥768 landscape 487×243 ·
  // ≥576 portrait 737×369 · <576 phone 545×307
  "product-images": {
    sizes: [
      {
        width: 1480,
        height: 740,
        suffix: "tablet",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.08 },
      },
      {
        width: 974,
        height: 486,
        suffix: "landscape",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.08 },
      },
      {
        width: 1474,
        height: 738,
        suffix: "portrait",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.08 },
      },
      {
        width: 1090,
        height: 614,
        suffix: "phone",
        watermarkScale: 1 / 2,
        watermarkMarginPercent: { x: 0.03, y: 0.12 },
      },
    ],
  },
};

const overlayConfig = {
  enabled: false,
};

/*
  Watermark settings.

  position can be:
  - "top-left"
  - "top-right"
  - "bottom-left"
  - "bottom-right"
  - "center"

  presets can choose a different watermark when a folder name is present:
  presets: [
    {
      folder: "DE",
      imagePath: "./watermark/watermark_DE.svg",
    },
  ],
*/
const watermarkConfig = {
  enabled: true,
  // No default — only locale presets below apply a badge.
  imagePath: null,
  position: "bottom-right",
  opacity: 1,
  marginPercent: { x: 0.03, y: 0.04 },
  // Fallback; product-images overrides per size (phone 1/2, others 1/3).
  scale: 1 / 3,
  fixedSize: false,
  // Switch *-16Aug.svg ↔ *-31Aug.svg when the campaign end date changes.
  presets: [
    {
      folder: "nl-nl",
      imagePath:
        "./watermark/2026-07-23-KortingActie/2026-07-23-KortingActie-NL-31Aug.svg",
    },
    {
      folder: "de-de",
      imagePath:
        "./watermark/2026-07-23-KortingActie/2026-07-23-KortingActie-DE-31Aug.svg",
    },
    {
      folder: "en-gb",
      imagePath:
        "./watermark/2026-07-23-KortingActie/2026-07-23-KortingActie-EN-31Aug.svg",
    },
    {
      folder: "be-fr",
      imagePath:
        "./watermark/2026-07-23-KortingActie/2026-07-23-KortingActie-FR-31Aug.svg",
    },
  ],
};

/*
  Default formats used when no folder-specific preset matches.

  Optional crop controls:
  - top: 0 = crop from top, 0.5 = center, 1 = bottom
  - left: 0 = crop from left, 0.5 = center, 1 = right

  Optional advanced controls:
  - blurSigma: applies blur
  - blurReferenceSize: keeps blur visually consistent across sizes
  - resizeWidth / resizeHeight: resize to this size first, then crop to width x height
  - scales: [1, 2, 3] — multiply width/height (and resize*) by each factor;
    filenames get @1x / @2x / @3x (see folderSizePresets comment)

  Example: resize to 640x360, then crop 384x192:
  { width: 384, height: 192, resizeWidth: 640, resizeHeight: 360 }

  Example: 1x CSS size 897×536, export 1x + 2x:
  { width: 897, height: 536, scales: [1, 2] }
*/
/*
  Canvas mode:

  Instead of cropping, resize the image to fit inside an inner box and center
  it on a larger canvas, padding the remaining space with `background`.

  - sizes.width / sizes.height: the final canvas size
  - canvas.imageWidth / imageHeight: the inner image box (contained inside it)
  - canvas.fit: "contain" (keep aspect ratio, default) or "fill" (stretch)
  - canvas.background: padding color (default opaque white)

  Note: JPEG output has no transparency, so an alpha < 1 background only shows
  through for PNG/WebP output.
*/
const formats = [
  {
    sizes: [
      {
        width: 1104,
        height: 621,
        left: 0,
      },
    ],
    // canvas: {
    //   imageWidth: 750,
    //   imageHeight: 428,
    //   fit: "contain",
    //   background: { r: 255, g: 255, b: 255, alpha: 0 },
    // },
  },
];

const outputConfig = {
  jpegQuality: 75,
  pngCompressionLevel: 9,
  // Both only take effect because PNG output is written in palette mode.
  // Lower pngQuality to shrink flat-colour graphics; raise pngDither towards 1
  // if a gradient starts to band.
  pngQuality: 90,
  pngDither: 0.8,
};

/*
  Compression pass (compress.js).

  Walks every immediate subfolder of `rootDir`, finds the source folder
  (first match of `sourceFolderNames`, case-insensitive), and writes
  compressed copies into a sibling `outputFolderName` folder. Keeps the
  original format (jpg -> jpg, png -> png) and reuses the quality settings
  in `outputConfig` above.

  The source folder is only ever read from, never written to.

  Output is resized to width x height (scaled to fill, then center-cropped
  so the result is exactly that size).
*/
const compressConfig = {
  rootDir:
    "V:/Gumax®/02. Beeldbank/02. Renders/01. Webshop afbeeldingen/09. Losse onderdelen",
  sourceFolderNames: ["Origineel"],
  outputFolderName: "Gecomprimeerd",
  width: 640,
  height: 360,
};

module.exports = {
  inputDir,
  outputDir,
  includeDimensionsInFileName,
  formatsEnabled,
  folderSizePresets,
  overlayConfig,
  watermarkConfig,
  formats,
  outputConfig,
  compressConfig,
};
