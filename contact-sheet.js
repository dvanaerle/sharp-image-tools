"use strict";

/*
  Contact sheet of a folder of exported images, for eyeballing framing without
  opening hundreds of files.

    node contact-sheet.js <folder> [--out sheet.jpg] [--name -0]
                                   [--tile 300] [--cols 6] [--max 60]
                                   [--report run.csv]

  Each tile is labelled with the basename and the output size, and is drawn at
  its real aspect on a grey background, so anything clipped at an edge and any
  image that had to leave 1:1 are both obvious at a glance.

  Pass `--report` the CSV from `crop-and-resize.js --report` and the tiles are
  grouped and labelled by their source folder instead, which is the handle
  `fitOverrides` matches on.

  Read-only: it never writes into the folder it reads.
*/

const path = require("path");
const fs = require("fs").promises;
const sharp = require("sharp");
const { getAllFiles, IMAGE_RE } = require("./src/discover");
const { mapConcurrent } = require("./src/run-control");

const DEFAULTS = { out: "contact-sheet.jpg", tile: 300, cols: 6, max: 60 };
const LABEL_HEIGHT = 34;

function parseArgs(argv) {
  const options = { ...DEFAULTS, folder: null, name: null, report: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (options.folder !== null) throw new Error(`Unexpected argument: ${arg}`);
      options.folder = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const raw = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
    if (raw === undefined || raw === "") throw new Error(`${flag} requires a value`);
    switch (flag) {
      case "--out":
        options.out = raw;
        break;
      case "--name":
        options.name = raw;
        break;
      case "--report":
        options.report = raw;
        break;
      case "--tile":
      case "--cols":
      case "--max": {
        const value = Number(raw);
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`${flag} must be a positive integer`);
        }
        options[flag.slice(2)] = value;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.folder === null) throw new Error("Usage: node contact-sheet.js <folder>");
  return options;
}

// Spreads `max` picks evenly over the list, so a sheet samples the whole
// folder rather than the first N files alphabetically.
function spread(files, max) {
  if (files.length <= max) return files;
  const step = files.length / max;
  return Array.from({ length: max }, (_, i) => files[Math.floor(i * step)]);
}

/*
  Maps output basename -> source folder name, from a run report. Only the
  source and output columns are used, so a report written by an older run
  still works. Quoted cells are handled because Windows paths can contain
  commas.
*/
function parseReport(csv) {
  const byName = new Map();
  const rows = csv.trim().split(/\r?\n/).slice(1);
  for (const row of rows) {
    const cells = row.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
    const unquote = (cell = "") =>
      cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
    const source = unquote(cells[0]);
    const output = unquote(cells[1]);
    if (!source || !output) continue;
    byName.set(path.parse(output).name, path.basename(path.dirname(source)));
  }
  return byName;
}

const escapeXml = (text) =>
  text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);

// Two lines, because the source folder name is long and is the thing worth
// reading: the group on top, the file and its output size underneath.
function labelSvg(width, group, detail) {
  const line = (text, y) =>
    `<text x="5" y="${y}" font-family="monospace" font-size="10" fill="#ffffff">${escapeXml(text)}</text>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_HEIGHT}">` +
      `<rect width="100%" height="100%" fill="#222222"/>` +
      (group ? line(group, 13) : "") +
      line(detail, group ? 27 : 20) +
      `</svg>`,
  );
}

async function buildSheet(options, logger = console) {
  const all = await getAllFiles(options.folder);
  const candidates = all.filter(
    (file) =>
      IMAGE_RE.test(path.basename(file)) &&
      (options.name === null || path.parse(file).name.includes(options.name)),
  );
  if (candidates.length === 0) {
    throw new Error(`No matching images under ${options.folder}`);
  }

  const folders = options.report
    ? parseReport(await fs.readFile(options.report, "utf8"))
    : new Map();
  const sorted = [...candidates].sort((a, b) => {
    const groupA = folders.get(path.parse(a).name) ?? "";
    const groupB = folders.get(path.parse(b).name) ?? "";
    return groupA.localeCompare(groupB) || a.localeCompare(b);
  });
  const picks = spread(sorted, options.max);

  const { tile, cols } = options;
  const cellHeight = tile + LABEL_HEIGHT;
  const cells = await mapConcurrent(picks, 4, async (file) => {
    const meta = await sharp(file).metadata();
    const name = path.parse(file).name;
    const group = folders.get(name);
    const image = await sharp(file)
      .resize(tile, tile, { fit: "contain", background: "#ffffff" })
      .toBuffer();
    const label = labelSvg(tile, group, `${name}  ${meta.width}x${meta.height}`);
    return await sharp({
      create: { width: tile, height: cellHeight, channels: 3, background: "#222222" },
    })
      .composite([
        { input: image, top: 0, left: 0 },
        { input: label, top: tile, left: 0 },
      ])
      .png()
      .toBuffer();
  });

  const rows = Math.ceil(cells.length / cols);
  await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await sharp({
    create: {
      width: cols * tile,
      height: rows * cellHeight,
      channels: 3,
      background: "#b0b0b0",
    },
  })
    .composite(
      cells.map((input, i) => ({
        input,
        left: (i % cols) * tile,
        top: Math.floor(i / cols) * cellHeight,
      })),
    )
    .jpeg({ quality: 88 })
    .toFile(options.out);

  logger.log(
    `${options.out}: ${picks.length} of ${candidates.length} image(s) from ${options.folder}`,
  );
  return { out: options.out, shown: picks.length, total: candidates.length };
}

if (require.main === module) {
  buildSheet(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, spread, parseReport, buildSheet };
