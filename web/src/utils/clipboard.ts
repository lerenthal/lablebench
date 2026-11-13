import * as fabric from "fabric";
import { ArUcoMarker } from "$/fabric-object/aruco";
import Barcode from "$/fabric-object/barcode";
import QRCode from "$/fabric-object/qrcode";
import { TextboxExt } from "$/fabric-object/textbox-ext";
import { OBJECT_DEFAULTS } from "$/defaults";
import { ensureObjectId, objectIdOf, objectText } from "$/utils/linked_objects";

/** What is on the clipboard. */
export type ClipboardKind = "object" | "text";

/** A serialised fabric object, the way `toObject()` writes it. */
type Serialized = Record<string, any>;

/**
 * How far a pasted copy is moved away from its original.
 *
 * A copy that lands exactly on top of the original looks like nothing
 * happened, so it is put a little to the right and below.
 */
const PASTE_OFFSET = 8;

/** How long a system clipboard read may take before it is given up on. */
const SYSTEM_READ_TIMEOUT = 1000;

/** The copied object, as fabric wrote it. */
let objectJson: Serialized | undefined;

/** The copied text. */
let textValue: string | undefined;

/** What was copied last. */
let kind: ClipboardKind | undefined;

/** The identity of the copied object, so the copy cannot inherit it. */
let sourceId: string | undefined;

/**
 * Construct a shape without the ceremony of a typed constructor call.
 *
 * The serialised form of a shape is a plain bag of properties, and the
 * shapes differ in what they take first (the text of a text box, the points
 * of a line), so the arguments are passed as they come.
 */
const build = <T>(Klass: new (...args: any[]) => T, args: any[]): T =>
  new Klass(...args);

/**
 * Put back the text and the styles of a text shape.
 *
 * A text shape is serialised with its styles in the array form, which is the
 * compact one; at runtime it wants them per character.
 */
const textOptions = (options: Serialized, text: string): Serialized => {
  delete options.text;

  if (options.styles !== undefined) {
    options.styles = fabric.util.stylesFromArray(options.styles, text);
  }

  return options;
};

/**
 * Build a new object of the same type from a serialised object.
 *
 * Fabric's own `fromObject` is asynchronous, but a paste has to put its
 * object on the canvas right away, so the shapes this app uses are rebuilt
 * here. A shape that cannot be rebuilt is reported as a failure rather than
 * as an object that draws nothing.
 */
const rebuild = (json: Serialized): fabric.FabricObject | undefined => {
  const options: Serialized = { ...json };

  delete options.type;
  // The copy is a new object and gets an identity of its own, so it must not
  // carry the original's.
  delete options.objectId;

  try {
    switch (json.type) {
      case "Textbox": {
        const text = String(options.text ?? "");
        return build(TextboxExt, [text, textOptions(options, text)]);
      }
      case "IText": {
        const text = String(options.text ?? "");
        return build(fabric.IText, [text, textOptions(options, text)]);
      }
      case "Text": {
        const text = String(options.text ?? "");
        return build(fabric.FabricText, [text, textOptions(options, text)]);
      }
      case "Barcode":
        return build(Barcode, [options]);
      case "QRCode":
        return build(QRCode, [options]);
      case "ArUcoMarker":
        return build(ArUcoMarker, [options]);
      case "Rect":
        return build(fabric.Rect, [options]);
      case "Circle":
        return build(fabric.Circle, [options]);
      case "Triangle":
        return build(fabric.Triangle, [options]);
      case "Ellipse":
        return build(fabric.Ellipse, [options]);
      case "Polyline":
        return build(fabric.Polyline, [options.points ?? [], options]);
      case "Polygon":
        return build(fabric.Polygon, [options.points ?? [], options]);
      case "Line":
        return build(fabric.Line, [
          [options.x1 ?? 0, options.y1 ?? 0, options.x2 ?? 0, options.y2 ?? 0],
          options,
        ]);
      case "Path":
        return build(fabric.Path, [options.path ?? "", options]);
      case "Image":
        return rebuildImage(options);
      case "Group":
        return rebuildGroup(options);
      default: {
        // Any shape fabric knows but this app does not name is rebuilt the
        // plain way, with the properties alone.
        const Klass = fabric.classRegistry.getClass<new (...args: any[]) => fabric.FabricObject>(
          json.type,
        );
        return build(Klass, [options]);
      }
    }
  } catch (e) {
    console.error(e);
    return undefined;
  }
};

/**
 * Rebuild a picture.
 *
 * A picture is serialised as the address of its image, so the image has to
 * be fetched again. That takes a moment, so the canvas is asked for a new
 * frame once the image has arrived.
 */
const rebuildImage = (options: Serialized): fabric.FabricObject | undefined => {
  const src = String(options.src ?? "");

  delete options.src;
  delete options.filters;
  delete options.resizeFilter;

  const element = document.createElement("img");
  element.src = src;

  const image = build(fabric.FabricImage, [element, options]);

  // The size of the original is kept, because the image is not there yet to
  // be measured.
  image.set({ width: options.width, height: options.height });

  element.addEventListener("load", () => {
    image.canvas?.requestRenderAll();
  });

  return image;
};

/**
 * Rebuild a group of shapes.
 *
 * A group is serialised with its shapes inside it, and each of them has to
 * be rebuilt on its own. The layout of the group is kept as it was: the
 * shapes are put back where they were, because a group that re-lays itself
 * out would move them.
 */
