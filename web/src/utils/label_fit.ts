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
): FitResult => {
  const result: FitResult = { moved: 0, scaled: 0, unchanged: 0 };

  for (const obj of objects) {
    let bounds = getObjectBounds(obj);
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;

    if (width > labelWidth || height > labelHeight) {
      const factor = Math.min(
        width > labelWidth ? labelWidth / width : 1,
        height > labelHeight ? labelHeight / height : 1,
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

    const dx =
      bounds.left < 0
        ? -bounds.left
        : bounds.right > labelWidth
          ? labelWidth - bounds.right
          : 0;

    const dy =
      bounds.top < 0
        ? -bounds.top
        : bounds.bottom > labelHeight
          ? labelHeight - bounds.bottom
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
): AdaptResult => {
  if (objects.length === 0 || oldSize.width <= 0 || oldSize.height <= 0) {
    return { factor: 1, rotated: false };
  }

  // Has the label been turned? The new size is the old size the other way
  // round, to within a fifth — close enough for the sizes a label comes in.
  const turned =
    Math.abs(newSize.width / oldSize.height - 1) < 0.2 &&
    Math.abs(newSize.height / oldSize.width - 1) < 0.2 &&
    Math.abs(newSize.width - oldSize.width) > 1;

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
  const before = contentBounds(objects);
  const contentWidth = Math.max(1, before.right - before.left);
  const contentHeight = Math.max(1, before.bottom - before.top);
  const factor = Math.min(newSize.width / contentWidth, newSize.height / contentHeight);

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
  const after = contentBounds(objects);
  const dx = (newSize.width - (after.right - after.left)) / 2 - after.left;
  const dy = (newSize.height - (after.bottom - after.top)) / 2 - after.top;

  for (const obj of objects) {
    obj.set({
      left: (obj.left ?? 0) + dx,
      top: (obj.top ?? 0) + dy,
    });
    obj.setCoords();
  }

  return { factor, rotated: turned };
};

/**
 * Turn a design a quarter turn, the way a change of printer turns it.
 *
 * The two printer families feed the label differently: one takes it the long
 * way round, the other the short way. A design drawn for one is the other
 * turned a quarter. So when a design moves to the other family, the canvas
 * is transposed and the content is turned with it — otherwise the design
 * would come out of the printer sideways.
 *
 * The content is not rescaled: the label is the same size, only the way it
 * is held has changed.
 */
export const turnContent = (
  objects: fabric.FabricObject[],
  size: { width: number; height: number },
): { width: number; height: number } => {
  const cx = size.width / 2;
  const cy = size.height / 2;

  // The turned canvas is the other way round, so its centre is elsewhere.
  const ncx = size.height / 2;
  const ncy = size.width / 2;

  for (const obj of objects) {
    obj.rotate((obj.angle ?? 0) + 90);

    const centre = obj.getCenterPoint();
    const dx = centre.x - cx;
    const dy = centre.y - cy;

    obj.set({
      left: (obj.left ?? 0) + (cx - dy - centre.x) + (ncx - cx),
      top: (obj.top ?? 0) + (cy + dx - centre.y) + (ncy - cy),
    });

    obj.setCoords();
  }

  return { width: size.height, height: size.width };
};
