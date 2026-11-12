import * as fabric from "fabric";

/**
 * Label preflight — a pure inspection of a fabric.js canvas.
 *
 * Nothing in here mutates the canvas: it only reads geometry, colours and
 * text, and answers the question "would this label print wrong?". In a GMP
 * environment a clipped sample id or an illegible expiry date is a real
 * quality problem, so every check maps to something that can actually go
 * wrong on the printed label.
 */

export type PreflightSeverity = "error" | "warning" | "info";

export type PreflightCode =
  | "text-overflow"
  | "outside-label"
  | "low-contrast"
  | "tiny-text"
  | "empty-text"
  | "hidden-text"
  | "unfilled-variable";

export interface PreflightFinding {
  /** Stable id, unique within one run: `${code}:${objectId ?? "canvas"}` */
  id: string;
  severity: PreflightSeverity;
  code: PreflightCode;
  /** i18n key. The caller translates it; do NOT put English prose in the message. */
  messageKey: string;
  /** Values for the i18n placeholders in that key. */
  params: Record<string, string | number>;
  /** fabric object id, when the finding belongs to one object. */
  objectId?: number;
  /** Short human name of the object, e.g. its text content truncated to 24 chars. */
  objectLabel?: string;
}

export interface PreflightOptions {
  /** The label's printable width in canvas pixels. */
  labelWidth: number;
  /** The label's printable height in canvas pixels. */
  labelHeight: number;
  /** Minimum font size, in canvas pixels, below which text is flagged as too small. Default 8. */
  minFontSize?: number;
  /** Minimum WCAG contrast ratio for text. Default 3 for large text, 4.5 otherwise. */
  minContrastRatio?: number;
}

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_MIN_FONT_SIZE = 8;
const DEFAULT_MIN_CONTRAST = 4.5;
const LARGE_TEXT_MIN_CONTRAST = 3;
/** WCAG "large text" — 18 px, or 14 px when bold. */
const LARGE_TEXT_PX = 18;
const LARGE_BOLD_TEXT_PX = 14;
/** How much a text box may overflow before it is worth complaining about. */
const OVERFLOW_TOLERANCE_PX = 0.5;
/** How far an object may stick out of the label before it is worth complaining about. */
const OUTSIDE_TOLERANCE_PX = 0.5;
/** Object labels are truncated to this many characters. */
const LABEL_MAX_CHARS = 24;

const MESSAGE_KEYS: Record<PreflightCode, string> = {
  "text-overflow": "preflight.text_overflow",
  "outside-label": "preflight.outside_label",
  "low-contrast": "preflight.low_contrast",
  "tiny-text": "preflight.tiny_text",
  "empty-text": "preflight.empty_text",
  "hidden-text": "preflight.hidden_text",
  "unfilled-variable": "preflight.unfilled_variable",
};

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** Un-substituted template placeholder, e.g. `{{sample_id}}`. */
const VARIABLE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/* ------------------------------------------------------------------ */
/* colours                                                             */
/* ------------------------------------------------------------------ */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** The named colours that actually show up in a label designer. */
const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  lime: "#00ff00",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  teal: "#008080",
  purple: "#800080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  transparent: "#00000000",
};

/** Parse `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` or a named colour. */
const parseColor = (color: string): Rgba | undefined => {
  if (typeof color !== "string") return undefined;
  const value = color.trim().toLowerCase();
  if (value.length === 0) return undefined;
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1,
      };
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
    return undefined;
  }

  const fn = value.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1]
      .split(/[\s,/]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length < 3) return undefined;
    const channel = (part: string, max: number): number =>
      part.endsWith("%") ? (parseFloat(part) / 100) * max : parseFloat(part);
    const r = channel(parts[0], 255);
    const g = channel(parts[1], 255);
    const b = channel(parts[2], 255);
    const a = parts.length > 3 ? channel(parts[3], 1) : 1;
    if (![r, g, b, a].every((n) => Number.isFinite(n))) return undefined;
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: clamp(a, 0, 1),
    };
  }

  const named = NAMED_COLORS[value];
  return named ? parseColor(named) : undefined;
};

/** WCAG 2.x relative luminance of an opaque colour. */
const relativeLuminance = (color: Rgba): number => {
  const linear = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
  );
};

