/**
 * The printer that is plugged in.
 *
 * The app used to ask which printer a template was for, and the answer was a
 * guess the user had to keep correcting. The printer knows what it is: it
 * reports its model id, and the library has a table of what every model can
 * do — how wide its print head is, which way it feeds a label, which
 * densities it takes, and which kinds of label stock it understands.
 *
 * This turns what the printer says about itself into the few facts the app
 * actually needs, so the printer can be the authority instead of a question.
 */

import {
  LabelType,
  findPrintTask,
  type PaperInfo,
  type PrinterModel,
  type PrinterModelMeta,
  type PrintTaskName,
} from "@mmote/niimbluelib";
import type { TemplateModel } from "$/types";

/**
 * Dots per millimetre at a given resolution.
 *
 * 203 dpi is 8 px/mm and is what every NIIMBOT but the 300 dpi _PRO models
 * uses. The library reports the head's resolution as 200, which is the same
 * thing to within a rounding error, so the resolution is what decides.
 */
export const dpmmForDpi = (dpi: number | undefined): number =>
  dpi !== undefined && dpi >= 250 ? 11.81 : 8;

/**
 * The printer a template was drawn for.
 *
 * This used to be one of two families, `d11` or `b21`, chosen from two
 * hand-written lists of model names. Those lists were the only thing stopping
 * the app designing for the other printers: the library describes 77 models
 * and can build a print task for every one of them, and the three facts the
 * app needs from a printer - how many dots its head is, which way it feeds a
 * label, and what resolution it prints at - are reported by the printer
 * itself. The family name carried no information the printer had not already
 * given, so it was turning 62 perfectly drivable printers away for nothing.
 *
 * A template now records the library's own model id, and the geometry it was
 * drawn at is stored beside it as millimetres and a feed direction. The model
 * is therefore a note about where the design came from, not a constraint: the
 * connected printer is what decides whether a label can be printed, and the
 * width check already measures against the head in front of it.
 *
 * `d11` and `b21` are still read, because templates saved before this carry
 * them.
 */
const LEGACY_FAMILY_MODELS: Record<string, string> = {
  d11: "D11",
  b21: "B21",
};

/**
 * The library model id a stored template's model refers to.
 *
 * Returns the id unchanged for anything the library might know, and maps the
 * two old family names onto the model each one stood for.
 */
export const libraryModelFor = (model: TemplateModel | undefined): string | undefined => {
  if (model === undefined || model === "") return undefined;
  return LEGACY_FAMILY_MODELS[model] ?? model;
};

/**
 * The print task a model's template would use, when no printer is connected.
 *
 * The protocol is properly a question for the printer: `getPrintTaskType()`
 * answers it from the model *and* the firmware's protocol version, and a D11
 * answers `D110` on version 1 and 2 but `D11_V1` from 3 on. So this is only
 * the stand-in shown before anything is plugged in, and it is deliberately
 * allowed to be undefined: guessing a protocol means sending one printer
 * another's packets, which is worse than admitting we do not know yet.
 *
 * Printing itself always uses the connected printer's own answer.
 */
export const printTaskForModel = (
  model: TemplateModel | undefined,
): PrintTaskName | undefined => {
  const id = libraryModelFor(model);
  if (id === undefined) return undefined;

  try {
    return findPrintTask(id as PrinterModel);
  } catch {
    return undefined;
  }
};

/** Everything the app needs to know about the printer it is talking to. */
export interface ConnectedPrinter {
  /** The library's own model id, which is what a template records. */
  model: TemplateModel;
  /** The printer's own model, as the library calls it. */
  libraryModel: PrinterModel;
  /** The print head's width, in dots. */
  headPixels: number;
  /** The print head's width, in millimetres. */
  headMm: number;
  /** Dots per millimetre at this printer's resolution. */
  dpmm: number;
  /** The way this printer feeds a label. */
  direction: "left" | "top";
  /** The label stocks this printer understands. */
  paperTypes: LabelType[];
  /** The densities it accepts. */
  densityMin: number;
  densityMax: number;
  densityDefault: number;
}

/**
 * Read a connected printer out of the metadata the library fetched for it.
 *
 * Any printer the library describes is one the app can design for, because
 * everything the design needs is in that description. Undefined means the
 * library had nothing to say about this printer at all - not that the app
 * refuses it - and in that case there is no head width to check a label
 * against, so the app has to say it does not know rather than guess.
 */
export const connectedPrinterFor = (
  meta: PrinterModelMeta | undefined,
): ConnectedPrinter | undefined => {
  if (meta === undefined) return undefined;

  const dpmm = dpmmForDpi(meta.dpi);

  return {
    model: String(meta.model),
    libraryModel: meta.model,
    headPixels: meta.printheadPixels,
    headMm: Math.round((meta.printheadPixels / dpmm) * 10) / 10,
    dpmm,
    direction: meta.printDirection,
    paperTypes: meta.paperTypes ?? [],
    densityMin: meta.densityMin,
    densityMax: meta.densityMax,
    densityDefault: meta.densityDefault,
  };
};

/**
 * The label type to print with.
 *
 * The printer is told which kind of stock it has, because it needs to know
 * whether to look for gaps. It only understands the kinds in its own
 * capability list, and a kind it does not understand is rejected outright
 * with "SetPaperFail" (error 17).
 *
 * So the type is always one the printer understands. The roll's own tag is
 * the best evidence of what is loaded, and the user's choice is honoured
 * when it is a kind the printer can do.
 */
