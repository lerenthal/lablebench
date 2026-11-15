import { LabelType, printTaskNames } from "@mmote/niimbluelib";
import * as fabric from "fabric";
import { z } from "zod";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export type ConnectionType = "bluetooth" | "serial" | "capacitor-ble";

export type LabelUnit = "mm" | "px";
export type OjectType =
  | "text"
  | "rectangle"
  | "line"
  | "circle"
  | "image"
  | "qrcode"
  | "barcode"
  | "aruco"
  | "pdf"
  /** A Date & time object — renders the moment it is printed. */
  | "datetime"
  /** A Serial number object — renders the next number from a central counter. */
  | "serial";
export type MoveDirection = "up" | "down" | "left" | "right";
export type LabelShape = "rect" | "rounded_rect" | "circle";
export type LabelSplit = "none" | "vertical" | "horizontal";
export type TailPosition = "right" | "bottom" | "left" | "top";
export type MirrorType = "none" | "copy" | "flip";

type _Range<T extends number, R extends unknown[]> = R["length"] extends T ? R[number] : _Range<T, [R["length"], ...R]>;

export type Range<T extends number> = number extends T ? number : _Range<T, []>;

export const CsvParamsSchema = z.object({
  data: z.string(),
});

/**
 * Target printer model (§5.1 / §7).
 * `d11` = 96 px print head, `b21` = 384 px print head, both at 203 dpi (8 px/mm).
 */
export const TemplateModelSchema = z.enum(["d11", "b21"]);
export type TemplateModel = z.infer<typeof TemplateModelSchema>;

export const PRINT_HEAD_PIXELS: Record<TemplateModel, number> = {
  d11: 96,
  b21: 384,
};

/** A declared merge variable (§5.2). */
export const TemplateVariableSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(["text", "barcode", "qrcode"]).default("text"),
  required: z.boolean().default(false),
  default_value: z.string().optional(),
});

export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

/** Serial-number auto-increment (§5.4). */
export const SerialConfigSchema = z.object({
  variable: z.string().min(1),
  /**
   * The server-side counter this sequence draws from.
   *
   * The counter is what makes the number central: two workstations printing
   * the same template draw from the same sequence instead of each counting
   * from its own first row. Empty means "use the variable name", so every
   * template that binds the same variable name shares one sequence.
   */
  counter: z.string().default(""),
  prefix: z.string().default(""),
  /** Appended after the number — "SN-0042-A" reads better than "A-SN-0042". */
  suffix: z.string().default(""),
  start: z.number().int().default(1),
  step: z.number().int().default(1),
  pad: z.number().int().min(0).max(20).default(0),
});

export type SerialConfig = z.infer<typeof SerialConfigSchema>;

/**
 * §7 `variables_json`: declared variables plus the persisted CSV column bindings.
 * The binding map lets a re-imported CSV of the same shape "just work" even when
 * the column headers have been renamed (§5.4).
 */
export const TemplateVariablesSchema = z.object({
  variables: z.array(TemplateVariableSchema).default([]),
  csv_mapping: z.record(z.string(), z.string()).default({}),
  serial: SerialConfigSchema.optional(),
});

export type TemplateVariables = z.infer<typeof TemplateVariablesSchema>;

/** Not validated */
export const FabricObjectSchema = z.custom<fabric.FabricObject>((val: any): boolean => {
  return typeof val === "object";
});

export const PreviewPropsOffsetSchema = z.object({
  x: z.number(),
  y: z.number(),
  offsetType: z.enum(["inner", "outer"]),
});

/** Print orientation: "left" rotates the raster 90° for the print head. */
export type Orientation = "left" | "top";

export const LabelPropsSchema = z.object({
  printDirection: z.enum(["left", "top"]),
  size: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  shape: z.enum(["rect", "rounded_rect", "circle"]).default("rect").optional(),
  split: z.enum(["none", "vertical", "horizontal"]).default("none").optional(),
  splitParts: z.number().min(1).default(2).optional(),
  tailPos: z.enum(["right", "bottom", "left", "top"]).default("right").optional(),
  tailLength: z.number().default(0).optional(),
  mirror: z.enum(["none", "copy", "flip"]).default("none").optional(),
  offset: PreviewPropsOffsetSchema.optional(),
});

export const LabelPresetSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(["mm", "px"]),
  dpmm: z.number().positive(),
  printDirection: z.enum(["left", "top"]),
  title: z.string().optional(),
  shape: z.enum(["rect", "rounded_rect", "circle"]).default("rect").optional(),
  split: z.enum(["none", "vertical", "horizontal"]).default("none").optional(),
  splitParts: z.number().min(1).default(2).optional(),
  tailPos: z.enum(["right", "bottom", "left", "top"]).default("right").optional(),
  tailLength: z.number().default(0).optional(),
  mirror: z.enum(["none", "copy", "flip"]).default("none").optional(),
  offset: PreviewPropsOffsetSchema.optional(),
});

export const FabricJsonSchema = z.object({
  version: z.string(),
  objects: z.array(FabricObjectSchema),
});

export const ExportedLabelTemplateSchema = z.object({
  canvas: FabricJsonSchema,
  label: LabelPropsSchema,
  thumbnailBase64: z.string().optional(),
  title: z.string().optional(),
  timestamp: z.number().positive().optional(),
  id: z.string().optional(), // server template id (UUID) when loaded from the central store
  csv: CsvParamsSchema.optional(),

  // --- LabelBench extensions ---
  /**
   * Target printer model.
   *
   * Optional so partial documents (the undo buffer, legacy imports) stay
   * valid; the central store always fills in a concrete value.
   */
  model: TemplateModelSchema.optional(),
  /** Dots per millimetre used to convert label size to pixels. */
  dpmm: z.number().positive().optional(),
  /** Declared merge variables and their persisted CSV column bindings. */
  variables: TemplateVariablesSchema.optional(),
  /** Tags for light organisation (§5.3). */
  tags: z.array(z.string()).optional(),
  /** Server-side asset ids referenced by this template (§5.3). */
  assetIds: z.array(z.string()).optional(),
});

