import * as fabric from "fabric";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import { DATE_TIME_KEY, VARIABLE_TEMPLATE_RX, preprocessDateTime } from "$/utils/dynamic_values";

type Variables = Record<string, string>;

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
      // A dynamic object's text on the canvas is the value it was resolved to.
      // The token it came from is what has to be resolved again — now, at
      // print time, so the label carries today's date and the next serial
      // number rather than the ones the template was designed with.
      const source =
        obj instanceof TextboxExt && obj.dynamicToken !== undefined
          ? obj.dynamicToken
          : (obj.text ?? "");

      const text = preprocessString(source, processedVars);

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
      if (key !== undefined && key !== DATE_TIME_KEY && !key.startsWith("$")) {
        found.add(key);
      }
    }
  });

  return [...found].sort();
};

/**
 * Collect the merge variables referenced by a serialised canvas document,
 * without instantiating a Fabric canvas.
 *
 * @param serialVariable the name of the template's serial variable, when it
 *   has one. It is filled from a central counter, not from a CSV column, so it
 *   must not be reported as a missing column.
 */
export const extractVariablesFromJson = (
  fabricJson: {
    objects?: Array<{ text?: string; dynamicToken?: string }>;
  },
  serialVariable?: string,
): string[] => {
  const found = new Set<string>();

  for (const obj of fabricJson.objects ?? []) {
    // A dynamic object stores the token it was resolved from; its `text` is the
    // value it was resolved to, which would otherwise be scanned as if it were
    // a placeholder.
    const text = obj.dynamicToken ?? obj.text;

    if (typeof text !== "string") {
      continue;
    }

    for (const match of text.matchAll(VARIABLE_TEMPLATE_RX)) {
      const key = match[1];
      if (
        key !== undefined &&
        key !== DATE_TIME_KEY &&
        key !== serialVariable &&
        !key.startsWith("$")
      ) {
        found.add(key);
      }
    }
  }

  return [...found].sort();
};
