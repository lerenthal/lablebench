/**
 * Executable check of the CSV-to-fields decision logic.
 *
 * The modules are bundled with the project's own esbuild (a Vite dependency)
 * so the real source is exercised, not a copy of it.
 *
 * Two things are being pinned down here. One is the text a field holds: the
 * heading and the token live in the same string, so `Lot: {lot}` has to
 * survive being read back, toggled and substituted without the token being
 * mistaken for part of the heading. The other is that a generated field never
 * starts outside the label - a field laid down off the printable area is
 * invisible until it prints wrong, which is the failure these buttons exist
 * to avoid.
 */
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(join(tmpdir(), "lb-csvfields-"));

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

const fields = await load(join(WEB, "src/utils/csv_fields.ts"));
const dynamic = await load(join(WEB, "src/utils/dynamic_values.ts"));
const fit = await load(join(WEB, "src/utils/label_fit.ts"));
const csv = await load(join(WEB, "src/utils/csv_batch.ts"));
const operator = await load(join(WEB, "src/utils/operator.ts"));

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

console.log("a heading a person would read, from a column a spreadsheet holds");
check("lot -> Lot", fields.headerLabelFor("lot"), "Lot");
check("lot_code -> Lot code", fields.headerLabelFor("lot_code"), "Lot code");
check("lot-code -> Lot code", fields.headerLabelFor("lot-code"), "Lot code");
check("runs of separators collapse", fields.headerLabelFor("lot__code"), "Lot code");
check("surrounding space is dropped", fields.headerLabelFor("  lot  "), "Lot");
// Only the first word is capitalised: a heading is a label, not a title.
check("best_before -> Best before, not Best Before", fields.headerLabelFor("best_before"), "Best before");
// Anything already capitalised was deliberate.
check("ID stays ID, it does not become Id", fields.headerLabelFor("ID"), "ID");
check("Batch No is left as written", fields.headerLabelFor("Batch No"), "Batch No");
check("an empty column name has no heading", fields.headerLabelFor("   "), "");

console.log("the text a field holds");
check("without a heading it is just the token", fields.fieldTextFor("lot", false), "{lot}");
check("with a heading the two share one string", fields.fieldTextFor("lot", true), "Lot: {lot}");
check("a column that yields no heading falls back to the token", fields.fieldTextFor("_", true), "{_}");

console.log("reading a field's text back");
check("the column comes from the token", fields.columnOfFieldText("Lot: {lot}"), "lot");
check("and from a bare token", fields.columnOfFieldText("{strain}"), "strain");
check("ordinary text is not a field", fields.columnOfFieldText("Lot"), undefined);
// A date object is dynamic but is not a CSV field, so the toggle must not
// offer to put a heading on it.
check("a date token is not a CSV field", fields.columnOfFieldText("{dt|YYYY-MM-DD}"), undefined);
check("nothing at all is not a field", fields.columnOfFieldText(""), undefined);

console.log("whether a field is showing its heading");
check("a bare token is not", fields.fieldTextHasHeader("{lot}"), false);
check("a bare token with space around it is still not", fields.fieldTextHasHeader("  {lot}  "), false);
check("anything else is", fields.fieldTextHasHeader("Lot: {lot}"), true);
check("even a heading the user rewrote", fields.fieldTextHasHeader("Batch no. {lot}"), true);
check("ordinary text is not a field at all", fields.fieldTextHasHeader("Lot"), false);

console.log("toggling the heading");
check("on", fields.withHeader("{lot}", true), "Lot: {lot}");
check("off", fields.withHeader("Lot: {lot}", false), "{lot}");
check("off, from a heading the user rewrote", fields.withHeader("Batch no. {lot}", false), "{lot}");
// Turning it back on regenerates from the column, so an edited heading is
// lost. That is deliberate and worth pinning: the alternative is remembering
// a string nobody can see.
check("on again regenerates, it does not restore", fields.withHeader("{lot}", true), "Lot: {lot}");
check("on, twice, is stable", fields.withHeader("Lot: {lot}", true), "Lot: {lot}");
check("text that is not a field is left alone", fields.withHeader("Lot", true), "Lot");