const rebuildGroup = (options: Serialized): fabric.FabricObject | undefined => {
  const children: Serialized[] = Array.isArray(options.objects) ? options.objects : [];

  delete options.objects;
  // The layout manager is not part of the shape list; the group keeps the
  // one it makes for itself.
  delete options.layoutManager;

  const built = children
    .map((child) => rebuild(child))
    .filter((child): child is fabric.FabricObject => child !== undefined);

  const group = build(fabric.Group, [built, options]) as fabric.Group;

  // Put every shape back where it was, so the group looks like the original.
  built.forEach((child, index) => {
    const saved = children[index];
    child.set({
      left: saved.left,
      top: saved.top,
      scaleX: saved.scaleX,
      scaleY: saved.scaleY,
      angle: saved.angle,
    });
  });

  group.set({
    left: options.left,
    top: options.top,
    scaleX: options.scaleX,
    scaleY: options.scaleY,
    angle: options.angle,
  });

  return group;
};

/** Write to the system clipboard, if the browser lets us. */
const writeSystemText = async (text: string): Promise<void> => {
  try {
    await navigator?.clipboard?.writeText(text);
  } catch {
    // The system clipboard needs a permission that may not have been given.
    // It is a bonus, not the store.
  }
};

/**
 * Read the system clipboard, if the browser lets us.
 *
 * The read may wait for a permission the user never gives, so it is given a
 * deadline of its own.
 */
const readSystemText = async (): Promise<string | undefined> => {
  try {
    const read = navigator?.clipboard?.readText();

    if (read === undefined) {
      return undefined;
    }

    const timeout = new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), SYSTEM_READ_TIMEOUT);
    });

    return await Promise.race([read, timeout]);
  } catch {
    return undefined;
  }
};

/** Copy the given object. Returns false when there is nothing to copy. */
export const copyObject = (obj: fabric.FabricObject | undefined): boolean => {
  if (obj === undefined) {
    return false;
  }

  objectJson = obj.toObject() as unknown as Serialized;
  textValue = undefined;
  kind = "object";
  sourceId = objectIdOf(obj);

  return true;
};

/**
 * Copy the text content of the given object — a text box, a barcode's or a
 * QR code's encoded text. Returns false when the object carries no text.
 */
export const copyObjectText = (obj: fabric.FabricObject | undefined): boolean => {
  if (obj === undefined) {
    return false;
  }

  const text = objectText(obj);

  if (text === "") {
    return false;
  }

  objectJson = undefined;
  textValue = text;
  kind = "text";
  sourceId = undefined;

  // The system clipboard is a bonus: it needs a permission the user may not
  // have given, so the app keeps its own copy of the text.
  void writeSystemText(text);

  return true;
};

/** What kind of thing is on the clipboard, if anything. */
export const clipboardKind = (): ClipboardKind | undefined => kind;

/**
 * The text on the clipboard, if any.
 *
 * Falls back to reading the system clipboard when the app's own clipboard
 * holds no text. The system read is best effort: it must never throw, and
 * it must never reject or hang the caller.
 */
export const clipboardText = async (): Promise<string | undefined> => {
  if (textValue !== undefined) {
    return textValue;
  }

  const systemText = await readSystemText();

  if (systemText !== undefined) {
    // Remember it, so that a paste which follows can put it into a shape.
    textValue = systemText;
  }

  return systemText;
};

/**
 * Paste a copied object onto the canvas.
 *
 * The copy lands a little to the right of and below the original, so it is
 * visibly a new object rather than an exact overlay, and it becomes the
 * active selection. Returns the new object, or undefined when the clipboard
 * holds no object.
 */
export const pasteObject = (canvas: fabric.Canvas): fabric.FabricObject | undefined => {
  if (objectJson === undefined) {
    return undefined;
  }

  const obj = rebuild(objectJson);

  if (obj === undefined) {
    return undefined;
  }

  obj.set({
    left: (obj.left ?? 0) + PASTE_OFFSET,
    top: (obj.top ?? 0) + PASTE_OFFSET,
    // A shape that was loaded from a template snaps to the grid, and a
    // pasted shape is one of those.
    snapAngle: OBJECT_DEFAULTS.snapAngle,
  });

  // The copy is a new object, so it needs an identity of its own: two shapes
  // sharing one would make a link point at the wrong shape.
  const identified = obj as fabric.FabricObject & { objectId?: string };

  if (identified.objectId === undefined || identified.objectId === sourceId) {
    delete identified.objectId;
  }

  ensureObjectId(obj);

  canvas.add(obj);
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();

  return obj;
};

/**
 * Paste text into the given object's text.
 *
 * Works for a text box and for a barcode or QR code's encoded text. Returns
 * false when there is no text to paste or the object cannot hold text.
 *
 * The text is read before the object is touched, because reading the system
 * clipboard may wait on a permission the user never gives.
 */
export const pasteText = async (obj: fabric.FabricObject): Promise<boolean> => {
  const text = await clipboardText();

  if (text === undefined || text === "") {
    return false;
  }

  if (obj instanceof fabric.IText) {
    obj.set({ text });
    return true;
  }

  if (obj instanceof Barcode || obj instanceof QRCode) {
    // A linked code follows the shape it was linked to. Its text belongs to
    // that shape, so it is not the code's to be overwritten.
    if (obj.linkedObjectId !== undefined) {
      return false;
    }

    obj.set({ text });
    return true;
  }

  return false;
};
