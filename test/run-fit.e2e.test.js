"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { run } = require("../src/run");
const { silentLogger, makeTempDir, listFiles } = require("./helpers");

/*
  Fixtures stand in for the renders at a tenth of the scale: a 192x108 frame
  of dark background with a bright, almost colourless slab in the upper half,
  which is what the detector looks for. `slab` is given in frame fractions.
*/
async function writeRender(filePath, slab, { width = 192, height = 108 } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const roof = await sharp({
    create: {
      width: Math.round((slab.x1 - slab.x0) * width),
      height: Math.round((slab.y1 - slab.y0) * height),
      channels: 3,
      background: { r: 235, g: 236, b: 238 },
    },
  })
    .png()
    .toBuffer();
  await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 80, b: 40 } },
  })
    .composite([
      {
        input: roof,
        top: Math.round(slab.y0 * height),
        left: Math.round(slab.x0 * width),
      },
    ])
    .jpeg({ quality: 95 })
    .toFile(filePath);
}

function fitConfig(inputs, outputDir, extra = {}) {
  return {
    outputDir,
    inputs,
    skuPrefixes: ["CAR-"],
    rules: [
      {
        endsWith: "-0",
        fit: "product",
        ladder: ["1:1", "4:3", "16:9"],
        width: 150,
        upscale: true,
      },
      { width: 150 },
    ],
    outputConfig: { jpegQuality: 90 },
    ...extra,
  };
}

async function size(filePath) {
  const meta = await sharp(filePath).metadata();
  return `${meta.width}x${meta.height}`;
}

const windowLeft = (entry) => Number(entry.plan.match(/at (\d+),/)[1]);

test("a product that fits a square is cropped square and offset to hold it whole", async (t) => {
  const root = await makeTempDir(t);
  const dir = path.join(root, "in", "Carport 3x2.5");
  const outputDir = path.join(root, "out");
  // Slab across 0.16..0.70: narrower than the 108px square, but a centred
  // square (left 42) would clip its left end.
  for (const colour of ["51", "71", "91"]) {
    await writeRender(path.join(dir, `CAR-1-${colour}-0.jpg`), {
      x0: 0.16,
      x1: 0.7,
      y0: 0.1,
      y1: 0.45,
    });
  }

  const summary = await run(
    fitConfig([{ path: dir, category: "Carport" }], outputDir),
    { logger: silentLogger },
  );

  const out = path.join(outputDir, "Carport", "CAR-1-51-0.jpg");
  assert.equal(await size(out), "150x150");
  const entry = summary.outputs.find((e) => e.outputPath === out);
  assert.equal(entry.aspect, "1:1");
  assert.equal(entry.fitSource, "detected");
  assert.equal(entry.square, true);
  assert.deepEqual([summary.fits.square, summary.fits.total], [3, 3]);

  assert.ok(entry.plan.includes("window 108x108"), entry.plan);
  assert.ok(windowLeft(entry) < 42, `expected an offset square, got ${entry.plan}`);
  // The whole slab is inside the window.
  assert.ok(windowLeft(entry) <= Math.round(0.16 * 192), entry.plan);
  assert.ok(windowLeft(entry) + 108 >= Math.round(0.7 * 192), entry.plan);
});

test("a product too wide for a square steps up to a wider output format", async (t) => {
  const root = await makeTempDir(t);
  const dir = path.join(root, "in", "Carport 12x4");
  const outputDir = path.join(root, "out");
  for (const colour of ["51", "71"]) {
    await writeRender(path.join(dir, `CAR-2-${colour}-0.jpg`), {
      x0: 0.08,
      x1: 0.82,
      y0: 0.08,
      y1: 0.5,
    });
  }

  const summary = await run(
    fitConfig([{ path: dir, category: "Carport" }], outputDir),
    { logger: silentLogger },
  );

  const out = path.join(outputDir, "Carport", "CAR-2-51-0.jpg");
  // 4:3 of a 108px-high frame is 144px wide, scaled up to 150x113.
  assert.equal(await size(out), "150x113");
  const entry = summary.outputs.find((e) => e.outputPath === out);
  assert.equal(entry.aspect, "4:3");
  assert.equal(entry.square, false);
  assert.equal(summary.fits.square, 0);
  assert.deepEqual(summary.fits.byAspect, { "4:3": 2 });
});

