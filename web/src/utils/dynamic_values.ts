/**
 * Date & time and Serial number objects.
 *
 * Both are *dynamic*: the value they show is decided when the label is
 * printed, not when the template is designed. The design canvas shows the
 * value it would produce right now; the template keeps only the token, so the
 * same template prints a different date tomorrow and a different serial
 * number on every label.
 *
 * The tokens are the ones the print pipeline already understands:
 *
 *   `{dt|YYYY-MM-DD}`   the current date and time, formatted
 *   `{dt+1d|...}`       the current date and time, shifted
 *   `{serial}`          a merge variable — the serial number is written into
 *                       it before the label is rendered
 *
 * Reusing the merge-variable machinery is what makes the serial number work
 * for every path — manual print, CSV batch, print preview — without each one
 * having to know about it.
 */

import * as fabric from "fabric";
import dayjs, { ManipulateType } from "dayjs";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import type { SerialConfig } from "$/types";
import { api } from "$/services/api";

/** The merge-variable name the built-in date/time expression uses. */
export const DATE_TIME_KEY = "dt";

/** The placeholder syntax, shared with the print pipeline. */
export const VARIABLE_TEMPLATE_RX = /{\s*(\$?\w+)(?:([+-])(\d+)([yMwdhms]))?\s*(?:\|\s*(.*?)\s*)?}/g;

/**
 * Formats offered in the Date & time panel.
 *
 * The pattern is shown rather than a translated name, because the pattern is
 * what the user has to learn to read the label — and a live preview of the
 * result sits next to it.
 */
export const DATE_TIME_FORMATS = [
  "YYYY-MM-DD",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD HH:mm:ss",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD.MM.YYYY",
  "HH:mm",
  "HH:mm:ss",
  "YYYY-MM",
  "MMM YYYY",
  "MMM D, YYYY",
  "dddd",
];

/** The format a Date & time object starts with. */
export const DEFAULT_DATE_TIME_FORMAT = "YYYY-MM-DD";

const DATE_DURATION_UNITS: Record<string, ManipulateType> = {
  y: "year",
  M: "month",
  w: "week",
  d: "day",
  h: "hour",
  m: "minute",
  s: "second",
};

/**
 * Render the current date and time.
 *
 * `sign`/`amount`/`unit` shift the moment — `{dt-1d}` is yesterday — which
 * the existing token syntax already allowed.
 */
export const preprocessDateTime = (
  format?: string,
  sign?: string,
  amount?: string,
  unit?: string,
  now: dayjs.Dayjs = dayjs(),
): string => {
  let date = now;

  if (sign && amount && unit) {
    const durationUnit = DATE_DURATION_UNITS[unit];

    if (durationUnit) {
      const value = Number(amount) * (sign === "-" ? -1 : 1);
      date = date.add(value, durationUnit);
    }
  }

  return date.format(format ?? "YYYY-MM-DD HH:mm:ss");
};

/** The token a Date & time object stores in the template. */
export const dateTimeToken = (format?: string): string =>
  format === undefined || format === "" ? `{${DATE_TIME_KEY}}` : `{${DATE_TIME_KEY}|${format}}`;

/** The token a Serial number object stores in the template. */
export const serialToken = (variable: string): string => `{${variable}}`;

/**
 * What a text object's token means.
 *
 * `date` is the built-in date/time expression. `variable` is a merge
 * variable — and when it names the template's serial variable, it is a
 * Serial number object.
 */
export type DynamicKind = "date" | "variable";

export type DynamicToken = {
  kind: DynamicKind;
  /** The token exactly as it appears in the template. */
  token: string;
  /** The format, for a date/time token. */
  format?: string;
  /** The variable name, for a variable token. */
  name?: string;
};

/** Read a token out of a text. Returns undefined for ordinary text. */
export const parseDynamicToken = (text: string): DynamicToken | undefined => {
  // `matchAll` rather than `exec`: the shared pattern carries the global flag,
  // and `exec` on a global regex advances its lastIndex, so the second call
  // would start mid-string and miss the token entirely.
  const match = [...text.matchAll(VARIABLE_TEMPLATE_RX)][0];

  if (match === undefined) {
    return undefined;
  }

  const key = match[1];
  const format = match[5];

  if (key === undefined) {
    return undefined;
  }

  if (key === DATE_TIME_KEY) {
    return { kind: "date", token: match[0], format };
  }

  if (key.startsWith("$")) {
    return undefined;
  }

  return { kind: "variable", token: match[0], name: key };
};

