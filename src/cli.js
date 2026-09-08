"use strict";

const path = require("path");

/*
  Command-line flags. `--config` picks the config file; the rest map onto
  run() options. Any other argument is an error: a mistyped flag must not
  silently run the root config against real folders.
*/
const FLAGS = {
  "--config": { kind: "string", option: "configPath" },
  "--concurrency": { kind: "integer", option: "concurrency" },
  "--limit": { kind: "integer", option: "limit" },
  "--only": { kind: "string", option: "only" },
  "--report": { kind: "string", option: "report" },
  "--dry-run": { kind: "boolean", option: "dryRun" },
  "--force": { kind: "boolean", option: "force" },
};

function parseInteger(flag, raw) {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

// Accepts `--flag value` and `--flag=value`; booleans take no value.
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const spec = FLAGS[flag];
    if (!spec || !arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (spec.kind === "boolean") {
      if (eq !== -1) throw new Error(`${flag} does not take a value`);
      parsed[spec.option] = true;
      continue;
    }

    let raw;
    if (eq !== -1) {
      raw = arg.slice(eq + 1);
    } else {
      raw = argv[i + 1];
      i += 1;
    }
    if (raw === undefined || raw === "" || raw.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    parsed[spec.option] = spec.kind === "integer" ? parseInteger(flag, raw) : raw;
  }

  const { configPath = null, ...runOptions } = parsed;
  return { configPath, runOptions };
}

// Without --config the root config.js loads, so existing runs are unchanged.
function resolveConfigPath(configPath, rootDir, cwd = process.cwd()) {
  return configPath
    ? path.resolve(cwd, configPath)
    : path.resolve(rootDir, "config.js");
}

// Returns { config, runOptions } for the entrypoint.
function loadConfig(argv, rootDir) {
  const { configPath, runOptions } = parseArgs(argv);
  return { config: require(resolveConfigPath(configPath, rootDir)), runOptions };
}

module.exports = { parseArgs, resolveConfigPath, loadConfig };
