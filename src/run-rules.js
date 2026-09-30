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
const { matchesOnly, isUpToDate, runBatch, mapConcurrent } = require("./run-control");
const { detectProductBox, consensusBox } = require("./detect-product");
const { planFit } = require("./fit-product");
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
      const rule = matchRule(rules, baseName, category);
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

// --name keeps the eligible sources whose basename contains the substring, so
// a re-run can target one index suffix ("-0") without touching the rest.
function selectSources(sources, name, logger) {
  if (name === null) return sources;
  const selected = sources.filter((source) => matchesOnly(name, source.baseName));
  if (selected.length === 0) {
    logger.warn(`Warning: no eligible filename contains "${name}".`);
  }
  return selected;
}

// The colour variants of one product sit in the same folder and share its
// scene, so `fit: "product"` resolves one box per folder rather than per file.
function fitGroupKey(source) {
  return comparablePath(path.dirname(source.sourcePath));
}

// Separators are normalised so a `match` can be written with forward slashes
// whichever way the configured input paths are spelled. Ending a match with a
// slash pins it to a whole folder, which matters when one folder name is a
// prefix of another ("Carport 11x3" also matches "Carport 11x3.5").
const forOverrideMatch = (text) => text.split("\\").join("/").toLowerCase();

function findOverride(overrides, sourcePath) {
  const haystack = forOverrideMatch(sourcePath);
  return (
    overrides.find((override) =>
      haystack.includes(forOverrideMatch(override.match)),
    ) ?? null
  );
}

/*
  Resolves the product box for every folder that has `fit: "product"` sources.
  Detection reads each file once at a small size; a folder whose detections all
  look implausible resolves to null and its files fall back to the rule's own
  aspect and anchors, which the summary reports.
*/
async function resolveFitGroups(sources, options) {
  const groups = new Map();
  for (const source of sources) {
    if (source.rule?.fit !== "product") continue;
    const key = fitGroupKey(source);
    if (!groups.has(key)) {
      groups.set(key, { key, dir: path.dirname(source.sourcePath), files: [] });
    }
    groups.get(key).files.push(source.sourcePath);
  }
  if (groups.size === 0) return new Map();

  const list = [...groups.values()];
  options.logger.log(
    `Detecting the product in ${list.length} folder(s) of ${sources.filter((s) => s.rule?.fit === "product").length} fitted image(s)`,
  );
  const resolved = await mapConcurrent(list, options.concurrency, async (group) => {
    const boxes = [];
    for (const file of group.files) {
      try {
        const box = await detectProductBox(file);
        if (box) boxes.push(box);
      } catch {
        // An unreadable file fails properly later, when it is processed.
      }
    }
    return {
      key: group.key,
      dir: group.dir,
      files: group.files,
      box: consensusBox(boxes),
    };
  });
  return new Map(resolved.map((entry) => [entry.key, entry]));
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
  Turns `fit: "product"` into a concrete aspect and anchor for one source: a
  hand override wins, then the folder's detected box, and failing both the
  rule is used as written. Returns the rule to crop with plus what decided it,
  for the plan line and the summary.
*/
function applyFit({ rule, sourcePath, srcWidth, srcHeight, fitGroups, overrides }) {
  if (rule.fit !== "product") {
    return { rule, source: null, square: null, note: "" };
  }

  const override = findOverride(overrides, sourcePath);
  if (override) {
    const merged = { ...rule, ...override };
    return {
      rule: merged,
      source: "override",
      square: merged.aspect === "1:1",
      note: ` [override ${override.match}: ${merged.aspect}]`,
    };
  }

  const group = fitGroups.get(comparablePath(path.dirname(sourcePath)));
  if (!group?.box) {
    return {
      rule,
      source: "undetected",
      square: rule.aspect === "1:1",
      note: " [product not detected]",
    };
  }

  const plan = planFit(group.box, srcWidth, srcHeight, {
    ladder: rule.ladder,
    margin: rule.fitMargin,
  });
  return {
    rule: { ...rule, aspect: plan.aspect, left: plan.left },
    source: "detected",
    square: plan.square,
    note: ` [fit ${plan.aspect} from ${group.box.agreed}/${group.box.of}${plan.fullFrame ? ", full frame" : ""}]`,
  };
}

/*
  Processes one eligible source and returns its summary entry. Nothing is
  logged here: with several sources in flight, the runner prints one line per
  finished file instead. Order of checks: rule, skip-existing, plan, write
  budget, write. A dry run plans first so every eligible file gets a plan
  line, and marks the ones a real run would skip as up to date.
*/
async function processSource({ source, config, force, dryRun, budget, fitGroups }) {
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
    const upToDate = !force && (await isUpToDate(sourcePath, outputPath));
    if (upToDate && !dryRun) {
      return { ...entry, status: "skipped", reason: "up-to-date" };
    }

    const metadata = await sharp(sourcePath).metadata();
    const { width: srcWidth, height: srcHeight } =
      getOrientedDimensions(metadata);
    if (!isPositiveNumber(srcWidth) || !isPositiveNumber(srcHeight)) {
      return { ...entry, status: "skipped", reason: "no-dimensions" };
    }

    const fitted = applyFit({
      rule,
      sourcePath,
      srcWidth,
      srcHeight,
      fitGroups,
      overrides: config.fitOverrides ?? [],
    });
    const window = createCropWindow({ srcWidth, srcHeight, rule: fitted.rule });
    const planned = {
      ...entry,
      srcWidth,
      srcHeight,
      width: window.outputWidth,
      height: window.outputHeight,
      aspect: fitted.rule.aspect,
      fitSource: fitted.source,
      square: fitted.square,
      plan: `rule ${ruleIndex + 1}: ${describeWindow(window, srcWidth, srcHeight)}${fitted.note}`,
    };

    if (dryRun) {
      return upToDate
        ? { ...planned, status: "skipped", reason: "up-to-date" }
        : { ...planned, status: "planned" };
    }
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
      return entry.plan
        ? `skip    ${entry.sourcePath}: ${entry.plan}, ${entry.outputPath} (${entry.reason})`
        : `skipped ${entry.sourcePath} (${entry.reason})`;
    default:
      return `FAILED  ${entry.sourcePath}: ${describeError(entry.error)}`;
  }
}

