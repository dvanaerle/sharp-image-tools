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
  if (typeof raw.outputDir !== "string" || raw.outputDir.length === 0) {
    throw new Error("config.outputDir must be a non-empty string");
  }
  if (Array.isArray(raw.inputs)) {
    return normalizeRuleConfig(raw);
  }
  if (typeof raw.inputDir !== "string" || raw.inputDir.length === 0) {
    throw new Error("config.inputDir must be a non-empty string");
  }

  return {
    mode: "presets",
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

function isAnchor(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizeRule(rule, index) {
  const label = `config.rules[${index}]`;
  if (!Number.isFinite(rule.width) || rule.width <= 0) {
    throw new Error(`${label}.width must be a positive number`);
  }
  const aspect = rule.aspect ?? "source";
  if (aspect !== "1:1" && aspect !== "source") {
    throw new Error(`${label}.aspect must be "1:1" or "source"`);
  }
  const zoom = rule.zoom ?? 1;
  if (!Number.isFinite(zoom) || zoom < 1) {
    throw new Error(`${label}.zoom must be a number >= 1`);
  }
  const top = rule.top ?? 0.5;
  const left = rule.left ?? 0.5;
  if (!isAnchor(top) || !isAnchor(left)) {
    throw new Error(`${label}.top and .left must be between 0 and 1`);
  }
  for (const key of ["startsWith", "endsWith"]) {
    if (rule[key] !== undefined && typeof rule[key] !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
  }
  const normalized = {
    width: rule.width,
    aspect,
    zoom,
    top,
    left,
    upscale: rule.upscale === true,
  };
  if (rule.startsWith !== undefined) normalized.startsWith = rule.startsWith;
  if (rule.endsWith !== undefined) normalized.endsWith = rule.endsWith;
  return normalized;
}

/*
  Rule-based config (Channable): an ordered list of `inputs`
  ({ path, category }), `skuPrefixes` for eligibility, and filename `rules`.
  Watermark, overlay and naming normalisation do not exist in this mode, so
  any such sections in the raw config are dropped rather than applied.
*/
function normalizeRuleConfig(raw) {
  if (raw.inputs.length === 0) {
    throw new Error("config.inputs must list at least one { path, category }");
  }
  raw.inputs.forEach((input, index) => {
    if (typeof input?.path !== "string" || input.path.length === 0) {
      throw new Error(`config.inputs[${index}].path must be a non-empty string`);
    }
    if (typeof input.category !== "string" || input.category.length === 0) {
      throw new Error(
        `config.inputs[${index}].category must be a non-empty string`,
      );
    }
  });
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new Error("config.rules must be a non-empty array");
  }
  if (!Array.isArray(raw.skuPrefixes) || raw.skuPrefixes.length === 0) {
    throw new Error("config.skuPrefixes must be a non-empty array");
  }

  return {
    mode: "rules",
    outputDir: raw.outputDir,
    inputs: raw.inputs.map(({ path, category }) => ({ path, category })),
    skuPrefixes: [...raw.skuPrefixes],
    rules: raw.rules.map(normalizeRule),
    outputConfig: { ...DEFAULT_OUTPUT_CONFIG, ...(raw.outputConfig ?? {}) },
  };
}

module.exports = { DEFAULT_OUTPUT_CONFIG, normalizeConfig, normalizeRule };
