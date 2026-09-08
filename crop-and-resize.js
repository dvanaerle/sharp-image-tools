"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const {
  inputDir,
  outputDir,
  includeDimensionsInFileName,
  namingConfig,
  imagePositionOverrides,
  formatsEnabled,
  folderSizePresets,
  overlayConfig,
  watermarkConfig,
  formats,
  outputConfig,
} = require("./config");

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

  // Preset match wins. Only fall back to imagePath when no presets are configured.
  if (preset?.imagePath) {
    return preset.imagePath;
  }

  if (Array.isArray(watermarkConfig.presets) && watermarkConfig.presets.length > 0) {
    return null;
  }

  return watermarkConfig.imagePath || null;
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

function getOutputFormatForSource(filePath, forcedFormat) {
  if (forcedFormat === "jpeg" || forcedFormat === "jpg") return "jpeg";
  if (forcedFormat === "png") return "png";
  return path.extname(filePath).toLowerCase() === ".png" ? "png" : "jpeg";
}

/*
  Output filename normalisation (CMS asset convention).

  Only the generated filename changes — source files are never renamed.
  Order: `rename` override → slugify → brand prefix.

  - rename: exact source basename → replacement, for legacy/Dutch names
    that need a semantic English one ("Homepage-afbeeldingen9" → "about-us")
  - slugify: strip accents, ASCII only, lowercase kebab-case
  - brandPrefix: prepended unless already present or listed in `noPrefix`
*/
const TRANSLITERATIONS = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  "€": "eur",
  "&": "-and-",
};

function slugifyBaseName(name) {
  return String(name)
    .replace(
      /[ßæœøđł€&]/g,
      (character) => TRANSLITERATIONS[character] ?? character,
    )
    .normalize("NFD")
    // Drop the combining accents NFD just split off (é → e).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBaseName(baseName, naming) {
  if (!naming || naming.enabled !== true) return baseName;

  const renamed = naming.rename?.[baseName] ?? baseName;
  const slug = naming.slugify === false ? renamed : slugifyBaseName(renamed);
  if (!slug) return baseName;

  const prefix = naming.brandPrefix;
  const exempt = (naming.noPrefix ?? []).includes(slug);
  if (!prefix || exempt || slug.startsWith(prefix)) return slug;
  return `${prefix}${slug}`;
}

function getOutputFileName({
  baseName,
  width,
  height,
  includeDimensions,
  suffix,
  outputFormat,
}) {
  const extension = outputFormat === "png" ? "png" : "jpg";
  baseName = normalizeBaseName(baseName, namingConfig);
  if (suffix) {
    // `@2x` joins without a hyphen → `hero@2x.jpg`; other suffixes use `-`.
    const joiner = String(suffix).startsWith("@") ? "" : "-";
    return `${baseName}${joiner}${suffix}.${extension}`;
  }
  // `suffix: false` means "bare basename" — needed when a multi-size preset
  // has one variant that must keep the plain name (no @Nx, no dimensions).
  if (suffix === false) {
    return `${baseName}.${extension}`;
  }
  if (!includeDimensions) {
    return `${baseName}.${extension}`;
  }
  return `${baseName}-${width}x${height}.${extension}`;
}

