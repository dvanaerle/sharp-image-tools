const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;

const inputDir = "./01_input";
const outputDir = "./02_output";
const includeDimensionsInFileName = true;
const formatsEnabled = true;
const folderSizePresets = {
  // home: {
  //   width: 1200,
  //   height: 675,
  //   watermarkPosition: "bottom-right",
  //   watermarkMargin: { right: 20, bottom: 60 },
  // },
  // schuifwand: {
  //   width: 1000,
  //   height: 563,
  //   watermarkPosition: "bottom-left",
  // },
  // verlichting: {
  //   width: 926,
  //   height: 521,
  //   watermarkPosition: "top-left",
  //   watermarkMaxWidth: 448,
  //   watermarkMaxHeight: 448,
  // },
  // category: {
  //   width: 1531,
  //   height: 1010,
  //   watermarkPosition: "top-right",
  //   watermarkMaxWidth: 576,
  //   watermarkMaxHeight: 576,
  // },
};

const overlayConfig = {
  enabled: false,
};

const watermarkConfig = {
  enabled: true,
  imagePath: "./watermark/Gumax_Logo_SVG_White.svg",
  // presets: [
  //   {
  //     folder: "NL-BE",
  //     imagePath:
  //       "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_NL.svg",
  //   },
  //   {
  //     folder: "DE",
  //     imagePath:
  //       "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_DE.svg",
  //   },
  //   {
  //     folder: "BE-FR",
  //     imagePath:
  //       "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_FR.svg",
  //   },
  //   {
  //     folder: "UK",
  //     imagePath:
  //       "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_EN.svg",
  //   },
  // ],
  position: "bottom-left",
  opacity: 0.3,
  margin: { left: 30, right: 30, bottom: 30, top: 30 },
  scale: 0.25,
  fixedSize: false,
  // maxWidth: 512,
  // maxHeight: 512,
};

const formats = [
  {
    sizes: [
      { width: 1200, height: 675 },
      { width: 1080, height: 607 },
    ],
    top: 0.5,
    left: 0.5,
    // blurSigma: 0,
    // blurReferenceSize: { width: 1080, height: 608 },
    // resizeWidth: 3500,
    // resizeHeight: 1750,
  },
];

