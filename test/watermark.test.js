"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getWatermarkPlacement } = require("../src/watermark");

const watermarkConfig = {
  position: "bottom-right",
  marginPercent: { x: 0.03, y: 0.04 },
  scale: 1 / 3,
  fixedSize: false,
};

test("bottom-right at scale 1/3 on a 1200x600 image lands a 400x200 badge at 782,376", () => {
  const placement = getWatermarkPlacement({
    imageWidth: 1200,
    imageHeight: 600,
    watermarkWidth: 400,
    watermarkHeight: 200,
    watermarkConfig,
    folderPreset: {},
  });
  assert.deepEqual(placement, { width: 400, height: 200, left: 782, top: 376, valid: true });
});

test("size overrides beat the preset: top-right at scale 1/2 with a 5% margin", () => {
  const placement = getWatermarkPlacement({
    imageWidth: 1000,
    imageHeight: 500,
    watermarkWidth: 100,
    watermarkHeight: 50,
    watermarkConfig,
    folderPreset: { watermarkScale: 0.2, watermarkPosition: "bottom-left" },
    sizeOverrides: { watermarkScale: 0.5, watermarkPosition: "top-right", watermarkMarginPercent: 0.05 },
  });
  // 500 wide, 250 high; margin = 5% of 500 = 25; left = 1000-500-25
  assert.deepEqual(placement, { width: 500, height: 250, left: 475, top: 25, valid: true });
});

test("a badge wider than the image is reported out of bounds", () => {
  const placement = getWatermarkPlacement({
    imageWidth: 100,
    imageHeight: 20,
    watermarkWidth: 400,
    watermarkHeight: 200,
    watermarkConfig: { ...watermarkConfig, scale: 1 },
    folderPreset: {},
  });
  assert.equal(placement.valid, false);
  assert.equal(placement.reason, "placement-out-of-bounds");
});
