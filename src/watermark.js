"use strict";

const sharp = require("sharp");
const fs = require("fs").promises;
const { isPositiveNumber } = require("./crop-plan");

function getFluidMargin(width, height, marginPercent) {
  const baseSize = Math.min(width, height);

  if (Number.isFinite(marginPercent)) {
    const percent = marginPercent >= 0 ? marginPercent : 0;
    const margin = Math.round(baseSize * percent);
    return {
      left: margin,
      right: margin,
      top: margin,
      bottom: margin,
    };
  }

  const horizontalPercent =
    Number.isFinite(marginPercent?.x) && marginPercent.x >= 0
      ? marginPercent.x
      : 0;
  const verticalPercent =
    Number.isFinite(marginPercent?.y) && marginPercent.y >= 0
      ? marginPercent.y
      : 0;
  return {
    left: Math.round(baseSize * horizontalPercent),
    right: Math.round(baseSize * horizontalPercent),
    top: Math.round(baseSize * verticalPercent),
    bottom: Math.round(baseSize * verticalPercent),
  };
}

function getWatermarkConfigValue({
  folderPreset,
  presetKey,
  activeWatermarkConfig,
  configKey,
}) {
  return folderPreset[presetKey] ?? activeWatermarkConfig[configKey];
}

function getInitialWatermarkWidth({
  imageWidth,
  maxWmWidth,
  activeWatermarkConfig,
  scale,
}) {
  if (activeWatermarkConfig.fixedSize) {
    return maxWmWidth;
  }

  return Math.round(imageWidth * scale);
}

function limitPositiveSize(value, maxValue) {
  if (!isPositiveNumber(maxValue)) {
    return value;
  }

  return Math.min(value, maxValue);
}

function getWatermarkWidthAfterHeightLimit({
  width,
  height,
  limitedHeight,
  aspect,
}) {
  if (limitedHeight === height) {
    return width;
  }

  return Math.round(limitedHeight / aspect);
}

function getWatermarkSize({
  imageWidth,
  watermarkWidth,
  watermarkHeight,
  watermarkConfig: activeWatermarkConfig,
  folderPreset,
  sizeOverrides = {},
}) {
  const maxWmWidth = getWatermarkConfigValue({
    folderPreset,
    presetKey: "watermarkMaxWidth",
    activeWatermarkConfig,
    configKey: "maxWidth",
  });
  const maxWmHeight = getWatermarkConfigValue({
    folderPreset,
    presetKey: "watermarkMaxHeight",
    activeWatermarkConfig,
    configKey: "maxHeight",
  });
  const scale =
    sizeOverrides.watermarkScale ??
    folderPreset.watermarkScale ??
    activeWatermarkConfig.scale;
  const wmAspect = watermarkHeight / watermarkWidth;
  const initialWidth = getInitialWatermarkWidth({
    imageWidth,
    maxWmWidth,
    activeWatermarkConfig,
    scale,
  });
  const heightAfterWidth = Math.round(initialWidth * wmAspect);
  const widthLimitedByMaxWidth = limitPositiveSize(initialWidth, maxWmWidth);
  const heightLimitedByMaxWidth =
    widthLimitedByMaxWidth === initialWidth
      ? heightAfterWidth
      : Math.round(widthLimitedByMaxWidth * wmAspect);
  const height = limitPositiveSize(heightLimitedByMaxWidth, maxWmHeight);
  const width = getWatermarkWidthAfterHeightLimit({
    width: widthLimitedByMaxWidth,
    height: heightLimitedByMaxWidth,
    limitedHeight: height,
    aspect: wmAspect,
  });

  return { width, height };
}

function getWatermarkCoordinates({
  imageWidth,
  imageHeight,
  width,
  height,
  margin,
  position,
}) {
  const positions = {
    "top-left": { left: margin.left, top: margin.top },
    "top-right": {
      left: imageWidth - width - margin.right,
      top: margin.top,
    },
    "bottom-left": {
      left: margin.left,
      top: imageHeight - height - margin.bottom,
    },
    "bottom-right": {
      left: imageWidth - width - margin.right,
      top: imageHeight - height - margin.bottom,
    },
    center: {
      left: (imageWidth - width) / 2,
      top: (imageHeight - height) / 2,
    },
  };
  const coordinates = positions[position] || positions["bottom-right"];

  return {
    left: Math.round(coordinates.left),
    top: Math.round(coordinates.top),
  };
}