// Rule-mode counterpart of run(): `config` and `options` are already normalised.
async function runRules(config, options) {
  const { logger, force, only, name, dryRun } = options;
  warnShadowedRules(config.rules, logger);
  assertOutputOutsideInputs(config.outputDir, config.inputs);

  const inputs = selectInputs(config.inputs, only, logger);
  const { sources: eligible, ignored } = await planInputs({ ...config, inputs });
  assertNoCollisions(eligible);
  const sources = selectSources(eligible, name, logger);
  const filtered =
    sources.length === eligible.length
      ? ""
      : ` (${eligible.length - sources.length} filtered out by --name)`;
  logger.log(
    `Found ${sources.length} eligible image(s) across ${inputs.length} input(s)${filtered}; ignoring ${ignored.length} file(s)${dryRun ? " (dry run, nothing will be written)" : ""}`,
  );

  const fitGroups = await resolveFitGroups(sources, options);

  const outputs = await runBatch(
    sources,
    options,
    (source, budget) =>
      processSource({ source, config, force, dryRun, budget, fitGroups }),
    describeEntry,
  );

  // A folder the detector missed is only a problem when no override covers
  // it; with one in place the framing is decided, just not by detection.
  const overrides = config.fitOverrides ?? [];
  const undetected = [...fitGroups.values()].filter(
    (group) =>
      !group.box && !group.files.some((file) => findOverride(overrides, file)),
  );
  if (undetected.length > 0) {
    logger.warn(
      `Warning: no product detected in ${undetected.length} folder(s); their files keep the rule's own framing:\n  ${undetected
        .map((group) => group.dir)
        .join("\n  ")}`,
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

module.exports = {
  runRules,
  applyFit,
  resolveFitGroups,
  assertOutputOutsideInputs,
  assertNoCollisions,
  selectSources,
};
