/**
 * DYMO LabelWriter support.
 *
 * The LabelWriter family is a raster printer: the host sends rows of dots,
 * not a label language. The transport is WebUSB, through the open-source
 * `thermal-label/labelwriter` driver (MIT), which needs the same things the
 * NIIMBOT path already needs — Chrome or Edge, and a page served over
 * HTTPS. There is no vendor driver, no native helper and no cloud call.
 *
 * ## How the two printers differ
 *
 * The NIIMBOT prints at 203 dpi and the app's label canvas is in device
 * pixels at 203 dpi, so a canvas pixel is a dot. The LabelWriter prints at
 * 300 dpi, so one canvas pixel is worth 1.476 dots.
 *
 * That is not a reason to change the template format. The label stays in
 * canvas pixels at 203 dpi; at print time the canvas is re-rendered at the
 * LabelWriter's own resolution and placed into the bitmap the driver asks
 * for. Re-rendering rather than enlarging matters: the text is laid out and
 * rasterised afresh at 300 dpi, so a 6 pt batch number is drawn at the
 * resolution the head will burn, not blown up from a 203 dpi bitmap.
 *
 * ## The geometry
 *
 * The driver owns the numbers. The head width, the media's length in dots
 * and the leading dead zone all come from the driver's own registry and
 * helpers, so a change of media or firmware is picked up rather than
 * hardcoded here.
 *
 * The driver's bitmap is the full width of the print head and the printable
 * length of the media:
 *
 *     width  = headDots              (672 on a 450)
 *     height = media.lengthDots - leadingDots
 *
 * The label is placed across the head (centred, because a label narrower
 * than the head sits in the middle of it) and along the roll from the top
 * of the printable area, which is where the driver expects it once it has
 * removed the leading dead zone.
 */

import { requestPrinters } from "@thermal-label/labelwriter-web";
import {
  DEFAULT_MEDIA,
  MEDIA,
  findMediaByDimensions,
  getPrintableCanvasDots,
  type LabelWriterMedia,
  type LabelWriterPrintOptions,
} from "@thermal-label/labelwriter-core";
import type { LabelPreset } from "$/types";

/** The app's native label resolution: 8 px/mm, which is 203 dpi. */
export const CANVAS_DPMM = 8;

/** The LabelWriter print heads print at 300 dpi. */
export const DYMO_DPI = 300;

/** Dots per millimetre on a 300 dpi head. */
export const DYMO_DPMM = DYMO_DPI / 25.4;

/**
 * How many print dots one canvas pixel is worth on a 300 dpi head.
 *
 * 1.4764: a 456 px (57 mm) canvas becomes 673 dots across the head.
 */
export const DOTS_PER_CANVAS_PX = DYMO_DPMM / CANVAS_DPMM;

/**
 * The width of the print head, in millimetres.
 *
 * 672 dots at 300 dpi is 56.9 mm — the physical width of the head on a
 * LabelWriter 450.
 */
export const DYMO_HEAD_MM = 672 / DYMO_DPMM;

/**
 * The dead zone at the start of the media, in millimetres.
 *
 * The printer feeds through this before the label begins. The driver knows
 * the exact figure in dots; this is the same number in millimetres, used to
 * work out the media's printable length.
 */
export const DYMO_LEADING_MM = 6;

/**
 * How much over the nominal head width a media may declare.
 *
 * The head is 672 dots, which is 56.9 mm, and DYMO sells a "57 mm" media —
 * the same thing, rounded. Half a millimetre of tolerance admits it
 * without admitting the media meant for the wider 550 head.
 */
export const DYMO_MEDIA_TOLERANCE_MM = 0.5;

/** The LabelWriter 450, the model in the lab. */
export const DYMO_450 = "LabelWriter 450";

/** The printer adapter, as the driver hands it back. */
export type DymoPrinter = Awaited<ReturnType<typeof requestPrinters>>[string];

export interface DymoConnection {
  printer: DymoPrinter;
  /** The model's name, for the status line. */
  model: string;
}

/**
 * Open the browser's USB picker and connect to a LabelWriter.
 *
 * Must be called from a user gesture: the browser will not show the picker
 * otherwise.
 */
