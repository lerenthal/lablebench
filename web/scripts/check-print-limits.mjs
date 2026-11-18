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
const turn = await load(join(WEB, "src/utils/label_turn.ts"));
const defaults = await load(join(WEB, "src/defaults.ts"));

// The library's own model table, so the checks are driven off the same
// facts the printer reports rather than a copy of them.
const { modelsLibrary, LabelType, findPrintTask } = await import(
  pathToFileURL(join(WEB, "node_modules/@mmote/niimbluelib/dist/cjs/index.js")).href
);
const metaFor = (suffix) => modelsLibrary.find((m) => String(m.model).endsWith(suffix));

// The library's own model table, for the checks that need a real printer
// rather than a hand-made one. It ships as CommonJS, so the named exports
// may sit on the namespace or behind `default` depending on the loader.
const niimblue = await import("@mmote/niimbluelib");
const { getPrinterMetaByModel, PrinterModel } = niimblue.default ?? niimblue;

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
check("D11 -> 12 mm", limits.headMmForModel("D11"), 12);
check("B1 -> 48 mm", limits.headMmForModel("B1"), 48);
check("unknown model -> undefined", limits.headMmForModel(undefined), undefined);
check("a name the library does not know -> undefined", limits.headMmForModel("NOPE"), undefined);

// A template saved before models were recorded by their own id carries one of
// the two old family names. Those have to keep answering, or every label in
// the gallery loses its head width and its size buttons.
console.log("the two old family names still answer");
check("d11 -> 12 mm", limits.headMmForModel("d11"), 12);
check("b21 -> 48 mm", limits.headMmForModel("b21"), 48);
check("d11 maps to D11", profile.libraryModelFor("d11"), "D11");
check("b21 maps to B21", profile.libraryModelFor("b21"), "B21");
check("any other id is passed straight through", profile.libraryModelFor("K3"), "K3");

// The whole point of the change: a printer nobody wrote a list entry for.
console.log("printers the app used to refuse");
check("a K3's head is 80 mm", limits.headMmForModel("K3"), 80);
check("an ET10's head is 200 mm", limits.headMmForModel("ET10"), 200);
check("a B1_PRO prints at 300 dpi, so 567 dots is still 48 mm", limits.headMmForModel("B1_PRO"), 48);

console.log("density ranges");
check("D11 density 1..3", limits.densityRangeForModel("D11"), { min: 1, max: 3 });
check("B1 density 1..5", limits.densityRangeForModel("B1"), { min: 1, max: 5 });
check("a K3's own range", limits.densityRangeForModel("K3"), {
  min: metaFor("K3").densityMin,
  max: metaFor("K3").densityMax,
});

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

