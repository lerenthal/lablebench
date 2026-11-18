import * as fabric from "fabric";
import type { AppConfig, LabelPreset, LabelProps } from "$/types";
import { TextboxExt } from "$/fabric-object/textbox-ext";

export const configureFabric = () => {
  fabric.config.disableStyleCopyPaste = true;

  fabric.classRegistry.setClass(TextboxExt, "Textbox");

  // Redraw objects on every step of a resize drag. By default Fabric keeps the old cached picture until
  // the mouse is released: scaled vector shapes (circle, SVG) look pixelated, and rect/QR/ArUco lose
  // the newly added part when enlarged.
  fabric.FabricObject.ownDefaults.noScaleCache = false;

  fabric.Line.prototype.setControlsVisibility({
    tl: false,
    bl: false,
    tr: false,
    br: false,
    mt: false,
    mb: false,
  });

  fabric.Polyline.prototype.setControlsVisibility({
    tl: false,
    bl: false,
    tr: false,
    br: false,
    mt: false,
    mb: false,
  });
};

/** Default presets for LabelPropsEditor */
export const DEFAULT_LABEL_PRESETS: LabelPreset[] = [
  // Every NIIMBOT prints at 203 dpi — 8 px/mm — so every label is.
  // The first is a D11 label (12 mm across the head, 40 mm along the roll)
  // and the second a B21 one (48 mm across the head, 30 mm along).
  //
  // The titles read across the head × along the roll, which is the order a
  // label is measured and sold in.
  { width: 40, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "12 × 40 mm" },
  { width: 48, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "48 × 30 mm" },
];

/**
 * Label sizes that fit a printer's print head.
 *
 * These were two hand-written lists, one per family, which is part of what
 * kept the app to two printers: a K3 has an 80 mm head and none of the sizes
 * on offer would have been right for it. They are worked out from the head
 * instead, so every printer gets sensible sizes and a new model needs no edit
 * here.
 *
 * Which side of the label the head limits depends on the way the printer
 * feeds it. With the print direction "left" the label's HEIGHT crosses the
 * head; with "top" it is the WIDTH. The length along the roll is free.
 *
 * The widths offered are the head itself plus the narrower stock sizes that
 * fit under it, because a roll narrower than the head is the common case -
 * the lab's own 40 x 20 mm labels sit on a 48 mm head.
 */

/** Stock widths labels are actually sold in, in millimetres. */
const STOCK_WIDTHS_MM = [8, 12, 15, 20, 25, 30, 40, 50, 56, 60, 72, 75, 80, 100, 104];

/** Lengths along the roll worth offering, in millimetres. */
const STOCK_LENGTHS_MM = [15, 20, 30, 40, 50, 75, 100];

/**
 * One-click label sizes for a printer with the given head.
 *
 * @param headMm    the print head's width in millimetres
 * @param direction the way the printer feeds a label
 * @param dpmm      the printer's resolution, in dots per millimetre
 */
export const labelPresetsForHead = (
  headMm: number | undefined,
  direction: "left" | "top",
  dpmm: number,
): LabelPreset[] => {
  if (headMm === undefined || headMm <= 0) {
    return [];
  }

  // The head's own width first, then the two widest stock sizes under it: a
  // long list of every combination would be harder to pick from than typing
  // the numbers, which is what these buttons exist to avoid.
  const underHead = STOCK_WIDTHS_MM.filter((w) => w < headMm).slice(-2).reverse();
  const widths = [Math.round(headMm * 10) / 10, ...underHead];

  const presets: LabelPreset[] = [];

  for (const across of widths) {
    // Shorter labels for narrower stock: a 12 mm roll is not usually bought
    // in 100 mm lengths, and the full ladder for every width is too many.
    const lengths = across >= 40
      ? [30, 50, 100]
      : across >= 20
        ? [20, 30, 50]
        : [15, 20, 30, 40];

    for (const along of lengths.filter((l) => STOCK_LENGTHS_MM.includes(l))) {
      presets.push({
        // "left" feeds the label the long way round, so the canvas width runs
        // along the roll and its height crosses the head. "top" is the other
        // way about. This is the same mapping `canvasForLabel` uses.
        width: direction === "left" ? along : across,
        height: direction === "left" ? across : along,
        unit: "mm",
        dpmm,
        printDirection: direction,
        shape: "rect",
        title: `${across} × ${along} mm`,
      });
    }
  }

  return presets;
};

/** Default canvas dimensions */
export const DEFAULT_LABEL_PROPS: LabelProps = {
  printDirection: "left",
  size: {
    width: 240,
    height: 96,
  },
  // Every NIIMBOT prints at 203 dpi — 8 px/mm.
  dpmm: 8,
};

/** Object movement snapping */
export const GRID_SIZE: number = 5;

export const BARCODE_WIDTH: number = 200;

/** Newly created Fabric object dimensions */
export const OBJECT_SIZE_DEFAULTS = {
  width: 64,
  height: 64,
};

/** Newly created Fabric object common properties */
export const OBJECT_DEFAULTS = {
  snapAngle: 10,
  top: 10,
  left: 10,
  originX: "left" as fabric.TOriginX,
  originY: "top" as fabric.TOriginY,
} as fabric.FabricObjectProps;

/** Newly created Fabric vector object properties */
export const OBJECT_DEFAULTS_VECTOR = {
  ...OBJECT_DEFAULTS,
  fill: "transparent",
  stroke: "black",
  strokeWidth: 3,
  strokeUniform: true,
} as fabric.FabricObjectProps;

/** Newly created Fabric text object properties */
export const OBJECT_DEFAULTS_TEXT = {
  ...OBJECT_DEFAULTS,
  fill: "black",
  fontFamily: "Noto Sans Variable",
  textAlign: "center" as fabric.TextboxProps["textAlign"],
  originX: "center" as fabric.TOriginX,
  originY: "center" as fabric.TOriginY,
  lineHeight: 1,
} as fabric.TextboxProps;

/** Scale image to this height when making a label thumbnail */
export const THUMBNAIL_HEIGHT = 48;

/** Generate thumbnail in jpeg format with this quality */
export const THUMBNAIL_QUALITY = 0.7;

export const APP_CONFIG_DEFAULTS: AppConfig = {
  fitMode: "stretch",
  iconListMode: "both",
  gridEnabled: false
};

