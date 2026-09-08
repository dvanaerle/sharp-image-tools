"use strict";

const config = require("./config");
const { compressAll } = require("./src/compress");

if (require.main === module) {
  // Optional CLI override: `node compress.js <rootDir>`
  compressAll(config, { rootDir: process.argv[2] }).catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

module.exports = { compressAll };