export const connectDymo = async (): Promise<DymoConnection> => {
  const printers = await requestPrinters({ transport: "usb" });
  const roles = Object.keys(printers);

  if (roles.length === 0) {
    throw new Error("No LabelWriter found");
  }

  // A LabelWriter Duo has two engines — the label side and the tape side.
  // The label engine is the one that prints labels, so it is the one wanted
  // here; the fallback is for a device that only exposes one.
  const role = roles.find((r) => r === "label") ?? roles[0];
  const printer = printers[role];

  return { printer, model: printer.model || DYMO_450 };
};

/** Close the connection. */
export const disconnectDymo = async (connection: DymoConnection): Promise<void> => {
  try {
    await connection.printer.close();
  } catch (e) {
    console.warn("LabelWriter close failed", e);
  }
};

/**
 * The media that matches a label, in millimetres.
 *
 * The app's label is W pixels along the roll and H pixels across the head
 * (with the print direction "left"), at 8 px/mm. The media registry stores
 * the media's nominal length, which includes the dead zone the printer
 * feeds through before the label starts — so the lookup adds that back.
 */
export const mediaForLabel = (
  canvasWidth: number,
  canvasHeight: number,
  leadingMm: number,
): LabelWriterMedia => {
  const alongRollMm = canvasWidth / CANVAS_DPMM;
  const acrossHeadMm = canvasHeight / CANVAS_DPMM;

  return (
    findMediaByDimensions(acrossHeadMm, alongRollMm + leadingMm) ??
    findMediaByDimensions(acrossHeadMm, alongRollMm) ??
    DEFAULT_MEDIA
  );
};

/** The printable area of the head and the media, in dots. */
export interface DymoGeometry {
  /** The full width of the print head, in dots. */
  headDots: number;
  /** The printable length along the roll, in dots. */
  printableLengthDots: number;
  /** The dead zone at the start of the media, in dots. */
  leadingDots: number;
  /** The media the label was matched to. */
  media: LabelWriterMedia;
}

export interface DymoGeometryInput {
  /** The label's canvas size in pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** The engine, which carries the head width and the dead zones. */
  engine?: Parameters<typeof getPrintableCanvasDots>[0];
}

/**
 * A LabelWriter 450 engine, used when the driver has not told us which
 * engine it is driving.
 *
 * The head width, the resolution and the dead zones are the ones the
 * vendor's own technical reference gives for the 450 series.
 */
export const DEFAULT_DYMO_ENGINE: Parameters<typeof getPrintableCanvasDots>[0] = {
  role: "primary",
  protocol: "lw-raster",
  dpi: DYMO_DPI,
  headDots: 672,
  mediaCompatibility: ["lw"],
  printableArea: { leading: 6, trailing: 0, left: 0, right: 0 },
};

/**
 * Work out the bitmap the driver wants for this label.
 *
 * The leading dead zone comes from the driver's own helper, so it is the
 * driver's number and not a constant here.
 */
export const dymoGeometry = ({
  canvasWidth,
  canvasHeight,
  engine,
}: DymoGeometryInput): DymoGeometry => {
  const printable = getPrintableCanvasDots(engine ?? DEFAULT_DYMO_ENGINE);
  const leadingMm = printable.leadingDots / DYMO_DPMM;
  const media = mediaForLabel(canvasWidth, canvasHeight, leadingMm);

  return {
    headDots: printable.widthDots,
    printableLengthDots:
      (media.lengthDots ?? 0) - printable.leadingDots - printable.trailingDots,
    leadingDots: printable.leadingDots,
    media,
  };
};

/**
 * The label sizes this printer can print, taken from the driver's media
 * registry.
 *
 * The media registry knows every roll DYMO makes, and it knows the length of
 * each in dots. The dead zone at the start of the media is what the printer
 * feeds through before the label begins, so the usable length of a roll is
 * its length less that. Nothing here is typed in by hand: the numbers come
 * from the registry, so a media the driver knows about is a size the app
 * offers.
 */
