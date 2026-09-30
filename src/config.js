"use strict";

const { isAspect, parseAspect } = require("./crop-window");

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
  if (!isAspect(aspect)) {
    throw new Error(`${label}.aspect must be "source" or a "w:h" ratio`);
  }
  const fit = rule.fit ?? "none";
  if (fit !== "none" && fit !== "product") {
    throw new Error(`${label}.fit must be "none" or "product"`);
  }
  if (rule.ladder !== undefined) {
    if (!Array.isArray(rule.ladder) || rule.ladder.length === 0) {
      throw new Error(`${label}.ladder must be a non-empty array of "w:h" ratios`);
    }
    for (const aspect of rule.ladder) {
      if (parseAspect(aspect) === null) {
        throw new Error(`${label}.ladder entries must be "w:h" ratios, got ${JSON.stringify(aspect)}`);
      }
    }
  }
  const fitMargin = rule.fitMargin ?? 0;
  if (!Number.isFinite(fitMargin) || fitMargin < 0 || fitMargin > 0.2) {
    throw new Error(`${label}.fitMargin must be a number between 0 and 0.2`);
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
  for (const key of ["startsWith", "endsWith", "category"]) {
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
  if (fit === "product") {
    normalized.fit = fit;
    normalized.fitMargin = fitMargin;
    if (rule.ladder !== undefined) normalized.ladder = [...rule.ladder];
  }
  if (rule.startsWith !== undefined) normalized.startsWith = rule.startsWith;
  if (rule.endsWith !== undefined) normalized.endsWith = rule.endsWith;
  if (rule.category !== undefined) normalized.category = rule.category;
  return normalized;
}

/*
  Hand corrections for `fit: "product"`. Each entry matches a source path by
  case-insensitive substring (the size folder name is the useful handle) and
  replaces what detection would have chosen. `aspect` forces the output
  format, `left` the horizontal anchor (0 flush left, 0.5 centred, 1 flush
  right); either may be given on its own.
*/
function normalizeFitOverrides(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("config.fitOverrides must be an array");
  }
  return raw.map((override, index) => {
    const label = `config.fitOverrides[${index}]`;
    if (typeof override?.match !== "string" || override.match.length === 0) {
      throw new Error(`${label}.match must be a non-empty string`);
    }
    if (override.aspect !== undefined && !isAspect(override.aspect)) {
      throw new Error(`${label}.aspect must be "source" or a "w:h" ratio`);
    }
    if (override.left !== undefined && !isAnchor(override.left)) {
      throw new Error(`${label}.left must be between 0 and 1`);
    }
    if (override.aspect === undefined && override.left === undefined) {
      throw new Error(`${label} must set aspect, left, or both`);
    }
    const normalized = { match: override.match };
    if (override.aspect !== undefined) normalized.aspect = override.aspect;
    if (override.left !== undefined) normalized.left = override.left;
    return normalized;
  });
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
  const fitOverrides = normalizeFitOverrides(raw.fitOverrides ?? []);

  return {
    mode: "rules",
    outputDir: raw.outputDir,
    inputs: raw.inputs.map(({ path, category }) => ({ path, category })),
    skuPrefixes: [...raw.skuPrefixes],
    rules: raw.rules.map(normalizeRule),
    fitOverrides,
    outputConfig: { ...DEFAULT_OUTPUT_CONFIG, ...(raw.outputConfig ?? {}) },
  };
}

module.exports = {
  DEFAULT_OUTPUT_CONFIG,
  normalizeConfig,
  normalizeRule,
  normalizeFitOverrides,
};
