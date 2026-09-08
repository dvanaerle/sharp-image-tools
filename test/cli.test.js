"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { parseArgs, resolveConfigPath } = require("../src/cli");

const root = path.resolve(__dirname, "..");

test("without --config the root config is used", () => {
  assert.deepEqual(parseArgs([]), { configPath: null });
  assert.equal(resolveConfigPath(null, root), path.join(root, "config.js"));
});

test("--config <path> selects a config file relative to the working directory", () => {
  assert.deepEqual(parseArgs(["--config", "configs/channable.js"]), {
    configPath: "configs/channable.js",
  });
  assert.deepEqual(parseArgs(["--config=configs/channable.js"]), {
    configPath: "configs/channable.js",
  });
  assert.equal(
    resolveConfigPath("configs/channable.js", root),
    path.join(root, "configs", "channable.js"),
  );
});

test("--config without a value is rejected", () => {
  assert.throws(() => parseArgs(["--config"]), /--config requires a path/);
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
