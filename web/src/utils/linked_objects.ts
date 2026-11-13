/**
 * Linking a barcode to another object.
 *
 * A barcode encodes a fixed string into bars, so the usual way to keep it
 * in step with a number is to type the number into it by hand — and then
 * every label in a batch has the same number on it. Linking solves that: a
 * barcode follows a text object, and the text object may itself be a serial
 * number or a date, so the bars are re-encoded from whatever the number
 * turns out to be at print time.
 *
 * The link is stored as the source object's id. Fabric gives every object a
 * unique id at construction, and the app puts that id into the template, so
 * the link survives a save and a reload.
 *
 * How the two ends resolve:
 *
 * - On the design canvas the barcode shows the source's *current* text, so
 *   the link is visible while it is being built.
 * - At print time the source's token is resolved first — `{serial}` becomes
 *   the number the counter hands out — and the barcode is re-encoded from
 *   that. The barcode's own text is therefore never the token: the token
 *   lives on the source, and the barcode borrows it.
 */

import * as fabric from "fabric";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";

/** The property a barcode or QR code keeps its link in. */
export const LINKED_OBJECT_ID = "linkedObjectId";

/**
 * The property an object keeps its identity in.
 *
 * Fabric does not give its objects an identity of its own — there is no id
 * on a FabricObject — so the app gives them one. It has to be in the
 * template, because a link that only survives in the browser would come
 * apart the next time the template was opened.
 */
export const OBJECT_ID = "objectId";

type Identified = fabric.FabricObject & { objectId?: string };

/** The identity of an object, if it has one. */
export const objectIdOf = (obj: fabric.FabricObject): string | undefined =>
  (obj as Identified).objectId;

/**
 * Give an object an identity, if it does not have one yet.
 *
 * Called for every object as it is added to the canvas, so an object always
 * has one by the time a barcode can be pointed at it.
 */
export const ensureObjectId = (obj: fabric.FabricObject): string => {
  const identified = obj as Identified;

  if (identified.objectId === undefined) {
    identified.objectId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `obj-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return identified.objectId;
};

/** The text an object carries, or an empty string when it carries none. */
export const objectText = (obj: fabric.FabricObject): string => {
  if (obj instanceof fabric.IText || obj instanceof Barcode || obj instanceof QRCode) {
    return obj.text ?? "";
  }

  return "";
};

/** The id of an object, if it has one. */
const objectId = objectIdOf;

/** A text object is a candidate for being linked to. */
export const isLinkSource = (obj: fabric.FabricObject): obj is TextboxExt =>
  obj instanceof TextboxExt && (obj.text ?? "").trim() !== "";

/** An object a barcode can follow, and what the menu calls it. */
export interface LinkSource {
  obj: TextboxExt;
  label: string;
}

/**
 * The objects on the canvas a barcode can follow.
 *
 * Only objects that carry text are offered: a barcode has nothing to encode
 * from an empty text box, and offering one would produce a barcode of
 * nothing.
 *
 * The menu names what the object *is*, not only what it currently says. A
 * serial number object shows the number it would print next, so two entries
 * reading "0001" would be indistinguishable — the kind is what tells them
 * apart.
 */
export const linkSources = (canvas: fabric.Canvas): LinkSource[] => {
  const sources: LinkSource[] = [];
  const counters: Record<string, number> = {};

  canvas.forEachObject((obj: fabric.FabricObject) => {
    if (!isLinkSource(obj)) {
      return;
    }

    // A source without an identity could not be pointed at, so it is given
    // one here rather than being quietly left out of the menu.
    ensureObjectId(obj);

    const token = obj.dynamicToken;

    if (token === undefined) {
      const text = obj.text.trim();
      sources.push({
        obj,
        label: text.length > 28 ? `${text.slice(0, 28)}…` : text,
      });
      return;
    }

    const kind = /^\{\s*dt\b/.test(token) ? "Date & time" : "Serial number";
    counters[kind] = (counters[kind] ?? 0) + 1;

    sources.push({
      obj,
      label: `${kind} ${counters[kind]} — ${obj.text}`,
    });
  });

  return sources;
};

/** The object with the given id, if it is still on the canvas. */
export const findById = (
  canvas: fabric.Canvas,
  id: string | undefined,
): fabric.FabricObject | undefined => {
  if (id === undefined || id === "") {
    return undefined;
  }

  let found: fabric.FabricObject | undefined;

  canvas.forEachObject((obj: fabric.FabricObject) => {
    if (found === undefined && objectId(obj) === id) {
      found = obj;
    }
  });

  return found;
};

/** The object a barcode or QR code follows, if it is still on the canvas. */
export const linkedSource = (
  canvas: fabric.Canvas,
  target: Barcode | QRCode,
): fabric.FabricObject | undefined => findById(canvas, target.linkedObjectId);

/**
 * Bring the linked barcodes into step with their sources.
 *
 * Called whenever the canvas changes. A barcode that follows a serial number
 * object is re-encoded every time the serial object is resolved, so the
 * bars on the design canvas match the number that would be printed.
 */
export const syncLinkedObjects = (canvas: fabric.Canvas): void => {
  canvas.forEachObject((obj: fabric.FabricObject) => {
    if (!(obj instanceof Barcode || obj instanceof QRCode)) {
      return;
    }

    const source = linkedSource(canvas, obj);

    if (source === undefined) {
      // The source is gone. The link is kept, so it comes back if the object
      // does, but the barcode keeps the text it had.
      return;
    }

    const text = (source as TextboxExt).text ?? "";

    if ((obj.text ?? "") !== text) {
      obj.set({ text });
    }
  });
};

/**
 * Follow the given source.
 *
 * The barcode's own text is replaced by the source's, which is the whole
 * point of the link. Unlinking leaves that text in place, so the barcode
 * stays printable and can be edited by hand from there.
 */
export const linkObject = (target: Barcode | QRCode, source: fabric.FabricObject): void => {
  target.linkedObjectId = objectId(source);
  target.set({ text: (source as TextboxExt).text ?? "" });
};

/** Stop following anything. */
export const unlinkObject = (target: Barcode | QRCode): void => {
  target.linkedObjectId = undefined;
};

/** Whether the target follows something. */
export const isLinked = (target: Barcode | QRCode): boolean =>
  target.linkedObjectId !== undefined;
