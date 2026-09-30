"use strict";

/*
  Crop window ("viewbox") for a rule-based output.

  1. Start with the largest box of the target aspect that fits the source:
     `source` gives the full frame, `"w:h"` gives the largest box of that
     ratio (`"1:1"` is min(w, h) square).
  2. `zoom` (>= 1) divides both window dimensions.
  3. `top` / `left` anchor the window in the source (0 edge, 0.5 centre,
     1 opposite edge).
  4. The window scales to at most `width` wide at its own ratio, so the output
     is always a plain crop of the source: nothing is added, padded or
     stretched. Upscaling past the window's own size only happens when
     `upscale` is set.
*/

// "w:h" -> w / h. `source` (and anything absent) -> null, meaning "keep the
// frame as it is".
function parseAspect(aspect) {
  if (aspect === undefined || aspect === null || aspect === "source") return null;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect).trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return width / height;
}

function isAspect(aspect) {
  return aspect === "source" || parseAspect(aspect) !== null;
}

function createCropWindow({ srcWidth, srcHeight, rule }) {
  const ratio = parseAspect(rule.aspect);
  const zoom = rule.zoom ?? 1;
  const anchorTop = rule.top ?? 0.5;
  const anchorLeft = rule.left ?? 0.5;
  const upscale = rule.upscale === true;

  let width = srcWidth;
  let height = srcHeight;
  if (ratio !== null) {
    if (srcWidth / srcHeight > ratio) {
      height = srcHeight;
      width = srcHeight * ratio;
    } else {
      width = srcWidth;
      height = srcWidth / ratio;
    }
  }
  width = Math.max(1, Math.round(width / zoom));
  height = Math.max(1, Math.round(height / zoom));

  const left = Math.round((srcWidth - width) * anchorLeft);
  const top = Math.round((srcHeight - height) * anchorTop);

  const outputWidth = upscale ? rule.width : Math.min(rule.width, width);
  const outputHeight =
    ratio !== null
      ? Math.max(1, Math.round(outputWidth / ratio))
      : Math.max(1, Math.round((outputWidth * height) / width));

  return { left, top, width, height, outputWidth, outputHeight };
}

module.exports = { createCropWindow, parseAspect, isAspect };
