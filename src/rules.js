"use strict";

const path = require("path");
const { IMAGE_RE } = require("./discover");

/*
  Filename rules for rule-based configs (Channable).

  `rules` is an ordered array; the first rule whose matchers all pass wins.
  Matchers `startsWith` / `endsWith` are tested against the basename without
  extension, `category` case-insensitively against the input entry's category
  label. A rule with no matchers matches everything (the default).
*/
function ruleMatches(rule, baseName, category = "") {
  if (rule.startsWith !== undefined && !baseName.startsWith(rule.startsWith)) {
    return false;
  }
  if (rule.endsWith !== undefined && !baseName.endsWith(rule.endsWith)) {
    return false;
  }
  if (
    rule.category !== undefined &&
    !category.toLowerCase().includes(rule.category.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function matchRule(rules, baseName, category) {
  return rules.find((rule) => ruleMatches(rule, baseName, category)) ?? null;
}

// `earlier` covers `later` when everything `later` accepts, `earlier` accepts
// too: each matcher of `earlier` is absent or weaker than the corresponding
// matcher of `later`.
function covers(earlier, later) {
  const startOk =
    earlier.startsWith === undefined ||
    (later.startsWith !== undefined &&
      later.startsWith.startsWith(earlier.startsWith));
  const endOk =
    earlier.endsWith === undefined ||
    (later.endsWith !== undefined && later.endsWith.endsWith(earlier.endsWith));
  const categoryOk =
    earlier.category === undefined ||
    (later.category !== undefined &&
      later.category.toLowerCase().includes(earlier.category.toLowerCase()));
  return startOk && endOk && categoryOk;
}

// Returns [{ index, shadowedBy }] for every rule that can never match
// because an earlier rule accepts everything it would.
function findShadowedRules(rules) {
  const shadowed = [];
  rules.forEach((rule, index) => {
    const by = rules.findIndex((earlier, i) => i < index && covers(earlier, rule));
    if (by !== -1) shadowed.push({ index, shadowedBy: by });
  });
  return shadowed;
}

// Eligible: a jpg/jpeg/png/webp whose basename starts with a SKU prefix.
function isEligibleFile(fileName, skuPrefixes) {
  if (!IMAGE_RE.test(fileName)) return false;
  const baseName = path.parse(fileName).name;
  return skuPrefixes.some((prefix) => baseName.startsWith(prefix));
}

module.exports = { ruleMatches, matchRule, findShadowedRules, isEligibleFile };
