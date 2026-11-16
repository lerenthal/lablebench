/**
 * Executable check of the print-width decision logic.
 *
 * The modules are bundled with the project's own esbuild (a Vite dependency)
 * so the real source is exercised, not a copy of it.
 *
 * Everything here is in MILLIMETRES. A width in pixels only means something
 * together with the resolution it was measured at, and the two sides of the
 * comparison do not come from the same one: the label is drawn at the
 * resolution the template was made at, while the print head is quoted in the
 * printer's dots. Comparing the two directly blocks a 40 mm label on a B21,
 * because 40 mm at 300 dpi is 472 px and the head is 384 px at 203 dpi — a
 * 40 mm label on a 48 mm head, which fits perfectly well.
 */
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The web directory, worked out from where this script lives rather than
// from an absolute path: the check has to run wherever the repository is
// checked out, which is the point of running it at all.
const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), "lb-limits-"));

/** Bundle a module from the source tree and import it. */
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

const limits = await load(join(WEB, "src/utils/print_limits.ts"));
const profile = await load(join(WEB, "src/utils/printer_profile.ts"));
const errors = await load(join(WEB, "src/utils/printer_errors.ts"));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok) {
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          got      ${JSON.stringify(actual)}`);
  }
};

console.log("head widths from the library's model table");
check("d11 -> 12 mm", limits.headMmForModel("d11"), 12);
check("b21 -> 48 mm", limits.headMmForModel("b21"), 48);
check("unknown model -> undefined", limits.headMmForModel(undefined), undefined);

console.log("density ranges");
check("d11 density 1..3", limits.densityRangeForModel("d11"), { min: 1, max: 3 });
check("b21 density 1..5", limits.densityRangeForModel("b21"), { min: 1, max: 5 });

console.log("evaluateWidth — everything in millimetres");
check(
  "fits the device head -> no block, no warning",
  limits.evaluateWidth(12, 12, undefined),
  { printWidth: 12, blocked: undefined, warning: undefined },
);
check(
  "wider than the device head -> blocked",
  limits.evaluateWidth(25, 12, undefined).blocked,
  "25 mm > 12 mm",
);
check(
  "wider than the model head but the device can print it -> warning only",
  limits.evaluateWidth(25, 48, 12).warning,
  "25 mm > 12 mm",
);
check(
  "wider than the model head and the device too -> blocked wins",
  limits.evaluateWidth(25, 12, 12).blocked,
  "25 mm > 12 mm",
);
check(
  "no device connected, model head exceeded -> warning only",
  limits.evaluateWidth(25, undefined, 12).warning,
  "25 mm > 12 mm",
);
check(
  "no device connected, model head exceeded -> not blocked",
  limits.evaluateWidth(25, undefined, 12).blocked,
  undefined,
);

console.log("the case that started this: a 40 x 20 mm label on a B21");
check(
  "40 mm across the head on a 48 mm head -> not blocked",
  limits.evaluateWidth(40, 48, 48).blocked,
  undefined,
);
check(
  "60 mm across the head on a 48 mm head -> blocked, in millimetres",
  limits.evaluateWidth(60, 48, 48).blocked,
  "60 mm > 48 mm",
);
check(
  "40 mm across the head on a D11's 12 mm head -> blocked",
  limits.evaluateWidth(40, 12, 12).blocked,
  "40 mm > 12 mm",
);

console.log("the canvas a label of a given physical size needs");
check(
  "a 40 x 20 mm label on a B21, which feeds it the short way round",
  profile.canvasForLabel(40, 20, "top", 8),
  { width: 320, height: 160 },
);
check(
  "the same label on a D11, which feeds it the long way round",
  profile.canvasForLabel(40, 20, "left", 8),
  { width: 160, height: 320 },
);
check(
  "the physical size back out of a B21 canvas",
  profile.physicalLabelOf(320, 160, "top", 8),
  { acrossMm: 40, alongMm: 20 },
);
check(
  "the physical size back out of a D11 canvas",
  profile.physicalLabelOf(160, 320, "left", 8),
  { acrossMm: 40, alongMm: 20 },
);

console.log("the label the printer has loaded");
check(
  "a 40 x 20 mm roll -> the canvas it needs, in the printer's way round",
  (() => {
    const loaded = profile.loadedLabelOf({ paperWidth: 40, paperHeight: 20 }, 8);
    return profile.canvasForPrinter(loaded, "top", 8);
  })(),
  { width: 320, height: 160 },
);
check(
  "no paper info -> nothing to apply",
  profile.loadedLabelOf(undefined, 8),
  undefined,
);
check(
  "a width but no length -> the length is not known either",
  profile.loadedLabelOf({ paperWidth: 40 }, 8),
  undefined,
);
check(
  "a continuous roll of 1000 mm -> not a label size, so not used",
  profile.loadedLabelOf({ paperWidth: 40, paperHeight: 1000 }, 8),
  undefined,
);

console.log("the canvas is the design, not the paper");

// The canvas is the pixels the designer drew. The direction says which of
// its two axes crosses the print head and which runs along the roll — so
// changing the direction changes what the label MEASURES, not what was
// drawn on it. The design must not be turned for that.
//
// These two cases are the whole of the printer-adoption flow:
//
//   1. the printer is adopted, so the direction changes and the canvas stays
//   2. the media the printer reports is applied, which sets the canvas size
//
// and the result has to be the label the printer actually has loaded.

console.log("a 40 x 20 mm label on a B21");
check(
  "the printer's direction, with the canvas left as it was drawn",
  (() => {
    // a 320x160 canvas drawn for a D11, adopted by a B21
    const direction = "top";
    return { direction, size: { width: 320, height: 160 } };
  })(),
  { direction: "top", size: { width: 320, height: 160 } },
);
check(
  "the media the printer reports, in the printer's orientation",
  (() => {
    const loaded = profile.loadedLabelOf({ paperWidth: 40, paperHeight: 20 }, 8);
    return profile.canvasForPrinter(loaded, "top", 8);
  })(),
  { width: 320, height: 160 },
);

console.log("the same label on a D11, which feeds it the long way round");
check(
  "the media the printer reports, in the printer's orientation",
  (() => {
    const loaded = profile.loadedLabelOf({ paperWidth: 40, paperHeight: 20 }, 8);
    return profile.canvasForPrinter(loaded, "left", 8);
  })(),
  { width: 160, height: 320 },
);
check(
  "the two canvases describe the same physical label",
  (() => {
    const loaded = profile.loadedLabelOf({ paperWidth: 40, paperHeight: 20 }, 8);
    const b21 = profile.physicalLabelOf(
      profile.canvasForPrinter(loaded, "top", 8).width,
      profile.canvasForPrinter(loaded, "top", 8).height,
      "top",
      8,
    );
    const d11 = profile.physicalLabelOf(
      profile.canvasForPrinter(loaded, "left", 8).width,
      profile.canvasForPrinter(loaded, "left", 8).height,
      "left",
      8,
    );
    return b21.acrossMm === d11.acrossMm && b21.alongMm === d11.alongMm;
  })(),
  true,
);

console.log("the roll's tag, which the printer writes the count back to");

// The printer reports what it can read of the roll's tag before a print,
// so the app can see the situation coming rather than after the print died
// with error 20 and no explanation.
check(
  "a roll with a tag, plenty left -> nothing to say",
  errors.inspectRollTag({
    tag: { tagPresent: true, usedPaper: 10, allPaper: 100 },
  }),
  undefined,
);
check(
  "plain thermal paper, no tag -> the roll has no tag",
  errors.inspectRollTag({ tag: { tagPresent: false, usedPaper: 0, allPaper: 0 } })?.kind,
  "no_tag",
);
check(
  "the printer cannot read the tag -> it says so",
  errors.inspectRollTag({
    heartbeat: { paperRfidSuccess: false },
    tag: { tagPresent: true, usedPaper: 10, allPaper: 100 },
  })?.kind,
  "unreadable",
);
check(
  "the counter has run out -> the write would be refused",
  errors.inspectRollTag({ tag: { tagPresent: true, usedPaper: 100, allPaper: 100 } })?.kind,
  "exhausted",
);
check(
  "no information at all -> nothing to say",
  errors.inspectRollTag({}),
  undefined,
);

console.log("recognising error 20");
check(
  "the library's error carries the code",
  errors.printerErrorCode(new Error("Print error 20: WriteRfidFail")),
  20,
);
check(
  "an error with a reasonId carries it too",
  errors.printerErrorCode(Object.assign(new Error("boom"), { reasonId: 20 })),
  20,
);
check(
  "error 20 is recognised",
  errors.isWriteRfidFail(new Error("Print error 20: WriteRfidFail")),
  true,
);
check(
  "another error is not",
  errors.isWriteRfidFail(new Error("Print error 16: WrongPaper")),
  false,
);
check(
  "a random failure is not",
  errors.isWriteRfidFail(new Error("Timeout waiting response")),
  false,
);

console.log("the width that is actually measured at print time");
// Both print paths resample the raster to the printer's native resolution and
// then measure what comes back, so the canvas handed to printableWidthMm is
// already in the printer's dots. It must be converted with NIIMBOT_DPMM:
// converting it with the template's own dpmm is the same unit error one level
// down, and it under-reports a label drawn above 8 dpmm — which would let an
// over-wide raster reach the head.
const resampled = (acrossMm, alongMm, fromDpmm) => {
  const scale = limits.NIIMBOT_DPMM / fromDpmm;
  return {
    width: Math.max(1, Math.round(Math.round(acrossMm * fromDpmm) * scale)),
    height: Math.max(1, Math.round(Math.round(alongMm * fromDpmm) * scale)),
  };
};
const measuredAcross = (acrossMm, alongMm, fromDpmm) =>
  limits.printableWidthMm(resampled(acrossMm, alongMm, fromDpmm), "top", limits.NIIMBOT_DPMM);

check("a 40 mm label drawn at 8 dpmm measures 40 mm", measuredAcross(40, 20, 8), 40);
check(
  "a 60 mm label drawn at 300 dpi still measures 60 mm, not 40.64",
  measuredAcross(60, 20, 11.81),
  60,
);
check(
  "so it is blocked on a 48 mm head instead of slipping through",
  limits.evaluateWidth(measuredAcross(60, 20, 11.81), 48, 48).blocked,
  "60 mm > 48 mm",
);
check(
  "a 40 mm label drawn at 4 dpmm measures 40 mm, not 80",
  measuredAcross(40, 20, 4),
  40,
);
check(
  "so it is not blocked on a 48 mm head that can print it",
  limits.evaluateWidth(measuredAcross(40, 20, 4), 48, 48).blocked,
  undefined,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
