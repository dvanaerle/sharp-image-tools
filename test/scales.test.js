"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { expandSizeByScales } = require("../src/crop-plan");

test("scales [1, 2] on a 512x320 size yields @1x and @2x outputs", () => {
  const sizes = expandSizeByScales({ width: 512, height: 320, scales: [1, 2] });
  assert.deepEqual(sizes, [
    { width: 512, height: 320, suffix: "@1x" },
    { width: 1024, height: 640, suffix: "@2x" },
  ]);
});

test("suffix 'hero' with scales [3] becomes hero@3x; no scales means no @Nx", () => {
  const [scaled] = expandSizeByScales({ width: 100, height: 50, suffix: "hero", scales: [3] });
  assert.equal(scaled.suffix, "hero@3x");
  assert.equal(scaled.width, 300);

  assert.deepEqual(expandSizeByScales({ width: 640, height: 360 }), [
    { width: 640, height: 360 },
  ]);
});
