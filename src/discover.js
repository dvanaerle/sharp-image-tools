"use strict";

const path = require("path");
const fs = require("fs").promises;

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

// Recursively lists every image file under `dir`.
async function getImageFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return getImageFiles(fullPath);
      }
      if (entry.isFile() && IMAGE_RE.test(entry.name)) {
        return fullPath;
      }
      return [];
    }),
  );
  return files.flat();
}

// Recursively lists every file under `dir`, images or not, so callers can
// report what they ignored without ever opening it.
async function getAllFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return getAllFiles(fullPath);
      return entry.isFile() ? [fullPath] : [];
    }),
  );
  return files.flat();
}

// Describes where an image sits relative to the input root, so presets and
// watermark locales can be matched against its folder names.
function getImageContext({ inputDir, imageFile }) {
  const relativePath = path.relative(inputDir, imageFile);
  const relativeDir = path.dirname(relativePath);
  const dirSegments = relativeDir === "." ? [] : relativeDir.split(path.sep);

  return {
    srcImage: imageFile,
    relativePath,
    baseName: path.parse(relativePath).name,
    relativeDir,
    dirSegments,
    dirSegmentsLower: dirSegments.map((segment) => segment.toLowerCase()),
  };
}

module.exports = { IMAGE_RE, getImageFiles, getAllFiles, getImageContext };