console.log("rewording a heading");
// The toggle regenerates a heading from the column name; this is how a lab
// that writes "Batch no." instead of "Lot" gets to say so without typing over
// a live value on the canvas.
check("the heading can be read back out", fields.headingOfFieldText("Lot: {lot}"), "Lot");
check("a field showing none has an empty heading, not no heading",
  fields.headingOfFieldText("{lot}"), "");
check("text that is not a field has no heading at all",
  fields.headingOfFieldText("Lot"), undefined);
check("a reworded heading reads back as written",
  fields.headingOfFieldText("Batch no.: {lot}"), "Batch no.");
check("setting one keeps the token", fields.withHeading("{lot}", "Batch no."), "Batch no.: {lot}");
check("replacing one does not stack separators",
  fields.withHeading("Lot: {lot}", "Batch no."), "Batch no.: {lot}");
check("an empty heading is the same as turning it off",
  fields.withHeading("Lot: {lot}", ""), fields.withHeader("Lot: {lot}", false));
check("surrounding space is not printed", fields.withHeading("{lot}", "  Lot  "), "Lot: {lot}");
check("a heading on something that is not a field changes nothing",
  fields.withHeading("Lot", "Batch"), "Lot");

console.log("who printed it");
// The app has no users, so {operator} is filled from a per-workstation
// setting. A spreadsheet that records who prepared each row is stating a
// fact about that row, so a bound column has to win over the setting.
check(
  "the workstation's operator fills the field",
  operator.applyOperator({ lot: "SB-0412" }, "Yaniv"),
  { lot: "SB-0412", operator: "Yaniv" },
);
check(
  "an unset operator prints empty rather than the raw token",
  operator.applyOperator({}, "").operator,
  "",
);
check("surrounding space is not printed", operator.applyOperator({}, "  Yaniv  ").operator, "Yaniv");
check(
  "a CSV column bound to operator wins over the workstation",
  operator.applyOperator({ operator: "Dana" }, "Yaniv", { operator: "who" }),
  { operator: "Dana" },
);
check("the token is the one the pipeline substitutes", operator.operatorToken(), "{operator}");
check(
  "and it resolves like any other field",
  dynamic.substituteTokens("Printed by: {operator}", operator.applyOperator({}, "Yaniv")),
  "Printed by: Yaniv",
);

console.log("a heading and its token substitute together");
// This is the whole reason the heading lives in the text. Replacing the
// string rather than substituting within it would print "SB-0412" and lose
// the word "Lot".
check(
  "Lot: {lot} -> Lot: SB-0412",
  dynamic.substituteTokens("Lot: {lot}", { lot: "SB-0412" }),
  "Lot: SB-0412",
);
check(
  "a bare token still resolves to just the value",
  dynamic.substituteTokens("{lot}", { lot: "SB-0412" }),
  "SB-0412",
);
check(
  "a value holding a token is expanded too",
  dynamic.substituteTokens("{a}", { a: "{b}", b: "deep" }),
  "deep",
);
check(
  "two variables referring to each other terminate",
  typeof dynamic.substituteTokens("{a}", { a: "{b}", b: "{a}" }),
  "string",
);
check(
  "an unknown token is left visible rather than blanked",
  dynamic.substituteTokens("Lot: {nope}", { lot: "x" }),
  "Lot: {nope}",
);

console.log("laying the fields out on the label");

// The lab's roll: 40 x 20 mm at 8 dpmm on a B1, which feeds "top", so the
// canvas is 320 x 160 px.
const b1Area = fit.printableArea(320, 160, "rect");
const four = fields.layOutFields(["strain", "lot", "date", "qr"], b1Area);

check("one field per column", four.length, 4);
check("in the CSV's own order", four.map((f) => f.column), ["strain", "lot", "date", "qr"]);

