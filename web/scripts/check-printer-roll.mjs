/**
 * Executable check of what the app concludes from the printer's own readings.
 *
 * The modules are bundled with the project's own esbuild (a Vite dependency)
 * so the real source is exercised, not a copy of it.
 *
 * Three things are being pinned down. One is that "the roll did not say" is
 * never reported as a number — a third-party roll carries no tag, and a
 * panel that renders that as "0 labels left" stops a lab holding a full
 * roll. The second is that a roll change is detected from a *transition* in
 * the heartbeat, so a printer that reports its lid shut forever does not
 * cause a re-read every two seconds. The third is that every reason the app
 * has for not sizing the canvas is a distinct state with its own wording,
 * because "no tag", "unreadable" and "wider than the head" are three
 * different things to do about it.
 */
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), "lb-roll-"));

const load = async (entry) => {
  const outFile = join(outDir, entry.replace(/[^a-z0-9]/gi, "_") + ".mjs");

  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    absWorkingDir: WEB,
    logLevel: "error",
  });

  return await import(pathToFileURL(outFile).href);
};

const roll = await load(join(WEB, "src/utils/printer_roll.ts"));
const profile = await load(join(WEB, "src/utils/printer_profile.ts"));

const { modelsLibrary } = await import(
  pathToFileURL(join(WEB, "node_modules/@mmote/niimbluelib/dist/cjs/index.js")).href
);

let failures = 0;

const check = (what, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ok    ${what}`);
  } else {
    failures++;
    console.log(`  FAIL  ${what}`);
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          got      ${JSON.stringify(actual)}`);
  }
};

// A real B1, from the library's own table: 48 mm head, 8 dots/mm.
const b1 = profile.connectedPrinterFor(modelsLibrary.find((m) => String(m.model) === "B1"));

console.log("how much of the roll is left");
check(
  "a full roll",
  roll.labelsLeft({ tagPresent: true, allPaper: 200, usedPaper: 0 }),
  { left: 200, total: 200 },
);
check(
  "a part-used roll",
  roll.labelsLeft({ tagPresent: true, allPaper: 200, usedPaper: 57 }),
  { left: 143, total: 200 },
);
check(
  "an exhausted roll is zero, not negative",
  roll.labelsLeft({ tagPresent: true, allPaper: 200, usedPaper: 240 }),
  { left: 0, total: 200 },
);
// The one that matters: an unknown quantity must never render as a number.
check(
  "third-party stock with no tag says nothing",
  roll.labelsLeft({ tagPresent: false, allPaper: 0, usedPaper: 0 }),
  undefined,
);
check("no tag at all says nothing", roll.labelsLeft(undefined), undefined);
// The library's parser seeds both counters with -1 when the field is absent.
check(
  "the library's -1 placeholder is not a count",
  roll.labelsLeft({ tagPresent: true, allPaper: -1, usedPaper: -1 }),
  undefined,
);

console.log("");
console.log("noticing that the roll has been changed");
const shut = { lidClosed: true };
const open = { lidClosed: false };
check("the lid being shut is a roll change", roll.heartbeatSaysNewMedia(open, shut), true);
check("a lid that stays shut is not", roll.heartbeatSaysNewMedia(shut, shut), false);
check("opening the lid is not, by itself", roll.heartbeatSaysNewMedia(shut, open), false);
check(
  "paper appearing is a roll change",
  roll.heartbeatSaysNewMedia({ paperInserted: false }, { paperInserted: true }),
  true,
);
check(
  "paper that stays in is not",
  roll.heartbeatSaysNewMedia({ paperInserted: true }, { paperInserted: true }),
  false,
);
// A printer that reports neither field must not trigger a re-read forever.
check("a printer that reports neither says nothing", roll.heartbeatSaysNewMedia({}, {}), false);
check("the first heartbeat is not a change", roll.heartbeatSaysNewMedia(undefined, shut), false);

