/**
 * A check of the LabelWriter geometry, run against the driver's own media
 * registry.
 *
 * The media lookup is the part that cannot be eyeballed: it decides which
 * roll the label is matched to, and therefore how long the bitmap is. This
 * runs the same arithmetic the app does and prints what comes out, so the
 * numbers can be compared with a physical roll.
 *
 *   cd web && node tools/check-dymo-geometry.mjs
 */
import { MEDIA, getPrintableCanvasDots } from "@thermal-label/labelwriter-core";

const CANVAS_DPMM = 8; // the app's native resolution: 8 px/mm
const DYMO_DPMM = 300 / 25.4;
const DYMO_LEADING_MM = 6;

const ENGINE = {
  role: "primary",
  protocol: "lw-raster",
  dpi: 300,
  headDots: 672,
  mediaCompatibility: ["lw"],
  printableArea: { leading: 6, trailing: 0, left: 0, right: 0 },
};

const printable = getPrintableCanvasDots(ENGINE);
const leadingMm = printable.leadingDots / DYMO_DPMM;

const TOLERANCE_MM = 1.5;

/** The app's mediaForLabel: the closest roll, accepted only when it is close. */
const mediaForLabel = (alongPx, acrossPx) => {
  const alongRollMm = alongPx / CANVAS_DPMM;
  const acrossHeadMm = acrossPx / CANVAS_DPMM;
  const wantedLength = alongRollMm + leadingMm;

  let best = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (const media of Object.values(MEDIA)) {
    if (media.type === "tape") continue;
    const width = media.widthMm ?? 0;
    const length = media.heightMm ?? 0;
    if (width <= 0 || length <= 0) continue;

    const error = Math.abs(width - acrossHeadMm) + Math.abs(length - wantedLength);
    if (error < bestError) {
      bestError = error;
      best = media;
    }
  }

  return { media: best, error: bestError, matched: bestError <= TOLERANCE_MM };
};

const geometry = (canvasWidth, canvasHeight, printDirection = "left") => {
  const alongPx = printDirection === "left" ? canvasWidth : canvasHeight;
  const acrossPx = printDirection === "left" ? canvasHeight : canvasWidth;
  const found = mediaForLabel(alongPx, acrossPx);
  const media = found.media;

  return {
    headDots: printable.widthDots,
    printableLengthDots: (media?.lengthDots ?? 0) - printable.leadingDots - printable.trailingDots,
    leadingDots: printable.leadingDots,
    media,
    matched: found.matched,
    error: found.error,
    alongPx,
    acrossPx,
  };
};

console.log(`head: ${printable.widthDots} dots (${(printable.widthDots / DYMO_DPMM).toFixed(1)} mm)`);
console.log(`dead zone: ${leadingMm.toFixed(1)} mm (${printable.leadingDots} dots)`);
console.log(`render scale: ${(300 / 25.4 / CANVAS_DPMM).toFixed(4)}`);
console.log("");

// The label sizes the app offers, taken from the driver's registry.
const rows = [];

for (const media of Object.values(MEDIA)) {
  const lengthDots = media.lengthDots ?? 0;
  const widthMm = media.widthMm ?? 0;
  const heightMm = media.heightMm ?? 0;
  if (lengthDots <= 0) continue;

  const alongMm = lengthDots / DYMO_DPMM;
  const others = [widthMm, heightMm].filter((mm) => Math.abs(mm - alongMm) > 0.5);
  const acrossMm =
    others.find((mm) => mm > 0 && mm <= 56.9 + 0.5) ??
    (widthMm > 0 && Math.abs(widthMm - alongMm) <= 0.5 && widthMm <= 56.9 + 0.5 ? widthMm : undefined);
  if (acrossMm === undefined) continue;

  const printableMm = alongMm - DYMO_LEADING_MM;
  if (printableMm <= 0) continue;

  rows.push({ name: media.name, alongMm, acrossMm, printableMm });
}

console.log("label size (mm)     ->  matched media                along  across  head");
for (const row of rows) {
  const canvasWidth = Math.round(row.printableMm * CANVAS_DPMM);
  const canvasHeight = Math.round(row.acrossMm * CANVAS_DPMM);
  const g = geometry(canvasWidth, canvasHeight);

  const alongDots = Math.round(g.alongPx * (300 / 25.4 / CANVAS_DPMM));
  const acrossDots = Math.round(g.acrossPx * (300 / 25.4 / CANVAS_DPMM));

  const fits = g.printableLengthDots >= alongDots && g.headDots >= acrossDots;
  const exact = g.printableLengthDots === alongDots;

  console.log(
    `${row.printableMm.toFixed(1)} x ${row.acrossMm.toFixed(1)}`.padEnd(20) +
      `->  ${String(g.media?.name ?? "NO MEDIA").padEnd(26)}` +
      `${String(alongDots).padStart(5)} ${String(acrossDots).padStart(7)} ${String(g.headDots).padStart(5)}` +
      `  roll: ${String(g.media?.heightMm).padStart(4)}mm/${String(g.media?.lengthDots).padStart(5)}dots` +
      ` printable: ${String(g.printableLengthDots).padStart(5)}` +
      `${g.matched ? "" : "  NO MATCH (continuous)"}` +
      `${fits ? (exact ? "  ok" : "  ok, the roll is longer") : "  DOES NOT FIT"}`,
  );
}
