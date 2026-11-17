/**
 * Whether a change of label size is the label being turned a quarter.
 *
 * It lives on its own, apart from the canvas, because it is a decision
 * about sizes and nothing else — and because that makes it checkable
 * without a canvas to draw on.
 */

export interface LabelSize {
  width: number;
  height: number;
}

export const isTurnedLabel = (
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
): boolean =>
  Math.abs(newSize.width / oldSize.height - 1) < 0.2 &&
  Math.abs(newSize.height / oldSize.width - 1) < 0.2 &&
  Math.abs(newSize.width - oldSize.width) > 1 &&
  Math.abs(oldSize.width / oldSize.height - 1) > 0.2;