export const resolveLabelType = (
  printer: ConnectedPrinter | undefined,
  consumablesType: LabelType | undefined,
  requested: LabelType | undefined,
): LabelType => {
  const understood: LabelType[] = (printer?.paperTypes ?? []).filter(
    (t: LabelType) => t !== LabelType.Invalid,
  );

  if (understood.length > 0) {
    if (requested !== undefined && understood.includes(requested)) return requested;
    if (consumablesType !== undefined && understood.includes(consumablesType)) {
      return consumablesType;
    }
    return understood.includes(LabelType.WithGaps) ? LabelType.WithGaps : understood[0];
  }

  // Nothing is known about the printer's stock, so fall back to the
  // ordinary kind with gaps, which is what most labels are.
  if (requested !== undefined && requested !== LabelType.Invalid) return requested;
  if (consumablesType !== undefined && consumablesType !== LabelType.Invalid) {
    return consumablesType;
  }
  return LabelType.WithGaps;
};

/**
 * The size of a label, in the two ways it is worth naming.
 *
 * A label has a width across the print head and a length along the roll.
 * Which of those the canvas's width is depends on how the printer feeds the
 * label, and that differs between the two families: a D11 takes the label
 * the long way round, so the canvas width runs along the roll, while a B21
 * takes it the other way, so the canvas width crosses the head.
 *
 * The canvas is always in the printer's own orientation, so a design appears
 * on the label exactly as it was drawn.
 */
export interface LabelGeometry {
  /** The canvas width, in pixels. */
  width: number;
  /** The canvas height, in pixels. */
  height: number;
}

/**
 * The canvas for a label of a given physical size.
 *
 * @param acrossMm the width across the print head
 * @param alongMm  the length along the roll
 */
export const canvasForLabel = (
  acrossMm: number,
  alongMm: number,
  direction: "left" | "top",
  dpmm: number,
): LabelGeometry => {
  const across = Math.round(acrossMm * dpmm);
  const along = Math.round(alongMm * dpmm);

  return direction === "left" ? { width: along, height: across } : { width: across, height: along };
};

/**
 * The physical size of a canvas, in millimetres.
 */
export const labelForCanvas = (
  width: number,
  height: number,
  direction: "left" | "top",
  dpmm: number,
): { acrossMm: number; alongMm: number } => {
  const acrossPx = direction === "left" ? height : width;
  const alongPx = direction === "left" ? width : height;

  return {
    acrossMm: Math.round((acrossPx / dpmm) * 100) / 100,
    alongMm: Math.round((alongPx / dpmm) * 100) / 100,
  };
};

/**
 * A label measured the way a person measures it: how wide it is across the
 * print head, and how long it is along the roll.
 *
 * These two are the same on every printer. Which of them the canvas's width
 * is depends on the way the printer feeds the label, and that is what
 * `printDirection` records.
 */
export interface PhysicalLabel {
  /** The width across the print head, in millimetres. */
  acrossMm: number;
  /** The length along the roll, in millimetres. */
  alongMm: number;
}

/**
 * The physical size of a canvas, in millimetres.
 */
export const physicalLabelOf = (
  width: number,
  height: number,
  direction: "left" | "top",
  dpmm: number,
): PhysicalLabel => {
  const acrossPx = direction === "left" ? height : width;
  const alongPx = direction === "left" ? width : height;

  return {
    acrossMm: Math.round((acrossPx / dpmm) * 100) / 100,
    alongMm: Math.round((alongPx / dpmm) * 100) / 100,
  };
};

/**
 * The label the printer has loaded, as the sensor measured it.
 *
 * The sensor behind the print head reports the width of the media and the
 * length of one label on it, both in millimetres. That is the one thing
 * about the loaded stock the app cannot work out for itself, and it is the
 * thing that makes a label print in the wrong place.
 *
 * The length is only taken when it is a plausible label length: on a
 * continuous roll the sensor reports what is left of the media, which is not
 * a label size at all.
 */
export const loadedLabelOf = (
  paperInfo: PaperInfo | undefined,
): PhysicalLabel | undefined => {
  if (paperInfo?.paperWidth === undefined) return undefined;

  const acrossMm = paperInfo.paperWidth;
  const alongMm = paperInfo.paperHeight;

  if (alongMm === undefined || alongMm <= 0 || alongMm > 300) {
    return undefined;
  }

  return { acrossMm, alongMm };
};

/**
 * The label the printer has loaded, when the reading is one this printer
 * could actually have.
 *
 * `loadedLabelOf` reports what the sensor measured. This decides whether to
 * believe it is a label, which needs the printer as well as the reading.
 *
 * A width wider than the print head is not a label width. The sensor behind
 * the head measures the media, and a label narrower than its backing reports
 * the backing: a 40 mm label on a 50 mm liner comes back as 50 mm. Taking
 * that at face value sizes the canvas to paper the printer cannot print
 * across, and the width check then refuses to print a label that is
 * perfectly printable — the printer's own reading blocking the printer.
 *
 * So an impossible width is ignored and the label on screen is left as it
 * is, the same way an impossible length already is. The user's own size is
 * better evidence than a reading that cannot be true.
 */
export const loadedLabelFor = (
  printer: ConnectedPrinter | undefined,
  paperInfo: PaperInfo | undefined,
): PhysicalLabel | undefined => {
  const loaded = loadedLabelOf(paperInfo);

  if (loaded === undefined) return undefined;
  if (printer !== undefined && loaded.acrossMm > printer.headMm) return undefined;

  return loaded;
};

/**
 * The canvas a printer wants for a given label.
 *
 * The printer's own feed direction decides which way round the canvas is:
 * a printer that takes the label the long way round has the canvas width
 * running along the roll, and one that takes it the other way has the width
 * crossing the head.
 */
export const canvasForPrinter = (
  label: PhysicalLabel,
  direction: "left" | "top",
  dpmm: number,
): { width: number; height: number } => canvasForLabel(label.acrossMm, label.alongMm, direction, dpmm);
