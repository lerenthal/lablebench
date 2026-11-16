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
  type PaperInfo,
  type PrinterModel,
  type PrinterModelMeta,
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
 * The two families of printer the app knows how to design for.
 *
 * A D11 has a 96 px (12 mm) print head and feeds the label the way the
 * design is drawn. A B21 has a 384 px (48 mm) head and takes the label the
 * other way round, so a design for one is the other turned a quarter.
 *
 * The families are the same as the head widths and feed directions, so a
 * printer is placed by what it can actually do rather than by its name.
 */
const D11_FAMILY = new Set<PrinterModel>([
  "D11" as PrinterModel,
  "D11S" as PrinterModel,
  "D11_H" as PrinterModel,
  "D11_PRO" as PrinterModel,
  "D110" as PrinterModel,
  "D110_M" as PrinterModel,
  "HI_NB_D11" as PrinterModel,
]);

const B21_FAMILY = new Set<PrinterModel>([
  "B21" as PrinterModel,
  "B21S" as PrinterModel,
  "B21_PRO" as PrinterModel,
  "B21_C2B" as PrinterModel,
  "B21_L2B" as PrinterModel,
  "B21S_C2B" as PrinterModel,
  "B1" as PrinterModel,
  "B11" as PrinterModel,
]);

/** The model family a printer belongs to, or undefined if it is not one the app designs for. */
export const familyForModel = (model: PrinterModel): TemplateModel | undefined => {
  if (D11_FAMILY.has(model)) return "d11";
  if (B21_FAMILY.has(model)) return "b21";
  return undefined;
};

/** Everything the app needs to know about the printer it is talking to. */
export interface ConnectedPrinter {
  /** The family the app designs for. */
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
 * Returns undefined when the printer is not one of the families the app
 * designs for — the app still prints on it, but the label geometry the app
 * offers would be a guess, so it is better to say so than to pretend.
 */
export const connectedPrinterFor = (
  meta: PrinterModelMeta | undefined,
): ConnectedPrinter | undefined => {
  if (meta === undefined) return undefined;

  const model = familyForModel(meta.model);
  if (model === undefined) return undefined;

  const dpmm = dpmmForDpi(meta.dpi);

  return {
    model,
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
