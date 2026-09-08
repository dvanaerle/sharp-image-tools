"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { run } = require("../src/run");
const { silentLogger, makeTempDir, writeImage, listFiles, pixelAt } = require("./helpers");

async function size(filePath) {
  const meta = await sharp(filePath).metadata();
  return `${meta.width}x${meta.height} ${meta.format}`;
}

// Fixtures stand in for HD (192x108) and 4K (384x216) at a tenth of the scale;
// rule widths are scaled down the same way (1500 -> 150).
function channableConfig(inputs, outputDir, rules) {
  return {
    outputDir,
    inputs,
    skuPrefixes: ["BUN-", "CAR-", "ACC-", "SUN-"],
    rules: rules ?? [
      { endsWith: "-0", aspect: "1:1", width: 150, upscale: true },
      { width: 150 },
    ],
    outputConfig: { jpegQuality: 80 },
  };
}

test("square rule, default rule, nested discovery, category folders and format preservation", async (t) => {
  const root = await makeTempDir(t);
  const veranda = path.join(root, "veranda", "Origineel");
  const carport = path.join(root, "carport", "Origineel", "Nieuwe map");
  const outputDir = path.join(root, "out");
  await writeImage(path.join(veranda, "BUN-1413081-51-0.jpg"), 192, 108);
  await writeImage(path.join(veranda, "BUN-1413081-51-1.jpg"), 192, 108);
  await writeImage(path.join(veranda, "[Standard] 10x2.5", "BUN-1413081-71-0.jpg"), 384, 216);
  await writeImage(path.join(veranda, "BUN-1413081-91-0.jpg"), 192, 107);
  await writeImage(path.join(carport, "CAR-1-51-2.png"), 100, 60, "png");

  const summary = await run(
    channableConfig(
      [
        { path: veranda, category: "Veranda Modern" },
        { path: carport, category: "Carport Modern" },
      ],
      outputDir,
    ),
    { logger: silentLogger },
  );

  assert.deepEqual(await listFiles(outputDir), [
    "Carport Modern/CAR-1-51-2.png",
    "Veranda Modern/BUN-1413081-51-0.jpg",
    "Veranda Modern/BUN-1413081-51-1.jpg",
    "Veranda Modern/BUN-1413081-71-0.jpg",
    "Veranda Modern/BUN-1413081-91-0.jpg",
  ]);
  assert.equal(await size(path.join(outputDir, "Veranda Modern", "BUN-1413081-51-0.jpg")), "150x150 jpeg");
  assert.equal(await size(path.join(outputDir, "Veranda Modern", "BUN-1413081-71-0.jpg")), "150x150 jpeg");
  assert.equal(await size(path.join(outputDir, "Veranda Modern", "BUN-1413081-91-0.jpg")), "150x150 jpeg");
  assert.equal(await size(path.join(outputDir, "Veranda Modern", "BUN-1413081-51-1.jpg")), "150x84 jpeg");
  // Default rule never upscales: 100x60 passes through, PNG stays PNG.
  assert.equal(await size(path.join(outputDir, "Carport Modern", "CAR-1-51-2.png")), "100x60 png");
  assert.equal(summary.sourceCount, 5);
  assert.deepEqual(summary.counts, { saved: 5, skipped: 0, failed: 0, ignored: 0, planned: 0 });
  const squareEntry = summary.outputs.find((o) => o.sourcePath.endsWith("BUN-1413081-51-0.jpg"));
  assert.equal(squareEntry.ruleIndex, 0);
  assert.equal(squareEntry.category, "Veranda Modern");
});

test("a prefix rule above the square rule changes the window; zoom 1 crops only what the aspect forces", async (t) => {
  const root = await makeTempDir(t);
  const input = path.join(root, "in");
  const outputDir = path.join(root, "out");
  await writeImage(path.join(input, "BUN-9-51-0.jpg"), 192, 108);
  await writeImage(path.join(input, "BUN-8-51-0.jpg"), 192, 108);

  await run(
    channableConfig([{ path: input, category: "x" }], outputDir, [
      { startsWith: "BUN-9-", aspect: "source", zoom: 2, top: 1, left: 0, width: 150 },
      { endsWith: "-0", aspect: "1:1", width: 150, upscale: true, zoom: 1 },
      { width: 150 },
    ]),
    { logger: silentLogger },
  );

  // zoom 2 on 192x108 -> 96x54 window; no upscale -> 96x54 out.
  assert.equal(await size(path.join(outputDir, "x", "BUN-9-51-0.jpg")), "96x54 jpeg");
  assert.equal(await size(path.join(outputDir, "x", "BUN-8-51-0.jpg")), "150x150 jpeg");
});