function isWatermarkInsideImage({
  imageWidth,
  imageHeight,
  watermarkWidth,
  watermarkHeight,
  left,
  top,
}) {
  return (
    left >= 0 &&
    top >= 0 &&
    left + watermarkWidth <= imageWidth &&
    top + watermarkHeight <= imageHeight
  );
}

function getWatermarkPlacement({
  imageWidth,
  imageHeight,
  watermarkWidth,
  watermarkHeight,
  watermarkConfig: activeWatermarkConfig,
  folderPreset,
  sizeOverrides = {},
}) {
  const { width, height } = getWatermarkSize({
    imageWidth,
    watermarkWidth,
    watermarkHeight,
    watermarkConfig: activeWatermarkConfig,
    folderPreset,
    sizeOverrides,
  });

  if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
    return {
      width,
      height,
      left: 0,
      top: 0,
      valid: false,
      reason: "invalid-size",
    };
  }

  const margin = getFluidMargin(
    imageWidth,
    imageHeight,
    sizeOverrides.watermarkMarginPercent ??
      folderPreset.watermarkMarginPercent ??
      activeWatermarkConfig.marginPercent,
  );
  const { left, top } = getWatermarkCoordinates({
    imageWidth,
    imageHeight,
    width,
    height,
    margin,
    position:
      sizeOverrides.watermarkPosition ||
      folderPreset.watermarkPosition ||
      activeWatermarkConfig.position,
  });
  const valid = isWatermarkInsideImage({
    imageWidth,
    imageHeight,
    watermarkWidth: width,
    watermarkHeight: height,
    left,
    top,
  });

  return {
    width,
    height,
    left,
    top,
    valid,
    ...(valid ? {} : { reason: "placement-out-of-bounds" }),
  };
}

// ---------------------------------------------------------------------------
// Locale lookup, asset loading and rendering (sharp); caches live per renderer
// ---------------------------------------------------------------------------

function getWatermarkPathForImage(dirSegments, watermarkConfig) {
  const preset = Array.isArray(watermarkConfig.presets)
    ? watermarkConfig.presets.find((entry) =>
        dirSegments.includes(entry.folder),
      )
    : null;

  // Preset match wins. Only fall back to imagePath when no presets are configured.
  if (preset?.imagePath) {
    return preset.imagePath;
  }

  if (
    Array.isArray(watermarkConfig.presets) &&
    watermarkConfig.presets.length > 0
  ) {
    return null;
  }

  return watermarkConfig.imagePath || null;
}

function createWatermarkRenderer() {
  const assetCache = new Map();
  const renderCache = new Map();

  async function getAsset(watermarkPath) {
    const cached = assetCache.get(watermarkPath);
    if (cached) {
      return cached;
    }

    const input = await fs.readFile(watermarkPath);
    const metadata = await sharp(input).metadata();
    if (
      !isPositiveNumber(metadata.width) ||
      !isPositiveNumber(metadata.height)
    ) {
      throw new Error(`Invalid watermark dimensions for ${watermarkPath}`);
    }

    const asset = { path: watermarkPath, input, metadata };
    assetCache.set(watermarkPath, asset);
    return asset;
  }

  async function getBuffer(asset, width, height, opacity) {
    const key = `${asset.path}|${width}x${height}|${opacity}`;
    const cached = renderCache.get(key);
    if (cached) {
      return cached;
    }

    const wmBuffer = await sharp(asset.input)
      .resize(width, height)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="white" fill-opacity="${opacity}"/></svg>`,
          ),
          blend: "dest-in",
        },
      ])
      .toBuffer();

    renderCache.set(key, wmBuffer);
    return wmBuffer;
  }

  return { getAsset, getBuffer };
}

module.exports = {
  getFluidMargin,
  getWatermarkSize,
  getWatermarkCoordinates,
  getWatermarkPlacement,
  getWatermarkPathForImage,
  createWatermarkRenderer,
};
