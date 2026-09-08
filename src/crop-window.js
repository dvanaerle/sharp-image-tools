"use strict";

/*
  Crop window ("viewbox") for a rule-based output.

  1. Start with the largest box of the target aspect that fits the source:
     `1:1` gives min(w, h) square, `source` gives the full frame.
  2. `zoom` (>= 1) divides both window dimensions.
  3. `top` / `left` anchor the window in the source (0 edge, 0.5 centre,
     1 opposite edge).
  4. Output: `1:1` scales to width x width; `source` scales to at most
     `width` wide at the window's ratio. Upscaling only when `upscale`.
*/
function createCropWindow({ srcWidth, srcHeight, rule }) {
  const aspect = rule.aspect ?? "source";
  const zoom = rule.zoom ?? 1;
  const anchorTop = rule.top ?? 0.5;
  const anchorLeft = rule.left ?? 0.5;
  const upscale = rule.upscale === true;

  let width = srcWidth;
  let height = srcHeight;
  if (aspect === "1:1") {
    width = height = Math.min(srcWidth, srcHeight);
  }
  width = Math.max(1, Math.round(width / zoom));
  height = Math.max(1, Math.round(height / zoom));

  const left = Math.round((srcWidth - width) * anchorLeft);
  const top = Math.round((srcHeight - height) * anchorTop);

  let outputWidth;
  let outputHeight;
  if (aspect === "1:1") {
    outputWidth = outputHeight = upscale ? rule.width : Math.min(rule.width, width);
  } else {
    outputWidth = upscale ? rule.width : Math.min(rule.width, width);
    outputHeight = Math.max(1, Math.round((outputWidth * height) / width));
  }

  return { left, top, width, height, outputWidth, outputHeight };
}

module.exports = { createCropWindow };
