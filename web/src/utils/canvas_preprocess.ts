import * as fabric from "fabric";
import dayjs, { ManipulateType } from "dayjs";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";

const VARIABLE_TEMPLATE_RX = /{\s*(\$?\w+)(?:([+-])(\d+)([yMwdhms]))?\s*(?:\|\s*(.*?)\s*)?}/g;

type Variables = Record<string, string>;

const DATE_DURATION_UNITS: Record<string, ManipulateType> = {
  y: "year",
  M: "month",
  w: "week",
  d: "day",
  h: "hour",
  m: "minute",
  s: "second",
};

const preprocessDateTime = (format?: string, sign?: string, amount?: string, unit?: string): string => {
  let date = dayjs();

  if (sign && amount && unit) {
    const durationUnit = DATE_DURATION_UNITS[unit];

    if (durationUnit) {
      const value = Number(amount) * (sign === "-" ? -1 : 1);
      date = date.add(value, durationUnit);
    }
  }

  return date.format(format ?? "YYYY-MM-DD HH:mm:ss");
};

const preprocessString = (input: string, variables?: Variables): string => {
  let result = input;
  let prev: string;
  let depth = 0;

  do {
    prev = result;
    result = result.replace(
      VARIABLE_TEMPLATE_RX,
      (source, key: string, sign?: string, amount?: string, unit?: string, format?: string) => {
        if (variables !== undefined && key in variables) {
          return variables[key];
        }
        if (key === "dt") {
          return preprocessDateTime(format, sign, amount, unit);
        }
        return source;
      },
    );
    depth++;
  } while (result !== prev && depth < 10);

  return result;
};

/** Preprocess all variable values so nested expressions become expanded. */
const preprocessVariables = (variables?: Variables): Variables | undefined => {
  if (!variables) {
    return undefined;
  }

  const resolved: Variables = {};
  for (const [key, value] of Object.entries(variables)) {
    resolved[key] = preprocessString(value, variables);
  }
  return resolved;
};

/** Replace text templates in some canvas objects. */
export const canvasPreprocess = (canvas: fabric.Canvas, variables?: Variables): void => {
  const processedVars = preprocessVariables(variables);

  canvas.forEachObject((obj: fabric.FabricObject) => {
    if (obj instanceof fabric.IText) {
      const text = preprocessString(obj.text ?? "", processedVars);

      if (obj instanceof TextboxExt && obj.fontAutoSize) {
        obj.setAndShrinkText(text, obj.width);
      } else {
        obj.set({ text });
      }

      return;
    }

    if (obj instanceof QRCode || obj instanceof Barcode) {
      obj.set({
        text: preprocessString(obj.text ?? "", processedVars),
      });
    }
  });
};

/**
 * Collect the merge variables referenced by a canvas.
 *
 * A variable is any `{name}` placeholder in a text, QR or barcode object.
 * `dt` is a built-in date/time expression, not a merge variable, so it is
 * excluded — it needs no CSV column.
 */
export const extractVariables = (canvas: fabric.Canvas): string[] => {
  const found = new Set<string>();

  canvas.forEachObject((obj: fabric.FabricObject) => {
    let text: string | undefined;

    if (obj instanceof fabric.IText || obj instanceof QRCode || obj instanceof Barcode) {
      text = obj.text;
    }

    if (text === undefined) {
      return;
    }

    for (const match of text.matchAll(VARIABLE_TEMPLATE_RX)) {
      const key = match[1];
      if (key !== undefined && key !== "dt" && !key.startsWith("$")) {
        found.add(key);
      }
    }
  });

  return [...found].sort();
};

/**
 * Collect the merge variables referenced by a serialised canvas document,
 * without instantiating a Fabric canvas.
 */
export const extractVariablesFromJson = (fabricJson: {
  objects?: Array<{ text?: string }>;
}): string[] => {
  const found = new Set<string>();

  for (const obj of fabricJson.objects ?? []) {
    const text = obj.text;
    if (typeof text !== "string") {
      continue;
    }

    for (const match of text.matchAll(VARIABLE_TEMPLATE_RX)) {
      const key = match[1];
      if (key !== undefined && key !== "dt" && !key.startsWith("$")) {
        found.add(key);
      }
    }
  }

  return [...found].sort();
};
