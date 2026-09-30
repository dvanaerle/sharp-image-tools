"use strict";

/*
  /slot-schuifwand — the Magezon `single_image` slots inside <main>.
  Live measure of https://tuinmaximaalnl.intern.systems/slot-schuifwand,
  320 -> 2560px, dpr=1, Sep 2026.

  Run with:
    node crop-and-resize.js --config configs/slot-schuifwand.js

  SOURCE — `Origineel`, not `Gecomprimeerd`.
    Gecomprimeerd is 640x360 for all 54 files, so it cannot fill the
    1436px slots without a ~2.2x upscale. Origineel is 1920x1080 and
    downscales into every size below. The outputs are still compressed:
    outputConfig.jpegQuality is 75, same as the rest of the repo.
    To batch the small files instead, point inputDir at `/Gecomprimeerd`
    — noUpscale below will then shrink the boxes rather than invent pixels.

  SLOTS MEASURED (all object-fit: COVER, so CSS centre-crops whatever we
  give it — the export ratio has to match the box or the browser trims it):

    thumb   140x124 CSS, two of them (`self-stretch` cards, the height is
            driven by the sibling text). Identical at 390 and 2560px.
            -> 280x158, exported 16:9 by request, NOT @2x of the box.
            The card is object-fit: cover, so a 16:9 file gets centre-
            cropped back to 140x124 in the browser: it scales to 220x124
            and loses the sides, landing at ~1.6x rather than 2x. Fine at
            this size, and it keeps every asset on one ratio. If the card
            is ever changed to a 16:9 box this becomes an exact 2x.
    3x2     718x479 CSS, container is `aspect-3/2`. Caps at 718 — 1920 and
            2560 measure the same. -> 1436x958 @2x
    16x9    718x404 CSS, container is `aspect-16/9`. Same 718 cap.
            -> 1436x808 @2x  (the page's own width/height attribute says
            1436x776, which is NOT 16:9 and would get cropped again)

  CROP NOTE: every source is 16:9, so both the thumb and the 16x9 size
  are pure downscales with zero crop. Only the 3x2 size crops, trimming
  ~11% off the sides, centred — which suits these centred product
  renders. Add entries to imagePositionOverrides to re-anchor a stray one.

  QUALITY: jpegQuality 75. Measured against 80 on a sample of 8 masters,
  80 costs ~19% more bytes on the 1436px sizes (108 -> 130 KB) for no
  visible gain on flat-lit renders over a plain background.

  No watermark: these are loose-part (ACC-*) renders for a spec page, not
  campaign assets.
*/

const inputDir =
  "V:/Gumax®/02. Beeldbank/02. Renders/01. Webshop afbeeldingen/09. Losse onderdelen/Slot schuifwand/Origineel";

const outputDir = "./02_output/Slot schuifwand";

const slotSchuifwand = {
  // The 1920x1080 masters clear every box below, so this never fires
  // today. It is the guard that keeps a Gecomprimeerd run honest.
  noUpscale: true,
  noWatermark: true,
  sizes: [
    { width: 280, height: 158, suffix: "thumb" },
    { width: 1436, height: 958, suffix: "3x2" },
    { width: 1436, height: 808, suffix: "16x9" },
  ],
};

/*
  Keyed on the SOURCE folder name, not "Slot schuifwand". Preset lookup
  matches the basename of inputDir plus each subfolder segment below it —
  and inputDir's basename here is "Origineel", so "Slot schuifwand" (its
  parent) is never in the candidate list. Both source folders map to the
  same preset so flipping inputDir is a one-line change.
*/
const folderSizePresets = {
  "Origineel": slotSchuifwand,
  "Gecomprimeerd": slotSchuifwand,
};

module.exports = {
  inputDir,
  outputDir,
  includeDimensionsInFileName: false,
  formatsEnabled: false,
  formats: [],
  folderSizePresets,
  namingConfig: { enabled: false },
  imagePositionOverrides: {},
  overlayConfig: { enabled: false },
  watermarkConfig: { enabled: false },
  outputConfig: {
    jpegQuality: 75,
    pngCompressionLevel: 9,
    pngQuality: 90,
    pngDither: 0.8,
  },
};
