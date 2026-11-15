import * as fabric from "fabric";
import type { AppConfig, LabelPreset, LabelProps, TemplateModel } from "$/types";
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
  { width: 40, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect" },
  { width: 48, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect" },
];

/**
 * Label sizes that fit each printer's print head.
 *
 * The numbers are millimetres at 8 px/mm, which is 203 dpi — the resolution
 * every NIIMBOT prints at. With the print direction "left" the label's
 * HEIGHT is the dimension that crosses the print head, so the height cannot
 * exceed the head's width:
 *
 *   D11   96 px head = 12 mm
 *   B21  384 px head = 48 mm
 *
 * The length along the roll is free; only the head limits the other side.
 * These are the sizes a lab actually buys and prints, so they are offered as
 * one click rather than typed in millimetres.
 */
export const MODEL_LABEL_PRESETS: Record<TemplateModel, LabelPreset[]> = {
  // A D11 takes the label the long way round, so the canvas width runs along
  // the roll and the canvas height across the head. These are 12 mm and 8 mm
  // wide rolls — the head is 12 mm.
  d11: [
    { width: 40, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "40 × 12 mm" },
    { width: 30, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 12 mm" },
    { width: 20, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "20 × 12 mm" },
    { width: 15, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "15 × 12 mm" },
    { width: 30, height: 8, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 8 mm" },
    { width: 20, height: 8, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "20 × 8 mm" },
  ],
  // A B21 takes the label the other way: the canvas width crosses the head
  // and the canvas height runs along the roll. The head is 48 mm, so these
  // are 48 mm, 25 mm and 12 mm wide rolls.
  b21: [
    { width: 48, height: 100, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "48 × 100 mm" },
    { width: 48, height: 50, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "48 × 50 mm" },
    { width: 48, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "48 × 30 mm" },
    { width: 25, height: 50, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "25 × 50 mm" },
    { width: 25, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "25 × 30 mm" },
    { width: 12, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect", title: "12 × 30 mm" },
  ],
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

export const CSV_DEFAULT = "var1,var2\n123,456\n777,888";
