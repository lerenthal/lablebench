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