export const dymoLabelPresets = (): LabelPreset[] => {
  const presets: LabelPreset[] = [];

  for (const media of Object.values(MEDIA) as LabelWriterMedia[]) {
    const lengthDots = media.lengthDots ?? 0;
    const widthMm = media.widthMm ?? 0;
    const heightMm = media.heightMm ?? 0;

    if (lengthDots <= 0) {
      continue;
    }

    // The roll's length in dots is the dimension along the roll.
    const alongMm = lengthDots / DYMO_DPMM;

    // The dimension across the head is the other one the media declares, and
    // it has to fit the head. A square label declares the same dimension
    // twice, so a difference of less than half a millimetre counts as the
    // same one.
    const others = [widthMm, heightMm].filter((mm) => Math.abs(mm - alongMm) > 0.5);
    const acrossMm =
      others.find((mm) => mm > 0 && mm <= DYMO_HEAD_MM + DYMO_MEDIA_TOLERANCE_MM) ??
      (widthMm > 0 && Math.abs(widthMm - alongMm) <= 0.5 && widthMm <= DYMO_HEAD_MM + DYMO_MEDIA_TOLERANCE_MM
        ? widthMm
        : undefined);

    if (acrossMm === undefined) {
      continue;
    }

    // The printable length is the roll's length less the dead zone the
    // printer feeds through before the label starts.
    const printableMm = alongMm - DYMO_LEADING_MM;

    if (printableMm <= 0) {
      continue;
    }

    presets.push({
      width: Math.round(printableMm * 10) / 10,
      height: Math.round(acrossMm * 10) / 10,
      unit: "mm",
      dpmm: CANVAS_DPMM,
      printDirection: "left",
      shape: "rect",
      title: `${media.name}`,
    });
  }

  return presets;
};

/**
 * Render the label into the bitmap the driver expects.
 *
 * The label is re-rendered at the head's own resolution rather than
 * enlarged, so the text is drawn afresh at 300 dpi.
 *
 * @param canvas    the label, already rendered and processed to 1 bit
 * @param geometry  the head and media geometry
 */
export const composeDymoBitmap = (
  canvas: HTMLCanvasElement,
  geometry: DymoGeometry,
): { width: number; height: number; data: Uint8Array } => {
  const width = geometry.headDots;
  const height = Math.max(1, geometry.printableLengthDots);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;

  // White is the label stock. The driver thresholds against it.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);

  // The label's own pixels, at the head's resolution. It is clamped to the
  // head, because a label that rounds up by a dot must lose that dot at the
  // edge rather than run off it.
  const scaled = Math.min(width, canvas.width * DOTS_PER_CANVAS_PX);
  const scaledHeight = canvas.height * DOTS_PER_CANVAS_PX;

  // Across the head: a label narrower than the head sits in the middle of
  // it, which is how a LabelWriter prints a small die-cut label.
  const x = Math.max(0, Math.round((width - scaled) / 2));
  // Along the roll: from the top of the printable area.
  const y = 0;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x, y, scaled, scaledHeight);

  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: new Uint8Array(imageData.data.buffer) };
};

/**
 * The engine a connected printer is driving.
 *
 * A LabelWriter Duo has two — the label side and the tape side — and the
 * label side is the one wanted here.
 */
export const dymoEngine = (connection: DymoConnection) => {
  const engines = connection.printer.device?.engines ?? [];
  return engines.find((e) => e.role === "label") ?? engines[0] ?? DEFAULT_DYMO_ENGINE;
};

/**
 * Print one label.
 *
 * @param connection  the open LabelWriter
 * @param canvas      the label, already rendered and processed to 1 bit
 * @param geometry    the head and media geometry
 */
export const printDymoLabel = async (
  connection: DymoConnection,
  canvas: HTMLCanvasElement,
  geometry: DymoGeometry,
): Promise<void> => {
  const image = composeDymoBitmap(canvas, geometry);

  // The generic adapter's option type does not carry the LabelWriter's
  // labelLengthDots, but the LabelWriter implementation accepts it, and the
  // driver needs it: without it the form-feed pitch is wrong.
  const options = {
    labelLengthDots: geometry.media.lengthDots ?? 0,
  } as LabelWriterPrintOptions;

  await connection.printer.print(image, geometry.media, options);
};