const insideArea = (box, area) =>
  box.left >= area.offsetX &&
  box.top >= area.offsetY &&
  box.left + box.width <= area.offsetX + area.width + 0.001 &&
  box.top + box.height <= area.offsetY + area.height + 0.001;

check("every field starts inside the printable area", four.every((f) => insideArea(f, b1Area)), true);
check("they are stacked, not piled up", four[1].top > four[0].top, true);
check("they do not overlap", four[1].top >= four[0].top + four[0].height - 0.001, true);
check("the text is big enough to print", four.every((f) => f.fontSize >= 8), true);

// A D11 is 12 mm across its head and feeds "left", so the same four fields
// have to fit a 96 px tall canvas. This is the case the old hand-written
// layout had no answer for.
const d11Area = fit.printableArea(320, 96, "rect");
const onD11 = fields.layOutFields(["strain", "lot", "date", "qr"], d11Area);
check("four fields still fit a D11's 12 mm head", onD11.every((f) => insideArea(f, d11Area)), true);
check("and the text is still printable", onD11.every((f) => f.fontSize >= 8), true);
check("a D11's text is smaller than a B1's", onD11[0].fontSize < four[0].fontSize, true);

// A round label's printable area is the square inside the circle, which the
// fields have to respect or they print off the edge.
const roundArea = fit.printableArea(200, 200, "circle");
const onRound = fields.layOutFields(["lot", "qr"], roundArea);
check("fields on a round label stay inside the inscribed square",
  onRound.every((f) => insideArea(f, roundArea)), true);

check("no columns means no fields", fields.layOutFields([], b1Area), []);
check(
  "a label with no room produces nothing rather than negative boxes",
  fields.layOutFields(["lot"], { width: 2, height: 2, offsetX: 0, offsetY: 0 }),
  [],
);

console.log("the example CSV, end to end");

// The file the lab tests with. Its awkward rows are the point: a quoted comma
// and a long value with an apostrophe.
const example = [
  "strain,lot,date,qr",
  "Blue Oyster,SB-0412,2026-11-17,SB-0412",
  '"Pink Oyster, wild",SB-0413,2026-11-17,SB-0413',
  "Lion's Mane (Hericium erinaceus),SB-0414,2026-11-18,SB-0414",
].join("\n");

const parsed = csv.parseCsv(example);
check("four columns", parsed.columns, ["strain", "lot", "date", "qr"]);
check("three rows", parsed.rows.length, 3);
check("no parse errors", parsed.errors, []);

const generated = fields.layOutFields(parsed.columns, b1Area);
check("a field per column of the real file", generated.length, 4);

// Row 1 drawn through the real substitution, heading and all.
const row1 = parsed.rows[0];
check(
  "the first row draws as the label will print",
  generated.map((f) => dynamic.substituteTokens(fields.fieldTextFor(f.column, true), row1)),
  ["Strain: Blue Oyster", "Lot: SB-0412", "Date: 2026-11-17", "Qr: SB-0412"],
);

// The quoted comma has to stay one value all the way to the canvas.
check(
  "row 2's quoted comma survives into the field",
  dynamic.substituteTokens(fields.fieldTextFor("strain", false), parsed.rows[1]),
  "Pink Oyster, wild",
);
check(
  "row 3's apostrophe and brackets survive too",
  dynamic.substituteTokens(fields.fieldTextFor("strain", false), parsed.rows[2]),
  "Lion's Mane (Hericium erinaceus)",
);

// The columns are the headers, so binding them to the variables the generated
// fields declare has to be the identity - that is what makes the batch dialog
// need no second pass.
check(
  "the generated fields auto-bind one to one",
  csv.autoBind(
    parsed.columns,
    parsed.columns.map((name) => ({ name, type: "text", required: false })),
  ),
  { strain: "strain", lot: "lot", date: "date", qr: "qr" },
);

console.log("");

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

console.log("ALL PASS");
