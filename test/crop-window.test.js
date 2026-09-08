"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCropWindow } = require("../src/crop-window");

const square = { aspect: "1:1", width: 1500, upscale: true };
const fallback = { width: 1500 };

test("square rule on an HD source takes the centred 1080 window and scales it to 1500", () => {
  assert.deepEqual(createCropWindow({ srcWidth: 1920, srcHeight: 1080, rule: square }), {
    left: 420, top: 0, width: 1080, height: 1080, outputWidth: 1500, outputHeight: 1500,
  });
});

test("square rule on a 4K source takes the 2160 window; an odd 1920x1079 source still yields 1500x1500", () => {
  const uhd = createCropWindow({ srcWidth: 3840, srcHeight: 2160, rule: square });
  assert.deepEqual([uhd.left, uhd.top, uhd.width, uhd.height], [840, 0, 2160, 2160]);
  assert.deepEqual([uhd.outputWidth, uhd.outputHeight], [1500, 1500]);

  const odd = createCropWindow({ srcWidth: 1920, srcHeight: 1079, rule: square });
  assert.deepEqual([odd.width, odd.height, odd.outputWidth, odd.outputHeight], [1079, 1079, 1500, 1500]);
});

test("default rule keeps the full frame and scales to at most the width, never upscaling", () => {
  assert.deepEqual(createCropWindow({ srcWidth: 1920, srcHeight: 1080, rule: fallback }), {
    left: 0, top: 0, width: 1920, height: 1080, outputWidth: 1500, outputHeight: 844,
  });
  const small = createCropWindow({ srcWidth: 1200, srcHeight: 700, rule: fallback });
  assert.deepEqual([small.outputWidth, small.outputHeight], [1200, 700]);
});

test("square rule without upscale on a small source outputs the window size", () => {
  const w = createCropWindow({ srcWidth: 1000, srcHeight: 600, rule: { aspect: "1:1", width: 1500 } });
  assert.deepEqual([w.width, w.height, w.outputWidth, w.outputHeight], [600, 600, 600, 600]);
});

test("zoom divides the window and top/left anchor it; zoom 1 crops only what the aspect forces", () => {
  const zoomed = createCropWindow({
    srcWidth: 1920, srcHeight: 1080,
    rule: { aspect: "1:1", width: 1500, upscale: true, zoom: 1.25, top: 0, left: 1 },
  });
  assert.deepEqual([zoomed.left, zoomed.top, zoomed.width, zoomed.height], [1056, 0, 864, 864]);

  const sourceZoom = createCropWindow({
    srcWidth: 1920, srcHeight: 1080, rule: { width: 1500, zoom: 2, top: 1, left: 0.5 },
  });
  assert.deepEqual([sourceZoom.left, sourceZoom.top, sourceZoom.width, sourceZoom.height], [480, 540, 960, 540]);
  assert.deepEqual([sourceZoom.outputWidth, sourceZoom.outputHeight], [960, 540]);

  const none = createCropWindow({ srcWidth: 1920, srcHeight: 1080, rule: { width: 3000, zoom: 1 } });
  assert.deepEqual([none.left, none.top, none.width, none.height], [0, 0, 1920, 1080]);
});
