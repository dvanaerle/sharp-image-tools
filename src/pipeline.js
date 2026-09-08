"use strict";

const path = require("path");

const overlayCache = new Map();

function getOverlayBuffer(width, height) {
  const key = `${width}x${height}`;
  if (overlayCache.has(key)) {
    return overlayCache.get(key);
  }

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="25%" style="stop-color:black;stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:black;stop-opacity:0" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)" />
    </svg>`,
  );

  overlayCache.set(key, overlay);
  return overlay;
}

function getOutputFormatForSource(filePath, forcedFormat) {
  if (forcedFormat === "jpeg" || forcedFormat === "jpg") return "jpeg";
  if (forcedFormat === "png") return "png";
  return path.extname(filePath).toLowerCase() === ".png" ? "png" : "jpeg";
}

// webp sources are encoded as JPEG (webp output is out of scope), so they
// take the .jpg extension too.
function getExtensionForFormat(outputFormat) {
  return outputFormat === "png" ? "png" : "jpg";
}

// Encodes the pipeline as PNG (palette mode) or JPEG (mozjpeg) using the
// quality settings in `outputConfig`.
function applyOutputFormat(pipeline, outputFormat, outputConfig) {
  if (outputFormat === "png") {
    return pipeline.png({
      compressionLevel: outputConfig.pngCompressionLevel,
      adaptiveFiltering: true,
      palette: true,
      quality: outputConfig.pngQuality,
      dither: outputConfig.pngDither,
      effort: 10,
    });
  }

  // Flatten transparency onto white before JPEG (PNG sources may have alpha).
  return pipeline
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ mozjpeg: true, quality: outputConfig.jpegQuality });
}

module.exports = {
  getOverlayBuffer,
  getOutputFormatForSource,
  getExtensionForFormat,
  applyOutputFormat,
};
