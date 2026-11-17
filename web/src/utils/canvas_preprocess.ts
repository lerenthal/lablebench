import * as fabric from "fabric";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import { DATE_TIME_KEY, VARIABLE_TEMPLATE_RX, substituteTokens } from "$/utils/dynamic_values";
import { findById, objectText } from "$/utils/linked_objects";

type Variables = Record<string, string>;

const preprocessString = substituteTokens;

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
      // A linked barcode is encoded from the object it follows, not from its
      // own text. The source's *token* is what gets resolved: a serial
      // number object's token is `{serial}`, and resolving it here is what
      // puts the number that was just allocated into the bars.
      const source = findById(canvas, obj.linkedObjectId);

      if (source !== undefined) {
        const sourceToken =
          source instanceof TextboxExt && source.dynamicToken !== undefined
            ? source.dynamicToken
            : objectText(source);

        obj.set({ text: preprocessString(sourceToken, processedVars) });
        return;
      }

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

    if (obj instanceof QRCode || obj instanceof Barcode) {
      // A linked barcode carries the variables of the object it follows —
      // that is where the serial number lives — not its own text.
      const source = findById(canvas, obj.linkedObjectId);

      if (source !== undefined) {
        text =
          source instanceof TextboxExt && source.dynamicToken !== undefined
            ? source.dynamicToken
            : objectText(source);
      } else {
        text = obj.text;
      }
    } else if (obj instanceof fabric.IText) {
      text = obj instanceof TextboxExt && obj.dynamicToken !== undefined ? obj.dynamicToken : obj.text;
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
    objects?: Array<{ text?: string; dynamicToken?: string; id?: string; linkedObjectId?: string }>;
  },
  serialVariable?: string,
): string[] => {
  const found = new Set<string>();
  const objects = fabricJson.objects ?? [];

  // A barcode that follows an object carries that object's variables, so
  // the source has to be found in the document rather than read off the
  // barcode.
  const byId = new Map<string, (typeof objects)[number]>();

  for (const obj of objects) {
    if (typeof obj.id === "string") {
      byId.set(obj.id, obj);
    }
  }

  for (const obj of objects) {
    let text: unknown = obj.dynamicToken ?? obj.text;

    const linkedId = (obj as { linkedObjectId?: string }).linkedObjectId;

    if (typeof linkedId === "string") {
      const source = byId.get(linkedId);
      text = source?.dynamicToken ?? source?.text;
    }

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
