"use strict";

const { parseAspect } = require("./crop-window");

/*
  Picks the output format for a detected product.

  A square is what Google Shopping wants, so the ladder is tried tightest
  first: the first aspect whose full-height window is wide enough to hold the
  whole product wins, and the window is then slid sideways so the product sits
  in the middle of it. A 3x2.5 carport fits 1:1 once the square stops being
  centred on the frame; a 12x4 one does not fit any square, so it steps out to
  a wider format rather than losing its roof ends.

  Nothing is added and nothing is stretched: the result is always a plain crop
  of the source. When no rung is wide enough the full frame is used. `square`
  says whether the output kept the 1:1 Google Shopping prefers, and the run
  reports how many images had to leave it.
*/

const DEFAULT_LADDER = ["1:1", "5:4", "4:3", "3:2", "16:9"];
const DEFAULT_MARGIN = 0;

// Fraction of the free space that puts a window of `width` with its centre on
// `centre`, clamped so the window stays inside the frame. Matches the
// top/left anchor convention: 0 is flush left, 0.5 centred, 1 flush right.
function anchorFor(centre, width, frameWidth) {
  const free = frameWidth - width;
  if (free <= 0) return 0.5;
  const left = Math.min(Math.max(0, centre - width / 2), free);
  return left / free;
}

/*
  Returns the rule fields that frame `box` (fractions of the frame) inside
  `srcWidth` x `srcHeight`: the chosen `aspect` and `left` anchor, plus
  `ratio`, `fits` and the width the product actually needed, for reporting.
*/
function planFit(box, srcWidth, srcHeight, options = {}) {
  const ladder = options.ladder ?? DEFAULT_LADDER;
  const margin = options.margin ?? DEFAULT_MARGIN;

  const productLeft = Math.max(0, box.x0 * srcWidth);
  const productRight = Math.min(srcWidth, box.x1 * srcWidth);
  const productWidth = productRight - productLeft;

  // Breathing space is opt-in and off by default, because asking for it can
  // push a product that would just fit a square into a wider format. Raise it
  // only if the detected box is running tight against real product edges.
  const marginPx = margin * srcWidth;
  const wanted = Math.min(srcWidth, productWidth + 2 * marginPx);
  const centre = (productLeft + productRight) / 2;

  const chosen =
    ladder
      .map((aspect) => ({ aspect, ratio: parseAspect(aspect) }))
      .filter(({ ratio }) => ratio !== null)
      .find(({ ratio }) => Math.min(srcWidth, Math.round(srcHeight * ratio)) >= wanted) ??
    null;

  const aspect = chosen?.aspect ?? "source";
  const ratio = chosen?.ratio ?? srcWidth / srcHeight;
  const windowWidth = chosen
    ? Math.min(srcWidth, Math.round(srcHeight * ratio))
    : srcWidth;

  return {
    aspect,
    ratio,
    left: anchorFor(centre, windowWidth, srcWidth),
    top: 0.5,
    productWidth,
    wanted,
    windowWidth,
    square: aspect === "1:1",
    fullFrame: chosen === null,
  };
}

module.exports = { DEFAULT_LADDER, DEFAULT_MARGIN, planFit, anchorFor };
