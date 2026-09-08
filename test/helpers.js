"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

const silentLogger = { log() {}, warn() {}, error() {} };

const red = { r: 200, g: 40, b: 40 };
const blue = { r: 0, g: 0, b: 255 };

async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sharp-image-tools-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

// Writes a flat-colour fixture image; `format` is "jpeg" or "png".
async function writeImage(filePath, width, height, format = "jpeg", background = red) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const image = sharp({ create: { width, height, channels: 3, background } });
  await (format === "png" ? image.png() : image.jpeg()).toFile(filePath);
}

// Sorted posix-style relative paths of every file under `dir`.
async function listFiles(dir, prefix = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

async function pixelAt(filePath, left, top) {
  const { data } = await sharp(filePath)
    .extract({ left, top, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

module.exports = { silentLogger, red, blue, makeTempDir, writeImage, listFiles, pixelAt };