/*
  Expand a size entry by optional `scales` (e.g. [1, 2, 3]).

  Base width/height are the 1x CSS/display size. Each scale multiplies
  width, height, and any resizeWidth/resizeHeight. When `scales` is set,
  filenames get `@1x` / `@2x` / … (combined with an existing suffix as
  `tablet@2x`). Omitting `scales` keeps a single unscaled output (no @Nx).
*/
function expandSizeByScales(size) {
  const hasExplicitScales =
    Array.isArray(size.scales) && size.scales.length > 0;
  const scales = hasExplicitScales ? size.scales : [1];

  return scales.flatMap((scale) => {
    if (!isPositiveNumber(scale)) {
      console.warn(`  Skipping invalid scale: ${scale}`);
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

function applyOutputFormat(pipeline, outputFormat) {
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

function getActiveFormatsForDirectory({
  dirSegmentsLower,
  srcWidth,
  srcHeight,
}) {
  // Also match the inputDir folder name itself. Needed when inputDir points
  // directly at a preset folder (e.g. ./01_input/showrooms), where images
  // sit at the root and have no relative path segments.
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

      if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
        console.warn("  Skipping: could not read source dimensions.");
        continue;
      }

      console.log(`  Oriented size: ${srcWidth}x${srcHeight}`);

      const positionOverride = imagePositionOverrides?.[baseName];
      if (positionOverride) {
        console.log(
          `  Position override: top=${positionOverride.top ?? "-"} left=${positionOverride.left ?? "-"}`,
        );
      }

      const { folderPresetKey, formats: activeFormats } =
        getActiveFormatsForDirectory({
          dirSegmentsLower,
          srcWidth,
          srcHeight,
        });
      const folderPreset = folderPresetKey
        ? folderSizePresets[folderPresetKey]
        : null;
      const outputFormat = getOutputFormatForSource(
        srcImage,
        folderPreset?.outputFormat,
      );

      let watermarkAsset = null;
      // A preset can opt out entirely, even while watermarkConfig.enabled
      // is on for the rest of the batch.
      if (watermarkConfig.enabled && !folderPreset?.noWatermark) {
        const watermarkPath = getWatermarkPathForImage(dirSegments);
        if (watermarkPath) {
          try {
            watermarkAsset = await getWatermarkAsset(watermarkPath);
            console.log(`  Watermark loaded: ${watermarkPath}`);
          } catch (err) {
            console.warn(`  Watermark not found: ${watermarkPath}`);
          }
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
        canvas,
      } of activeFormats) {
        const expandedSizes = sizes.flatMap(expandSizeByScales);
        // Only unsuffixed sizes can collide on name; a suffix already
        // separates them, so those never need dimensions appended.
        const unsuffixedCount = expandedSizes.filter((s) => !s.suffix).length;
        for (const size of expandedSizes) {
          const {
            width: requestedWidth,
            height: requestedHeight,
            resizeWidth: sizeResizeWidth,
            resizeHeight: sizeResizeHeight,
            top: sizeTop,
            left: sizeLeft,
            suffix: sizeSuffix,
          } = size;

          // Never upscale. When the source cannot fill the requested box,
          // fall back to the largest box that fits inside it AT THE
          // SOURCE'S OWN ratio — so the ratio is adjusted instead of the
          // image being enlarged or cropped to a shape it cannot fill.
          // scale === 1 means the source is smaller in both axes, so it
          // passes through at native size with no crop at all.
          const noUpscale =
            size.noUpscale ?? folderPreset?.noUpscale ?? false;
          let width = requestedWidth;
          let height = requestedHeight;
          if (
            noUpscale &&
            isPositiveNumber(requestedWidth) &&
            isPositiveNumber(requestedHeight) &&
            (srcWidth < requestedWidth || srcHeight < requestedHeight)
          ) {
            const scale = Math.min(
              requestedWidth / srcWidth,
              requestedHeight / srcHeight,
              1,
            );
            width = Math.max(1, Math.round(srcWidth * scale));
            height = Math.max(1, Math.round(srcHeight * scale));
            console.log(
              `  No upscale: ${requestedWidth}x${requestedHeight} -> ${width}x${height} (source ${srcWidth}x${srcHeight}, ratio kept at ${(srcWidth / srcHeight).toFixed(3)})`,
            );
          }
          const effectiveResizeWidth = sizeResizeWidth ?? resizeWidth;
          const effectiveResizeHeight = sizeResizeHeight ?? resizeHeight;
          // A per-file override beats both the size entry and the preset.
          const effectiveTop =
            positionOverride?.top ?? sizeTop ?? top ?? 0.5;
          const effectiveLeft =
            positionOverride?.left ?? sizeLeft ?? left ?? 0.5;

          const canvasPlan = canvas
            ? createCanvasPlan({
                canvasWidth: width,
                canvasHeight: height,
                canvas,
              })
            : null;

          const {
            targetResizeWidth,
            targetResizeHeight,
            offsetX,
            offsetY,
            valid: cropIsValid,
          } = canvasPlan
            ? {
                targetResizeWidth: canvasPlan.imageWidth,
                targetResizeHeight: canvasPlan.imageHeight,
                offsetX: 0,
                offsetY: 0,
                valid: true,
              }
            : createResizeCropPlan({
                srcWidth,
                srcHeight,
                width,
                height,
                resizeWidth: effectiveResizeWidth,
                resizeHeight: effectiveResizeHeight,
                top: effectiveTop,
                left: effectiveLeft,
              });

          if (canvasPlan) {
            console.log(
              `  Fitting image into ${canvasPlan.imageWidth}x${canvasPlan.imageHeight}, centering on ${width}x${height} canvas`,
            );
          } else {
            console.log(
              `  Resizing to ${targetResizeWidth}x${targetResizeHeight}, cropping ${width}x${height} at ${offsetX},${offsetY}`,
            );
          }

          const fileName = getOutputFileName({
            baseName,
            width,
            height,
            includeDimensions:
              includeDimensionsInFileName || unsuffixedCount > 1,
            suffix: sizeSuffix,
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

            let pipeline;
            if (canvasPlan) {
              pipeline = basePipeline
                .clone()
                .resize(canvasPlan.imageWidth, canvasPlan.imageHeight, {
                  fit: canvasPlan.fit,
                  background: canvasPlan.background,
                })
                .extend({
                  ...canvasPlan.extend,
                  background: canvasPlan.background,
                });
            } else {
              pipeline = basePipeline
                .clone()
                .resize(targetResizeWidth, targetResizeHeight, {
                  fit: "cover",
                  position: "centre",
                })
                .extract({
                  left: offsetX,
                  top: offsetY,
                  width,
                  height,
                });
            }

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
                sizeOverrides: {
                  watermarkMarginPercent: size.watermarkMarginPercent,
                  watermarkPosition: size.watermarkPosition,
                  watermarkScale: size.watermarkScale,
                },
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
  applyOutputFormat,
  getActiveFormatsForDirectory,
  getOutputFormatForSource,
  getOutputFileName,
  expandSizeByScales,
  processImages,
};
