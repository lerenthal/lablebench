/**
 * Turning a CSV's columns into the label's fields.
 *
 * The app used to ask for the design first: you drew text objects, typed
 * `{lot}` into them by hand, and only then imported a CSV to bind columns to
 * the variables those placeholders had declared. That is backwards. The CSV
 * already says what the fields are - it has a heading per column - so the
 * design can start from it.
 *
 * So uploading a CSV lays out one field per column, each showing the value
 * from a chosen row. What is stored in the template is still the token,
 * `{lot}`; the value is only what the canvas shows, the same arrangement the
 * date and serial objects have always used. The row is a preview, not data:
 * flipping to another row changes what is drawn and nothing about the
 * template.
 *
 * Everything here is arithmetic and string handling, with no canvas and no
 * fabric object, so the decisions can be checked without a browser.
 */

import { VARIABLE_TEMPLATE_RX } from "$/utils/dynamic_values";

/**
 * A heading a person would read, from a column name a spreadsheet would hold.
 *
 * `lot_code` becomes `Lot code`. Underscores and hyphens are word breaks,
 * runs of them collapse, and only the first word is capitalised - a heading
 * is a label, not a title, and `Lot Code` reads like a column in a report
 * rather than a word on a label.
 *
 * A name that is already capitalised is left as it is: `ID` must not become
 * `Id`, and someone who wrote `Batch No` meant it.
 */
export const headerLabelFor = (column: string): string => {
  const words = column.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (words === "") {
    return "";
  }

  // Anything with a capital in it was deliberate, so it is not touched.
  if (/[A-Z]/.test(words)) {
    return words;
  }

  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The separator between a field's heading and its value. */
const HEADER_SEPARATOR = ": ";

/**
 * The text a field object holds.
 *
 * With the heading shown this is `Lot: {lot}`, and the token is substituted
 * in place when the label is drawn or printed - which is why the heading has
 * to live in the same string as the token rather than in a second object or a
 * flag on the template. One string means one thing to position, one thing to
 * style, and nothing extra to keep in step.
 */
export const fieldTextFor = (column: string, showHeader: boolean): string => {
  const token = `{${column}}`;

  if (!showHeader) {
    return token;
  }

  const heading = headerLabelFor(column);

  return heading === "" ? token : `${heading}${HEADER_SEPARATOR}${token}`;
};

/**
 * The column a field's text refers to, or undefined if it is not a field.
 *
 * Read from the token rather than from the heading, because the heading is
 * free text the user may have edited and the token is the part that has to
 * stay machine-readable.
 */
export const columnOfFieldText = (text: string): string | undefined => {
  // matchAll rather than exec: the shared pattern carries the global flag, so
  // exec would advance its lastIndex and the next call would start mid-string.
  const match = [...text.matchAll(VARIABLE_TEMPLATE_RX)][0];
  const key = match?.[1];

  if (key === undefined || key === "" || key.startsWith("$") || key === "dt") {
    return undefined;
  }

  return key;
};

/**
 * Whether a field's text carries anything besides its token.
 *
 * This is what the heading toggle reads, and it asks the text rather than
 * keeping a flag beside it: a flag could disagree with the text after the
 * user edited it by hand, and then the toggle would lie.
 */
export const fieldTextHasHeader = (text: string): boolean => {
  const column = columnOfFieldText(text);

  if (column === undefined) {
    return false;
  }

  return text.trim() !== `{${column}}`;
};

/**
 * The same field with its heading turned on or off.
 *
 * Turning it on regenerates the heading from the column name. Turning it off
 * leaves the token alone. A heading the user has rewritten is therefore lost
 * when they toggle it off and on again, which is the honest behaviour: the
 * alternative is remembering a string nobody can see, and bringing back a
 * heading they may have deliberately changed.
 */
export const withHeader = (text: string, showHeader: boolean): string => {
  const column = columnOfFieldText(text);

  if (column === undefined) {
    return text;
  }

  return fieldTextFor(column, showHeader);
};

/** Where one generated field sits on the canvas, in pixels. */
export interface FieldBox {
  /** The column this field shows. */
  column: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * How many pixels of margin to leave inside the printable area.
 *
 * Thermal printing is not precise to the dot at the edge of a label, and a
 * field flush against the boundary is the one that comes out clipped.
 */
const MARGIN_PX = 4;

/** The smallest text worth generating: below this a thermal head smears it. */
const MIN_FONT_PX = 8;

/** Above this, generated text looks like a mistake rather than a heading. */
const MAX_FONT_PX = 28;

/**
 * Lay out one field per column, stacked down the label.
 *
 * A stack is the arrangement that survives not knowing anything about the
 * data: it needs no guess about which column matters most, it fits any label
 * that is taller than it is narrow and any that is not, and every field is
 * immediately draggable to wherever it actually belongs. Getting the fields
 * onto the label with real values in them is the point; the arrangement is a
 * starting position, not a design.
 *
 * @param columns the CSV's column names, in their own order
 * @param area    the printable area, from `printableArea`
 */
export const layOutFields = (
  columns: string[],
  area: { width: number; height: number; offsetX: number; offsetY: number },
): FieldBox[] => {
  if (columns.length === 0) {
    return [];
  }

  const usableWidth = area.width - MARGIN_PX * 2;
  const usableHeight = area.height - MARGIN_PX * 2;

  if (usableWidth <= 0 || usableHeight <= 0) {
    return [];
  }

  const rowHeight = usableHeight / columns.length;

  // Most of the row is the glyph; the rest is the gap that stops two lines
  // touching. Clamped at both ends so a label with many columns still has
  // readable text and one with two does not get a headline.
  const fontSize = Math.max(
    MIN_FONT_PX,
    Math.min(MAX_FONT_PX, Math.floor(rowHeight * 0.7)),
  );

  return columns.map((column, index) => ({
    column,
    left: area.offsetX + MARGIN_PX,
    top: area.offsetY + MARGIN_PX + rowHeight * index,
    width: usableWidth,
    height: rowHeight,
    fontSize,
  }));
};