console.log("a reading the printer could not actually have");
// The sensor behind the head measures the media, so a label narrower than
// its backing reports the backing: a 40 mm label on a 50 mm liner comes back
// as 50 mm. Applied to a 48 mm head that sizes the canvas to paper the
// printer cannot print across, and the width check then blocks a label that
// prints perfectly well. An impossible width is ignored, like an impossible
// length.
const b21 = profile.connectedPrinterFor(
  getPrinterMetaByModel(PrinterModel.B21),
);
const d11 = profile.connectedPrinterFor(
  getPrinterMetaByModel(PrinterModel.D11),
);
check(
  "a 40 mm label on a B21 -> believed",
  profile.loadedLabelFor(b21, { paperWidth: 40, paperHeight: 20 }),
  { acrossMm: 40, alongMm: 20 },
);
check(
  "the 50 mm liner it sits on -> wider than the 48 mm head, so ignored",
  profile.loadedLabelFor(b21, { paperWidth: 50, paperHeight: 20 }),
  undefined,
);
check(
  "exactly 48 mm on a 48 mm head -> still a label",
  profile.loadedLabelFor(b21, { paperWidth: 48, paperHeight: 20 }),
  { acrossMm: 48, alongMm: 20 },
);
check(
  "a 12 mm roll on a D11 -> believed",
  profile.loadedLabelFor(d11, { paperWidth: 12, paperHeight: 40 }),
  { acrossMm: 12, alongMm: 40 },
);
check(
  "a 15 mm reading on a D11's 12 mm head -> ignored",
  profile.loadedLabelFor(d11, { paperWidth: 15, paperHeight: 40 }),
  undefined,
);
check(
  "no printer -> nothing to compare the width with, so the reading stands",
  profile.loadedLabelFor(undefined, { paperWidth: 50, paperHeight: 20 }),
  { acrossMm: 50, alongMm: 20 },
);
check(
  "an impossible length is still ignored",
  profile.loadedLabelFor(b21, { paperWidth: 40, paperHeight: 1000 }),
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

console.log("the printers in the lab");

// The lab has a B1 and a D11. Their numbers come from the library's table,
// so a change in the library shows up here rather than in the field.
const labB1 = metaFor("B1");
const labD11 = metaFor("D11");

check(
  "the B1 is recorded by its own model id",
  profile.connectedPrinterFor(labB1).model,
  "B1",
);
check(
  "and so is the D11",
  profile.connectedPrinterFor(labD11).model,
  "D11",
);
check(
  "the B1's head is 48 mm",
  profile.connectedPrinterFor(labB1).headMm,
  48,
);
check(
  "the D11's head is 12 mm",
  profile.connectedPrinterFor(labD11).headMm,
  12,
);
check(
  "the B1 feeds a label the short way round",
  profile.connectedPrinterFor(labB1).direction,
  "top",
);
check(
  "the D11 feeds a label the long way round",
  profile.connectedPrinterFor(labD11).direction,
  "left",
);
check(
  "the D11 takes densities 1 to 3",
  [
    profile.connectedPrinterFor(labD11).densityMin,
    profile.connectedPrinterFor(labD11).densityMax,
  ],
  [1, 3],
);
check(
  "the B1 takes densities 1 to 5",
  [
    profile.connectedPrinterFor(labB1).densityMin,
    profile.connectedPrinterFor(labB1).densityMax,
  ],
  [1, 5],
);

console.log("a 40 x 20 mm label, the stock in the lab");
check(
  "on the B1 it is 320 x 160 px, in the printer's own orientation",
  profile.canvasForPrinter({ acrossMm: 40, alongMm: 20 }, "top", 8),
  { width: 320, height: 160 },
);
check(
  "on the B1 it fits the head",
  limits.evaluateWidth(40, profile.connectedPrinterFor(labB1).headMm, 48).blocked,
  undefined,
);
check(
  "on the D11 it does not fit the head, and the print is blocked",
  limits.evaluateWidth(40, profile.connectedPrinterFor(labD11).headMm, 12).blocked,
  "40 mm > 12 mm",
);
check(
  "a 12 mm label fits the D11",
  limits.evaluateWidth(12, profile.connectedPrinterFor(labD11).headMm, 12).blocked,
  undefined,
);

console.log("the backing paper, which the sensor measures instead of the label");

// The sensor behind the print head measures the media the label sits on,
// so a 40 mm label on a 50 mm liner reads as 50 mm. A width wider than the
// print head cannot be a label width, so it is ignored.
check(
  "a 50 mm liner on a B1 -> ignored, the printer's own head is 48 mm",
  profile.loadedLabelFor(profile.connectedPrinterFor(labB1), {
    paperWidth: 50,
    paperHeight: 20,
  }),
  undefined,
);
check(
  "a 40 mm label on a B1 -> believed",
  profile.loadedLabelFor(profile.connectedPrinterFor(labB1), {
    paperWidth: 40,
    paperHeight: 20,
  }),
  { acrossMm: 40, alongMm: 20 },
);
check(
  "a 12 mm label on a D11 -> believed",
  profile.loadedLabelFor(profile.connectedPrinterFor(labD11), {
    paperWidth: 12,
    paperHeight: 30,
  }),
  { acrossMm: 12, alongMm: 30 },
);
check(
  "a 15 mm liner on a D11's 12 mm head -> ignored",
  profile.loadedLabelFor(profile.connectedPrinterFor(labD11), {
    paperWidth: 15,
    paperHeight: 30,
  }),
  undefined,
);

console.log("turning the label, and not turning it when it is only resized");

// A label that is turned comes out the other way round, and the design turns
// with it. A label that is only resized does not — and a square label has
// no "other way round" to be resized into.
check(
  "40 x 20 -> 20 x 40 is a turn",
  turn.isTurnedLabel({ width: 40, height: 20 }, { width: 20, height: 40 }),
  true,
);
check(
  "40 x 20 -> 42 x 21 is not a turn",
  turn.isTurnedLabel({ width: 40, height: 20 }, { width: 42, height: 21 }),
  false,
);
check(
  "40 x 40 -> 42 x 42 is not a turn, though the size is nearly square",
  turn.isTurnedLabel({ width: 40, height: 40 }, { width: 42, height: 42 }),
  false,
);
check(
  "40 x 40 -> 40 x 40 is not a turn",
  turn.isTurnedLabel({ width: 40, height: 40 }, { width: 40, height: 40 }),
  false,
);
check(
  "a round label, which is square by definition, is not turned by a resize",
  turn.isTurnedLabel({ width: 320, height: 320 }, { width: 336, height: 336 }),
  false,
);
check(
  "a label that is clearly not square, turned, is turned",
  turn.isTurnedLabel({ width: 320, height: 240 }, { width: 240, height: 320 }),
  true,
);
check(
  "a label that is nearly square is left alone, because a turn and a resize "
    + "cannot be told apart",
  turn.isTurnedLabel({ width: 320, height: 330 }, { width: 330, height: 320 }),
  false,
);
check(
  "a label turned a quarter and back is not a turn",
  turn.isTurnedLabel({ width: 320, height: 160 }, { width: 320, height: 160 }),
  false,
);

console.log("every printer the library describes can be designed for");

// This is the claim the change rests on. The app used to accept 15 of these
// and refuse the other 62, from two hand-written lists of names. Nothing
// about a printer is decided from its name any more, so the only models it
// cannot design for are ones the library itself says nothing about.
const designable = modelsLibrary.filter(
  (meta) => profile.connectedPrinterFor(meta) !== undefined,
);
check(
  `all ${modelsLibrary.length} of the library's models are accepted`,
  designable.length,
  modelsLibrary.length,
);
check("nothing at all is still nothing", profile.connectedPrinterFor(undefined), undefined);

// And every one of them reports the three facts a design needs. A head of
// zero dots or a missing feed direction would make a canvas nobody can print,
// so it is worth knowing the table never hands one over.
const incomplete = modelsLibrary.filter((meta) => {
  const p = profile.connectedPrinterFor(meta);
  return (
    !(p.headPixels > 0) ||
    !(p.headMm > 0) ||
    (p.direction !== "left" && p.direction !== "top") ||
    !(p.dpmm > 0)
  );
});
check("every model reports a head, a feed direction and a resolution", incomplete.length, 0);

console.log("size buttons are worked out from the head, not a list");

// The sizes on offer used to be two hand-written lists, so a printer outside
// the two families got none at all.
const b1Presets = defaults.labelPresetsForHead(48, "top", 8);
const d11Presets = defaults.labelPresetsForHead(12, "left", 8);
const k3Presets = defaults.labelPresetsForHead(80, "top", 8);

check("a 48 mm head gets sizes", b1Presets.length > 0, true);
check("a 12 mm head gets sizes", d11Presets.length > 0, true);
check("an 80 mm head gets sizes too, which it never used to", k3Presets.length > 0, true);
check("no head means no sizes to offer", defaults.labelPresetsForHead(undefined, "top", 8), []);

// A size that does not fit the head is the bug these buttons exist to avoid,
// so none of them may be wider than the head they were worked out from.
const acrossOf = (preset) => (preset.printDirection === "left" ? preset.height : preset.width);
check(
  "nothing offered for a 12 mm head is wider than 12 mm",
  d11Presets.every((preset) => acrossOf(preset) <= 12),
  true,
);
check(
  "nothing offered for a 48 mm head is wider than 48 mm",
  b1Presets.every((preset) => acrossOf(preset) <= 48),
  true,
);
check(
  "an 80 mm head is offered its full width",
  k3Presets.some((preset) => acrossOf(preset) === 80),
  true,
);
// The feed direction decides which side of the canvas crosses the head, and
// getting it the wrong way round turns every label a quarter.
check(
  "a label fed \"left\" has its length along the canvas width",
  d11Presets[0].width > d11Presets[0].height,
  true,
);
check(
  "a label fed \"top\" has its width across the canvas width",
  b1Presets[0].width,
  48,
);

console.log("the protocol stand-in shown before anything is connected");

// Guessing a protocol sends one printer another's packets, so not knowing has
// to be expressible rather than defaulted.
check("a D11's stand-in is a D11 protocol", profile.printTaskForModel("D11"), "D11_V1");
check("a B1's is the B1 protocol", profile.printTaskForModel("B1"), "B1");
check("an old d11 template resolves the same way", profile.printTaskForModel("d11"), "D11_V1");
check(
  "a model the library cannot place without a firmware version says so",
  profile.printTaskForModel("K3"),
  undefined,
);
check("and nothing named says nothing", profile.printTaskForModel(undefined), undefined);


console.log("the B1's own stock list, which is shorter than the B21's");

// The B1 does not understand Continuous stock, so a roll of that kind must
// not be sent to it — the printer rejects a kind it does not know with
// "SetPaperFail" (error 17) and nothing is printed.
check(
  "a request the B1 understands is honoured",
  profile.resolveLabelType(
    profile.connectedPrinterFor(labB1),
    undefined,
    LabelType.Black,
  ),
  LabelType.Black,
);
check(
  "a request the B1 does not understand falls back to one it does",
  profile.resolveLabelType(
    profile.connectedPrinterFor(labB1),
    undefined,
    LabelType.Continuous,
  ),
  LabelType.WithGaps,
);
check(
  "the roll's own type is used when the user asked for nothing",
  profile.resolveLabelType(
    profile.connectedPrinterFor(labB1),
    LabelType.Transparent,
    undefined,
  ),
  LabelType.Transparent,
);
check(
  "and the roll's type is not used when the B1 does not understand it",
  profile.resolveLabelType(
    profile.connectedPrinterFor(labB1),
    LabelType.Continuous,
    undefined,
  ),
  LabelType.WithGaps,
);
check(
  "the D11 understands even less, and falls back to gaps",
  profile.resolveLabelType(
    profile.connectedPrinterFor(labD11),
    LabelType.Black,
    undefined,
  ),
  LabelType.WithGaps,
);

console.log("the protocol each printer speaks");

// The B1 and the B21 look alike but do not speak alike: the B1 has its own
// print task, with a different print start and a different page size.
check(
  "the B1 speaks the B1 protocol",
  findPrintTask(labB1.model, 3),
  "B1",
);
// The D11 has been through several protocol revisions, and which one it
// speaks depends on its firmware: the old one at v1 and v2, and the
// original one from v3 on.
check(
  "a D11 on the older firmware speaks the D110 protocol",
  findPrintTask(labD11.model, 1),
  "D110",
);
check(
  "and the same at v2",
  findPrintTask(labD11.model, 2),
  "D110",
);
check(
  "a D11 on a later firmware speaks the original D11 protocol",
  findPrintTask(labD11.model, 3),
  "D11_V1",
);
check(
  "and the same at v4",
  findPrintTask(labD11.model, 4),
  "D11_V1",
);
check(
  "the B1 speaks the same protocol at every version",
  [1, 2, 3, 4, 5].map((v) => findPrintTask(labB1.model, v)),
  ["B1", "B1", "B1", "B1", "B1"],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
