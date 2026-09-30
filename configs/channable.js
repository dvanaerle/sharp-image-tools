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
  `endsWith` test the basename without extension, `category` matches the input
  entry's category label case-insensitively as a substring; a rule without
  matchers is the default.

  Outputs per rule:
  - width:   width of the output file
  - aspect:  "source" (full frame) or a "w:h" crop window, e.g. "1:1", "4:3"
  - fit:     "product" to choose the aspect and horizontal anchor per product
             instead of using the two above (see below); "none" by default
  - ladder:  aspects `fit: "product"` may choose from, tightest first
  - fitMargin: optional breathing space around the product, as a fraction of
             the frame width (default 0, since asking for space can push a
             product that would just fit a square into a wider format)
  - zoom:    >= 1, divides the crop window (1.25 on a 1080 window gives 864)
  - top/left: anchor of the window, 0 = top/left edge, 0.5 = centre, 1 = other edge
  - upscale: allow enlarging the window to fill the output (default false)

  Every output is a plain crop of the source: nothing is ever padded, barred,
  stretched or otherwise altered.

  A rule that is fully shadowed by an earlier one is reported at startup.

  Why the main image is fitted rather than cropped square. A square is what
  Google Shopping wants, and the largest square that fits an HD frame is
  1080 of its 1920 px. Most products fit that easily, but only once the square
  stops being centred on the frame: a 3x2.5 carport is about 1045 px wide and
  sits left of centre, so a centred crop clips its roof while an offset one
  holds it whole. The widest products (a 12x4 carport needs about 1514 px, a
  9x4 veranda about 1630 px) fit no square at all, so those step out to the
  next format up the ladder rather than losing their roof ends.

  `fit: "product"` finds the product per source folder: the colour variants in
  a size folder share one scene and one geometry, so the box is the median of
  the plausible detections across them, which is far steadier than detecting
  per file. The detector is a heuristic and misses some scenes - a large
  cream-coloured wall or a sunlit driveway can beat the roof - so review the
  result per category and correct what is wrong through `fitOverrides` below:

      npm run sheet -- "google-channable-export/<category>" --name -0

  Folders where nothing plausible was found are named in a startup warning and
  keep the rule's own framing.
*/
const rules = [
  // Main image per SKU and colour: the tightest format that holds the whole
  // product, anchored so the product sits in the middle of it.
  {
    endsWith: "-0",
    fit: "product",
    ladder: ["1:1", "5:4", "4:3", "3:2", "16:9"],
    width: 1500,
    upscale: true,
  },

  // Everything else: at most 1500 wide at the source ratio, never upscaled.
  { width: 1500 },
];

/*
  Hand corrections for the rule above, matched against the source path by
  case-insensitive substring, first match winning. The size folder name is the
  useful handle, since one entry then covers every colour variant of that
  product. Set `aspect` to force the output format, `left` to move the window
  (0 flush left, 0.5 centred, 1 flush right), or both.

  Write the match with a trailing slash to pin it to one folder: "Carport 11x3"
  on its own would also match "Carport 11x3.5". Separators are normalised, so
  forward slashes work against the backslash paths on V:.

  To work out the numbers for a folder the detector gets wrong, run the export
  with `--report`, build a sheet of the category, and read off the window from
  the dry-run plan line of a folder of the same product width that came out
  right.
*/
const fitOverrides = [
  // Detection merges the roof with the pale garage wall behind it in these
  // two, so they fall back to the full frame. The carport spans 203..1451 px
  // of the 1920 px frame, which 5:4 holds when anchored at 0.267.
  { match: "Carport 11x2.5/", aspect: "5:4", left: 0.267 },
  { match: "Carport 11x3/", aspect: "5:4", left: 0.267 },

  // Here the roof runs straight into the neighbouring garage canopy, which is
  // just as bright and just as solid, so detection reads the two as one and
  // frames wider than it needs to. The carport itself spans 211..1344 px.
  { match: "Carport 5x2.5/", aspect: "5:4", left: 0.179 },
  { match: "Carport 5x3/", aspect: "5:4", left: 0.179 },
];

module.exports = {
  outputDir: "./google-channable-export",
  inputs,
  skuPrefixes,
  rules,
  fitOverrides,
  outputConfig: {
    jpegQuality: 80,
    pngCompressionLevel: 9,
    pngQuality: 90,
    pngDither: 0.8,
  },
};
