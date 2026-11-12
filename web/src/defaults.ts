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
  // 203dpi
  { width: 40, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect" },
  { width: 48, height: 30, unit: "mm", dpmm: 8, printDirection: "top", shape: "rect" },
  // 300dpi
  { width: 40, height: 12, unit: "mm", dpmm: 11.81, printDirection: "left", shape: "rect", title: "40x12mm 300dpi" },
  { width: 48, height: 30, unit: "mm", dpmm: 11.81, printDirection: "top", shape: "rect", title: "48x30mm 300dpi" },
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
  d11: [
    { width: 40, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "40 × 12 mm" },
    { width: 30, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 12 mm" },
    { width: 20, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "20 × 12 mm" },
    { width: 15, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "15 × 12 mm" },
    { width: 30, height: 8, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 8 mm" },
    { width: 20, height: 8, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "20 × 8 mm" },
  ],
  b21: [
    { width: 100, height: 48, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "100 × 48 mm" },
    { width: 50, height: 48, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "50 × 48 mm" },
    { width: 30, height: 48, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 48 mm" },
    { width: 50, height: 25, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "50 × 25 mm" },
    { width: 30, height: 25, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 25 mm" },
    { width: 30, height: 12, unit: "mm", dpmm: 8, printDirection: "left", shape: "rect", title: "30 × 12 mm" },
  ],
};

/** Default canvas dimensions */
export const DEFAULT_LABEL_PROPS: LabelProps = {
  printDirection: "left",
  size: {
    width: 240,
    height: 96,
  },
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
