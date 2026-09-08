"use strict";

const { run } = require("./src/run");
const { loadConfig } = require("./src/cli");

if (require.main === module) {
  // `--config <path>` selects a config file; without it ./config.js loads.
  let config;
  try {
    config = loadConfig(process.argv.slice(2), __dirname);
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exitCode = 1;
  }
  if (config) {
    run(config).catch((err) => {
      console.error("Fatal error:", err);
      process.exitCode = 1;
    });
  }
}

module.exports = { run };
