"use strict";

const path = require("path");
const fs = require("fs").promises;

const STATUSES = ["saved", "skipped", "failed", "ignored", "planned"];

function countStatuses(outputs, ignored) {
  const counts = { saved: 0, skipped: 0, failed: 0, ignored: ignored.length, planned: 0 };
  for (const entry of outputs) counts[entry.status] += 1;
  return counts;
}

/*
  The one summary shape both modes return and the console prints.
  `outputs` holds one entry per attempted output (status saved / skipped /
  failed / planned); `ignored` holds files never opened; `failed` is the
  failed subset of `outputs` for convenience.
*/
function buildSummary({ outputs, ignored, sourceCount, dryRun, ...rest }) {
  return {
    ...rest,
    sourceCount,
    dryRun,
    outputs,
    ignored,
    failed: outputs.filter((entry) => entry.status === "failed"),
    counts: countStatuses(outputs, ignored),
  };
}

function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}

function printSummary(summary, logger) {
  const { counts, sourceCount, ignored, failed, dryRun } = summary;
  const parts = STATUSES.filter((s) => s !== "planned" || dryRun).map(
    (s) => `${counts[s]} ${s}`,
  );
  logger.log(
    `\nSummary${dryRun ? " (dry run)" : ""}: ${parts.join(", ")} (${sourceCount} eligible source(s))`,
  );
  if (failed.length > 0) {
    logger.log(`Failed (${failed.length}):`);
    for (const entry of failed) {
      logger.log(`  ${entry.sourcePath}: ${describeError(entry.error)}`);
    }
  }
  if (ignored.length > 0) {
    logger.log(`Ignored (${ignored.length}):`);
    for (const entry of ignored) logger.log(`  ${entry.sourcePath}`);
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sizeCell(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : "";
}

// Opt-in per-file CSV: one row per output entry, then one per ignored file.
async function writeReport(reportPath, summary) {
  const rows = [["source", "output", "rule", "source size", "output size", "status"]];
  for (const entry of summary.outputs) {
    rows.push([
      entry.sourcePath,
      entry.outputPath,
      entry.rule,
      sizeCell(entry.srcWidth, entry.srcHeight),
      sizeCell(entry.width, entry.height),
      entry.status,
    ]);
  }
  for (const entry of summary.ignored) {
    rows.push([entry.sourcePath, "", "", "", "", "ignored"]);
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n",
    "utf8",
  );
}

module.exports = { buildSummary, printSummary, writeReport, describeError };
