"use strict";

const fs = require("fs").promises;

const DEFAULT_CONCURRENCY = 4;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/*
  Run options shared by both modes. Anything not given falls back to the
  defaults: four images in flight, skip-existing on, no limit, no filter,
  real writes, no report.
*/
function normalizeRunOptions(options = {}) {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!isPositiveInteger(concurrency)) {
    throw new Error("concurrency must be a positive integer");
  }
  const limit = options.limit ?? null;
  if (limit !== null && !isPositiveInteger(limit)) {
    throw new Error("limit must be a positive integer");
  }
  const only = options.only ?? null;
  if (only !== null && (typeof only !== "string" || only.length === 0)) {
    throw new Error("only must be a non-empty string");
  }
  const report = options.report ?? null;
  if (report !== null && (typeof report !== "string" || report.length === 0)) {
    throw new Error("report must be a non-empty path");
  }
  return {
    logger: options.logger ?? console,
    concurrency,
    force: options.force === true,
    limit,
    only,
    dryRun: options.dryRun === true,
    report,
  };
}

// Case-insensitive substring filter used by --only.
function matchesOnly(only, ...candidates) {
  if (only === null) return true;
  const needle = only.toLowerCase();
  return candidates.some((c) => String(c).toLowerCase().includes(needle));
}

// Skip-existing: an output is current when it exists and is not older than
// its source. A stat failure on either side means "not current"; a missing
// source then fails later, when it is opened, with the real error.
async function isUpToDate(sourcePath, outputPath) {
  try {
    const [out, src] = await Promise.all([fs.stat(outputPath), fs.stat(sourcePath)]);
    return out.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

/*
  Write budget for --limit. `claim()` is synchronous, so with several images
  in flight at most `limit` writes are ever granted; a job that loses the
  race reports itself as skipped. Unlimited when `limit` is null.
*/
function createWriteBudget(limit) {
  let claimed = 0;
  return {
    claim() {
      if (limit !== null && claimed >= limit) return false;
      claimed += 1;
      return true;
    },
    exhausted() {
      return limit !== null && claimed >= limit;
    },
  };
}

/*
  Runs `worker(item, index)` over `items` with at most `concurrency` calls
  in flight, preserving item order in the result. Once `shouldStop()` turns
  true no further items are started; unstarted items are absent from the
  result (their slots are `undefined`).
*/
async function mapConcurrent(items, concurrency, worker, { shouldStop } = {}) {
  const results = new Array(items.length);
  let next = 0;
  async function pump() {
    while (next < items.length) {
      if (shouldStop?.()) return;
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const lanes = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: lanes }, pump));
  return results;
}

// Logs `[n / total] text` with n counting completed items.
function createProgress(total, logger) {
  let done = 0;
  return {
    tick(text) {
      done += 1;
      logger.log(`[${done} / ${total}] ${text}`);
    },
  };
}

/*
  The loop both modes share: process `items` with `concurrency` in flight,
  print one progress line per finished item, and stop starting new items
  once the write budget for --limit is spent. `worker(item, budget)` returns
  the item's result; `describe(result)` renders its progress line. Returns
  the results of the items that were started, in item order.
*/
async function runBatch(items, { concurrency, limit, logger }, worker, describe) {
  const budget = createWriteBudget(limit);
  const progress = createProgress(items.length, logger);
  const results = await mapConcurrent(
    items,
    concurrency,
    async (item) => {
      const result = await worker(item, budget);
      progress.tick(describe(result));
      return result;
    },
    { shouldStop: () => budget.exhausted() },
  );
  const started = results.filter((result) => result !== undefined);
  if (started.length < items.length) {
    logger.log(
      `Limit of ${limit} written file(s) reached; ${items.length - started.length} source(s) not processed.`,
    );
  }
  return started;
}

module.exports = {
  DEFAULT_CONCURRENCY,
  runBatch,
  normalizeRunOptions,
  matchesOnly,
  isUpToDate,
  createWriteBudget,
  mapConcurrent,
  createProgress,
};
