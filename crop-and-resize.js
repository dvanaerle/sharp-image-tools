const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;

const inputDir = "./01_input";
const outputDir = "./02_output";
const includeDimensionsInFileName = true;
const formatsEnabled = true;
const folderSizePresets = {
  home: {
    width: 1200,
    height: 675,
    watermarkPosition: "bottom-right",
    watermarkMargin: { right: 20, bottom: 60 },
  },
  schuifwand: {
    width: 1000,
    height: 563,
    watermarkPosition: "bottom-left",
  },
  verlichting: {
    width: 926,
    height: 521,
    watermarkPosition: "top-left",
    watermarkMaxWidth: 448,
    watermarkMaxHeight: 448,
  },
  category: {
    width: 1531,
    height: 1010,
    watermarkPosition: "top-right",
    watermarkMaxWidth: 576,
    watermarkMaxHeight: 576,
  },
};

const overlayConfig = {
  enabled: false,
};

const watermarkConfig = {
  enabled: false,
  imagePath: "./watermark/tuinmaximaal/Tuinmaximaal_Logo_SVG_White.svg",
  presets: [
    {
      folder: "NL-BE",
      imagePath:
        "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_NL.svg",
    },
    {
      folder: "DE",
      imagePath:
        "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_DE.svg",
    },
    {
      folder: "BE-FR",
      imagePath:
        "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_FR.svg",
    },
    {
      folder: "UK",
      imagePath:
        "./watermark/2026-22-02_Winterkorting_Logo_verlengd_RGB_EN.svg",
    },
  ],
  position: "bottom-right",
  opacity: 0.8,
  margin: { left: 20, right: 100, bottom: 100, top: 30 },
  scale: 0.25,
  // maxWidth: 512,
  // maxHeight: 512,
  fixedSize: false,
};

const formats = [
  {
    sizes: [
      { width: 1080, height: 608 }
    ],
    blurSigma: 0,
    blurReferenceSize: { width: 1080, height: 608 },
    // resizeWidth: 3500,
    // resizeHeight: 1750,
    top: 0.5,
    left: 0.5,
  },
];

function getCoverResize(srcWidth, srcHeight, targetWidth, targetHeight) {
  const scale = Math.max(targetWidth / srcWidth, targetHeight / srcHeight);
  return {
    width: Math.ceil(srcWidth * scale),
    height: Math.ceil(srcHeight * scale),
  };
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

    console.log(`\nProcessing: ${relativePath}`);

    const { width: srcWidth, height: srcHeight } =
      await sharp(srcImage).metadata();

    console.log(`  Original size: ${srcWidth}x${srcHeight}`);

    const dirSegmentsLower = dirSegments.map((segment) =>
      segment.toLowerCase(),
    );
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

    let watermark = null;
    if (watermarkConfig.enabled) {
      const preset = Array.isArray(watermarkConfig.presets)
        ? watermarkConfig.presets.find((entry) =>
            dirSegments.includes(entry.folder),
          )
        : null;
      const watermarkPath = preset?.imagePath || watermarkConfig.imagePath;
      try {
        watermark = await fs.readFile(watermarkPath);
        console.log(`  Watermark loaded: ${watermarkPath}`);
      } catch (err) {
        console.warn(`  Watermark not found: ${watermarkPath}`);
      }
    }

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
          `  Resizing to ${resizeWidth}x${resizeHeight}, cropping ${width}x${height} at ${offsetX},${offsetY}`,
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

          let pipeline = sharp(srcImage)
            .resize(targetResizeWidth, targetResizeHeight)
            .extract({
              left: offsetX,
              top: offsetY,
              width: width,
              height: height,
            });

          if (Number.isFinite(blurSigma) && blurSigma > 0) {
            const refWidth = blurReferenceSize?.width ?? width;
            const widthScale = refWidth > 0 ? width / refWidth : 1;
            const effectiveBlurSigma = Math.max(0.3, blurSigma * widthScale);
            pipeline = pipeline.blur(effectiveBlurSigma);
          }

          const composites = [];

          if (overlayConfig.enabled) {
            composites.push({ input: overlay, blend: "over" });
          }

          if (watermark) {
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
            const marginLeft = margin.left ?? 0;
            const marginRight = margin.right ?? 0;
            const marginTop = margin.top ?? 0;
            const marginBottom = margin.bottom ?? 0;
            const wmMeta = await sharp(watermark).metadata();
            const presetMaxWidth = folderPresetKey
              ? folderSizePresets[folderPresetKey].watermarkMaxWidth
              : undefined;
            const presetMaxHeight = folderPresetKey
              ? folderSizePresets[folderPresetKey].watermarkMaxHeight
              : undefined;
            const maxWmWidth = presetMaxWidth ?? maxWidth;
            const maxWmHeight = presetMaxHeight ?? maxHeight;

            let wmWidth = fixedSize ? maxWmWidth : Math.round(width * wmScale);
            let wmHeight = Math.round(wmWidth * (wmMeta.height / wmMeta.width));

            if (wmWidth > maxWmWidth) {
              wmWidth = maxWmWidth;
              wmHeight = Math.round(wmWidth * (wmMeta.height / wmMeta.width));
            }
            if (wmHeight > maxWmHeight) {
              wmHeight = maxWmHeight;
              wmWidth = Math.round(wmHeight * (wmMeta.width / wmMeta.height));
            }

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

            const wmBuffer = await sharp(watermark)
              .resize(wmWidth, wmHeight)
              .composite([
                {
                  input: Buffer.from(
                    `<svg><rect width="${wmWidth}" height="${wmHeight}" fill="white" fill-opacity="${1 - opacity}"/></svg>`,
                  ),
                  blend: "dest-in",
                },
              ])
              .toBuffer();

            composites.push({
              input: wmBuffer,
              left: Math.round(wmLeft),
              top: Math.round(wmTop),
            });
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
  }

  console.log("\nAll images processed!");
})();
