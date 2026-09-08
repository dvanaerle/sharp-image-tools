"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { normalizeConfig } = require("./config");
const { IMAGE_RE, getAllFiles, getImageContext } = require("./discover");
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
const {
  normalizeRunOptions,
  matchesOnly,
  isUpToDate,
  runBatch,
} = require("./run-control");
const { buildSummary, printSummary, writeReport } = require("./summary");

// Processes one source image; returns one summary entry per output variant.
// `force`, `dryRun` and `budget` are the run-control knobs (see run-control.js).
async function processImage({ config, imageFile, renderer, logger, force, dryRun, budget }) {
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
          rule: folderPresetKey ?? null,
          srcWidth,
          srcHeight,
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

          if (!force && (await isUpToDate(srcImage, outputPath))) {
            logger.log(`  Up to date: ${fileName}`);
            results.push({ ...entry, status: "skipped", reason: "up-to-date" });
            continue;
          }

          if (dryRun) {
            logger.log(`  Plan: ${width}x${height} ${outputFormat} -> ${outputPath}`);
            results.push({ ...entry, status: "planned" });
            continue;
          }

          if (!budget.claim()) {
            logger.log(`  Limit reached, not writing: ${fileName}`);
            results.push({ ...entry, status: "skipped", reason: "limit" });
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

function describeImage(relativePath, entries) {
  const tally = {};
  for (const entry of entries) tally[entry.status] = (tally[entry.status] ?? 0) + 1;
  const parts = Object.entries(tally).map(([status, n]) => `${n} ${status}`);
  return `${relativePath}: ${parts.join(", ")}`;
}

// Preset mode: one input root, presets matched by folder name. `--only`
// filters on the path relative to inputDir. Non-image files are reported as
// ignored, never opened.
async function runPresets(config, options) {
  const { logger, force, only, dryRun } = options;
  const renderer = createWatermarkRenderer();

  const allFiles = await getAllFiles(config.inputDir);
  const ignored = allFiles
    .filter((file) => !IMAGE_RE.test(path.basename(file)))
    .map((sourcePath) => ({ sourcePath, status: "ignored" }));
  const imageFiles = allFiles.filter(
    (file) =>
      IMAGE_RE.test(path.basename(file)) &&
      matchesOnly(only, path.relative(config.inputDir, file)),
  );
  if (only !== null && imageFiles.length === 0) {
    logger.warn(`Warning: no image path under ${config.inputDir} contains "${only}".`);
  }
  logger.log(
    `Found ${imageFiles.length} image(s) to process; ignoring ${ignored.length} file(s)${dryRun ? " (dry run, nothing will be written)" : ""}`,
  );

  const processed = await runBatch(
    imageFiles,
    options,
    (imageFile, budget) =>
      processImage({ config, imageFile, renderer, logger, force, dryRun, budget }),
    (entries) => describeImage(path.relative(config.inputDir, entries[0].sourcePath), entries),
  );

  const summary = buildSummary({
    mode: "presets",
    inputDir: config.inputDir,
    outputDir: config.outputDir,
    sourceCount: imageFiles.length,
    outputs: processed.flat(),
    ignored,
    dryRun,
  });
  printSummary(summary, logger);
  return summary;
}

/*
  Programmatic entrypoint.

  `rawConfig` is either the root-config shape (inputDir + folder presets) or
  a rule-based config (inputs + rules, see configs/channable.js). Relative
  paths resolve against the process working directory, as before.

  `options`: logger (default console), concurrency (default 4), force
  (rewrite up-to-date outputs), limit (stop after N written files), only
  (substring filter), dryRun (plan only, write nothing), report (CSV path).

  Resolves to the summary the console prints: { mode, outputDir, sourceCount,
  outputs, ignored, failed, counts, dryRun } plus `inputDir` (preset mode) or
  `inputs` (rule mode). Each entry in `outputs` has a `status` of "saved",
  "skipped", "failed" or "planned"; `counts` tallies those plus `ignored`.
*/
async function run(rawConfig, options = {}) {
  const config = normalizeConfig(rawConfig);
  const runOptions = normalizeRunOptions(options);
  const summary =
    config.mode === "rules"
      ? await runRules(config, runOptions)
      : await runPresets(config, runOptions);
  if (runOptions.report !== null) {
    await writeReport(runOptions.report, summary);
    runOptions.logger.log(`Report written: ${runOptions.report}`);
  }
  return summary;
}

module.exports = { run };
