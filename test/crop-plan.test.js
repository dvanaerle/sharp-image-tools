"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createResizeCropPlan } = require("../src/crop-plan");

test("centred cover crop of a 1292x729 source into a 1248x702 box", () => {
  const plan = createResizeCropPlan({
    srcWidth: 1292,
    srcHeight: 729,
    width: 1248,
    height: 702,
    top: 0.5,
    left: 0.5,
  });
  assert.deepEqual(plan, {
    targetResizeWidth: 1248,
    targetResizeHeight: 705,
    offsetX: 0,
    offsetY: 2,
    valid: true,
  });
});

test("a 200x50 crop out of a 100x100 resize is reported invalid", () => {
  const plan = createResizeCropPlan({
    srcWidth: 100,
    srcHeight: 100,
    width: 200,
    height: 50,
    resizeWidth: 100,
    resizeHeight: 100,
    top: 0.5,
    left: 0.5,
  });
  assert.equal(plan.valid, false);
  assert.equal(plan.targetResizeWidth, 100);
});
