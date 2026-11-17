/**
 * Putting objects back inside the label.
 *
 * The preflight check reports an object that runs off the edge of the label,
 * because it will be clipped when it prints. Usually the object is simply in
 * the wrong place and moving it is enough — but an object larger than the
 * label cannot be moved inside it, so it is made smaller instead, keeping
 * its shape.
 *
 * The geometry is the same as the check's, so what this fixes is exactly
 * what the check complains about.
 */

import * as fabric from "fabric";
import { isTurnedLabel } from "$/utils/label_turn";

/**
 * The shape of a label.
 *
 * A label is not always a rectangle. A round label is a circle, and the
 * corners of the canvas are outside it — anything drawn there is printed on
 * nothing. A rounded rectangle has the same problem in its four corners.
 *
 * So the printable area of a label is not always the whole canvas, and the
 * checks and the fitting both have to know which shape they are working
 * with. The shape is the label's own; it does not depend on the printer.
 */
export type LabelShape = "rect" | "rounded_rect" | "circle";

/** How far a rounded label's corners are rounded, in canvas pixels. */
export const CORNER_RADIUS = 10;

/**
 * The rectangle a label's content must stay inside.
 *
 * For a rectangle that is the whole canvas. For a circle it is the largest
 * square that fits inside it — the inscribed square, whose corners touch the
 * circle — because a rectangle of content that fits in that square is
 * entirely on the label. For a rounded rectangle it is the canvas inset by
 * the corner radius, because that is the region where the corners cut in.
 *
 * The result is the area that content is fitted into and checked against.
 */
export const printableArea = (
  width: number,
  height: number,
  shape: LabelShape = "rect",
): { width: number; height: number; offsetX: number; offsetY: number } => {
  if (shape === "circle") {
    // The circle is inscribed in the canvas, so the largest square inside it
    // has its side equal to the circle's diameter divided by root two.
    const side = Math.min(width, height) / Math.SQRT2;

    return {
      width: side,
      height: side,
      offsetX: (width - side) / 2,
      offsetY: (height - side) / 2,
    };
  }

  if (shape === "rounded_rect") {
    const inset = Math.min(CORNER_RADIUS, Math.floor(Math.min(width, height) / 2));

    return { width: width - inset * 2, height: height - inset * 2, offsetX: inset, offsetY: inset };
  }

  return { width, height, offsetX: 0, offsetY: 0 };
};

/**
 * Whether a point is on the label.
 *
 * The rectangle is a simple bounds test; the circle is a distance test from
 * the middle; the rounded rectangle is the bounds test with the corners
 * rounded off.
 */
export const isOnLabel = (
  x: number,
  y: number,
  width: number,
  height: number,
  shape: LabelShape = "rect",
): boolean => {
  if (x < 0 || y < 0 || x > width || y > height) return false;

  if (shape === "circle") {
    const radius = Math.min(width, height) / 2;
    const dx = x - width / 2;
    const dy = y - height / 2;

    return dx * dx + dy * dy <= radius * radius;
  }

  if (shape === "rounded_rect") {
    const r = Math.min(CORNER_RADIUS, Math.floor(Math.min(width, height) / 2));
    if (r <= 0) return true;

    // The point is in a corner region; it must be within the corner arc.
    const cx = x < r ? r : x > width - r ? width - r : x;
    const cy = y < r ? r : y > height - r ? height - r : y;
    const dx = x - cx;
    const dy = y - cy;

    return dx * dx + dy * dy <= r * r;
  }

  return true;
};

export interface FitResult {
  /** Objects that were moved back inside. */
  moved: number;
  /** Objects that were too large and had to be made smaller. */
  scaled: number;
  /** Objects that were already inside. */
  unchanged: number;
}

/**
 * The object's own box in canvas (label) coordinates.
 *
 * `calcTransformMatrix()` is the object's own transform — it deliberately
 * does not include the canvas viewport transform, so the result stays in
 * label space even while the user zooms or pans the designer.
 */
const getObjectBounds = (obj: fabric.FabricObject) => {
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

/**
 * Move every object that runs off the label back inside it.
 *
 * An object that is bigger than the label is first made smaller, keeping
 * its shape, because moving cannot make it fit.
 */
export const fitObjectsInsideLabel = (
  objects: fabric.FabricObject[],
  labelWidth: number,
  labelHeight: number,
  shape: LabelShape = "rect",
): FitResult => {
  const result: FitResult = { moved: 0, scaled: 0, unchanged: 0 };

  // The area content is kept inside is the label's own shape, not its
  // bounding box: on a round label the corners of the canvas are not on the
  // label at all, so content fitted to the box would still be clipped.
  const area = printableArea(labelWidth, labelHeight, shape);

  for (const obj of objects) {
    let bounds = getObjectBounds(obj);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;

    if (width > area.width || height > area.height) {
      const factor = Math.min(
        width > area.width ? area.width / width : 1,
        height > area.height ? area.height / height : 1,
      );

      // Scaling is about the object's origin, not its centre, so the
      // position is corrected afterwards — otherwise the object would drift
      // away from where the user put it.
      const centre = obj.getCenterPoint();

      obj.set({
        scaleX: (obj.scaleX ?? 1) * factor,
        scaleY: (obj.scaleY ?? 1) * factor,
      });

      const after = obj.getCenterPoint();

      obj.set({
        left: (obj.left ?? 0) + (centre.x - after.x),
        top: (obj.top ?? 0) + (centre.y - after.y),
      });

      bounds = getObjectBounds(obj);
      result.scaled++;
    }

    const minX = area.offsetX;
    const minY = area.offsetY;
    const maxX = area.offsetX + area.width;
    const maxY = area.offsetY + area.height;

    const dx =
      bounds.left < minX
        ? minX - bounds.left
        : bounds.right > maxX
          ? maxX - bounds.right
          : 0;

    const dy =
      bounds.top < minY
        ? minY - bounds.top
        : bounds.bottom > maxY
          ? maxY - bounds.bottom
          : 0;

    if (dx !== 0 || dy !== 0) {
      obj.set({
        left: (obj.left ?? 0) + dx,
        top: (obj.top ?? 0) + dy,
      });
      obj.setCoords();
      result.moved++;
    } else {
      result.unchanged++;
    }
  }

  return result;
};


export interface AdaptResult {
  /** The factor the content was scaled by. */
  factor: number;
  /** Whether the content was turned with the label. */
  rotated: boolean;
}

/**
 * The box that holds every object.
 */
const contentBounds = (objects: fabric.FabricObject[]) => {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const obj of objects) {
    const bounds = getObjectBounds(obj);
    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  }

  return { left, top, right, bottom };
};

