"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getOutputFileName } = require("../src/naming");

test("suffix 'tablet' joins with a hyphen, '@2x' joins bare, png keeps .png", () => {
  const base = { baseName: "hero", width: 1480, height: 740, includeDimensions: false };
  assert.equal(getOutputFileName({ ...base, suffix: "tablet", outputFormat: "jpeg" }), "hero-tablet.jpg");
  assert.equal(getOutputFileName({ ...base, suffix: "@2x", outputFormat: "jpeg" }), "hero@2x.jpg");
  assert.equal(getOutputFileName({ ...base, suffix: "tablet", outputFormat: "png" }), "hero-tablet.png");
});

test("dimensions are appended only when requested, and suffix false forces the bare name", () => {
  const base = { baseName: "about", width: 1712, height: 1712, outputFormat: "jpeg" };
  assert.equal(getOutputFileName({ ...base, includeDimensions: true }), "about-1712x1712.jpg");
  assert.equal(getOutputFileName({ ...base, includeDimensions: false }), "about.jpg");
  assert.equal(getOutputFileName({ ...base, includeDimensions: true, suffix: false }), "about.jpg");
});

test("naming config renames, slugifies and brand-prefixes the basename", () => {
  const naming = {
    enabled: true,
    slugify: true,
    brandPrefix: "tuinmaximaal-",
    noPrefix: ["gumax-sliding-doors"],
    rename: { "Homepage-afbeeldingen9": "About Us" },
  };
  const make = (baseName) =>
    getOutputFileName({ baseName, width: 1, height: 1, includeDimensions: false, outputFormat: "jpeg", naming });
  assert.equal(make("Homepage-afbeeldingen9"), "tuinmaximaal-about-us.jpg");
  assert.equal(make("Gumax Sliding Doors"), "gumax-sliding-doors.jpg");
  assert.equal(make("Café & Straße"), "tuinmaximaal-cafe-and-strasse.jpg");
});
