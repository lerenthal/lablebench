/**
 * Shared domain model for templates.
 *
 * The shape here is the contract between the SPA and the server. It is
 * intentionally close to the upstream niimblue document model (`ExportedLabelTemplate`)
 * so the fork stays a thin diff: niimblue's `canvas`/`label` structures are carried
 * through unchanged inside `canvas_json`.
 */
import { z } from "zod";

/** §5.1 / §7: target printer model. */
export const TemplateModelSchema = z.enum(["d11", "b21"]);
export type TemplateModel = z.infer<typeof TemplateModelSchema>;

/**
 * Print orientation. "left" means the raster is rotated 90° clockwise for the
 * print head (upstream niimblue `printDirection`).
 */
export const OrientationSchema = z.enum(["left", "top"]);
export type Orientation = z.infer<typeof OrientationSchema>;

/** Print head width in pixels, per model. Never send an over-wide raster. */
export const PRINT_HEAD_PIXELS: Record<TemplateModel, number> = {
  d11: 96,
  b21: 384,
};

/** Nominal dots per millimetre (203 dpi ≈ 8 px/mm). */
export const DEFAULT_DPMM = 8;

/** niimblue label geometry. Carried through unchanged. */
export const LabelPropsSchema = z.object({
  printDirection: z.enum(["left", "top"]),
  size: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  shape: z.enum(["rect", "rounded_rect", "circle"]).optional(),
  split: z.enum(["none", "vertical", "horizontal"]).optional(),
  splitParts: z.number().min(1).optional(),
  tailPos: z.enum(["right", "bottom", "left", "top"]).optional(),
  tailLength: z.number().optional(),
  mirror: z.enum(["none", "copy", "flip"]).optional(),
  offset: z
    .object({
      x: z.number(),
      y: z.number(),
      offsetType: z.enum(["inner", "outer"]),
    })
    .optional(),
});

export type LabelProps = z.infer<typeof LabelPropsSchema>;

/**
 * The canvas document: everything needed to render the label.
 *
 * `fabric` is the upstream Fabric.js object graph. `label` is the upstream
 * `LabelProps`. `thumbnail` is a base64 PNG for the gallery view.
 */
export const CanvasDocumentSchema = z.object({
  fabric: z.unknown(),
  label: LabelPropsSchema,
  dpmm: z.number().positive().default(DEFAULT_DPMM),
  thumbnail: z.string().optional(),
});

export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;

/** A declared merge variable. */
export const TemplateVariableSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.enum(["text", "barcode", "qrcode"]).default("text"),
  required: z.boolean().default(false),
  default_value: z.string().optional(),
});

export type TemplateVariable = z.infer<typeof TemplateVariableSchema>;

/**
 * Serial-number auto-increment (§5.4, optional field).
 * Assigns a synthetic value to one variable as rows are printed.
 */
export const SerialConfigSchema = z.object({
  variable: z.string().min(1),
  prefix: z.string().default(""),
  start: z.number().int().default(1),
  step: z.number().int().default(1),
  pad: z.number().int().min(0).max(20).default(0),
});

export type SerialConfig = z.infer<typeof SerialConfigSchema>;

/**
 * §7: `variables_json` — declared variables plus the CSV column bindings.
 * The bindings are persisted with the template so re-importing a CSV of the
 * same shape "just works" (§5.4).
 */
export const TemplateVariablesSchema = z.object({
  variables: z.array(TemplateVariableSchema).default([]),
  /** template variable name -> CSV column name */
  csv_mapping: z.record(z.string(), z.string()).default({}),
  serial: SerialConfigSchema.optional(),
});

export type TemplateVariables = z.infer<typeof TemplateVariablesSchema>;

/** Request body for POST /api/templates and PUT /api/templates/:id */
export const TemplateInputSchema = z.object({
  name: z.string().min(1).max(200),
  model: TemplateModelSchema,
  label_w_mm: z.number().positive(),
  label_h_mm: z.number().positive(),
  orientation: OrientationSchema,
  canvas: CanvasDocumentSchema,
  variables: TemplateVariablesSchema.optional(),
  asset_ids: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export type TemplateInput = z.infer<typeof TemplateInputSchema>;

/** A stored template, as returned by the API. */
export interface Template {
  id: string;
  name: string;
  model: TemplateModel;
  label_w_mm: number;
  label_h_mm: number;
  orientation: Orientation;
  canvas: CanvasDocument;
  variables: TemplateVariables;
  asset_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** Compact template record for the gallery / list views. */
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

export interface TemplateVersion {
  id: string;
  template_id: string;
  version: number;
  created_at: string;
}
