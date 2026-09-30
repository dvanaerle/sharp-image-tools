"use strict";

const sharp = require("sharp");

/*
  Where the product sits in a render.

  The products are white or anthracite aluminium structures with translucent
  roof panels, photographed against a garden scene. The roof slab is the
  widest part and the only large region that is bright, almost colourless and
  smooth, so it is found by thresholding on saturation and brightness, cleaning
  the mask up, and taking the largest connected region that does not run off
  the bottom of the frame (the ground plane does, the roof never does).

  This is a heuristic and it is wrong on some renders: scenes with a big
  cream-coloured wall or a sunlit driveway can beat the roof. It is therefore
  used per source folder rather than per file: the colour variants in a size
  folder share one scene and one geometry, so the median of the plausible
  detections is far steadier than any single one, and a folder whose detections
  disagree is reported rather than trusted. Anything still wrong is corrected
  by hand through `fitOverrides` in the config.
*/

const DETECT_WIDTH = 480;
const DETECT_HEIGHT = 270;

const DEFAULTS = {
  // Roof aluminium and panels in daylight: nearly colourless and bright.
  saturation: 0.09,
  luminance: 190,
  // Part of the roof is usually in the shadow of the house, down around 100,
  // which is dimmer than the sunlit wall next to it. A lower global threshold
  // would take the wall first, so the dim part is reached by growing out from
  // the bright part instead: only pixels connected to a confident seed join.
  weakSaturation: 0.16,
  weakLuminance: 85,
  // Closing bridges the dark frame lines between roof panels, opening then
  // removes paving grout and foliage speckle.
  close: 2,
  open: 2,
  // A region that reaches this close to the bottom edge is ground, not roof.
  bottomSlack: 8,
  // Plausibility of a single detection.
  minFill: 0.05,
  minWidth: 0.3,
  maxWidth: 0.99,
  minHeight: 0.05,
  minRatio: 0.9,
  maxTop: 0.2,
  // A roof slab sits above its posts, so it never reaches the bottom of the
  // frame. Without this a sunlit driveway, which connects to the roof through
  // the posts, gets swallowed into the same region.
  maxBottom: 0.75,
  // A roof slab fills its own bounding box solidly. A region that has reached
  // across a thin bridge into another bright structure does not, so this is
  // what stops the growth step running off into a neighbouring canopy.
  minDensity: 0.42,
};

function threshold(pixels, saturation, luminance) {
  const mask = new Uint8Array(DETECT_WIDTH * DETECT_HEIGHT);
  for (let p = 0; p < mask.length; p += 1) {
    const r = pixels[p * 3];
    const g = pixels[p * 3 + 1];
    const b = pixels[p * 3 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > luminance && (max === 0 ? 0 : (max - min) / max) < saturation) {
      mask[p] = 1;
    }
  }
  return mask;
}

/*
  Hysteresis: every `weak` pixel reachable from a `seed` pixel through other
  weak pixels joins the result. This is what carries the detection across the
  shadow line on a roof without also taking in the sunlit wall behind it,
  which is just as colourless and brighter but not connected to a seed.
*/
function grow(seeds, weak) {
  const out = new Uint8Array(seeds.length);
  const queue = new Int32Array(seeds.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < seeds.length; i += 1) {
    if (seeds[i] && weak[i]) {
      out[i] = 1;
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % DETECT_WIDTH;
    const y = (index - x) / DETECT_WIDTH;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= DETECT_WIDTH || ny < 0 || ny >= DETECT_HEIGHT) continue;
      const next = ny * DETECT_WIDTH + nx;
      if (weak[next] && !out[next]) {
        out[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }
  }
  return out;
}

// One 3x3 pass. "erode" keeps a pixel only when its whole neighbourhood is
// set, "dilate" sets it when any neighbour is.
function morphPass(src, op) {
  const dst = new Uint8Array(src.length);
  for (let y = 0; y < DETECT_HEIGHT; y += 1) {
    for (let x = 0; x < DETECT_WIDTH; x += 1) {
      let on = 0;
      let total = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= DETECT_HEIGHT || nx < 0 || nx >= DETECT_WIDTH) continue;
          total += 1;
          if (src[ny * DETECT_WIDTH + nx]) on += 1;
        }
      }
      dst[y * DETECT_WIDTH + x] = op === "erode" ? (on === total ? 1 : 0) : on > 0 ? 1 : 0;
    }
  }
  return dst;
}

