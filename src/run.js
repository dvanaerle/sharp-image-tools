"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { normalizeConfig } = require("./config");
const { getImageFiles, getImageContext } = require("./discover");
const {
  isPositiveNumber,
  createResizeCropPlan,
  createCanvasPlan,
  getOrientedDimensions,
  expandSizeByScales,
  getActiveFormatsForDirectory,
} = require("./crop-plan");
const {
  getWatermarkPathForImage,
  getWatermarkPlacement,
  createWatermarkRenderer,
} = require("./watermark");
const { getOutputFileName } = require("./naming");
const {
  getOverlayBuffer,
  getOutputFormatForSource,
  applyOutputFormat,
} = require("./pipeline");
const { runRules } = require("./run-rules");

// Processes one source image; returns one summary entry per output variant.
async function processImage({ config, imageFile, renderer, logger }) {
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
  } = config;
  const {
    srcImage,
    relativePath,
    baseName,
    relativeDir,
    dirSegments,
    dirSegmentsLower,
  } = getImageContext({ inputDir, imageFile });
  const results = [];

  logger.log(`\nProcessing: ${relativePath}`);

  try {
    const srcMetadata = await sharp(srcImage).metadata();
    const { width: srcWidth, height: srcHeight } =
      getOrientedDimensions(srcMetadata);

    if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
      logger.warn("  Skipping: could not read source dimensions.");
      return [
        {
          sourcePath: srcImage,
          outputPath: null,
          status: "skipped",
          reason: "no-dimensions",
        },
      ];
    }

    logger.log(`  Oriented size: ${srcWidth}x${srcHeight}`);

    const positionOverride = imagePositionOverrides?.[baseName];
    if (positionOverride) {
      logger.log(
        `  Position override: top=${positionOverride.top ?? "-"} left=${positionOverride.left ?? "-"}`,
      );
    }

    const { folderPresetKey, formats: activeFormats } =
      getActiveFormatsForDirectory({
        inputDir,
        dirSegmentsLower,
        srcWidth,
        srcHeight,
        folderSizePresets,
        formatsEnabled,
        formats,
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
      const watermarkPath = getWatermarkPathForImage(
        dirSegments,
        watermarkConfig,
      );
      if (watermarkPath) {
        try {
          watermarkAsset = await renderer.getAsset(watermarkPath);
          logger.log(`  Watermark loaded: ${watermarkPath}`);
        } catch (err) {
          logger.warn(`  Watermark not found: ${watermarkPath}`);
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
      const expandedSizes = sizes.flatMap((size) =>
        expandSizeByScales(size, logger),
      );
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
        const noUpscale = size.noUpscale ?? folderPreset?.noUpscale ?? false;
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
          logger.log(
            `  No upscale: ${requestedWidth}x${requestedHeight} -> ${width}x${height} (source ${srcWidth}x${srcHeight}, ratio kept at ${(srcWidth / srcHeight).toFixed(3)})`,
          );
        }
        const effectiveResizeWidth = sizeResizeWidth ?? resizeWidth;
        const effectiveResizeHeight = sizeResizeHeight ?? resizeHeight;
        // A per-file override beats both the size entry and the preset.
        const effectiveTop = positionOverride?.top ?? sizeTop ?? top ?? 0.5;
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
          logger.log(
            `  Fitting image into ${canvasPlan.imageWidth}x${canvasPlan.imageHeight}, centering on ${width}x${height} canvas`,
          );
        } else {
          logger.log(
            `  Resizing to ${targetResizeWidth}x${targetResizeHeight}, cropping ${width}x${height} at ${offsetX},${offsetY}`,
          );
        }

        const fileName = getOutputFileName({
          baseName,
          width,
          height,
          includeDimensions: includeDimensionsInFileName || unsuffixedCount > 1,
          suffix: sizeSuffix,
          outputFormat,
          naming: namingConfig,
        });
        const outputSubdir = path.join(outputDir, relativeDir);
        const outputPath = path.join(outputSubdir, fileName);
        const entry = {
          sourcePath: srcImage,
          outputPath,
          presetKey: folderPresetKey ?? null,
          width,
          height,
          format: outputFormat,
        };

        try {
          if (!cropIsValid) {
            logger.warn(`  Skipping invalid crop for ${fileName}`);
            results.push({ ...entry, status: "skipped", reason: "invalid-crop" });
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
              folderPreset: folderPreset ?? {},
              sizeOverrides: {
                watermarkMarginPercent: size.watermarkMarginPercent,
                watermarkPosition: size.watermarkPosition,
                watermarkScale: size.watermarkScale,
              },
            });

            if (placement.valid) {
              const wmBuffer = await renderer.getBuffer(
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
              logger.warn(`  Skipping watermark for ${fileName}: invalid size.`);
            } else {
              logger.warn(
                `  Skipping watermark for ${fileName}: placement out of bounds.`,
              );
            }
          }

          if (composites.length > 0) {
            pipeline = pipeline.composite(composites);
          }

          await applyOutputFormat(pipeline, outputFormat, outputConfig).toFile(
            outputPath,
          );
          logger.log(`  Saved: ${fileName}`);
          results.push({ ...entry, status: "saved" });
        } catch (err) {
          logger.error(`  Error: ${fileName}`, err);
          results.push({ ...entry, status: "failed", reason: "write-error", error: err });
        }
      }
    }
  } catch (err) {
    logger.error(`  Error processing ${relativePath}:`, err);
    results.push({
      sourcePath: srcImage,
      outputPath: null,
      status: "failed",
      reason: "source-error",
      error: err,
    });
  }

  return results;
}

function countStatuses(outputs) {
  const counts = { saved: 0, skipped: 0, failed: 0 };
  for (const entry of outputs) {
    counts[entry.status] += 1;
  }
  return counts;
}

/*
  Programmatic entrypoint.

  `rawConfig` is either the root-config shape (inputDir + folder presets) or
  a rule-based config (inputs + rules, see configs/channable.js). Relative
  paths resolve against the process working directory, as before. All
  progress output goes to `options.logger` (defaults to console).

  Resolves to { inputDir, outputDir, sourceCount, outputs, counts }. Each
  entry in `outputs` has a `status` of "saved", "skipped" or "failed", and
  `counts` tallies those statuses. Rule mode returns `inputs` instead of
  `inputDir`, plus `ignored` (files never opened) and `counts.ignored`.
*/
async function run(rawConfig, options = {}) {
  const config = normalizeConfig(rawConfig);
  const logger = options.logger ?? console;
  if (config.mode === "rules") {
    return runRules(config, { logger });
  }
  const renderer = createWatermarkRenderer();

  const imageFiles = await getImageFiles(config.inputDir);
  logger.log(`Found ${imageFiles.length} image(s) to process`);

  const outputs = [];
  for (const imageFile of imageFiles) {
    outputs.push(
      ...(await processImage({ config, imageFile, renderer, logger })),
    );
  }

  logger.log("\nAll images processed!");

  return {
    inputDir: config.inputDir,
    outputDir: config.outputDir,
    sourceCount: imageFiles.length,
    outputs,
    counts: countStatuses(outputs),
  };
}

module.exports = { run };