test("non-SKU, psd and db files are ignored, never opened, and counted", async (t) => {
  const root = await makeTempDir(t);
  const input = path.join(root, "in");
  const outputDir = path.join(root, "out");
  await writeImage(path.join(input, "ACC-1-0.jpg"), 192, 108);
  await writeImage(path.join(input, "3m.jpg"), 192, 108);
  await writeImage(path.join(input, "gumax-zonwering-detailfoto.jpg"), 192, 108);
  await fs.writeFile(path.join(input, "Thumbs.db"), "binary");
  await fs.writeFile(path.join(input, "ACC-1-0.psd"), "not an image, would fail if opened");

  const summary = await run(
    channableConfig([{ path: input, category: "acc" }], outputDir),
    { logger: silentLogger },
  );

  assert.deepEqual(await listFiles(outputDir), ["acc/ACC-1-0.jpg"]);
  assert.deepEqual(summary.counts, { saved: 1, skipped: 0, failed: 0, ignored: 4, planned: 0 });
  assert.deepEqual(
    summary.ignored.map((entry) => path.basename(entry.sourcePath)).sort(),
    ["3m.jpg", "ACC-1-0.psd", "Thumbs.db", "gumax-zonwering-detailfoto.jpg"],
  );
});

test("watermark, overlay and naming from a root-style config are not applied in rule mode", async (t) => {
  const root = await makeTempDir(t);
  const input = path.join(root, "in");
  const outputDir = path.join(root, "out");
  await writeImage(path.join(input, "BUN-Een_Twee-0.jpg"), 192, 108);
  const badge = path.join(root, "badge.png");
  await writeImage(badge, 40, 20, "png");

  const summary = await run(
    {
      ...channableConfig([{ path: input, category: "c" }], outputDir),
      includeDimensionsInFileName: true,
      namingConfig: { enabled: true, brandPrefix: "gumax-" },
      overlayConfig: { enabled: true },
      watermarkConfig: {
        enabled: true,
        imagePath: badge,
        position: "bottom-right",
        opacity: 1,
        marginPercent: { x: 0, y: 0 },
        scale: 1,
      },
    },
    { logger: silentLogger },
  );

  // Naming off: exact basename kept (no slug, no prefix, no dimensions).
  assert.deepEqual(await listFiles(outputDir), ["c/BUN-Een_Twee-0.jpg"]);
  // Overlay and watermark off: bottom-right pixel is still plain red.
  const pixel = await pixelAt(path.join(outputDir, "c", "BUN-Een_Twee-0.jpg"), 145, 145);
  assert.ok(pixel.r > 150 && pixel.b < 100, `expected plain red pixel, got ${JSON.stringify(pixel)}`);
  assert.equal(summary.counts.saved, 1);
});

test("a shadowed rule produces a startup warning", async (t) => {
  const root = await makeTempDir(t);
  const input = path.join(root, "in");
  const outputDir = path.join(root, "out");
  await fs.mkdir(input, { recursive: true });
  const warnings = [];
  const logger = { ...silentLogger, warn: (m) => warnings.push(String(m)) };

  await run(
    channableConfig([{ path: input, category: "c" }], outputDir, [
      { width: 150 },
      { endsWith: "-0", aspect: "1:1", width: 150, upscale: true },
    ]),
    { logger },
  );

  assert.ok(warnings.some((w) => /rule 2 .*shadowed.* rule 1/i.test(w)), JSON.stringify(warnings));
});

test("the run aborts before writing when the output root lies inside an input path", async (t) => {
  const root = await makeTempDir(t);
  const input = path.join(root, "in");
  await writeImage(path.join(input, "BUN-1-0.jpg"), 192, 108);

  for (const outputDir of [path.join(input, "export"), input, path.join(input, "..", "in")]) {
    await assert.rejects(
      run(channableConfig([{ path: input, category: "c" }], outputDir), { logger: silentLogger }),
      /output root .* inside input/i,
    );
  }
  assert.deepEqual(await listFiles(input), ["BUN-1-0.jpg"]);
});

test("the run aborts before writing when two sources map to the same output path", async (t) => {
  const root = await makeTempDir(t);
  const a = path.join(root, "a");
  const b = path.join(root, "b");
  const outputDir = path.join(root, "out");
  await writeImage(path.join(a, "BUN-1-0.jpg"), 192, 108);
  await writeImage(path.join(b, "BUN-1-0.jpg"), 192, 108);
  await writeImage(path.join(a, "BUN-2-0.jpg"), 192, 108);

  await assert.rejects(
    run(
      channableConfig([{ path: a, category: "same" }, { path: b, category: "same" }], outputDir),
      { logger: silentLogger },
    ),
    /BUN-1-0\.jpg/,
  );
  await assert.rejects(fs.access(outputDir));
});
