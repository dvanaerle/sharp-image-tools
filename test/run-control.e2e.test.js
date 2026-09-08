"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { run } = require("../src/run");
const { silentLogger, makeTempDir, writeImage, listFiles } = require("./helpers");

function channableConfig(inputs, outputDir) {
  return {
    outputDir,
    inputs,
    skuPrefixes: ["BUN-", "CAR-", "ACC-", "SUN-"],
    rules: [
      { endsWith: "-0", aspect: "1:1", width: 150, upscale: true },
      { width: 150 },
    ],
    outputConfig: { jpegQuality: 80 },
  };
}

// Twelve eligible sources across two inputs, plus one ignored file.
async function seed(root) {
  const veranda = path.join(root, "veranda", "Origineel");
  const ledspots = path.join(root, "Ledspots", "Origineel");
  for (let i = 0; i < 8; i += 1) {
    await writeImage(path.join(veranda, `BUN-${i}-51-${i % 2}.jpg`), 192, 108);
  }
  for (let i = 0; i < 4; i += 1) {
    await writeImage(path.join(ledspots, `ACC-${i}-0.jpg`), 384, 216);
  }
  await fs.writeFile(path.join(veranda, "Thumbs.db"), "x");
  return [
    { path: veranda, category: "Veranda Modern" },
    { path: ledspots, category: "Verlichting Ledspots" },
  ];
}

async function pixelHashes(dir) {
  const out = {};
  for (const rel of await listFiles(dir)) {
    const { data } = await sharp(path.join(dir, rel)).raw().toBuffer({ resolveWithObject: true });
    out[rel] = crypto.createHash("sha1").update(data).digest("hex");
  }
  return out;
}

async function statAll(dir) {
  const out = {};
  for (const rel of await listFiles(dir)) {
    const s = await fs.stat(path.join(dir, rel));
    out[rel] = `${s.size}:${s.mtimeMs}`;
  }
  return out;
}

test("concurrency 4 produces the same files as a sequential run", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const seq = path.join(root, "seq");
  const par = path.join(root, "par");

  const a = await run(channableConfig(inputs, seq), { logger: silentLogger, concurrency: 1 });
  const b = await run(channableConfig(inputs, par), { logger: silentLogger, concurrency: 4 });

  const parHashes = await pixelHashes(par);
  assert.deepEqual(parHashes, await pixelHashes(seq));
  assert.equal(Object.keys(parHashes).length, 12);
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.counts, { saved: 12, skipped: 0, failed: 0, ignored: 1, planned: 0 });
});

test("a second run skips everything; touching a source rewrites only that file; --force rewrites all", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");
  const config = channableConfig(inputs, outputDir);

  await run(config, { logger: silentLogger });
  const before = await statAll(outputDir);

  const second = await run(config, { logger: silentLogger });
  assert.deepEqual(second.counts, { saved: 0, skipped: 12, failed: 0, ignored: 1, planned: 0 });
  assert.ok(second.outputs.every((o) => o.status === "skipped" && o.reason === "up-to-date"));
  assert.deepEqual(await statAll(outputDir), before);

  const touched = path.join(inputs[0].path, "BUN-3-51-1.jpg");
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(touched, future, future);
  const third = await run(config, { logger: silentLogger });
  assert.deepEqual(third.counts, { saved: 1, skipped: 11, failed: 0, ignored: 1, planned: 0 });
  assert.equal(third.outputs.find((o) => o.status === "saved").sourcePath, touched);

  const forced = await run(config, { logger: silentLogger, force: true });
  assert.deepEqual(forced.counts, { saved: 12, skipped: 0, failed: 0, ignored: 1, planned: 0 });
});

test("--limit 5 writes at most five files; skipped files do not count toward the limit", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");
  const config = channableConfig(inputs, outputDir);

  const first = await run(config, { logger: silentLogger, limit: 5, concurrency: 4 });
  assert.equal((await listFiles(outputDir)).length, 5);
  assert.equal(first.counts.saved, 5);

  // Five are up to date now; the next five get written.
  const second = await run(config, { logger: silentLogger, limit: 5, concurrency: 4 });
  assert.equal(second.counts.saved, 5);
  assert.equal((await listFiles(outputDir)).length, 10);

  const third = await run(config, { logger: silentLogger, limit: 5 });
  assert.equal(third.counts.saved, 2);
  assert.equal((await listFiles(outputDir)).length, 12);
});