/**
 * Render a serial number.
 *
 * The number is padded to `pad` digits and wrapped in the prefix and the
 * suffix, so 42 with prefix "SN-", suffix "-A" and pad 4 is "SN-0042-A".
 */
export const formatSerialValue = (
  value: number,
  config: Pick<SerialConfig, "prefix" | "suffix" | "pad">,
): string => {
  const pad = config.pad ?? 0;
  const digits = pad > 0 ? String(Math.abs(value)).padStart(pad, "0") : String(value);

  return `${config.prefix ?? ""}${digits}${config.suffix ?? ""}`;
};

/**
 * The counter a serial sequence draws from.
 *
 * An empty counter name means "use the variable name", so two templates that
 * both bind a variable called `serial` share one sequence, and the lab gets a
 * single unbroken run of numbers across every template that uses it.
 */
export const counterNameFor = (config: SerialConfig): string =>
  config.counter.trim() === "" ? config.variable : config.counter.trim();

/**
 * Resolve the dynamic objects on a canvas so the design canvas shows what
 * would actually be printed.
 *
 * The token is kept on the object (`dynamicToken`) and the canvas shows the
 * resolved value, so saving the template stores the token rather than today's
 * date.
 *
 * @param canvas the design canvas
 * @param serialVariable the name of the template's serial variable, when it has
 *   one. Only that variable is treated as a serial number; every other
 *   `{placeholder}` stays an ordinary merge variable.
 * @param serialValues the value to show for the serial variable
 */
export const resolveDynamicObjects = (
  canvas: fabric.Canvas,
  serialVariable?: string,
  serialValues: Record<string, string> = {},
): void => {
  canvas.forEachObject((obj: fabric.FabricObject) => {
    if (!(obj instanceof TextboxExt)) {
      return;
    }

    const source = obj.dynamicToken ?? obj.text ?? "";
    const parsed = parseDynamicToken(source);

    if (parsed === undefined) {
      return;
    }

    if (parsed.kind === "date") {
      obj.dynamicToken = source;
      obj.set({ text: preprocessDateTime(parsed.format) });
      return;
    }

    if (parsed.name !== undefined && parsed.name === serialVariable) {
      obj.dynamicToken = source;

      const value = serialValues[serialVariable];

      if (value !== undefined) {
        obj.set({ text: value });
      }
    }
  });
};

/**
 * Take the next number from the central counter and format it.
 *
 * The server allocates atomically, so two workstations printing at the same
 * moment are never handed the same number.
 */
export const allocateSerialValues = async (
  config: SerialConfig,
): Promise<Record<string, string>> => {
  try {
    const counter = await api.nextSerialValue(counterNameFor(config), {
      start: config.start,
      step: config.step,
    });

    return { [config.variable]: formatSerialValue(counter.value, config) };
  } catch (e) {
    console.error("Could not take the next serial number", e);
    return {};
  }
};

/**
 * The number the next print would use, without taking it.
 *
 * A preview must not consume a number, so this reads the counter rather than
 * allocating from it.
 */
export const peekSerialValues = async (
  config: SerialConfig,
): Promise<Record<string, string>> => {
  try {
    const counters = await api.listSerialCounters();
    const counter = counters.find((c) => c.name === counterNameFor(config));

    const value = counter === undefined ? config.start : counter.value + config.step;

    return { [config.variable]: formatSerialValue(value, config) };
  } catch (e) {
    console.error("Could not read the serial counter", e);
    return {};
  }
};

/**
 * The value a serial object should show before anything is printed.
 *
 * The preview must not consume a number, so this shows what the *next* print
 * would use, derived from the counter's current value.
 */
export const previewSerialValue = (
  currentValue: number | undefined,
  config: SerialConfig,
): string | undefined => {
  if (currentValue === undefined) {
    return undefined;
  }

  return formatSerialValue(currentValue + config.step, config);
};
