"use strict";

/*
  Google Channable export.

  Run with:  npm run build:channable
  (equivalent to `node crop-and-resize.js --config configs/channable.js`)

  Reads the 20 read-only `Origineel` folders on V: and writes
  google-channable-export/<category>/<source-basename>.<ext>. Inputs are only
  ever read; the run aborts before writing if the output root sits inside an
  input path or if two sources would land on the same output path.

  No watermark, no overlay, no filename normalisation, no dimensions in
  filenames. JPG stays JPG, PNG stays PNG.
*/

const share =
  "V:/Gumax®/02. Beeldbank/02. Renders/01. Webshop afbeeldingen";

// Ordered list of inputs. Discovery is recursive, so folders that nest
// per-size subfolders ("[Standard Classic] Veranda 10x2.5") are covered.
const inputs = [
  // 01. Terrasoverkappingen
  { path: `${share}/01. Terrasoverkappingen/01. Standaard Modern/Origineel`, category: "Veranda Standaard Modern" },
  { path: `${share}/01. Terrasoverkappingen/02. Standaard Klassiek/Origineel`, category: "Veranda Standaard Klassiek" },
  { path: `${share}/01. Terrasoverkappingen/03. Heavy Duty Tijdloos Veranda/Origineel`, category: "Veranda Heavy Duty Tijdloos" },
  { path: `${share}/01. Terrasoverkappingen/04. Heavy Duty Modern Veranda/Origineel`, category: "Veranda Heavy Duty Modern" },
  { path: `${share}/01. Terrasoverkappingen/05. Heavy Duty Authentiek Veranda/Origineel`, category: "Veranda Heavy Duty Authentiek" },
  { path: `${share}/01. Terrasoverkappingen/06. Heavy Duty Eigentijds Veranda/Origineel`, category: "Veranda Heavy Duty Eigentijds" },
  { path: `${share}/01. Terrasoverkappingen/07. Heavy Duty Freestanding Veranda 8°/Origineel`, category: "Veranda Heavy Duty Freestanding" },

  // 02. Schuifwanden
  { path: `${share}/02. Schuifwanden/01. Glazen schuifwand/Origineel`, category: "Glazen schuifwand" },
  { path: `${share}/02. Schuifwanden/02. Shading Panel/Origineel`, category: "Shading Panel" },

  // 03. Zonwering
  { path: `${share}/03. Zonwering/Origineel`, category: "Zonwering" },

  // 04. Verlichting
  { path: `${share}/04. Verlichting/01. Ledspots/Origineel`, category: "Ledspots" },
  { path: `${share}/04. Verlichting/02. Lighting System/Origineel`, category: "Lighting System" },

  // 05. Carport (01 keeps its renders one level deeper, in "Nieuwe map")
  { path: `${share}/05. Carport/01. Standaard Modern Carport/Origineel/Nieuwe map`, category: "Carport Standaard Modern" },
  { path: `${share}/05. Carport/02. Standaard Klassiek Carport/Origineel`, category: "Carport Standaard Klassiek" },
  { path: `${share}/05. Carport/03. Heavy Duty Tijdloos Carport/Origineel`, category: "Carport Heavy Duty Tijdloos" },
  { path: `${share}/05. Carport/04. Heavy Duty Modern Carport/Origineel`, category: "Carport Heavy Duty Modern" },
  { path: `${share}/05. Carport/05. Carport Flat White/Origineel`, category: "Carport Flat White" },
  { path: `${share}/05. Carport/05. Heavy Duty Eigentijds Carport/Origineel`, category: "Carport Heavy Duty Eigentijds" },
  { path: `${share}/05. Carport/06. Heavy Duty Authentiek Carport/Origineel`, category: "Carport Heavy Duty Authentiek" },

  // 06. Bamboo decking (ACC-30000-0001_01 style names: default rule)
  { path: `${share}/06. Bamboo decking/Origineel`, category: "Bamboo decking" },
];

// Only files whose basename starts with one of these are processed. Everything
// else (3m.jpg, *-energielabel.jpg, *-detailfoto.jpg, Thumbs.db, .psd) is
// ignored, never opened, and listed in the run summary.
const skuPrefixes = ["BUN-", "CAR-", "ACC-", "SUN-"];

/*
  Rules: evaluated top to bottom, first match wins. Matchers `startsWith` and
  `endsWith` test the basename without extension; a rule without matchers is
  the default.

  Outputs per rule:
  - width:   exact side for aspect "1:1"; maximum width for aspect "source"
  - aspect:  "1:1" (largest centred square that fits) or "source" (full frame)
  - zoom:    >= 1, divides the crop window (1.25 on a 1080 window gives 864)
  - top/left: anchor of the window, 0 = top/left edge, 0.5 = centre, 1 = other edge
  - upscale: allow enlarging the window to `width` (default false)

  A rule that is fully shadowed by an earlier one is reported at startup.
*/
const rules = [
  // Frame one SKU family differently: put such rules ABOVE the square rule.
  // { startsWith: "BUN-1413081-", endsWith: "-0", aspect: "1:1", width: 1500, upscale: true, zoom: 1.25, top: 0.6, left: 0.5 },

  // Main image per SKU + colour: largest square, scaled to 1500x1500.
  { endsWith: "-0", aspect: "1:1", width: 1500, upscale: true },

  // Everything else: at most 1500 wide at the source ratio, never upscaled.
  { width: 1500 },
];

module.exports = {
  outputDir: "./google-channable-export",
  inputs,
  skuPrefixes,
  rules,
  outputConfig: {
    jpegQuality: 80,
    pngCompressionLevel: 9,
    pngQuality: 90,
    pngDither: 0.8,
  },
};