function morph(mask, op, passes) {
  let current = mask;
  for (let i = 0; i < passes; i += 1) current = morphPass(current, op);
  return current;
}

// Bounding boxes and pixel counts of the connected regions, largest first.
function regions(mask) {
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const found = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    let x0 = DETECT_WIDTH;
    let x1 = -1;
    let y0 = DETECT_HEIGHT;
    let y1 = -1;
    queue[tail] = start;
    tail += 1;
    seen[start] = 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % DETECT_WIDTH;
      const y = (index - x) / DETECT_WIDTH;
      size += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= DETECT_WIDTH || ny < 0 || ny >= DETECT_HEIGHT) continue;
        const next = ny * DETECT_WIDTH + nx;
        if (mask[next] && !seen[next]) {
          seen[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    found.push({ size, x0, x1, y0, y1 });
  }
  return found.sort((a, b) => b.size - a.size);
}

// A detection is plausible when it looks like a roof slab: a decent slab of
// pixels, wider than it is tall, high in the frame, not the whole frame.
function isPlausibleBox(box, options = {}) {
  if (!box) return false;
  const {
    minFill,
    minWidth,
    maxWidth,
    minHeight,
    minRatio,
    maxTop,
    maxBottom,
    minDensity,
  } = { ...DEFAULTS, ...options };
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  if (height <= 0 || width <= 0) return false;
  return (
    box.fill / (width * height) >= minDensity &&
    box.fill >= minFill &&
    width >= minWidth &&
    width <= maxWidth &&
    height >= minHeight &&
    width / height >= minRatio &&
    box.y0 <= maxTop &&
    box.y1 <= maxBottom
  );
}

// Box as fractions of the frame, so it applies to HD and 4K sources alike.
async function detectProductBox(filePath, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const pixels = await sharp(filePath)
    .resize(DETECT_WIDTH, DETECT_HEIGHT, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();

  let seeds = threshold(pixels, settings.saturation, settings.luminance);
  if (settings.close > 0) {
    seeds = morph(morph(seeds, "dilate", settings.close), "erode", settings.close);
  }
  if (settings.open > 0) {
    seeds = morph(morph(seeds, "erode", settings.open), "dilate", settings.open);
  }

  const usable = (mask) => {
    const candidates = regions(mask).filter(
      (region) => region.y1 < DETECT_HEIGHT - 1 - settings.bottomSlack,
    );
    return candidates[0] ?? null;
  };

  const seeded = usable(seeds);
  if (seeded === null) return null;

  // Grow only from the region we settled on, so a bright patch elsewhere in
  // the scene cannot drag the box out with it. If growing produces something
  // implausible, typically by leaking into a sunlit driveway, keep the seed.
  const seedOnly = new Uint8Array(seeds.length);
  for (let y = seeded.y0; y <= seeded.y1; y += 1) {
    for (let x = seeded.x0; x <= seeded.x1; x += 1) {
      const index = y * DETECT_WIDTH + x;
      if (seeds[index]) seedOnly[index] = 1;
    }
  }
  const weak = threshold(pixels, settings.weakSaturation, settings.weakLuminance);
  const grown = usable(grow(seedOnly, weak));

  const toBox = (region) => ({
    x0: region.x0 / DETECT_WIDTH,
    x1: (region.x1 + 1) / DETECT_WIDTH,
    y0: region.y0 / DETECT_HEIGHT,
    y1: (region.y1 + 1) / DETECT_HEIGHT,
    fill: region.size / (DETECT_WIDTH * DETECT_HEIGHT),
  });

  const grownBox = grown === null ? null : toBox(grown);
  return grownBox !== null && isPlausibleBox(grownBox, options)
    ? grownBox
    : toBox(seeded);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/*
  One box for a group of renders that share a scene. Implausible detections
  are dropped first, then each edge is the median of the rest, so a single bad
  frame cannot move the box. Returns null when nothing plausible was found.
*/
function consensusBox(boxes) {
  const usable = boxes.filter((box) => isPlausibleBox(box));
  if (usable.length === 0) return null;
  return {
    x0: median(usable.map((box) => box.x0)),
    x1: median(usable.map((box) => box.x1)),
    y0: median(usable.map((box) => box.y0)),
    y1: median(usable.map((box) => box.y1)),
    agreed: usable.length,
    of: boxes.length,
  };
}

module.exports = {
  DEFAULTS,
  DETECT_WIDTH,
  DETECT_HEIGHT,
  detectProductBox,
  isPlausibleBox,
  consensusBox,
  median,
};
