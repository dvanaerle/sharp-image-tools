"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;

const inputDir = "./01_input";
const outputDir = "./02_output";
const includeDimensionsInFileName = true;
const formatsEnabled = true;

/*
folderSizePresets usage:

{
  "tm-showrooms": {
    sizes: [
      { width: 1200, height: 800 },
      { width: 384, height: 216 },
    ],
    top: 0.5,
    left: 0.5,
  },
  category: {
    width: 1531,
    height: 1010,
    watermarkPosition: "top-right",
    watermarkMarginPercent: { x: 0.05, y: 0.045 },
    watermarkMaxWidth: 576,
    watermarkMaxHeight: 576,
  },
}
*/
const folderSizePresets = {
  "tm-showrooms": {
    sizes: [
      { width: 1200, height: 800 },
      { width: 384, height: 216 },
    ],
  },
};

/*
overlayConfig usage:

{
  enabled: true,
}
*/
const overlayConfig = {
  enabled: false,
};

/*
watermarkConfig usage:

{
  enabled: true,
  imagePath: "./watermark/Gumax_Logo_SVG_White.svg",
  presets: [
    {
      folder: "DE",
      imagePath: "./watermark/watermark_DE.svg",
    },
  ],
  position: "bottom-left",
  opacity: 0.8,
  marginPercent: { x: 0.05, y: 0.045 },
  scale: 0.125,
  fixedSize: false,
  maxWidth: 512,
  maxHeight: 512,
}
*/
const watermarkConfig = {
  enabled: false,
  imagePath: "./watermark/Gumax_Logo_SVG_White.svg",
  position: "bottom-left",
  opacity: 0.8,
  marginPercent: { x: 0.05, y: 0.045 },
  scale: 0.125,
  fixedSize: false,
};

/*
formats usage:

[
  {
    sizes: [
      { width: 1200, height: 800 },
      { width: 384, height: 216 },
    ],
    top: 0.5,
    left: 0.5,
    blurSigma: 0,
    blurReferenceSize: { width: 1080, height: 608 },
    resizeWidth: 3500,
    resizeHeight: 1750,
  },
]
*/
const formats = [
  {
    sizes: [
      {
        width: 1366,
        height: 768,
      },
      {
        width: 1366,
        height: 768,
      },
    ],
    top: 0.5,
    left: 0.5,
  },
];

const watermarkAssetCache = new Map();
const watermarkRenderCache = new Map();
const overlayCache = new Map();

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

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

function getOrientedDimensions(metadata) {
  const oriented = metadata.autoOrient;
  return {
    width: oriented?.width ?? metadata.width,
    height: oriented?.height ?? metadata.height,
  };
}

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

function getWatermarkPathForImage(dirSegments) {
  const preset = Array.isArray(watermarkConfig.presets)
    ? watermarkConfig.presets.find((entry) =>
        dirSegments.includes(entry.folder),
      )
    : null;
  return preset?.imagePath || watermarkConfig.imagePath;
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
}) {
  if (activeWatermarkConfig.fixedSize) {
    return maxWmWidth;
  }

  return Math.round(imageWidth * activeWatermarkConfig.scale);
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
  const wmAspect = watermarkHeight / watermarkWidth;
  const initialWidth = getInitialWatermarkWidth({
    imageWidth,
    maxWmWidth,
    activeWatermarkConfig,
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
}) {
  const { width, height } = getWatermarkSize({
    imageWidth,
    watermarkWidth,
    watermarkHeight,
    watermarkConfig: activeWatermarkConfig,
    folderPreset,
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
    folderPreset.watermarkMarginPercent ?? activeWatermarkConfig.marginPercent,
  );
  const { left, top } = getWatermarkCoordinates({
    imageWidth,
    imageHeight,
    width,
    height,
    margin,
    position: folderPreset.watermarkPosition || activeWatermarkConfig.position,
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

async function getWatermarkAsset(watermarkPath) {
  const cached = watermarkAssetCache.get(watermarkPath);
  if (cached) {
    return cached;
  }

  const input = await fs.readFile(watermarkPath);
  const metadata = await sharp(input).metadata();
  if (!isPositiveNumber(metadata.width) || !isPositiveNumber(metadata.height)) {
    throw new Error(`Invalid watermark dimensions for ${watermarkPath}`);
  }

  const asset = { path: watermarkPath, input, metadata };
  watermarkAssetCache.set(watermarkPath, asset);
  return asset;
}

async function getWatermarkBuffer(asset, width, height, opacity) {
  const key = `${asset.path}|${width}x${height}|${opacity}`;
  const cached = watermarkRenderCache.get(key);
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

  watermarkRenderCache.set(key, wmBuffer);
  return wmBuffer;
}

async function getImageFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return getImageFiles(fullPath);
      }
      if (entry.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
        return fullPath;
      }
      return [];
    }),
  );
  return files.flat();
}

function getImageContext({ inputDir, imageFile }) {
  const relativePath = path.relative(inputDir, imageFile);
  const relativeDir = path.dirname(relativePath);
  const dirSegments = relativeDir === "." ? [] : relativeDir.split(path.sep);

  return {
    srcImage: imageFile,
    relativePath,
    baseName: path.parse(relativePath).name,
    relativeDir,
    dirSegments,
    dirSegmentsLower: dirSegments.map((segment) => segment.toLowerCase()),
  };
}

function getOutputFormatForSource(filePath) {
  return path.extname(filePath).toLowerCase() === ".png" ? "png" : "jpeg";
}

