"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const sharp = require("sharp");
const { compressAll } = require("../src/compress");
const { makeTempDir, writeImage, listFiles, silentLogger } = require("./helpers");

test("compressAll keeps flat-folder format and dimensions", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "levergebied");
  const outputDir = path.join(root, "out");
  const srcPath = path.join(inputDir, "map.jpg");
  const pngPath = path.join(inputDir, "overlay.png");

  await writeImage(srcPath, 120, 80, "jpeg");
  await writeImage(pngPath, 90, 60, "png");

  await compressAll(
    {
      compressConfig: {
        rootDir: inputDir,
        preserveDimensions: true,
        sourceFolderNames: ["Origineel"],
        outputFolderName: "Gecomprimeerd",
        width: 40,
        height: 30,
      },
      outputConfig: {
        jpegQuality: 75,
        pngCompressionLevel: 9,
        pngQuality: 90,
        pngDither: 0.8,
      },
      outputDir,
    },
    { logger: silentLogger },
  );

  const outputs = await listFiles(path.join(outputDir, "levergebied"));
  assert.deepEqual(outputs, ["map.jpg", "overlay.png"]);

  const jpegMeta = await sharp(path.join(outputDir, "levergebied", "map.jpg")).metadata();
  assert.equal(jpegMeta.format, "jpeg");
  assert.equal(jpegMeta.width, 120);
  assert.equal(jpegMeta.height, 80);

  const pngMeta = await sharp(path.join(outputDir, "levergebied", "overlay.png")).metadata();
  assert.equal(pngMeta.format, "png");
  assert.equal(pngMeta.width, 90);
  assert.equal(pngMeta.height, 60);

});
