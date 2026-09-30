"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sharp = require("sharp");
const { parseArgs, spread, parseReport, buildSheet } = require("../contact-sheet");
const { silentLogger, makeTempDir, writeImage } = require("./helpers");

test("the folder is positional and the rest are flags", () => {
  assert.deepEqual(parseArgs(["out/Carport", "--name", "-0", "--cols=3", "--tile", "100"]), {
    folder: "out/Carport",
    name: "-0",
    out: "contact-sheet.jpg",
    report: null,
    tile: 100,
    cols: 3,
    max: 60,
  });
  assert.throws(() => parseArgs([]), /Usage: node contact-sheet\.js/);
  assert.throws(() => parseArgs(["a", "b"]), /Unexpected argument: b/);
  assert.throws(() => parseArgs(["a", "--cols", "0"]), /--cols must be a positive integer/);
  assert.throws(() => parseArgs(["a", "--wat", "1"]), /Unknown argument: --wat/);
});

test("spread samples the whole list rather than its first entries", () => {
  assert.deepEqual(spread([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6], 3), [1, 3, 5]);
});

test("a sheet is a grid of tiles over the matching images", async (t) => {
  const root = await makeTempDir(t);
  const folder = path.join(root, "Carport");
  for (const name of ["CAR-1-51-0.jpg", "CAR-2-51-0.jpg", "CAR-1-51-1.jpg", "notes.txt"]) {
    await writeImage(path.join(folder, name), 150, 150);
  }
  const out = path.join(root, "sheets", "carport.jpg");

  const result = await buildSheet(
    { folder, out, name: "-0", report: null, tile: 50, cols: 2, max: 60 },
    silentLogger,
  );

  assert.deepEqual([result.shown, result.total], [2, 2]);
  const meta = await sharp(out).metadata();
  // One row of two 50px tiles, each with a label strip under it.
  assert.deepEqual([meta.width, meta.height], [100, 84]);
});

test("a report groups and labels the tiles by their source folder", () => {
  const csv = [
    "source,output,rule,source size,output size,aspect,fit,status",
    // A quoted source, because a Windows path may contain a comma.
    '"V:/renders/Carport 12x4, wide/CAR-2-51-0.jpg",out/Carport/CAR-2-51-0.jpg,1,1920x1080,1500x1125,4:3,detected,saved',
    "V:/renders/Carport 3x2.5/CAR-1-51-0.jpg,out/Carport/CAR-1-51-0.jpg,1,1920x1080,1500x1500,1:1,detected,saved",
    "V:/renders/Carport 3x2.5/Thumbs.db,,,,,,,ignored",
  ].join("\n");

  const folders = parseReport(csv);
  assert.equal(folders.get("CAR-2-51-0"), "Carport 12x4, wide");
  assert.equal(folders.get("CAR-1-51-0"), "Carport 3x2.5");
  // Ignored rows have no output, so they contribute nothing.
  assert.equal(folders.size, 2);
});

test("a folder with no matching image is an error, not an empty sheet", async (t) => {
  const root = await makeTempDir(t);
  await writeImage(path.join(root, "CAR-1-51-1.jpg"), 20, 20);
  await assert.rejects(
    () =>
      buildSheet(
        { folder: root, out: path.join(root, "s.jpg"), name: "-0", report: null, tile: 50, cols: 2, max: 60 },
        silentLogger,
      ),
    /No matching images under/,
  );
});
