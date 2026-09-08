"use strict";

const { run } = require("./src/run");
const { loadConfig } = require("./src/cli");

if (require.main === module) {
  // `--config <path>` selects a config file; without it ./config.js loads.
  // Run-control flags: --concurrency N, --limit N, --only <substring>,
  // --dry-run, --force, --report <path>.
  let loaded;
  try {
    loaded = loadConfig(process.argv.slice(2), __dirname);
  } catch (err) {
    console.error("Fatal error:", err.message);
    process.exitCode = 1;
  }
  if (loaded) {
    run(loaded.config, loaded.runOptions)
      .then((summary) => {
        // A batch with failures exits non-zero so a wrapper script notices.
        if (summary.counts.failed > 0) process.exitCode = 1;
      })
      .catch((err) => {
        console.error("Fatal error:", err);
        process.exitCode = 1;
      });
  }
}

module.exports = { run };