console.log("");
console.log("what the panel has to say");
check(
  "no printer",
  roll.rollStateOf({ connected: false, printer: b1, paperInfo: undefined, tag: undefined, heartbeat: undefined }),
  { kind: "disconnected" },
);
check(
  "the lid is open",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: { valid: true, paperWidth: 40, paperHeight: 20 },
    tag: { tagPresent: true, allPaper: 200, usedPaper: 1 },
    heartbeat: { lidClosed: false },
  }),
  { kind: "lid_open" },
);
check(
  "a 40 x 20 label on a B1",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: { valid: true, paperWidth: 40, paperHeight: 20, gapHeight: 2 },
    tag: { tagPresent: true, allPaper: 200, usedPaper: 1 },
    heartbeat: { lidClosed: true },
  }),
  { kind: "loaded", label: { acrossMm: 40, alongMm: 20 }, gapMm: 2 },
);
// The backing paper, not the label. Believing it prints 2 mm off the edge.
check(
  "a reading wider than the head is refused, with the numbers",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: { valid: true, paperWidth: 50, paperHeight: 20 },
    tag: { tagPresent: true, allPaper: 200, usedPaper: 1 },
    heartbeat: { lidClosed: true },
  }),
  { kind: "too_wide", acrossMm: 50, headMm: 48 },
);
check(
  "a tag the printer could not read",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: undefined,
    tag: undefined,
    heartbeat: { lidClosed: true, paperRfidSuccess: false },
  }),
  { kind: "unreadable" },
);
check(
  "third-party stock with no tag",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: undefined,
    tag: { tagPresent: false, allPaper: 0, usedPaper: 0 },
    heartbeat: { lidClosed: true },
  }),
  { kind: "no_tag" },
);
check(
  "connected, and the printer has not said yet",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: undefined,
    tag: undefined,
    heartbeat: undefined,
  }),
  { kind: "no_size", reading: undefined },
);
// When the app cannot make a label out of the answer, the answer itself is
// the only thing that can settle why - so it is carried, not swallowed.
check(
  "an answer the app cannot use is reported verbatim",
  roll.rollStateOf({
    connected: true,
    printer: b1,
    paperInfo: { valid: true, totalHeight: 62, gapHeight: 2 },
    tag: undefined,
    heartbeat: { lidClosed: true },
  }),
  { kind: "no_size", reading: "totalHeight=62 gapHeight=2" },
);

console.log("");
console.log("a size the printer reports only in dots");
// Which fields arrive depends on the model and protocol version. Dots and
// millimetres are the same measurement, so either will do.
check(
  "millimetres are used when they are there",
  profile.loadedLabelOf({ valid: true, paperWidth: 40, paperHeight: 60 }, 8),
  { acrossMm: 40, alongMm: 60 },
);
check(
  "dots are converted when the millimetres are not",
  profile.loadedLabelOf({ valid: true, paperWidthPixel: 320, paperHeightPixel: 480 }, 8),
  { acrossMm: 40, alongMm: 60 },
);
check(
  "a mix of the two still resolves",
  profile.loadedLabelOf({ valid: true, paperWidth: 40, paperHeightPixel: 480 }, 8),
  { acrossMm: 40, alongMm: 60 },
);
// Dots mean nothing without the resolution they were counted at.
check(
  "dots with no printer to ask are not a reading",
  profile.loadedLabelOf({ valid: true, paperWidthPixel: 320, paperHeightPixel: 480 }, undefined),
  undefined,
);
check(
  "a 40 x 60 roll on a B1 is accepted, not refused as backing paper",
  profile.loadedLabelFor(b1, { valid: true, paperWidth: 40, paperHeight: 60 }),
  { acrossMm: 40, alongMm: 60 },
);
check(
  "and the same roll reported in dots",
  profile.loadedLabelFor(b1, { valid: true, paperWidthPixel: 320, paperHeightPixel: 480 }),
  { acrossMm: 40, alongMm: 60 },
);

console.log("");
console.log("the design and the roll disagreeing");
check("same size is no mismatch", roll.labelMismatch({ width: 320, height: 160 }, { width: 320, height: 160 }), false);
check("a different roll is", roll.labelMismatch({ width: 320, height: 160 }, { width: 240, height: 120 }), true);
check("nothing loaded is not a mismatch", roll.labelMismatch({ width: 320, height: 160 }, undefined), false);

console.log("");
console.log("dots and millimetres");
check("a B1 label across the head", roll.dotsToMm(384, 8), 48);
check("one dot is an eighth of a millimetre", roll.dotsToMm(1, 8), 0.1);
check("millimetres snap to whole dots", roll.mmToDots(20, 8), 160);
check("and a figure between dots snaps to the nearest", roll.mmToDots(20.04, 8), 160);
check("a 300 dpi head has its own dots", roll.mmToDots(20, 11.81), 236);

console.log("");

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

console.log("ALL PASS");