/**
 * Adapt the content to a label that has changed size or orientation.
 *
 * The canvas itself is resized by the caller; this moves the objects so the
 * design still fits. The content is scaled to fill the new label and
 * centred on it, so a label that grew gets a design that grew with it.
 *
 * When the label has been turned — the same label the other way round — the
 * content turns with it. A label that was turned is a design that was
 * turned, and leaving the text sideways on a label that is no longer
 * sideways is never what was wanted.
 *
 * The centring is worked out from the objects' own box rather than from
 * their origins, so it holds whatever the object's origin happens to be.
 */
export const adaptContentToLabel = (
  objects: fabric.FabricObject[],
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
  shape: LabelShape = "rect",
): AdaptResult => {
  if (objects.length === 0 || oldSize.width <= 0 || oldSize.height <= 0) {
    return { factor: 1, rotated: false };
  }

  // Has the label been turned? A label that is already square has no "other
  // way round", so a resize of one is a resize and not a turn — and a round
  // label is square by definition, so it is affected throughout.
  const turned = isTurnedLabel(oldSize, newSize);

  if (turned) {
    // Turn every object a quarter turn about the middle of the old label.
    const cx = oldSize.width / 2;
    const cy = oldSize.height / 2;

    for (const obj of objects) {
      obj.rotate((obj.angle ?? 0) + 90);

      const centre = obj.getCenterPoint();
      const dx = centre.x - cx;
      const dy = centre.y - cy;

      // (x, y) → (−y, x) for a quarter turn.
      obj.set({
        left: (obj.left ?? 0) + (cx - dy - centre.x),
        top: (obj.top ?? 0) + (cy + dx - centre.y),
      });
    }
  }

  // The content's own box, and the factor that fits it to the new label.
  //
  // The label it is fitted to is the label's printable area, which for a
  // round or a rounded label is smaller than its bounding box. Fitting to
  // the box would leave the content running off the edge of the round label
  // and being clipped by it.
  const area = printableArea(newSize.width, newSize.height, shape);
  const before = contentBounds(objects);
  const contentWidth = Math.max(1, before.right - before.left);
  const contentHeight = Math.max(1, before.bottom - before.top);
  const factor = Math.min(area.width / contentWidth, area.height / contentHeight);

  for (const obj of objects) {
    obj.set({
      scaleX: (obj.scaleX ?? 1) * factor,
      scaleY: (obj.scaleY ?? 1) * factor,
    });
    obj.setCoords();
  }

  // Centre what is left on the new label. The shift is a plain move in the
  // label's coordinates, so it does not depend on where the object's origin
  // sits or which way it is turned.
  //
  // The centre is the centre of the printable area, which is the middle of
  // the canvas for every shape — the circle and the rounded rectangle are
  // both centred on it — but the area it is fitted to is not always the
  // whole canvas.
  const after = contentBounds(objects);
  const dx = area.offsetX + (area.width - (after.right - after.left)) / 2 - after.left;
  const dy = area.offsetY + (area.height - (after.bottom - after.top)) / 2 - after.top;

  for (const obj of objects) {
    obj.set({
      left: (obj.left ?? 0) + dx,
      top: (obj.top ?? 0) + dy,
    });
    obj.setCoords();
  }

  return { factor, rotated: turned };
};

/*
 * There is deliberately no "turn the design for the other printer" helper
 * here any more.
 *
 * The canvas is the pixels the designer drew. A printer's direction says
 * which of the canvas's two axes crosses the print head and which runs
 * along the roll, so adopting a printer changes what the label *measures*,
 * not what was drawn on it. Turning the design as well was wrong twice
 * over: it turned a design that was already right for the printer, and it
 * turned it a second time when the media was applied, because a change of
 * size that transposes the canvas is indistinguishable from a label turned
 * a quarter.
 *
 * So the direction is adopted on its own, and the size comes from the media
 * the printer reports having loaded — `applyLoadedLabel` in
 * `LabelDesigner.svelte`, which resizes the canvas and lets
 * `adaptContentToLabel` above fit the design into it.
 */
