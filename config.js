"use strict";

const inputDir = "./01_input/tm-home";
const outputDir = "./02_compressed";

const includeDimensionsInFileName = false;
const formatsEnabled = false;

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

  Optional watermark opt-out (preset-level):
  - noWatermark: true
    Skips the watermark for this preset even when watermarkConfig.enabled
    is true for the rest of the batch.

  Optional no-upscale guard (preset-level or per size entry):
  - noUpscale: true
    Sources that cannot fill width×height are not enlarged. Instead the
    output becomes the largest box that fits inside width×height at the
    SOURCE's aspect ratio — the ratio is adjusted rather than the pixels
    invented. A source smaller than the box in both axes passes through
    at native size with no crop.

  Optional watermark overrides:
  - watermarkPosition: "top-left", "top-right", "bottom-left", "bottom-right", or "center"
  - watermarkMarginPercent: { x: 0.05, y: 0.045 }
  - watermarkMaxWidth: 576
  - watermarkMaxHeight: 576
  Size entries may also set watermarkMarginPercent / watermarkPosition /
  watermarkScale (and suffix) to override per output size.
*/
const folderSizePresets = {
  /*
    Homepage (m2stagingnl) — re-measured 320→2560px, Sep 2026.
    All exports are @2x of the widest CSS box that role ever gets.

    The homepage now ships real <picture> elements and the mobile
    source switches on exactly `(max-width: 767px)`, so the "mobile"
    suffix below maps 1:1 onto that media query. Above 767px the
    layout container caps out around 1900px — 1920 and 2560 measure
    identical, so nothing ever renders larger than the numbers here.

    Known site bug (not fixable from this config): both <picture>
    mobile <source>s on the homepage point at the same file,
    glass-sliding-doors-opening-mobile.jpg. The "column" slot should
    reference its own -mobile asset instead.
  */

  // 10 promo tiles (verandas, carports, onderdelen, montage, reviews, ...).
  // Box is 16:9 at every viewport; widest is mobile single-column
  // (735×415 @767px, no scrollbar) — larger than desktop, which caps at
  // 633×357 (identical at 1920 and 2560). Confirmed re-measure: no mobile
  // <source> exists for these, and none is needed — one image covers both.
  "tiles": {
    sizes: [
      { width: 1472, height: 828 },
    ],
  },

  // "Over Tuinmaximaal" main banner. ≥1024px the box is near-square /
  // portrait (462×445 … 353×445), <768px it is landscape (735×300).
  // Worth two images; one source per image, both crops from the same folder.
  // Height is FIXED by CSS, width is fluid, so the ratio varies and
  // object-fit: cover does the trimming. Re-measured Sep 2026, this time
  // sweeping the top of the landscape band instead of stopping at 992:
  //   >=1280  445x445 (1.00)  ->  1024  353x445 (0.79)
  //   768-1023 landscape band, height 400: 632x400 @768
  //            -> 835x400 @1002 -> 855x400 @1023 (true max width)
  //   <=767   height 300 then 224: 735x300 @767 -> 288x224 @320
  // A square desktop crop is the compromise across 0.79-2.45. The widest
  // desktop box is 855, not the 840 measured earlier, so 1400 was only
  // ~1.6x there — 1712 restores a genuine 2x at the top of the band.
  "about": {
    sizes: [
      { width: 1712, height: 1712, suffix: false },
      { width: 1472, height: 828, suffix: "mobile" },
    ],
  },

  // .page-builder-block-img-selling-points
  // Re-measured dpr=1, integer widths, Sep 2026.
  // The box has NO fixed ratio: computed aspect-ratio is
  // "auto 1260/2100", i.e. height = width / the file's own ratio.
  // So the shape is a design choice; only the WIDTH is constrained:
  //   >=768px  361 @768 -> 630 @1366+   (two-column)  -> need 1260 wide
  //            630 is a hard cap; 1920 and 2560 both measure 630.
  //   <=767px  cw - 32, max 735 @767    (full width)  -> need 1470 wide
  // Current shapes: desktop 3:5 portrait, mobile 16:9.
  "column": {
    sizes: [
      { width: 1260, height: 2100, suffix: false },
      { width: 1472, height: 828, suffix: "mobile" },
    ],
  },

  "tm-bamboo-decking": {
    sizes: [
      {
        width: 512, height: 320, scales: [2],
      }
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

  /*
    tm-home — the homepage review blocks (klantenvertellen, Trustpilot,
    Trusted Shops). Measured Sep 2026.

    These sit in the same promo-tile grid as the rest of the homepage, so
    the box is 16:9 below 576px and 2:1 from 576px up, maxing at
    831x416 CSS (single-column peak at ~846px viewport).

    Deliberately ONE size and no <picture>: these are badge-style review
    graphics reused across slots, not art-directed photography, so the
    extra sources buy nothing. A single 16:9 master covers both bands via
    object-fit: cover — the 2:1 band crops a little off the top and
    bottom, which is fine for a centred score badge.

    Scale is 1.5x, capped by the masters: sources are 1292x729, so 2x of
    the 831px box (1662 wide) is unreachable. 1.5x of 831x416 = 1247x624;
    1248x702 is exact 16:9, clears the 2:1 height requirement (624) and
    the phone band (818x461), and is a slight downscale from 1292 rather
    than an upscale.

    No watermark: review scores are not campaign assets, and a
    Voordeelweken badge over a rating graphic reads as endorsement of the
    promo by the review platform.
  */
  "tm-home": {
    noUpscale: true,
    noWatermark: true,
    sizes: [
      {
        width: 1248,
        height: 702,
      },
    ],
  },

  /*
    Schuifwanden — the Magezon `single_image` slots on /schuifwand (and
    the same pattern on /verlichting). Measured Sep 2026.

    These are object-fit: COVER inside `aspect-video`, so the box is
    locked 16:9 and CSS centre-crops whatever we give it. That is the
    opposite of the Categoriepagina heroes, whose box inherits the file's
    own ratio — which is why these need their own preset instead of being
    forced to 1.516.

    Max CSS box: 735x413 (hero, /schuifwand top block) and 490x276
    (carousel cards). 1.5x of 735x413 = 1104x621, exact 16:9.

    noUpscale still applies: the 1000x563 gumax-* masters cannot reach
    1104 wide, so they pass through at 1000x563 (1.36x of the hero box).
    gumax-insect-screen.jpg is 1920x1080 and downscales cleanly to
    1104x621 with zero crop — under the Categoriepagina preset it was
    being cropped to 1.516 instead.

    Put the 16:9 sources here — gumax-glass-sliding-doors,
    gumax-shading-panel, gumax-steel-look-glass-sliding-doors,
    gumax-insect-screen — in 01_input/tm-actie/<locale>/Schuifwanden/.

    IMPORTANT — key order matters: "Schuifwanden", then
    "Categoriepagina", then "tm-actie". Preset lookup takes the FIRST key
    in this object that appears anywhere in the image's path, not the
    deepest folder. Everything lives under 01_input/tm-actie/<locale>/...
    so "tm-actie" always matches too, and declaration order is what
    decides. Below "tm-actie" these would wrongly get the four homepage
    <picture> sizes.
  */
  "Schuifwanden": {
    noUpscale: true,
    sizes: [
      {
        width: 1104,
        height: 621,
        watermarkPosition: "bottom-left",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.05 },
      },
    ],
  },

  /*
    Category pages (Categoriepagina). Live measure of the
    `.category-view container` block on /terrasoverkapping, /schuifwand,
    /carport, /veranda, /serre, /zonwering and /verlichting,
    320->2560px, dpr=1, Sep 2026.

    No <picture> here — every slot is a plain <img> behind
    /cdn-cgi/image/quality=75,format=auto, which converts format but does
    NOT resize. So one file per image serves every viewport; the source
    dimensions are the only lever. Hence a single size entry.

    Two page families behave OPPOSITELY, which is what makes the sizing
    subtle:

    A) Legacy `tm_image` widget — /carport, /veranda, /serre, /zonwering
       object-fit: FILL, and the box aspect ratio is inherited from the
       FILE, not from CSS. Carport_tuinmaximaal.jpg is 1531x1010 (1.516)
       and every box measures 1.516 at every viewport; Productinformatie-
       blok.jpg is 1.545 and every box measures 1.545. So the browser
       crops NOTHING — any ratio we export becomes the layout shape.
       Max box: 870x574 CSS @vw900 (single-column peak; drops to 466x307
       at 992 when it goes two-column, and caps at 735x485 from 1536up).

    B) Magezon `single_image` — /schuifwand, /verlichting
       object-fit: COVER inside `aspect-video`, so the box is locked 16:9
       and the source gets centre-cropped to fit.
       Max box: 735x413 (hero) and 490x276 (carousel cards).

    Scale choice: 1.5x, not 2x. The masters cap at 1531x1010, so 2x of
    the 870px hero box (1740x1148) is not reachable without upscaling.
    1.5x of 870x574 = 1305x861, which is ratio 1.516 — IDENTICAL to the
    native 1531x1010 ratio. So this is a pure downscale with ~zero crop,
    which is what fixes the top/bottom cropping seen on
    Tuinmaximaal-carport-categorie.jpg (that was our own 16:9 export
    crop, never the page CSS). At an 870px photographic box, 2x buys
    little perceptible sharpness for roughly double the bytes.

    Watermark sits TOP-RIGHT here: the family-A slots carry a green CTA
    button overlapping the bottom edge, and family B has the orange
    price badge bottom-left.

    KNOWN SOURCE LIMITS (config cannot fix these — re-export needed):
      gumax-glass-sliding-doors / -shading-panel / -steel-look-*
        are 1000x563 and would be upscaled ~30% by this size. Their real
        need is 1103x620 (1.5x of the 735px hero slot on /schuifwand).
      en-gb Carport_Block-ID_1087_.jpg and Sunshading_Block-ID_1047_.jpg
        are only 800x528 — below even 1x for an 870px box.
    Move those into their own folder/preset once re-exported.
  */
  "Categoriepagina": {
    // Never enlarge a master. Sources that cannot fill 1305x861 fall back
    // to the biggest box that fits at their OWN ratio, so the 1000x563
    // gumax cards stay 16:9 (their slot is object-fit: cover / 16:9
    // anyway) and the 800x528 en-gb files stay 1.515 — no upscale, no
    // shape they cannot fill.
    noUpscale: true,
    sizes: [
      {
        width: 1305,
        height: 861,
        watermarkPosition: "top-right",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.05 },
      },
    ],
  },

  /*
    Homepage promo tiles for the Voordeelweken campaign (tm-actie).
    Live measure of www.tuinmaximaal.nl, 320->2560px, dpr=1, Sep 2026.

    One <picture> source per media query already on the page:
      (min-width: 1024px) -> tablet     ·  (min-width: 768px) -> landscape
      (min-width: 576px)  -> portrait   ·  <img> fallback      -> phone

    Max CSS box per band, exported @2x:
      >=1024      740x370  (2:1)   peak 1536px+, container caps at 1530
      768-1023    816x408  (2:1)   peak 846px  <- LARGEST band of the four
      576-767     737x369  (2:1)   peak 767px
      <576        545x307  (16:9)  peak 575px

    The 768-1023 band beats >=1024 because the tile grid is
    `minmax(min(400px,100%),1fr)` with a 32px gap: it stays SINGLE column
    up to ~846px viewport (816 CSS px), then snaps to two columns and
    drops to 405px. So `landscape` must be the biggest file, not `tablet`.

    Tailwind's `sm:` breakpoint is 576px here, which is exactly where the
    box flips 16:9 -> 2:1 — so only `phone` is 16:9.
  */
  "tm-actie": {
    sizes: [
      {
        width: 1480,
        height: 740,
        suffix: "tablet",
        watermarkScale: 1 / 3,
        watermarkMarginPercent: { x: 0.03, y: 0.08 },
      },
      {
        width: 1632,
        height: 816,
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

/*
  Filename normalisation for the /media/wysiwyg/tm/ CMS convention:
  lowercase kebab-case, ASCII only, English, brand-prefixed.

  Off by default so existing presets keep their current output names.
  Flip `enabled` on for the homepage batch. `rename` maps a source
  basename to a semantic English one; keys are the *source* names.
*/
const namingConfig = {
  enabled: false,
  slugify: true,
  brandPrefix: "tuinmaximaal-",
  // Slugs that keep their own brand — decide per case.
  // e.g. "gumax-sliding-doors" to leave it unprefixed.
  noPrefix: [],
  rename: {},
};

/*
  Per-file crop position overrides, keyed by source basename (no extension).

  Beats the preset and the size entry, so a single image can be re-anchored
  without splitting it into its own folder.

  - top:  0 = crop window at the top of the source (subject sits lower in
          the frame), 0.5 = centre, 1 = bottom (subject sits higher)
  - left: 0 = left, 0.5 = centre, 1 = right
*/
const imagePositionOverrides = {
  "veranda-diy-assembly-profiles": { top: 0 },
  "showroom-employee-advising-customer": { top: 0.17 },
  "veranda-glass-sliding-doors-back-garden": { top: 0.75 },
  "veranda-glass-sliding-doors-lawn-overview": { top: 0.85 },
  "veranda-lounge-chair-relaxing-garden": { top: 0.6 },
  "delivery-truck-veranda": { top: 0},
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
  // Voordeelweken campaign. Switch *-28sept.svg ↔ *-7okt.svg when the
  // campaign end date changes. Note the EN badge is named -UK-, not -EN-.
  //
  // The `folder` values must match the locale folder names on disk EXACTLY
  // (case-sensitive, matched against the raw path segments). An unmatched
  // locale gets NO watermark, silently — 01_input/tm-actie uses nl-be,
  // while 01_input/product-images uses nl-nl, so both are listed.
  presets: [
    {
      folder: "nl-nl",
      imagePath:
        "./watermark/2026-08-20-Voordeelweken/2026-08-20-Voordeelweken_RGB-NL-28sept.svg",
    },
    {
      folder: "nl-be",
      imagePath:
        "./watermark/2026-08-20-Voordeelweken/2026-08-20-Voordeelweken_RGB-NL-28sept.svg",
    },
    {
      folder: "de-de",
      imagePath:
        "./watermark/2026-08-20-Voordeelweken/2026-08-20-Voordeelweken_RGB-DE-28sept.svg",
    },
    {
      folder: "en-gb",
      imagePath:
        "./watermark/2026-08-20-Voordeelweken/2026-08-20-Voordeelweken_RGB-UK-28sept.svg",
    },
    {
      folder: "be-fr",
      imagePath:
        "./watermark/2026-08-20-Voordeelweken/2026-08-20-Voordeelweken_RGB-FR-28sept.svg",
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
  namingConfig,
  imagePositionOverrides,
  formatsEnabled,
  folderSizePresets,
  overlayConfig,
  watermarkConfig,
  formats,
  outputConfig,
  compressConfig,
};