const watermarkAssetCache = new Map();
const watermarkRenderCache = new Map();
const overlayCache = new Map();

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function getCoverResize(srcWidth, srcHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
  return {
    width: Math.ceil(srcWidth * scale),
    height: Math.ceil(srcHeight * scale),
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

(async () => {
  const imageFiles = await getImageFiles(inputDir);

  console.log(`Found ${imageFiles.length} image(s) to process`);

  for (const imageFile of imageFiles) {
    const srcImage = imageFile;
    const relativePath = path.relative(inputDir, imageFile);
    const baseName = path.parse(relativePath).name;
    const relativeDir = path.dirname(relativePath);
    const dirSegments = relativeDir === "." ? [] : relativeDir.split(path.sep);
    const dirSegmentsLower = dirSegments.map((segment) =>
      segment.toLowerCase(),
    );

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

      const folderPresetKey = Object.keys(folderSizePresets).find((key) =>
        dirSegmentsLower.includes(key),
      );
      const activeFormats = folderPresetKey
        ? [
            {
              sizes: [
                {
                  width: folderSizePresets[folderPresetKey].width,
                  height: folderSizePresets[folderPresetKey].height,
                },
              ],
              top: folderSizePresets[folderPresetKey].top ?? 0.5,
              left: folderSizePresets[folderPresetKey].left ?? 0.5,
            },
          ]
        : formatsEnabled
          ? formats
          : [
              {
                sizes: [{ width: srcWidth, height: srcHeight }],
                resizeWidth: srcWidth,
                resizeHeight: srcHeight,
                top: 0,
                left: 0,
              },
            ];

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
          const { width: targetResizeWidth, height: targetResizeHeight } =
            Number.isFinite(resizeWidth) && Number.isFinite(resizeHeight)
              ? { width: resizeWidth, height: resizeHeight }
              : getCoverResize(srcWidth, srcHeight, width, height);

          const offsetX = Math.round((targetResizeWidth - width) * left);
          const offsetY = Math.round((targetResizeHeight - height) * top);

          console.log(
            `  Resizing to ${targetResizeWidth}x${targetResizeHeight}, cropping ${width}x${height} at ${offsetX},${offsetY}`,
          );

          const fileName = includeDimensionsInFileName
            ? `${baseName}-${width}x${height}.jpg`
            : `${baseName}.jpg`;
          const outputSubdir = path.join(outputDir, relativeDir);
          const outputPath = path.join(outputSubdir, fileName);

          try {
            if (
              offsetX < 0 ||
              offsetY < 0 ||
              offsetX + width > targetResizeWidth ||
              offsetY + height > targetResizeHeight
            ) {
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
              const {
                margin: baseMargin,
                scale: wmScale,
                opacity,
                position,
                maxWidth,
                maxHeight,
                fixedSize,
              } = watermarkConfig;
              const margin =
                (folderPresetKey &&
                  folderSizePresets[folderPresetKey].watermarkMargin) ||
                baseMargin;
              const presetWatermarkPosition = folderPresetKey
                ? folderSizePresets[folderPresetKey].watermarkPosition
                : undefined;
              const watermarkPosition = presetWatermarkPosition || position;

              const presetMaxWidth = folderPresetKey
                ? folderSizePresets[folderPresetKey].watermarkMaxWidth
                : undefined;
              const presetMaxHeight = folderPresetKey
                ? folderSizePresets[folderPresetKey].watermarkMaxHeight
                : undefined;
              const maxWmWidth = presetMaxWidth ?? maxWidth;
              const maxWmHeight = presetMaxHeight ?? maxHeight;
              const wmAspect =
                watermarkAsset.metadata.height / watermarkAsset.metadata.width;

              let wmWidth = fixedSize
                ? maxWmWidth
                : Math.round(width * wmScale);
              let wmHeight = Math.round(wmWidth * wmAspect);

              if (isPositiveNumber(maxWmWidth) && wmWidth > maxWmWidth) {
                wmWidth = maxWmWidth;
                wmHeight = Math.round(wmWidth * wmAspect);
              }
              if (isPositiveNumber(maxWmHeight) && wmHeight > maxWmHeight) {
                wmHeight = maxWmHeight;
                wmWidth = Math.round(wmHeight / wmAspect);
              }

              if (isPositiveNumber(wmWidth) && isPositiveNumber(wmHeight)) {
                const marginLeft = margin.left ?? 0;
                const marginRight = margin.right ?? 0;
                const marginTop = margin.top ?? 0;
                const marginBottom = margin.bottom ?? 0;
                const positions = {
                  "top-left": { left: marginLeft, top: marginTop },
                  "top-right": {
                    left: width - wmWidth - marginRight,
                    top: marginTop,
                  },
                  "bottom-left": {
                    left: marginLeft,
                    top: height - wmHeight - marginBottom,
                  },
                  "bottom-right": {
                    left: width - wmWidth - marginRight,
                    top: height - wmHeight - marginBottom,
                  },
                  center: {
                    left: (width - wmWidth) / 2,
                    top: (height - wmHeight) / 2,
                  },
                };

                const { left: wmLeft, top: wmTop } =
                  positions[watermarkPosition] || positions["bottom-right"];

                if (
                  wmLeft >= 0 &&
                  wmTop >= 0 &&
                  wmLeft + wmWidth <= width &&
                  wmTop + wmHeight <= height
                ) {
                  const wmBuffer = await getWatermarkBuffer(
                    watermarkAsset,
                    wmWidth,
                    wmHeight,
                    opacity,
                  );
                  composites.push({
                    input: wmBuffer,
                    left: Math.round(wmLeft),
                    top: Math.round(wmTop),
                  });
                } else {
                  console.warn(
                    `  Skipping watermark for ${fileName}: placement out of bounds.`,
                  );
                }
              } else {
                console.warn(
                  `  Skipping watermark for ${fileName}: invalid size.`,
                );
              }
            }

            if (composites.length > 0) {
              pipeline = pipeline.composite(composites);
            }

            await pipeline
              .jpeg({ mozjpeg: true, quality: 75 })
              .toFile(outputPath);
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
})();
