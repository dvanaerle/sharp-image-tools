"use strict";

const config = require("./config");
const { run } = require("./src/run");

if (require.main === module) {
  run(config).catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

module.exports = { run };
