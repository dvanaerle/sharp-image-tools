"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { matchRule, findShadowedRules, isEligibleFile } = require("../src/rules");

const square = { endsWith: "-0", aspect: "1:1", width: 1500, upscale: true };
const fallback = { width: 1500 };
const prefix = { startsWith: "BUN-1413081-", zoom: 1.25, width: 1500 };

test("first matching rule wins, a rule without matchers is the default", () => {
  assert.equal(matchRule([prefix, square, fallback], "BUN-1413081-51-0"), prefix);
  assert.equal(matchRule([square, prefix, fallback], "BUN-1413081-51-0"), square);
  assert.equal(matchRule([square, fallback], "BUN-1413081-51-3"), fallback);
  assert.equal(matchRule([square], "BUN-1413081-51-3"), null);
});

test("matchers test the basename, both must pass when given", () => {
  const both = { startsWith: "CAR-", endsWith: "-0", width: 100 };
  assert.equal(matchRule([both], "CAR-1-0"), both);
  assert.equal(matchRule([both], "BUN-1-0"), null);
  assert.equal(matchRule([both], "CAR-1-1"), null);
});

test("a rule is shadowed when an earlier rule has the same or broader matchers", () => {
  assert.deepEqual(findShadowedRules([fallback, square]), [
    { index: 1, shadowedBy: 0 },
  ]);
  assert.deepEqual(
    findShadowedRules([{ endsWith: "-0", width: 1 }, { startsWith: "BUN-", endsWith: "51-0", width: 1 }]),
    [{ index: 1, shadowedBy: 0 }],
  );
  assert.deepEqual(findShadowedRules([prefix, square, fallback]), []);
  assert.deepEqual(findShadowedRules([square, fallback]), []);
});

test("only sku-prefixed image files are eligible", () => {
  const prefixes = ["BUN-", "CAR-", "ACC-", "SUN-"];
  assert.equal(isEligibleFile("BUN-1413081-51-0.jpg", prefixes), true);
  assert.equal(isEligibleFile("ACC-30000-0001_01.png", prefixes), true);
  assert.equal(isEligibleFile("3m.jpg", prefixes), false);
  assert.equal(isEligibleFile("gumax-zonwering-detailfoto.jpg", prefixes), false);
  assert.equal(isEligibleFile("Thumbs.db", prefixes), false);
  assert.equal(isEligibleFile("BUN-1413081-51-0.psd", prefixes), false);
});

test("a category matcher tests the input's category label as a case-insensitive substring", () => {
  const carport = { category: "Carport", endsWith: "-0", pad: "1:1", width: 1500 };
  const anyCategory = { endsWith: "-0", width: 1500 };
  const rules = [carport, anyCategory];

  assert.equal(matchRule(rules, "CAR-1-51-0", "Carport Standaard Klassiek"), carport);
  assert.equal(matchRule(rules, "CAR-1-51-0", "carport flat white"), carport);
  assert.equal(matchRule(rules, "BUN-1-51-0", "Veranda Standaard Modern"), anyCategory);
  assert.equal(matchRule(rules, "CAR-1-51-3", "Carport Standaard Klassiek"), null);
  // No category given (preset-style call): a category matcher cannot pass.
  assert.equal(matchRule(rules, "CAR-1-51-0"), anyCategory);
});

test("a category rule is shadowed by an earlier rule that does not restrict the category", () => {
  assert.deepEqual(
    findShadowedRules([
      { endsWith: "-0", width: 1 },
      { category: "Carport", endsWith: "-0", width: 1 },
    ]),
    [{ index: 1, shadowedBy: 0 }],
  );
  // The other order is fine: the narrower rule runs first.
  assert.deepEqual(
    findShadowedRules([
      { category: "Carport", endsWith: "-0", width: 1 },
      { endsWith: "-0", width: 1 },
    ]),
    [],
  );
});
