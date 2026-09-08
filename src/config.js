"use strict";

const DEFAULT_OUTPUT_CONFIG = {
  jpegQuality: 75,
  pngCompressionLevel: 9,
  pngQuality: 90,
  pngDither: 0.8,
};

// Fills in defaults for every optional section so the rest of the code can
// read `config.x.y` without null checks. Paths are left untouched: relative
// inputDir/outputDir resolve against the process working directory, exactly
// as the root config has always behaved.
function normalizeConfig(raw = {}) {
  if (typeof raw.inputDir !== "string" || raw.inputDir.length === 0) {
    throw new Error("config.inputDir must be a non-empty string");
  }
  if (typeof raw.outputDir !== "string" || raw.outputDir.length === 0) {
    throw new Error("config.outputDir must be a non-empty string");
  }

  return {
    inputDir: raw.inputDir,
    outputDir: raw.outputDir,
    includeDimensionsInFileName: raw.includeDimensionsInFileName === true,
    formatsEnabled: raw.formatsEnabled === true,
    formats: Array.isArray(raw.formats) ? raw.formats : [],
    folderSizePresets: raw.folderSizePresets ?? {},
    namingConfig: raw.namingConfig ?? { enabled: false },
    imagePositionOverrides: raw.imagePositionOverrides ?? {},
    overlayConfig: raw.overlayConfig ?? { enabled: false },
    watermarkConfig: raw.watermarkConfig ?? { enabled: false },
    outputConfig: { ...DEFAULT_OUTPUT_CONFIG, ...(raw.outputConfig ?? {}) },
  };
}

module.exports = { DEFAULT_OUTPUT_CONFIG, normalizeConfig };
