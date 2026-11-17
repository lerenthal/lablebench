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

import { modelsLibrary } from "@mmote/niimbluelib";
import { type TemplateModel } from "$/types";
import { dpmmForDpi, libraryModelFor } from "$/utils/printer_profile";

/**
 * The library's description of a model a template names.
 *
 * This was a two-entry map from the app's own family names to the library's
 * enum, which meant a template drawn for any other printer had no head width
 * at all and the model warning below could never fire for it. The lookup is
 * by the library's own id now, over the whole table, so it answers for every
 * model the library knows.
 */
const metaForTemplateModel = (model: TemplateModel | undefined) => {
  const id = libraryModelFor(model);
  if (id === undefined) return undefined;

  return modelsLibrary.find((meta) => String(meta.model) === id);
};

/**
 * The resolution every NIIMBOT prints at.
 *
 * 203 dpi is 8 dots per millimetre. The 300 dpi _PRO models are the only
 * exceptions, and they say so in their own metadata.
 */
export const NIIMBOT_DPMM = 8;

/**
 * The print head of a model, in millimetres.
 *
 * The head is quoted in dots at the printer's own resolution, so it is
 * converted with that resolution: a B1 is 384 dots at 203 dpi, which is
 * 48 mm, and a D11 is 96 dots at 203 dpi, which is 12 mm. A 300 dpi model
 * quotes more dots for the same millimetres, which is why the resolution has
 * to come into it rather than a fixed 8.
 */
export const headMmForModel = (model: TemplateModel | undefined): number | undefined => {
  const meta = metaForTemplateModel(model);
  if (meta === undefined) {
    return undefined;
  }

  return Math.round((meta.printheadPixels / dpmmForDpi(meta.dpi)) * 10) / 10;
};

/**
 * The density range a model accepts.
 *
 * A D11 takes 1–3; a B1 takes 1–5. Sending a value outside the range is
 * rejected by the printer, so the slider has to follow the model rather than
 * offer a fixed 1–5. Some newer firmware ignores the density command
 * entirely, which is a firmware behaviour rather than a limit.
 */
export const densityRangeForModel = (
  model: TemplateModel | undefined,
): { min: number; max: number } | undefined => {
  const meta = metaForTemplateModel(model);
  if (meta === undefined) {
    return undefined;
  }

  return { min: meta.densityMin, max: meta.densityMax };
};

export interface WidthEvaluation {
  /** The width the printer will actually lay down, in millimetres. */
  printWidth: number;
  /** Set when the raster must not be sent: the device cannot print it. */
  blocked: string | undefined;
  /** Set when the raster is printable but does not match the template's model. */
  warning: string | undefined;
}

/**
 * Decide what to do about a raster of a given width.
 *
 * Everything here is in millimetres. A width in pixels only means something
 * together with the resolution it was measured at, and the two sides of the
 * comparison do not come from the same one: the label is drawn at the
 * resolution the template was made at, while the print head is quoted in the
 * printer's dots. Comparing the two directly blocks a 40 mm label on a B21
 * because 40 mm at 300 dpi is 472 px and the head is 384 px at 203 dpi — a
 * 40 mm label on a 48 mm head, which fits perfectly well.
 *
 * @param printWidthMm  the raster width across the print head, in millimetres
 * @param deviceHeadMm  the connected printer's head width, if known
 * @param modelHeadMm   the head width of the model the template targets
 */
export const evaluateWidth = (
  printWidthMm: number,
  deviceHeadMm: number | undefined,
  modelHeadMm: number | undefined,
): WidthEvaluation => {
  const evaluation: WidthEvaluation = {
    printWidth: printWidthMm,
    blocked: undefined,
    warning: undefined,
  };

  if (deviceHeadMm !== undefined && printWidthMm > deviceHeadMm) {
    evaluation.blocked = `${printWidthMm} mm > ${deviceHeadMm} mm`;
    return evaluation;
  }

  if (modelHeadMm !== undefined && printWidthMm > modelHeadMm) {
    evaluation.warning = `${printWidthMm} mm > ${modelHeadMm} mm`;
  }

  return evaluation;
};

/**
 * The width a canvas lays down across the print head, in millimetres.
 *
 * The label is fed to the head along its long axis, so a "left" print
 * direction lays down the canvas height. The canvas is in the template's own
 * pixels, so it is converted with the template's resolution.
 *
 * The result is a physical width, which is the only thing that can be
 * compared with a print head — the head is quoted in the printer's dots.
 */
export const printableWidthMm = (
  canvas: HTMLCanvasElement,
  printDirection: "left" | "top",
  dpmm: number,
): number => {
  const pixels = printDirection === "left" ? canvas.height : canvas.width;
  return Math.round((pixels / dpmm) * 100) / 100;
};
