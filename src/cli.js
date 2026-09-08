"use strict";

const path = require("path");

// Parses `--config <path>` / `--config=<path>`. Anything else is left alone
// so later tickets can add their own flags.
function parseArgs(argv) {
  let configPath = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--config requires a path");
      }
      configPath = value;
      i += 1;
    } else if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      if (!configPath) throw new Error("--config requires a path");
    }
  }
  return { configPath };
}

// Without --config the root config.js loads, so existing runs are unchanged.
function resolveConfigPath(configPath, rootDir, cwd = process.cwd()) {
  return configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(rootDir, "config.js");
}

function loadConfig(argv, rootDir) {
  const { configPath } = parseArgs(argv);
  return require(resolveConfigPath(configPath, rootDir));
}

module.exports = { parseArgs, resolveConfigPath, loadConfig };
