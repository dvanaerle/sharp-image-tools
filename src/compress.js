"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { IMAGE_RE, getImageFiles } = require("./discover");
const { getOutputFormatForSource, applyOutputFormat } = require("./pipeline");

function outputPathForSource(srcImage, outputDir) {
  const rel = path.parse(path.basename(srcImage));
  const outputFormat = getOutputFormatForSource(srcImage);
  const ext = outputFormat === "png" ? ".png" : ".jpg";
  return path.join(outputDir, `${rel.name}${ext}`);
}

function buildCompressPipeline(srcImage, compressConfig) {
  const pipeline = sharp(srcImage).autoOrient();
  if (!compressConfig.preserveDimensions) {
    pipeline.resize(compressConfig.width, compressConfig.height);
  }
  return pipeline;
}

async function compressOneFile(
  srcImage,
  outputPath,
  { compressConfig, outputConfig },
) {
  const outputFormat = getOutputFormatForSource(srcImage);
  const pipeline = buildCompressPipeline(srcImage, compressConfig);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await applyOutputFormat(pipeline, outputFormat, outputConfig).toFile(
    outputPath,
  );
}

function assertSeparatePaths(sourcePath, outputPath, logger, label) {
  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    logger.error(`  Skipping ${label}: output folder resolves to the source folder`);
    return false;
  }
  return true;
}

// Finds the source folder inside a product folder, trying each configured
// name case-insensitively.
async function findSourceDir(productDir, compressConfig) {
  const entries = await fs.readdir(productDir, { withFileTypes: true });
  const dirsByLower = new Map(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => [entry.name.toLowerCase(), entry.name]),
  );
  for (const name of compressConfig.sourceFolderNames) {
    const match = dirsByLower.get(name.toLowerCase());
    if (match) return path.join(productDir, match);
  }
  return null;
}

async function hasDirectImages(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.some(
    (entry) => entry.isFile() && IMAGE_RE.test(entry.name),
  );
}

async function compressFlatRoot(rootDir, outputRoot, context) {
  const { logger } = context;
  if (!assertSeparatePaths(rootDir, outputRoot, logger, path.basename(rootDir))) {
    return;
  }

  const files = await getImageFiles(rootDir);
  if (files.length === 0) return;

  await fs.mkdir(outputRoot, { recursive: true });

  for (const srcImage of files) {
    const relDir = path.dirname(path.relative(rootDir, srcImage));
    const outputDir = relDir === "." ? outputRoot : path.join(outputRoot, relDir);
    const outputPath = outputPathForSource(srcImage, outputDir);
    const label = path.relative(rootDir, srcImage);

    try {
      await compressOneFile(srcImage, outputPath, context);
      logger.log(`  ${label}`);
    } catch (err) {
      logger.error(`  Error: ${label}`, err.message);
    }
  }
}

async function compressFolder(productDir, { compressConfig, outputConfig, logger }) {
  const sourceDir = await findSourceDir(productDir, compressConfig);
  if (!sourceDir) return;

  const files = (await fs.readdir(sourceDir)).filter((name) =>
    IMAGE_RE.test(name),
  );
  if (files.length === 0) return;

  const outputDir = path.join(productDir, compressConfig.outputFolderName);
  if (!assertSeparatePaths(sourceDir, outputDir, logger, path.basename(productDir))) {
    return;
  }

  await fs.mkdir(outputDir, { recursive: true });

  for (const file of files) {
    const srcImage = path.join(sourceDir, file);
    const outputPath = outputPathForSource(srcImage, outputDir);

    try {
      await compressOneFile(srcImage, outputPath, {
        compressConfig,
        outputConfig,
      });
      logger.log(`  ${path.basename(productDir)}/${file}`);
    } catch (err) {
      logger.error(
        `  Error: ${path.basename(productDir)}/${file}`,
        err.message,
      );
    }
  }
}

/*
  Compression pass. Processes every product folder under `rootDir` (defaults
  to compressConfig.rootDir). If rootDir is itself a product folder (contains
  a source folder), only that one is processed; otherwise its children are
  treated as product folders. When images sit directly in `rootDir` (for example
  `./01_input/levergebied`), they are re-encoded into `outputDir`, keeping the
  same format and dimensions.
*/
async function compressAll(
  { compressConfig, outputConfig, outputDir },
  options = {},
) {
  const logger = options.logger ?? console;
  const rootDir = options.rootDir ?? compressConfig.rootDir;
  const context = { compressConfig, outputConfig, logger };

  if (await findSourceDir(rootDir, compressConfig)) {
    await compressFolder(rootDir, context);
  } else if (await hasDirectImages(rootDir)) {
    const outputRoot =
      compressConfig.outputDir ??
      path.join(outputDir, path.basename(rootDir));
    await compressFlatRoot(rootDir, outputRoot, context);
  } else {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await compressFolder(path.join(rootDir, entry.name), context);
      }
    }
  }
  logger.log("Done.");
}

module.exports = { compressAll };
