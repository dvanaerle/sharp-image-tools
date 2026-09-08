"use strict";

const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;
const { getAllFiles } = require("./discover");
const { matchRule, findShadowedRules, isEligibleFile } = require("./rules");
const { createCropWindow } = require("./crop-window");
const { getOrientedDimensions, isPositiveNumber } = require("./crop-plan");
const {
  getOutputFormatForSource,
  getExtensionForFormat,
  applyOutputFormat,
} = require("./pipeline");

// Windows paths compare case-insensitively; a mistyped drive-letter case
// must not slip past the read-only guard.
function comparablePath(p) {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInsideOrEqual(child, parent) {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  // Compare the first segment, so a sibling named "..export" is not mistaken
  // for a parent walk.
  return rel.split(path.sep)[0] !== "..";
}

// Inputs are read-only: refuse to run when the output root is one of them
// or sits below one of them.
function assertOutputOutsideInputs(outputDir, inputs) {
  const out = comparablePath(outputDir);
  for (const input of inputs) {
    if (isInsideOrEqual(out, comparablePath(input.path))) {
      throw new Error(
        `Refusing to run: output root ${path.resolve(outputDir)} is inside input path ${path.resolve(input.path)}`,
      );
    }
  }
}

function warnShadowedRules(rules, logger) {
  for (const { index, shadowedBy } of findShadowedRules(rules)) {
    logger.warn(
      `Warning: rule ${index + 1} ${JSON.stringify(rules[index])} is fully shadowed by rule ${shadowedBy + 1} ${JSON.stringify(rules[shadowedBy])} and can never match.`,
    );
  }
}

// Walks every input and splits its files into eligible sources (with their
// rule and output path) and ignored files. Nothing is opened here.
async function planInputs(config) {
  const { inputs, outputDir, skuPrefixes, rules } = config;
  const sources = [];
  const ignored = [];
  for (const { path: inputPath, category } of inputs) {
    for (const file of await getAllFiles(inputPath)) {
      if (!isEligibleFile(path.basename(file), skuPrefixes)) {
        ignored.push({ sourcePath: file, category, status: "ignored" });
        continue;
      }
      const baseName = path.parse(file).name;
      const format = getOutputFormatForSource(file);
      const outputPath = path.join(
        outputDir,
        category,
        `${baseName}.${getExtensionForFormat(format)}`,
      );
      const rule = matchRule(rules, baseName);
      sources.push({
        sourcePath: file,
        category,
        baseName,
        format,
        outputPath,
        rule,
        ruleIndex: rule ? rules.indexOf(rule) : -1,
      });
    }
  }
  return { sources, ignored };
}

function assertNoCollisions(sources) {
  const seen = new Map();
  const collisions = [];
  for (const source of sources) {
    const key = comparablePath(source.outputPath);
    if (seen.has(key)) {
      collisions.push(
        `${source.outputPath}\n    from ${seen.get(key)}\n    from ${source.sourcePath}`,
      );
    } else {
      seen.set(key, source.sourcePath);
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Refusing to run: ${collisions.length} output path collision(s):\n  ${collisions.join("\n  ")}`,
    );
  }
}

async function processSource({ source, config, logger }) {
  const { sourcePath, outputPath, category, format, rule, ruleIndex } = source;
  const entry = { sourcePath, outputPath, category, format, ruleIndex };
  logger.log(`\nProcessing: ${sourcePath}`);

  if (!rule) {
    logger.warn("  Skipping: no rule matches.");
    return { ...entry, status: "skipped", reason: "no-rule" };
  }

  try {
    const metadata = await sharp(sourcePath).metadata();
    const { width: srcWidth, height: srcHeight } =
      getOrientedDimensions(metadata);
    if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
      logger.warn("  Skipping: could not read source dimensions.");
      return { ...entry, status: "skipped", reason: "no-dimensions" };
    }

    const window = createCropWindow({ srcWidth, srcHeight, rule });
    logger.log(
      `  Rule ${ruleIndex + 1}: window ${window.width}x${window.height} at ${window.left},${window.top} of ${srcWidth}x${srcHeight} -> ${window.outputWidth}x${window.outputHeight}`,
    );

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const pipeline = sharp(sourcePath)
      .autoOrient()
      .extract({
        left: window.left,
        top: window.top,
        width: window.width,
        height: window.height,
      })
      .resize(window.outputWidth, window.outputHeight, { fit: "fill" });
    await applyOutputFormat(pipeline, format, config.outputConfig).toFile(
      outputPath,
    );
    logger.log(`  Saved: ${outputPath}`);
    return {
      ...entry,
      width: window.outputWidth,
      height: window.outputHeight,
      status: "saved",
    };
  } catch (err) {
    logger.error(`  Error processing ${sourcePath}:`, err);
    return { ...entry, status: "failed", reason: "source-error", error: err };
  }
}

// Rule-mode counterpart of run(): `config` is already normalised.
async function runRules(config, { logger }) {
  warnShadowedRules(config.rules, logger);
  assertOutputOutsideInputs(config.outputDir, config.inputs);

  const { sources, ignored } = await planInputs(config);
  assertNoCollisions(sources);
  logger.log(
    `Found ${sources.length} eligible image(s) across ${config.inputs.length} input(s); ignoring ${ignored.length} file(s)`,
  );

  const outputs = [];
  for (const source of sources) {
    outputs.push(await processSource({ source, config, logger }));
  }

  const counts = { saved: 0, skipped: 0, failed: 0, ignored: ignored.length };
  for (const entry of outputs) counts[entry.status] += 1;

  logger.log("\nAll images processed!");
  if (ignored.length > 0) {
    logger.log(`Ignored ${ignored.length} file(s):`);
    for (const entry of ignored) logger.log(`  ${entry.sourcePath}`);
  }

  return {
    inputs: config.inputs,
    outputDir: config.outputDir,
    sourceCount: sources.length,
    outputs,
    ignored,
    counts,
  };
}

module.exports = { runRules, assertOutputOutsideInputs, assertNoCollisions };
