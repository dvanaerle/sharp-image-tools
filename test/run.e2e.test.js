"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { run } = require("../src/run");
const {
  silentLogger,
  red,
  blue,
  makeTempDir,
  writeImage,
  listFiles,
  pixelAt: cornerPixel,
} = require("./helpers");

test("a jpeg in a preset folder is cropped to the preset size and kept as jpeg", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await writeImage(path.join(inputDir, "tiles", "hero.jpg"), 384, 216, "jpeg", red);

  const summary = await run(
    {
      inputDir,
      outputDir,
      folderSizePresets: { tiles: { sizes: [{ width: 160, height: 90 }] } },
      watermarkConfig: { enabled: false },
    },
    { logger: silentLogger },
  );

  assert.deepEqual(await listFiles(outputDir), ["tiles/hero.jpg"]);
  const meta = await sharp(path.join(outputDir, "tiles", "hero.jpg")).metadata();
  assert.equal(meta.width, 160);
  assert.equal(meta.height, 90);
  assert.equal(meta.format, "jpeg");
  assert.equal(summary.sourceCount, 1);
  assert.deepEqual(summary.counts, { saved: 1, skipped: 0, failed: 0 });
});

test("a locale preset badge is composited bottom-right; a noWatermark preset opts out", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  const badge = path.join(root, "badge.png");
  await writeImage(badge, 40, 20, "png", blue);
  await writeImage(path.join(inputDir, "tiles", "nl-nl", "hero.jpg"), 384, 216, "jpeg", red);
  await writeImage(path.join(inputDir, "reviews", "nl-nl", "score.jpg"), 384, 216, "jpeg", red);

  await run(
    {
      inputDir,
      outputDir,
      folderSizePresets: {
        tiles: { sizes: [{ width: 160, height: 90 }] },
        reviews: { noWatermark: true, sizes: [{ width: 160, height: 90 }] },
      },
      watermarkConfig: {
        enabled: true,
        imagePath: null,
        position: "bottom-right",
        opacity: 1,
        marginPercent: { x: 0.03, y: 0.04 },
        scale: 1 / 4,
        fixedSize: false,
        presets: [{ folder: "nl-nl", imagePath: badge }],
      },
    },
    { logger: silentLogger },
  );

  // Badge is 40x20 at scale 1/4 of 160 → 40x20; margins 3%/4% of 90 → 3 and 4.
  // So it covers x 117..156, y 66..85. Sample inside it and outside it.
  const inside = await cornerPixel(path.join(outputDir, "tiles", "nl-nl", "hero.jpg"), 136, 75);
  assert.ok(inside.b > inside.r, `expected blue badge pixel, got ${JSON.stringify(inside)}`);
  const outside = await cornerPixel(path.join(outputDir, "tiles", "nl-nl", "hero.jpg"), 10, 10);
  assert.ok(outside.r > outside.b, `expected red image pixel, got ${JSON.stringify(outside)}`);

  const optedOut = await cornerPixel(path.join(outputDir, "reviews", "nl-nl", "score.jpg"), 136, 75);
  assert.ok(optedOut.r > optedOut.b, `expected no badge, got ${JSON.stringify(optedOut)}`);
});

test("noUpscale passes a small source through at native size, forced png changes the extension", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await writeImage(path.join(inputDir, "reviews", "score.jpg"), 100, 60, "jpeg", red);

  const summary = await run(
    {
      inputDir,
      outputDir,
      folderSizePresets: {
        reviews: { noUpscale: true, outputFormat: "png", sizes: [{ width: 200, height: 100 }] },
      },
    },
    { logger: silentLogger },
  );

  assert.deepEqual(await listFiles(outputDir), ["reviews/score.png"]);
  const meta = await sharp(path.join(outputDir, "reviews", "score.png")).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 100);
  assert.equal(meta.height, 60);
  assert.equal(summary.outputs[0].presetKey, "reviews");
  assert.equal(summary.outputs[0].status, "saved");
});

test("a multi-size preset names suffixed variants and keeps one bare name via suffix false", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await writeImage(path.join(inputDir, "about", "team.png"), 400, 300, "png", red);

  await run(
    {
      inputDir,
      outputDir,
      folderSizePresets: {
        about: {
          sizes: [
            { width: 120, height: 120, suffix: false },
            { width: 160, height: 90, suffix: "mobile" },
          ],
        },
      },
    },
    { logger: silentLogger },
  );

  assert.deepEqual(await listFiles(outputDir), ["about/team-mobile.png", "about/team.png"]);
  const square = await sharp(path.join(outputDir, "about", "team.png")).metadata();
  assert.equal(`${square.width}x${square.height}`, "120x120");
});

test("an unreadable source is reported as failed and the rest of the batch still runs", async (t) => {
  const root = await makeTempDir(t);
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  await writeImage(path.join(inputDir, "ok.jpg"), 50, 50, "jpeg", red);
  await fs.writeFile(path.join(inputDir, "broken.jpg"), "not an image");

  const summary = await run({ inputDir, outputDir }, { logger: silentLogger });

  assert.equal(summary.sourceCount, 2);
  assert.deepEqual(summary.counts, { saved: 1, skipped: 0, failed: 1 });
  assert.deepEqual(await listFiles(outputDir), ["ok.jpg"]);
});
