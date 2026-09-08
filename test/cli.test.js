"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { parseArgs, resolveConfigPath } = require("../src/cli");

const root = path.resolve(__dirname, "..");

test("without --config the root config is used and no run option is set", () => {
  assert.deepEqual(parseArgs([]), { configPath: null, runOptions: {} });
  assert.equal(resolveConfigPath(null, root), path.join(root, "config.js"));
});

test("--config <path> selects a config file relative to the working directory", () => {
  assert.equal(parseArgs(["--config", "configs/channable.js"]).configPath, "configs/channable.js");
  assert.equal(parseArgs(["--config=configs/channable.js"]).configPath, "configs/channable.js");
  assert.equal(
    resolveConfigPath("configs/channable.js", root),
    path.join(root, "configs", "channable.js"),
  );
});

test("run-control flags map onto run() options, in both --flag value and --flag=value form", () => {
  const { runOptions } = parseArgs([
    "--concurrency", "8",
    "--limit=5",
    "--only", "Ledspots",
    "--dry-run",
    "--force",
    "--report=out.csv",
  ]);
  assert.deepEqual(runOptions, {
    concurrency: 8,
    limit: 5,
    only: "Ledspots",
    dryRun: true,
    force: true,
    report: "out.csv",
  });
});

test("missing values, bad numbers and unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["--config"]), /--config requires a value/);
  assert.throws(() => parseArgs(["--only"]), /--only requires a value/);
  assert.throws(() => parseArgs(["--only", "--force"]), /--only requires a value/);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency must be a positive integer/);
  assert.throws(() => parseArgs(["--limit", "abc"]), /--limit must be a positive integer/);
  assert.throws(() => parseArgs(["--dry-run=yes"]), /--dry-run does not take a value/);
  assert.throws(() => parseArgs(["--confg", "x.js"]), /Unknown argument: --confg/);
  assert.throws(() => parseArgs(["stray"]), /Unknown argument: stray/);
});

test("the shipped Channable config is a valid rule config", () => {
  const { normalizeConfig } = require("../src/config");
  const config = require("../configs/channable.js");
  const normalized = normalizeConfig(config);
  assert.equal(normalized.mode, "rules");
  assert.equal(normalized.inputs.length, 20);
  assert.ok(normalized.inputs.some((i) => /Origineel[\\/]Nieuwe map$/.test(i.path)));
  assert.deepEqual(normalized.rules.map((r) => r.aspect), ["1:1", "source"]);
  assert.equal(normalized.outputConfig.jpegQuality, 80);
  assert.equal(normalized.outputDir, "./google-channable-export");
});
