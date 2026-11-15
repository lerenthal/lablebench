/**
 * Print-head limits.
 *
 * §5.1 of the brief: "Validate/clamp raster width to the model's print head:
 * D11 = 96 px, B21 = 384 px. Reject or scale oversized output with a clear
 * message — never send an over-wide raster silently."
 *
 * Two different limits are in play, and they are not the same thing:
 *
 *   - The **device** limit is the connected printer's print head. Exceeding it
 *     means the printer physically cannot reproduce the label, so the raster
 *     must never be sent. This blocks the print.
 *
 *   - The **model** limit is the head width of the model the template was
 *     designed for. Exceeding it means the template does not match the
 *     printer it names, which is worth saying out loud — but a wider printer
 *     will print it perfectly well, so it warns rather than blocks.
 *
 * Both the manual print preview and the CSV batch runner go through this
 * module, so the two paths cannot drift apart.
 */

import { PrinterModel, getPrinterMetaByModel } from "@mmote/niimbluelib";
import { PRINT_HEAD_PIXELS, type TemplateModel } from "$/types";

/** The template's target model → the library's model enum. */
const MODEL_ENUM: Partial<Record<TemplateModel, PrinterModel>> = {
  d11: PrinterModel.D11,
  b21: PrinterModel.B21,
};

/**
 * The print-head width of a model, in pixels at its native resolution.
 *
 * Returns undefined for an unknown model rather than guessing.
 */
export const headWidthForModel = (model: TemplateModel | undefined): number | undefined => {
  if (model === undefined) {
    return undefined;
  }

  const meta = getPrinterMetaByModel(MODEL_ENUM[model]!);
  return meta?.printheadPixels;
};

/**
 * The density range a model accepts.
 *
 * The D11 takes 1–3; the B21 takes 1–5. Some newer B21 firmware ignores the
 * density command entirely, which is a firmware behaviour rather than a limit.
 */
export const densityRangeForModel = (
  model: TemplateModel | undefined,
): { min: number; max: number } | undefined => {
  if (model === undefined) {
    return undefined;
  }

  const meta = getPrinterMetaByModel(MODEL_ENUM[model]!);
  if (meta === undefined) {
    return undefined;
  }

  return { min: meta.densityMin, max: meta.densityMax };
};

export interface WidthEvaluation {
  /** The width the printer will actually lay down, in pixels. */
  printWidth: number;
  /** Set when the raster must not be sent: the device cannot print it. */
  blocked: string | undefined;
  /** Set when the raster is printable but does not match the template's model. */
  warning: string | undefined;
}

/**
 * Decide what to do about a raster of a given width.
 *
 * @param printWidth      the raster width in the printer's print direction
 * @param deviceHeadWidth the connected printer's print head width, if known
 * @param modelHeadWidth  the head width of the model the template targets
 */
export const evaluateWidth = (
  printWidth: number,
  deviceHeadWidth: number | undefined,
  modelHeadWidth: number | undefined,
): WidthEvaluation => {
  const evaluation: WidthEvaluation = {
    printWidth,
    blocked: undefined,
    warning: undefined,
  };

  if (deviceHeadWidth !== undefined && printWidth > deviceHeadWidth) {
    evaluation.blocked = `${printWidth} > ${deviceHeadWidth}`;
    return evaluation;
  }

  if (modelHeadWidth !== undefined && printWidth > modelHeadWidth) {
    evaluation.warning = `${printWidth} > ${modelHeadWidth}`;
  }

  return evaluation;
};

/**
 * The printable width of a canvas, for the given print direction.
 *
 * The label is fed to the head along its long axis, so a "left" print
 * direction lays down the canvas height.
 */
export const printableWidth = (canvas: HTMLCanvasElement, printDirection: "left" | "top"): number =>
  printDirection === "left" ? canvas.height : canvas.width;
