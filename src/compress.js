"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { IMAGE_RE } = require("./discover");
const { getOutputFormatForSource, applyOutputFormat } = require("./pipeline");

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

async function compressFolder(productDir, { compressConfig, outputConfig, logger }) {
  const sourceDir = await findSourceDir(productDir, compressConfig);
  if (!sourceDir) return;

  const files = (await fs.readdir(sourceDir)).filter((name) =>
    IMAGE_RE.test(name),
  );
  if (files.length === 0) return;

  const outputDir = path.join(productDir, compressConfig.outputFolderName);

  // Safety: never read and write the same folder — the source must stay untouched.
  if (path.resolve(outputDir) === path.resolve(sourceDir)) {
    logger.error(
      `  Skipping ${path.basename(productDir)}: output folder resolves to the source folder`,
    );
    return;
  }

  await fs.mkdir(outputDir, { recursive: true });

  for (const file of files) {
    const srcImage = path.join(sourceDir, file);
    const outputFormat = getOutputFormatForSource(srcImage);
    const extension = outputFormat === "png" ? "png" : "jpg";
    const outputPath = path.join(
      outputDir,
      `${path.parse(file).name}.${extension}`,
    );

    try {
      const pipeline = sharp(srcImage)
        .autoOrient()
        .resize(compressConfig.width, compressConfig.height);
      await applyOutputFormat(pipeline, outputFormat, outputConfig).toFile(
        outputPath,
      );
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
  treated as product folders.
*/
async function compressAll({ compressConfig, outputConfig }, options = {}) {
  const logger = options.logger ?? console;
  const rootDir = options.rootDir ?? compressConfig.rootDir;
  const context = { compressConfig, outputConfig, logger };

  if (await findSourceDir(rootDir, compressConfig)) {
    await compressFolder(rootDir, context);
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