const [firstTask, ...otherTasks] = printTaskNames;

const PostProcessTypeSchema = z.enum([
  "threshold",
  "threshold_rb",
  "dither",
  "bayer2",
  "bayer4",
  "bayer8",
  "floyd_steinberg",
  "jjn",
  "stucki",
  "screentone",
  "grayscale",
]);

export const PreviewPropsSchema = z.object({
  postProcess: PostProcessTypeSchema.optional(),
  postProcessInvert: z.boolean().optional(),
  postProcessMirror: z.boolean().optional(),
  threshold: z.number().gte(1).lte(255).optional(),
  thresholdRed: z.number().gte(1).lte(255).optional(),
  strength: z.number().gte(0).lte(1.5).optional(),
  serpentine: z.boolean().optional(),
  screentoneAngle: z.number().gte(0).lte(365).optional(),
  screentoneDotSize: z.number().gte(1).optional(),
  contrast: z.number().gte(0).lte(127).optional(),
  brightness: z.number().gte(0).lte(255).optional(),
  quantity: z.number().gte(1).optional(),
  density: z.number().gte(1).optional(),
  speed: z.union([z.literal(0), z.literal(1)]).optional(),
  labelType: z.enum(LabelType).optional(),
  printTaskName: z.enum([firstTask, ...otherTasks]).optional(),
  offset: PreviewPropsOffsetSchema.optional(),
});

export const AutomationPropsSchema = z.object({
  /** Request device connect on page load. Works only for Capacitor BLE connection. */
  autoConnect: z.boolean().optional(),
  /** Connect to MAC or device id. Works only for Capacitor BLE connection. */
  autoConnectDeviceId: z.string().optional(),
  /** immediately - just open print preview dialog */
  startPrint: z.enum(["after_connect", "immediately"]).optional(),
});

export const AppConfigSchema = z.object({
  /** Keep image aspect ration when using "fit" button */
  fitMode: z.enum(["stretch", "ratio_min", "ratio_max"]),
  iconListMode: z.enum(["user", "pack", "both"]),
  packetIntervalMs: z.number().gte(0).optional(),
  gridEnabled: z.boolean().optional(),
  savedLabelsSortMode: z.enum(["date_desc", "date_asc", "title_asc", "title_desc"]).optional(),
});

export const UserIconSchema = z.object({
  name: z.string(),
  data: z.string(),
});

export const UserFontSchema = z.object({
  gzippedDataB64: z.string(),
  family: z.string(),
  mimeType: z.string(),
});

export type PostProcessType = z.infer<typeof PostProcessTypeSchema>;

export type CsvParams = z.infer<typeof CsvParamsSchema>;
export type UserIcon = z.infer<typeof UserIconSchema>;
export type LabelProps = z.infer<typeof LabelPropsSchema>;
export type LabelPreset = z.infer<typeof LabelPresetSchema>;
export type FabricJson = z.infer<typeof FabricJsonSchema>;
export type ExportedLabelTemplate = z.infer<typeof ExportedLabelTemplateSchema>;
export type PreviewPropsOffset = z.infer<typeof PreviewPropsOffsetSchema>;
export type PreviewProps = z.infer<typeof PreviewPropsSchema>;
export type AutomationProps = z.infer<typeof AutomationPropsSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type UserFont = z.infer<typeof UserFontSchema>;

/**
 * The server-side template record (§7).
 *
 * `canvas` is the whole render input: the Fabric object graph, the label
 * geometry and the millimetre-to-pixel scale. Keeping it in one document is
 * what lets a later server-side render path (§9) consume the template unchanged.
 */
export const ServerCanvasDocumentSchema = z.object({
  fabric: z.unknown(),
  label: LabelPropsSchema,
  dpmm: z.number().positive().default(8),
  thumbnail: z.string().optional(),
});

export type ServerCanvasDocument = z.infer<typeof ServerCanvasDocumentSchema>;

export interface ServerTemplate {
  id: string;
  name: string;
  model: TemplateModel;
  label_w_mm: number;
  label_h_mm: number;
  orientation: "left" | "top";
  canvas: ServerCanvasDocument;
  variables: TemplateVariables;
  asset_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** Compact record for the gallery and list views. */
export interface TemplateSummary {
  id: string;
  name: string;
  model: TemplateModel;
  label_w_mm: number;
  label_h_mm: number;
  orientation: "left" | "top";
  /** Label geometry, so a gallery can render the card without the canvas document. */
  label: LabelProps;
  tags: string[];
  thumbnail?: string;
  variable_names: string[];
  created_at: string;
  updated_at: string;
}

/**
 * A row in the saved-templates browser.
 *
 * The browser only needs the identity, the title, the thumbnail and the label
 * geometry — not the whole canvas document. Keeping the list payload separate
 * from the canvas keeps the gallery fast.
 */
export interface TemplateListItem {
  id: string;
  title: string;
  timestamp: number;
  thumbnailBase64?: string;
  label: LabelProps;
  model: TemplateModel;
  tags: string[];
  variable_names: string[];
}

export const previewPropsKeys = Object.keys(PreviewPropsSchema.shape) as (keyof PreviewProps)[];
