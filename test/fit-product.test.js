"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planFit, anchorFor, DEFAULT_LADDER } = require("../src/fit-product");

// A box as the detector reports it: fractions of the frame.
const box = (x0, x1, y0 = 0.05, y1 = 0.5) => ({ x0, x1, y0, y1 });

test("a product that fits a square gets 1:1, anchored so it sits in the middle", () => {
  // 1045px wide, left of centre: the same case as CAR-1413081-51-0.
  const plan = planFit(box(0.167, 0.711), 1920, 1080, { margin: 0 });
  assert.equal(plan.aspect, "1:1");
  assert.equal(plan.square, true);
  assert.equal(plan.square, true);
  assert.equal(plan.windowWidth, 1080);
  // Product centre is at 843px; a 1080 window centred there starts at 303 of
  // the 840px of free space.
  assert.equal(Math.round(plan.left * 1000), 361);
});

test("a product too wide for a square steps up the ladder rather than being cut", () => {
  // 12x4 carport: 1269px of roof, past the 1080px square, inside 5:4's 1350.
  const carport = planFit(box(0.106, 0.767), 1920, 1080, { margin: 0 });
  assert.equal(carport.aspect, "5:4");
  assert.equal(carport.square, false);
  assert.ok(carport.productWidth > 1080 && carport.productWidth <= 1350);

  // 9x4 veranda: 1507px, past 4:3's 1440, inside 3:2's 1620.
  const veranda = planFit(box(0.076, 0.861), 1920, 1080, { margin: 0 });
  assert.equal(veranda.aspect, "3:2");
  assert.ok(veranda.productWidth > 1440 && veranda.productWidth <= 1620);
});

test("a product spanning the whole frame takes the widest rung on the ladder", () => {
  const plan = planFit(box(0, 1), 1920, 1080);
  assert.equal(plan.aspect, "16:9");
  assert.equal(plan.square, false);
  assert.equal(plan.fullFrame, false);
  assert.equal(plan.productWidth, 1920);
});

test("a ladder too narrow for the product falls back to the full frame and says so", () => {
  const plan = planFit(box(0.05, 0.95), 1920, 1080, { ladder: ["1:1", "4:3"], margin: 0 });
  assert.equal(plan.aspect, "source");
  assert.equal(plan.fullFrame, true);
  assert.equal(plan.square, false);
  assert.equal(plan.windowWidth, 1920);
});

test("margin is off by default, and asking for it can push the format wider", () => {
  const box0 = box(0.2, 0.75);
  assert.equal(planFit(box0, 1920, 1080).aspect, "1:1");
  assert.equal(planFit(box0, 1920, 1080, { margin: 0 }).aspect, "1:1");
  assert.equal(planFit(box0, 1920, 1080, { margin: 0.02 }).aspect, "5:4");
});

test("the window is clamped inside the frame, never hanging off an edge", () => {
  const hardLeft = planFit(box(0, 0.4), 1920, 1080);
  assert.equal(hardLeft.left, 0);
  const hardRight = planFit(box(0.6, 1), 1920, 1080);
  assert.equal(hardRight.left, 1);
});

test("a custom ladder is honoured and its order decides the winner", () => {
  const plan = planFit(box(0.167, 0.711), 1920, 1080, { ladder: ["16:9", "1:1"], margin: 0 });
  assert.equal(plan.aspect, "16:9");
  assert.equal(plan.square, false);
  assert.deepEqual(DEFAULT_LADDER, ["1:1", "5:4", "4:3", "3:2", "16:9"]);
});

test("a 4K source picks the same format as its HD twin", () => {
  const hd = planFit(box(0.167, 0.711), 1920, 1080, { margin: 0.01 });
  const uhd = planFit(box(0.167, 0.711), 3840, 2160, { margin: 0.01 });
  assert.equal(hd.aspect, uhd.aspect);
  assert.equal(Math.round(hd.left * 100), Math.round(uhd.left * 100));
});

test("anchorFor turns a centre into a 0..1 anchor and clamps at the edges", () => {
  assert.equal(anchorFor(960, 1080, 1920), 0.5);
  assert.equal(anchorFor(0, 1080, 1920), 0);
  assert.equal(anchorFor(1920, 1080, 1920), 1);
  // No free space: the anchor cannot matter.
  assert.equal(anchorFor(100, 1920, 1920), 0.5);
});