test("one box is resolved per folder, so the colour variants are framed identically", async (t) => {
  const root = await makeTempDir(t);
  const small = path.join(root, "in", "Carport 3x2.5");
  const wide = path.join(root, "in", "Carport 12x4");
  const outputDir = path.join(root, "out");
  const slab = { x0: 0.16, x1: 0.7, y0: 0.1, y1: 0.45 };
  await writeRender(path.join(small, "CAR-1-51-0.jpg"), slab);
  await writeRender(path.join(small, "CAR-1-71-0.jpg"), slab);
  await writeRender(path.join(wide, "CAR-2-51-0.jpg"), { x0: 0.08, x1: 0.82, y0: 0.08, y1: 0.5 });

  const logs = [];
  const summary = await run(
    fitConfig([{ path: path.join(root, "in"), category: "Carport" }], outputDir),
    { logger: { ...silentLogger, log: (m) => logs.push(m) } },
  );

  assert.ok(
    logs.some((m) => m.includes("Detecting the product in 2 folder(s)")),
    logs.join("\n"),
  );
  const variants = summary.outputs.filter((e) => e.baseName?.startsWith("CAR-1") ?? e.outputPath.includes("CAR-1"));
  assert.equal(variants.length, 2);
  assert.equal(variants[0].aspect, variants[1].aspect);
  assert.equal(windowLeft(variants[0]), windowLeft(variants[1]));
});

test("a fitOverride replaces what detection chose, matched on the source path", async (t) => {
  const root = await makeTempDir(t);
  const dir = path.join(root, "in", "Carport 4x2.5");
  const outputDir = path.join(root, "out");
  await writeRender(path.join(dir, "CAR-3-51-0.jpg"), { x0: 0.16, x1: 0.7, y0: 0.1, y1: 0.45 });

  const summary = await run(
    fitConfig([{ path: dir, category: "Carport" }], outputDir, {
      fitOverrides: [{ match: "Carport 4x2.5", aspect: "16:9", left: 0 }],
    }),
    { logger: silentLogger },
  );

  const entry = summary.outputs[0];
  assert.equal(entry.aspect, "16:9");
  assert.equal(entry.fitSource, "override");
  assert.equal(summary.fits.overridden, 1);
  assert.equal(windowLeft(entry), 0);
});

test("a folder with no detectable product keeps the framing of the rule and is warned about", async (t) => {
  const root = await makeTempDir(t);
  const dir = path.join(root, "in", "Carport dark");
  const outputDir = path.join(root, "out");
  await fs.mkdir(dir, { recursive: true });
  // All dark: nothing for the detector to latch onto.
  await sharp({
    create: { width: 192, height: 108, channels: 3, background: { r: 20, g: 60, b: 30 } },
  })
    .jpeg()
    .toFile(path.join(dir, "CAR-4-51-0.jpg"));

  const warnings = [];
  const summary = await run(
    fitConfig([{ path: dir, category: "Carport" }], outputDir),
    { logger: { ...silentLogger, warn: (m) => warnings.push(m) } },
  );

  const entry = summary.outputs[0];
  assert.equal(entry.fitSource, "undetected");
  assert.equal(summary.fits.undetected, 1);
  assert.ok(
    warnings.some((m) => m.includes("no product detected in 1 folder(s)")),
    warnings.join("\n"),
  );
  // It still produced a file, using the aspect the rule asked for.
  assert.deepEqual(await listFiles(outputDir), ["Carport/CAR-4-51-0.jpg"]);
});

test("rules without fit are untouched by all this", async (t) => {
  const root = await makeTempDir(t);
  const dir = path.join(root, "in", "Carport 3x2.5");
  const outputDir = path.join(root, "out");
  await writeRender(path.join(dir, "CAR-1-51-3.jpg"), { x0: 0.16, x1: 0.7, y0: 0.1, y1: 0.45 });

  const summary = await run(
    fitConfig([{ path: dir, category: "Carport" }], outputDir),
    { logger: silentLogger },
  );

  const entry = summary.outputs[0];
  assert.equal(entry.rule, 2);
  assert.equal(entry.fitSource, null);
  assert.equal(summary.fits, null);
  assert.equal(await size(path.join(outputDir, "Carport", "CAR-1-51-3.jpg")), "150x84");
});
