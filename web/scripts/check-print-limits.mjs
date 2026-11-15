/**
 * Executable check of the print-width decision logic.
 *
 * The module is bundled with the project's own esbuild (a Vite dependency) so
 * the real source is exercised, not a copy of it.
 */
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The web directory, worked out from where this script lives rather than
// from an absolute path: the check has to run wherever the repository is
// checked out, which is the point of running it at all.
const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRY = join(WEB, "src/utils/print_limits.ts");
const outDir = mkdtempSync(join(tmpdir(), "lb-limits-"));
const outFile = join(outDir, "print_limits.mjs");

await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
  absWorkingDir: WEB,
  logLevel: "error",
});

const mod = await import(pathToFileURL(outFile).href);

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
check("d11 -> 96 px", mod.headWidthForModel("d11"), 96);
check("b21 -> 384 px", mod.headWidthForModel("b21"), 384);
check("unknown model -> undefined", mod.headWidthForModel(undefined), undefined);

console.log("density ranges");
check("d11 density 1..3", mod.densityRangeForModel("d11"), { min: 1, max: 3 });
check("b21 density 1..5", mod.densityRangeForModel("b21"), { min: 1, max: 5 });

console.log("evaluateWidth");
check(
  "fits the device head -> no block, no warning",
  mod.evaluateWidth(96, 96, 96),
  { printWidth: 96, blocked: undefined, warning: undefined },
);
check(
  "wider than the device head -> blocked",
  mod.evaluateWidth(200, 96, 96).blocked,
  "200 > 96",
);
check(
  "wider than the model head but the device can print it -> warning only",
  mod.evaluateWidth(200, 384, 96).warning,
  "200 > 96",
);
check(
  "wider than the model head and the device too -> blocked wins",
  mod.evaluateWidth(200, 96, 96).blocked,
  "200 > 96",
);
check(
  "no device connected, model head exceeded -> warning only",
  mod.evaluateWidth(200, undefined, 96).warning,
  "200 > 96",
);
check(
  "no device connected, model head exceeded -> not blocked",
  mod.evaluateWidth(200, undefined, 96).blocked,
  undefined,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
