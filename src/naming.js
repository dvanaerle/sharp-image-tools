"use strict";

const { getExtensionForFormat } = require("./pipeline");

/*
  Output filename normalisation (CMS asset convention).

  Only the generated filename changes — source files are never renamed.
  Order: `rename` override → slugify → brand prefix.

  - rename: exact source basename → replacement, for legacy/Dutch names
    that need a semantic English one ("Homepage-afbeeldingen9" → "about-us")
  - slugify: strip accents, ASCII only, lowercase kebab-case
  - brandPrefix: prepended unless already present or listed in `noPrefix`
*/
const TRANSLITERATIONS = {
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ł: "l",
  "€": "eur",
  "&": "-and-",
};

function slugifyBaseName(name) {
  return String(name)
    .replace(
      /[ßæœøđł€&]/g,
      (character) => TRANSLITERATIONS[character] ?? character,
    )
    .normalize("NFD")
    // Drop the combining accents NFD just split off (é → e).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBaseName(baseName, naming) {
  if (!naming || naming.enabled !== true) return baseName;

  const renamed = naming.rename?.[baseName] ?? baseName;
  const slug = naming.slugify === false ? renamed : slugifyBaseName(renamed);
  if (!slug) return baseName;

  const prefix = naming.brandPrefix;
  const exempt = (naming.noPrefix ?? []).includes(slug);
  if (!prefix || exempt || slug.startsWith(prefix)) return slug;
  return `${prefix}${slug}`;
}

// `naming` is the namingConfig section; omitted means no normalisation.
function getOutputFileName({
  baseName,
  width,
  height,
  includeDimensions,
  suffix,
  outputFormat,
  naming,
}) {
  const extension = getExtensionForFormat(outputFormat);
  const name = normalizeBaseName(baseName, naming);
  if (suffix) {
    // `@2x` joins without a hyphen → `hero@2x.jpg`; other suffixes use `-`.
    const joiner = String(suffix).startsWith("@") ? "" : "-";
    return `${name}${joiner}${suffix}.${extension}`;
  }
  // `suffix: false` means "bare basename" — needed when a multi-size preset
  // has one variant that must keep the plain name (no @Nx, no dimensions).
  if (suffix === false) {
    return `${name}.${extension}`;
  }
  if (!includeDimensions) {
    return `${name}.${extension}`;
  }
  return `${name}-${width}x${height}.${extension}`;
}

module.exports = { slugifyBaseName, normalizeBaseName, getOutputFileName };