test("--only restricts the run to inputs whose path or category contains the substring", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");

  const byPath = await run(channableConfig(inputs, outputDir), { logger: silentLogger, only: "Ledspots" });
  assert.deepEqual(await listFiles(outputDir), [
    "Verlichting Ledspots/ACC-0-0.jpg",
    "Verlichting Ledspots/ACC-1-0.jpg",
    "Verlichting Ledspots/ACC-2-0.jpg",
    "Verlichting Ledspots/ACC-3-0.jpg",
  ]);
  assert.equal(byPath.sourceCount, 4);
  assert.equal(byPath.counts.ignored, 0);

  const byCategory = await run(channableConfig(inputs, path.join(root, "out2")), {
    logger: silentLogger,
    only: "Veranda Mod",
  });
  assert.equal(byCategory.sourceCount, 8);
  assert.equal(byCategory.counts.ignored, 1);
});

test("--dry-run prints one plan line per eligible file and writes nothing", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");
  const lines = [];
  const logger = { ...silentLogger, log: (m) => lines.push(String(m)) };

  const summary = await run(channableConfig(inputs, outputDir), { logger, dryRun: true });

  await assert.rejects(fs.access(outputDir));
  assert.deepEqual(summary.counts, { saved: 0, skipped: 0, failed: 0, ignored: 1, planned: 12 });
  const planLines = lines.filter((l) => /rule \d+/.test(l));
  assert.equal(planLines.length, 12);
  const square = planLines.find((l) => l.includes("ACC-0-0.jpg"));
  assert.match(square, /rule 1/);
  assert.match(square, /216x216 at 84,0 of 384x216/);
  assert.match(square, /-> 150x150/);
  assert.ok(square.includes(path.join(outputDir, "Verlichting Ledspots", "ACC-0-0.jpg")));

  // Over a populated output a dry run still plans every file, and reports
  // the ones a real run would skip as up to date.
  await run(channableConfig(inputs, outputDir), { logger: silentLogger, limit: 3 });
  lines.length = 0;
  const resumed = await run(channableConfig(inputs, outputDir), { logger, dryRun: true });
  assert.equal(lines.filter((l) => /rule \d+/.test(l)).length, 12);
  assert.deepEqual(resumed.counts, { saved: 0, skipped: 3, failed: 0, ignored: 1, planned: 9 });
  assert.equal((await listFiles(outputDir)).length, 3);
});

test("progress shows n / total, and the summary lists counts plus every ignored and failed path", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");
  const broken = path.join(inputs[0].path, "BUN-99-0.jpg");
  await fs.writeFile(broken, "not an image");
  const lines = [];
  const logger = {
    log: (m) => lines.push(String(m)),
    warn: (m) => lines.push(String(m)),
    error: (m) => lines.push(String(m)),
  };

  const summary = await run(channableConfig(inputs, outputDir), { logger, concurrency: 2 });

  assert.ok(lines.some((l) => /\b1 \/ 13\b/.test(l)), "progress 1 / 13");
  assert.ok(lines.some((l) => /\b13 \/ 13\b/.test(l)), "progress 13 / 13");
  assert.deepEqual(summary.counts, { saved: 12, skipped: 0, failed: 1, ignored: 1, planned: 0 });
  const text = lines.join("\n");
  const tail = text.slice(text.lastIndexOf("Summary"));
  assert.match(tail, /12 saved/);
  assert.match(tail, /1 failed/);
  assert.match(tail, /1 ignored/);
  assert.ok(tail.includes(broken), "failed path listed in summary");
  assert.ok(tail.includes(path.join(inputs[0].path, "Thumbs.db")), "ignored path listed in summary");
  assert.deepEqual(summary.failed.map((f) => f.sourcePath), [broken]);
});

test("--report writes one CSV row per file; without it no report exists", async (t) => {
  const root = await makeTempDir(t);
  const inputs = await seed(root);
  const outputDir = path.join(root, "out");
  const reportPath = path.join(root, "report", "out.csv");

  await run(channableConfig(inputs, outputDir), { logger: silentLogger });
  const csvFiles = (await listFiles(root)).filter((f) => f.endsWith(".csv"));
  assert.deepEqual(csvFiles, []);

  await run(channableConfig(inputs, outputDir), { logger: silentLogger, force: true, report: reportPath });
  const csv = await fs.readFile(reportPath, "utf8");
  const rows = csv.trim().split(/\r?\n/);
  assert.equal(rows[0], "source,output,rule,source size,output size,status");
  assert.equal(rows.length, 1 + 13);
  const acc = rows.find((r) => r.includes("ACC-0-0.jpg"));
  const cells = acc.split(",");
  assert.equal(cells[2], "1");
  assert.equal(cells[3], "384x216");
  assert.equal(cells[4], "150x150");
  assert.equal(cells[5], "saved");
  const ignoredRow = rows.find((r) => r.includes("Thumbs.db"));
  assert.match(ignoredRow, /,,,,ignored$/);
});
