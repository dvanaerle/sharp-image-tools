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
const {
  matchesOnly,
  isUpToDate,
  createWriteBudget,
  mapConcurrent,
  createProgress,
} = require("./run-control");
const { buildSummary, printSummary, describeError } = require("./summary");

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

// --only keeps the input entries whose path or category label contains the
// substring. The read-only guard still checks every configured input.
function selectInputs(inputs, only, logger) {
  const selected = inputs.filter((input) =>
    matchesOnly(only, input.path, input.category),
  );
  if (only !== null && selected.length === 0) {
    logger.warn(`Warning: no input path or category contains "${only}".`);
  }
  return selected;
}

// Walks every input and splits its files into eligible sources (with their
// rule and output path) and ignored files. Nothing is opened here.
async function planInputs({ inputs, outputDir, skuPrefixes, rules }) {
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

function describeWindow(window, srcWidth, srcHeight) {
  return `window ${window.width}x${window.height} at ${window.left},${window.top} of ${srcWidth}x${srcHeight} -> ${window.outputWidth}x${window.outputHeight}`;
}

/*
  Processes one eligible source and returns its summary entry. Nothing is
  logged here: with several sources in flight, the runner prints one line per
  finished file instead. Order of checks: rule, skip-existing, plan, dry-run,
  write budget, write.
*/
async function processSource({ source, config, force, dryRun, budget }) {
  const { sourcePath, outputPath, category, format, rule, ruleIndex } = source;
  const entry = {
    sourcePath,
    outputPath,
    category,
    format,
    ruleIndex,
    rule: ruleIndex === -1 ? null : ruleIndex + 1,
  };

  if (!rule) return { ...entry, status: "skipped", reason: "no-rule" };

  try {
    if (!force && (await isUpToDate(sourcePath, outputPath))) {
      return { ...entry, status: "skipped", reason: "up-to-date" };
    }

    const metadata = await sharp(sourcePath).metadata();
    const { width: srcWidth, height: srcHeight } =
      getOrientedDimensions(metadata);
    if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
      return { ...entry, status: "skipped", reason: "no-dimensions" };
    }

    const window = createCropWindow({ srcWidth, srcHeight, rule });
    const planned = {
      ...entry,
      srcWidth,
      srcHeight,
      width: window.outputWidth,
      height: window.outputHeight,
      plan: `rule ${ruleIndex + 1}: ${describeWindow(window, srcWidth, srcHeight)}`,
    };

    if (dryRun) return { ...planned, status: "planned" };
    if (!budget.claim()) return { ...planned, status: "skipped", reason: "limit" };

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
    return { ...planned, status: "saved" };
  } catch (err) {
    return { ...entry, status: "failed", reason: "source-error", error: err };
  }
}

function describeEntry(entry) {
  switch (entry.status) {
    case "saved":
      return `saved   ${entry.sourcePath} -> ${entry.outputPath}`;
    case "planned":
      return `plan    ${entry.sourcePath}: ${entry.plan}, ${entry.outputPath}`;
    case "skipped":
      return `skipped ${entry.sourcePath} (${entry.reason})`;
    default:
      return `FAILED  ${entry.sourcePath}: ${describeError(entry.error)}`;
  }
}

// Rule-mode counterpart of run(): `config` and `options` are already normalised.
async function runRules(config, options) {
  const { logger, concurrency, force, limit, only, dryRun } = options;
  warnShadowedRules(config.rules, logger);
  assertOutputOutsideInputs(config.outputDir, config.inputs);

  const inputs = selectInputs(config.inputs, only, logger);
  const { sources, ignored } = await planInputs({ ...config, inputs });
  assertNoCollisions(sources);
  logger.log(
    `Found ${sources.length} eligible image(s) across ${inputs.length} input(s); ignoring ${ignored.length} file(s)${dryRun ? " (dry run, nothing will be written)" : ""}`,
  );

  const budget = createWriteBudget(limit);
  const progress = createProgress(sources.length, logger);
  const results = await mapConcurrent(
    sources,
    concurrency,
    async (source) => {
      const entry = await processSource({ source, config, force, dryRun, budget });
      progress.tick(describeEntry(entry));
      return entry;
    },
    { shouldStop: () => budget.exhausted() },
  );
  const outputs = results.filter((entry) => entry !== undefined);
  if (outputs.length < sources.length) {
    logger.log(
      `Limit of ${limit} written file(s) reached; ${sources.length - outputs.length} source(s) not processed.`,
    );
  }

  const summary = buildSummary({
    mode: "rules",
    inputs,
    outputDir: config.outputDir,
    sourceCount: sources.length,
    outputs,
    ignored,
    dryRun,
  });
  printSummary(summary, logger);
  return summary;
}

module.exports = { runRules, assertOutputOutsideInputs, assertNoCollisions };
