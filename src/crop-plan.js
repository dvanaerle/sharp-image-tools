"use strict";

const path = require("path");

function getCoverResize(srcWidth, srcHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
  return {
    width: Math.ceil(srcWidth * scale),
    height: Math.ceil(srcHeight * scale),
  };
}

function isCropWithinBounds({
  offsetX,
  offsetY,
  width,
  height,
  targetResizeWidth,
  targetResizeHeight,
}) {
  return (
    offsetX >= 0 &&
    offsetY >= 0 &&
    offsetX + width <= targetResizeWidth &&
    offsetY + height <= targetResizeHeight
  );
}

function createResizeCropPlan({
  srcWidth,
  srcHeight,
  width,
  height,
  resizeWidth,
  resizeHeight,
  top,
  left,
}) {
  const { width: targetResizeWidth, height: targetResizeHeight } =
    Number.isFinite(resizeWidth) && Number.isFinite(resizeHeight)
      ? { width: resizeWidth, height: resizeHeight }
      : getCoverResize(srcWidth, srcHeight, width, height);
  const offsetX = Math.round((targetResizeWidth - width) * left);
  const offsetY = Math.round((targetResizeHeight - height) * top);

  return {
    targetResizeWidth,
    targetResizeHeight,
    offsetX,
    offsetY,
    valid: isCropWithinBounds({
      offsetX,
      offsetY,
      width,
      height,
      targetResizeWidth,
      targetResizeHeight,
    }),
  };
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

/*
  Expand a size entry by optional `scales` (e.g. [1, 2, 3]).

  Base width/height are the 1x CSS/display size. Each scale multiplies
  width, height, and any resizeWidth/resizeHeight. When `scales` is set,
  filenames get `@1x` / `@2x` / … (combined with an existing suffix as
  `tablet@2x`). Omitting `scales` keeps a single unscaled output (no @Nx).
*/
function expandSizeByScales(size, logger = console) {
  const hasExplicitScales =
    Array.isArray(size.scales) && size.scales.length > 0;
  const scales = hasExplicitScales ? size.scales : [1];

  return scales.flatMap((scale) => {
    if (!isPositiveNumber(scale)) {
      logger.warn(`  Skipping invalid scale: ${scale}`);
      return [];
    }

    const { scales: _ignored, ...rest } = size;
    const scaled = {
      ...rest,
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale),
    };

    if (Number.isFinite(size.resizeWidth)) {
      scaled.resizeWidth = Math.round(size.resizeWidth * scale);
    }
    if (Number.isFinite(size.resizeHeight)) {
      scaled.resizeHeight = Math.round(size.resizeHeight * scale);
    }
    if (
      size.blurReferenceSize &&
      Number.isFinite(size.blurReferenceSize.width) &&
      Number.isFinite(size.blurReferenceSize.height)
    ) {
      scaled.blurReferenceSize = {
        width: Math.round(size.blurReferenceSize.width * scale),
        height: Math.round(size.blurReferenceSize.height * scale),
      };
    }

    if (hasExplicitScales) {
      const scaleSuffix = `@${scale}x`;
      scaled.suffix = size.suffix
        ? `${size.suffix}${scaleSuffix}`
        : scaleSuffix;
    }

    return [scaled];
  });
}

function createCanvasPlan({ canvasWidth, canvasHeight, canvas }) {
  const imageWidth = Math.min(canvas.imageWidth, canvasWidth);
  const imageHeight = Math.min(canvas.imageHeight, canvasHeight);
  const horizontal = canvasWidth - imageWidth;
  const vertical = canvasHeight - imageHeight;
  const left = Math.floor(horizontal / 2);
  const top = Math.floor(vertical / 2);

  return {
    imageWidth,
    imageHeight,
    fit: canvas.fit === "fill" ? "fill" : "contain",
    background: canvas.background || { r: 255, g: 255, b: 255, alpha: 1 },
    extend: {
      left,
      right: horizontal - left,
      top,
      bottom: vertical - top,
    },
  };
}

// Prefer the auto-oriented dimensions when sharp reports them, so EXIF
// rotated photos are planned at the size they will actually be rendered.
function getOrientedDimensions(metadata) {
  const oriented = metadata.autoOrient;
  return {
    width: oriented?.width ?? metadata.width,
    height: oriented?.height ?? metadata.height,
  };
}

/*
  Resolve which formats apply to an image, based on the folder it sits in.

  Preset lookup takes the FIRST key in `folderSizePresets` that appears
  anywhere in the image's path (case-insensitive), not the deepest folder.
  The inputDir folder name itself is matched too. Needed when inputDir points
  directly at a preset folder (e.g. ./01_input/showrooms), where images sit
  at the root and have no relative path segments.
*/
function getActiveFormatsForDirectory({
  inputDir,
  dirSegmentsLower,
  srcWidth,
  srcHeight,
  folderSizePresets,
  formatsEnabled,
  formats,
}) {
  const inputFolderName = path.basename(path.resolve(inputDir)).toLowerCase();
  const matchSegments = [inputFolderName, ...dirSegmentsLower];
  const folderPresetKey = Object.keys(folderSizePresets).find((key) =>
    matchSegments.includes(key.toLowerCase()),
  );
  const folderPreset = folderSizePresets[folderPresetKey];

  if (folderPreset) {
    return {
      folderPresetKey,
      formats: [
        {
          sizes: folderPreset.sizes ?? [
            {
              width: folderPreset.width,
              height: folderPreset.height,
            },
          ],
          top: folderPreset.top ?? 0.5,
          left: folderPreset.left ?? 0.5,
        },
      ],
    };
  }

  return {
    folderPresetKey,
    formats: formatsEnabled
      ? formats
      : [
          {
            sizes: [{ width: srcWidth, height: srcHeight }],
            resizeWidth: srcWidth,
            resizeHeight: srcHeight,
            top: 0,
            left: 0,
          },
        ],
  };
}

module.exports = {
  isPositiveNumber,
  getCoverResize,
  createResizeCropPlan,
  createCanvasPlan,
  getOrientedDimensions,
  expandSizeByScales,
  getActiveFormatsForDirectory,
};