function getOutputFileName({
  baseName,
  width,
  height,
  includeDimensions,
  outputFormat,
}) {
  const extension = outputFormat === "png" ? "png" : "jpg";
  if (!includeDimensions) {
    return `${baseName}.${extension}`;
  }
  return `${baseName}-${width}x${height}.${extension}`;
}

function applyOutputFormat(pipeline, outputFormat) {
  if (outputFormat === "png") {
    return pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
      effort: 10,
    });
  }

  return pipeline.jpeg({ mozjpeg: true, quality: 75 });
}

function getActiveFormatsForDirectory({
  dirSegmentsLower,
  srcWidth,
  srcHeight,
}) {
  const folderPresetKey = Object.keys(folderSizePresets).find((key) =>
    dirSegmentsLower.includes(key),
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

async function processImages() {
  const imageFiles = await getImageFiles(inputDir);

  console.log(`Found ${imageFiles.length} image(s) to process`);

  for (const imageFile of imageFiles) {
    const {
      srcImage,
      relativePath,
      baseName,
      relativeDir,
      dirSegments,
      dirSegmentsLower,
    } = getImageContext({ inputDir, imageFile });

    console.log(`\nProcessing: ${relativePath}`);

    try {
      const srcMetadata = await sharp(srcImage).metadata();
      const { width: srcWidth, height: srcHeight } =
        getOrientedDimensions(srcMetadata);
      const outputFormat = getOutputFormatForSource(srcImage);

      if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
        console.warn("  Skipping: could not read source dimensions.");
        continue;
      }

      console.log(`  Oriented size: ${srcWidth}x${srcHeight}`);

      const { folderPresetKey, formats: activeFormats } =
        getActiveFormatsForDirectory({
          dirSegmentsLower,
          srcWidth,
          srcHeight,
        });

      let watermarkAsset = null;
      if (watermarkConfig.enabled) {
        const watermarkPath = getWatermarkPathForImage(dirSegments);
        try {
          watermarkAsset = await getWatermarkAsset(watermarkPath);
          console.log(`  Watermark loaded: ${watermarkPath}`);
        } catch (err) {
          console.warn(`  Watermark not found: ${watermarkPath}`);
        }
      }

      const basePipeline = sharp(srcImage).autoOrient();

      for (const {
        sizes,
        resizeWidth,
        resizeHeight,
        blurSigma,
        blurReferenceSize,
        top,
        left,
      } of activeFormats) {
        for (const { width, height } of sizes) {
          const {
            targetResizeWidth,
            targetResizeHeight,
            offsetX,
            offsetY,
            valid: cropIsValid,
          } = createResizeCropPlan({
            srcWidth,
            srcHeight,
            width,
            height,
            resizeWidth,
            resizeHeight,
            top,
            left,
          });

          console.log(
            `  Resizing to ${targetResizeWidth}x${targetResizeHeight}, cropping ${width}x${height} at ${offsetX},${offsetY}`,
          );

          const fileName = getOutputFileName({
            baseName,
            width,
            height,
            includeDimensions: includeDimensionsInFileName,
            outputFormat,
          });
          const outputSubdir = path.join(outputDir, relativeDir);
          const outputPath = path.join(outputSubdir, fileName);

          try {
            if (!cropIsValid) {
              console.warn(`  Skipping invalid crop for ${fileName}`);
              continue;
            }

            await fs.mkdir(outputSubdir, { recursive: true });

            let pipeline = basePipeline
              .clone()
              .resize(targetResizeWidth, targetResizeHeight)
              .extract({
                left: offsetX,
                top: offsetY,
                width,
                height,
              });

            if (Number.isFinite(blurSigma) && blurSigma > 0) {
              const refWidth = blurReferenceSize?.width ?? width;
              const widthScale = refWidth > 0 ? width / refWidth : 1;
              const effectiveBlurSigma = Math.max(0.3, blurSigma * widthScale);
              pipeline = pipeline.blur(effectiveBlurSigma);
            }

            const composites = [];

            if (overlayConfig.enabled) {
              composites.push({
                input: getOverlayBuffer(width, height),
                blend: "over",
              });
            }

            if (watermarkAsset) {
              const placement = getWatermarkPlacement({
                imageWidth: width,
                imageHeight: height,
                watermarkWidth: watermarkAsset.metadata.width,
                watermarkHeight: watermarkAsset.metadata.height,
                watermarkConfig,
                folderPreset: folderPresetKey
                  ? folderSizePresets[folderPresetKey]
                  : {},
              });

              if (placement.valid) {
                const wmBuffer = await getWatermarkBuffer(
                  watermarkAsset,
                  placement.width,
                  placement.height,
                  watermarkConfig.opacity,
                );
                composites.push({
                  input: wmBuffer,
                  left: placement.left,
                  top: placement.top,
                });
              } else if (placement.reason === "invalid-size") {
                console.warn(
                  `  Skipping watermark for ${fileName}: invalid size.`,
                );
              } else {
                console.warn(
                  `  Skipping watermark for ${fileName}: placement out of bounds.`,
                );
              }
            }

            if (composites.length > 0) {
              pipeline = pipeline.composite(composites);
            }

            await applyOutputFormat(pipeline, outputFormat).toFile(outputPath);
            console.log(`  Saved: ${fileName}`);
          } catch (err) {
            console.error(`  Error: ${fileName}`, err);
          }
        }
      }
    } catch (err) {
      console.error(`  Error processing ${relativePath}:`, err);
    }
  }

  console.log("\nAll images processed!");
}

if (require.main === module) {
  processImages();
}

module.exports = {
  getActiveFormatsForDirectory,
  getOutputFormatForSource,
  getOutputFileName,
  processImages,
};