/** Composite a (possibly translucent) colour over an opaque backdrop. */
const compositeOver = (foreground: Rgba, background: Rgba): Rgba => ({
  r: foreground.r * foreground.a + background.r * (1 - foreground.a),
  g: foreground.g * foreground.a + background.g * (1 - foreground.a),
  b: foreground.b * foreground.a + background.b * (1 - foreground.a),
  a: 1,
});

/** WCAG contrast ratio between two colours, 1 … 21. */
const contrastRatio = (a: Rgba, b: Rgba): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The object's own box in canvas (label) coordinates.
 *
 * `calcTransformMatrix()` is the object's own transform — it deliberately does
 * not include the canvas viewport transform, so the result stays in label
 * space even while the user zooms or pans the designer.
 */
const getObjectBounds = (obj: fabric.FabricObject): Bounds => {
  const matrix = obj.calcTransformMatrix();
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const corners = [
    new fabric.Point(0, 0),
    new fabric.Point(width, 0),
    new fabric.Point(width, height),
    new fabric.Point(0, height),
  ].map((corner) => fabric.util.transformPoint(corner, matrix));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

const boundsOverlap = (a: Bounds, b: Bounds): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** How far the object sticks out of the label, in canvas pixels. */
const outsideAmount = (bounds: Bounds, labelWidth: number, labelHeight: number): number => {
  const left = Math.max(0, -bounds.left);
  const top = Math.max(0, -bounds.top);
  const right = Math.max(0, bounds.right - labelWidth);
  const bottom = Math.max(0, bounds.bottom - labelHeight);
  return Math.max(left, top, right, bottom);
};

/* ------------------------------------------------------------------ */
/* object inspection                                                   */
/* ------------------------------------------------------------------ */

interface ObjectIdentity {
  canvasId?: unknown;
  id?: unknown;
}

/**
 * A stable numeric id for an object.
 *
 * Fabric keeps a numeric `canvasId` on every object it creates; the index in
 * the canvas object list is used as a fallback so that ids stay unique inside
 * one run even for hand-made objects.
 */
const getObjectId = (obj: fabric.FabricObject, index: number): number => {
  const identity = obj as unknown as ObjectIdentity;
  if (typeof identity.canvasId === "number" && Number.isFinite(identity.canvasId)) {
    return identity.canvasId;
  }
  if (typeof identity.id === "number" && Number.isFinite(identity.id)) {
    return identity.id;
  }
  return index;
};

/** A short, human readable name of the object. */
const getObjectLabel = (obj: fabric.FabricObject): string => {
  if (obj instanceof fabric.FabricText) {
    const text = (obj.text ?? "").replace(/\s+/g, " ").trim();
    if (text.length > 0) return truncate(text, LABEL_MAX_CHARS);
  }
  const name = (obj as unknown as { name?: string }).name;
  if (typeof name === "string" && name.trim().length > 0) {
    return truncate(name.trim(), LABEL_MAX_CHARS);
  }
  return truncate(String(obj.type ?? "object"), LABEL_MAX_CHARS);
};

const isTextObject = (obj: fabric.FabricObject): obj is fabric.FabricText =>
  obj instanceof fabric.FabricText;

/**
 * The text properties the checks read.
 *
 * A structural type on purpose: fabric's own text classes carry generic type
 * parameters that make `Textbox` unassignable to `FabricText` (their `toObject`
 * signatures differ), so the helpers take the shape they actually need.
 */
interface TextLike {
  text: string;
  fontSize: number;
  fontWeight: string | number;
  fill: unknown;
  scaleX: number;
  scaleY: number;
  width: number;
  /** Present on fabric text objects; used for the rendered line widths. */
  getLineWidth?: (lineIndex: number) => number;
  _textLines?: string[][];
  textLines?: string[][];
}

/** True when the object is drawn with something that hides what is below it. */
const isOpaqueObject = (obj: fabric.FabricObject): boolean => {
  if (obj.opacity <= 0) return false;
  if (obj.visible === false) return false;
  if (obj instanceof fabric.FabricText) return true;
  if (obj instanceof fabric.Group) {
    return obj.getObjects().some((child) => isOpaqueObject(child));
  }
  if (obj instanceof fabric.Image) return true;
  const fill = (obj as unknown as { fill?: unknown }).fill;
  if (typeof fill === "string") {
    const parsed = parseColor(fill);
    return parsed !== undefined && parsed.a > 0.5;
  }
  if (fill && typeof fill === "object") return true; // gradient or pattern
  return false;
};

/* ------------------------------------------------------------------ */
/* text metrics                                                        */
/* ------------------------------------------------------------------ */

/**
 * Fabric internals we read defensively — the public API moved a few times
 * between fabric 6 and 7, so every accessor is optional.
 */
interface LineMetrics {
  getLineWidth?: (lineIndex: number) => number;
  _textLines?: string[][];
  textLines?: string[][];
  _measureLine?: (line: string[]) => number;
}

/**
 * The width of the widest rendered line of a text object, in object units.
 *
 * `getLineWidth` is fabric's own measurement of a rendered line, so it
 * accounts for the font, the letter spacing and the text direction.
 */
const getWidestLineWidth = (obj: TextLike): number => {
  const metrics = obj as LineMetrics;
  const lines = metrics._textLines ?? metrics.textLines ?? [];
  let widest = 0;
  for (let i = 0; i < lines.length; i += 1) {
    let width = 0;
    if (typeof metrics.getLineWidth === "function") {
      width = metrics.getLineWidth(i);
    } else if (typeof metrics._measureLine === "function" && lines[i]) {
      width = metrics._measureLine(lines[i]);
    }
    if (Number.isFinite(width) && width > widest) widest = width;
  }
  return widest;
};

/** Font size in canvas pixels, after the object's own scaling is applied. */
const getEffectiveFontSize = (obj: fabric.FabricText): number => {
  const scaleX = Math.abs(obj.scaleX ?? 1);
  const scaleY = Math.abs(obj.scaleY ?? 1);
  return (obj.fontSize ?? 0) * Math.min(scaleX, scaleY);
};

/** WCAG "large text" — 18 px, or 14 px when bold. */
const isLargeText = (
  obj: { fontWeight?: string | number },
  effectiveFontSize: number,
): boolean => {
  const weight = obj.fontWeight;
  const bold = weight === "bold" || (typeof weight === "number" && weight >= 600);
  return effectiveFontSize >= (bold ? LARGE_BOLD_TEXT_PX : LARGE_TEXT_PX);
};

/** The first un-substituted `{{variable}}` of a text, if any. */
const findUnfilledVariable = (text: string): string | undefined => {
  const match = VARIABLE_RE.exec(text);
  VARIABLE_RE.lastIndex = 0;
  return match ? match[1] : undefined;
};

/** A Date & time / Serial number object carries its token out of band. */
const hasDynamicToken = (obj: fabric.FabricObject): boolean => {
  const token = (obj as unknown as { dynamicToken?: unknown }).dynamicToken;
  return typeof token === "string" && token.length > 0;
};

/* ------------------------------------------------------------------ */
/* background                                                          */
/* ------------------------------------------------------------------ */

/**
 * The colour a text object is printed on: the canvas background if one is
 * set, otherwise the fill of a full-size background rectangle, otherwise the
 * white label stock.
 */
const resolveBackground = (
  canvas: fabric.Canvas,
  objects: fabric.FabricObject[],
  labelWidth: number,
  labelHeight: number,
): Rgba => {
  const background = canvas.backgroundColor;
  if (typeof background === "string") {
    const parsed = parseColor(background);
    if (parsed) return parsed;
  }
  for (const obj of objects) {
    if (!(obj instanceof fabric.Rect)) continue;
    const fill = (obj as unknown as { fill?: unknown }).fill;
    if (typeof fill !== "string") continue;
    const parsed = parseColor(fill);
    if (!parsed || parsed.a === 0) continue;
    const bounds = getObjectBounds(obj);
    const coversLabel =
      bounds.right - bounds.left >= labelWidth * 0.95 &&
      bounds.bottom - bounds.top >= labelHeight * 0.95;
    if (coversLabel) return parsed;
  }
  return WHITE;
};

/* ------------------------------------------------------------------ */
/* the checks                                                          */
/* ------------------------------------------------------------------ */

/**
 * Inspect a canvas and report everything that would make the printed label
 * wrong. The canvas is never modified.
 */
export const runPreflight = (
  canvas: fabric.Canvas,
  options: PreflightOptions,
): PreflightFinding[] => {
  const labelWidth = Math.max(0, options.labelWidth);
  const labelHeight = Math.max(0, options.labelHeight);
  const minFontSize = options.minFontSize ?? DEFAULT_MIN_FONT_SIZE;
  const minContrastRatio = options.minContrastRatio;

  const objects = canvas.getObjects();
  const background = resolveBackground(canvas, objects, labelWidth, labelHeight);
  const findings: PreflightFinding[] = [];

  const push = (
    code: PreflightCode,
    severity: PreflightSeverity,
    params: Record<string, string | number>,
    objectId: number | undefined,
    objectLabel: string | undefined,
  ): void => {
    findings.push({
      id: `${code}:${objectId ?? "canvas"}`,
      severity,
      code,
      messageKey: MESSAGE_KEYS[code],
      params,
      objectId,
      objectLabel,
    });
  };

  objects.forEach((obj, index) => {
    const objectId = getObjectId(obj, index);
    const objectLabel = getObjectLabel(obj);
    const bounds = getObjectBounds(obj);

    // 2. outside-label — the object would be clipped by the label edge.
    const outside = outsideAmount(bounds, labelWidth, labelHeight);
    if (outside > OUTSIDE_TOLERANCE_PX) {
      push(
        "outside-label",
        "error",
        { overflowPx: round1(outside) },
        objectId,
        objectLabel,
      );
    }

    if (!isTextObject(obj)) return;

    const text = obj.text ?? "";
    const effectiveFontSize = getEffectiveFontSize(obj);

    // 5. empty-text
    if (text.trim().length === 0) {
      push("empty-text", "info", {}, objectId, objectLabel);
    }

    // 7. unfilled-variable — a template placeholder that was never replaced.
    if (!hasDynamicToken(obj)) {
      const variable = findUnfilledVariable(text);
      if (variable !== undefined) {
        push("unfilled-variable", "error", { variable }, objectId, objectLabel);
      }
    }

    // 4. tiny-text
    if (effectiveFontSize > 0 && effectiveFontSize < minFontSize) {
      push(
        "tiny-text",
        "warning",
        { fontSize: round1(effectiveFontSize), minSize: round1(minFontSize) },
        objectId,
        objectLabel,
      );
    }

    // 1. text-overflow — a word that is longer than its box is not broken and
    //    spills out sideways. A Textbox's height always matches its content,
    //    so only the horizontal direction can overflow.
    if (obj instanceof fabric.Textbox) {
      // A fabric Textbox has every field TextLike asks for, but its generic
      // parameters make TypeScript unable to prove it, so the shape is asserted
      // here rather than loosened for every other caller.
      const widest = getWidestLineWidth(obj as unknown as TextLike);
      if (widest > 0) {
        const scaleX = Math.abs(obj.scaleX ?? 1);
        const overflowPx = widest * scaleX - (obj.width ?? 0) * scaleX;
        if (overflowPx > OVERFLOW_TOLERANCE_PX) {
          push(
            "text-overflow",
            "error",
            { overflowPx: round1(overflowPx) },
            objectId,
            objectLabel,
          );
        }
      }
    }

    // 3. low-contrast — the fill of the text against what is printed behind it.
    const fill = obj.fill;
    if (typeof fill === "string") {
      const foreground = parseColor(fill);
      if (foreground && foreground.a > 0) {
        const ratio = contrastRatio(compositeOver(foreground, background), background);
        const threshold =
          minContrastRatio ??
          (isLargeText(obj, effectiveFontSize)
            ? LARGE_TEXT_MIN_CONTRAST
            : DEFAULT_MIN_CONTRAST);
        if (ratio < threshold) {
          push("low-contrast", "warning", { ratio: round2(ratio) }, objectId, objectLabel);
        }
      }
    }

    // 6. hidden-text — something drawn later sits on top of this text.
    const covering = objects
      .slice(index + 1)
      .filter((other) => isOpaqueObject(other))
      .filter((other) => boundsOverlap(bounds, getObjectBounds(other)));
    if (covering.length > 0) {
      const top = covering[covering.length - 1];
      push(
        "hidden-text",
        "warning",
        { other: getObjectLabel(top) },
        objectId,
        objectLabel,
      );
    }
  });

  const rank: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
};

/** Counts per severity, for the headline of the preflight panel. */
export const summarizeFindings = (
  findings: PreflightFinding[],
): { errors: number; warnings: number; infos: number } => ({
  errors: findings.filter((finding) => finding.severity === "error").length,
  warnings: findings.filter((finding) => finding.severity === "warning").length,
  infos: findings.filter((finding) => finding.severity === "info").length,
});
