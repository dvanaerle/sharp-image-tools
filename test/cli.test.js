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
    "--name=-0",
    "--dry-run",
    "--force",
    "--report=out.csv",
  ]);
  assert.deepEqual(runOptions, {
    concurrency: 8,
    limit: 5,
    only: "Ledspots",
    name: "-0",
    dryRun: true,
    force: true,
    report: "out.csv",
  });
});

test("missing values, bad numbers and unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["--config"]), /--config requires a value/);
  assert.throws(() => parseArgs(["--only"]), /--only requires a value/);
  assert.throws(() => parseArgs(["--only", "--force"]), /--only requires a value/);
  assert.throws(() => parseArgs(["--name"]), /--name requires a value/);
  assert.throws(() => parseArgs(["--concurrency", "0"]), /--concurrency must be a positive integer/);
  assert.throws(() => parseArgs(["--limit", "abc"]), /--limit must be a positive integer/);
  assert.throws(() => parseArgs(["--dry-run=yes"]), /--dry-run does not take a value/);
  assert.throws(() => parseArgs(["--confg", "x.js"]), /Unknown argument: --confg/);
  assert.throws(() => parseArgs(["stray"]), /Unknown argument: stray/);
});

test("the shipped Channable config is a valid rule config", () => {
  const { normalizeConfig } = require("../src/config");
  const { findShadowedRules } = require("../src/rules");
  const config = require("../configs/channable.js");
  const normalized = normalizeConfig(config);
  assert.equal(normalized.mode, "rules");
  assert.equal(normalized.inputs.length, 20);
  assert.ok(normalized.inputs.some((i) => /Origineel[\\/]Nieuwe map$/.test(i.path)));
  // The main image is fitted per product; everything else keeps the frame.
  assert.deepEqual(normalized.rules.map((r) => r.fit ?? "none"), ["product", "none"]);
  assert.deepEqual(normalized.rules.map((r) => r.endsWith ?? null), ["-0", null]);
  assert.deepEqual(normalized.rules[0].ladder, ["1:1", "5:4", "4:3", "3:2", "16:9"]);
  assert.deepEqual(findShadowedRules(normalized.rules), []);
  // Overrides are hand corrections, so their values are not asserted here;
  // what matters is that every one of them is well formed and specific enough
  // to pin a single folder.
  for (const override of normalized.fitOverrides) {
    assert.match(override.match, /\/$/, `${override.match} should end with a slash`);
    assert.ok(override.aspect !== undefined || override.left !== undefined);
  }
  assert.equal(normalized.outputConfig.jpegQuality, 80);
  assert.equal(normalized.outputDir, "./google-channable-export");
});
