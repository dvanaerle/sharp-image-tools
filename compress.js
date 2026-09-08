"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { compressConfig } = require("./config");
const {
  getOutputFormatForSource,
  applyOutputFormat,
} = require("./crop-and-resize");

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

// Finds the source folder inside a product folder, trying each configured
// name case-insensitively.
async function findSourceDir(productDir) {
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

async function compressFolder(productDir) {
  const sourceDir = await findSourceDir(productDir);
  if (!sourceDir) return;

  const files = (await fs.readdir(sourceDir)).filter((name) =>
    IMAGE_RE.test(name),
  );
  if (files.length === 0) return;

  const outputDir = path.join(productDir, compressConfig.outputFolderName);

  // Safety: never read and write the same folder — the source must stay untouched.
  if (path.resolve(outputDir) === path.resolve(sourceDir)) {
    console.error(
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
      await applyOutputFormat(pipeline, outputFormat).toFile(outputPath);
      console.log(`  ${path.basename(productDir)}/${file}`);
    } catch (err) {
      console.error(`  Error: ${path.basename(productDir)}/${file}`, err.message);
    }
  }
}

// Processes every product folder under `rootDir` (defaults to the configured
// root). Pass a different root to run against another tree, e.g. for testing.
async function compressAll(rootDir = compressConfig.rootDir) {
  // If rootDir is itself a product folder (contains a source folder), process
  // just that one. Otherwise treat its children as product folders.
  if (await findSourceDir(rootDir)) {
    await compressFolder(rootDir);
  } else {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await compressFolder(path.join(rootDir, entry.name));
      }
    }
  }
  console.log("Done.");
}

if (require.main === module) {
  // Optional CLI override: `node compress.js <rootDir>`
  compressAll(process.argv[2]).catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

module.exports = { compressAll };
