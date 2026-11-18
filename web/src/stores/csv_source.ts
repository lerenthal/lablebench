/**
 * The CSV the designer is working from.
 *
 * One CSV, loaded once, shared by the designer, the print preview and the
 * batch dialog. Before this there were two unrelated CSV implementations -
 * a textarea you pasted into at design time and a file you uploaded again at
 * print time - which is why the app could ask for the same spreadsheet twice
 * and then disagree with itself about what was in it.
 *
 * It is deliberately *not* persisted. A roll of lab data is not part of the
 * template and does not belong in localStorage: it can be large, it goes
 * stale the moment the spreadsheet is edited, and a batch silently printed
 * from last week's file is the kind of mistake that costs a tray of labels.
 * The template keeps the column *bindings*; the data arrives fresh.
 */

import { derived, get, writable } from "svelte/store";
import { parseCsv, type CsvRow } from "$/utils/csv_batch";
import { applyOperator } from "$/utils/operator";
import { operatorName } from "$/stores/app";

export type CsvSource = {
  /** The file it came from, for the user to recognise. */
  name: string;
  /** The text as loaded, so the batch dialog can show and re-parse it. */
  text: string;
  columns: string[];
  rows: CsvRow[];
  delimiter: string;
  errors: string[];
};

/** The loaded CSV, or undefined when none has been loaded this session. */
export const csvSource = writable<CsvSource | undefined>(undefined);

/**
 * Which row the canvas and the preview are showing.
 *
 * A preview, not a selection: the row decides what is *drawn*, never what is
 * saved. The template stores `{lot}`; the row only says which value stands in
 * for it while the label is being designed.
 */
export const csvPreviewRow = writable<number>(0);

/** Parse a CSV and make it the one the app is working from. */
export const loadCsvSource = (name: string, text: string): CsvSource => {
  const parsed = parseCsv(text);

  const source: CsvSource = {
    name,
    text,
    columns: parsed.columns,
    rows: parsed.rows,
    delimiter: parsed.delimiter,
    errors: parsed.errors,
  };

  csvSource.set(source);
  csvPreviewRow.set(0);

  return source;
};

/** Forget the loaded CSV. The design keeps its fields; they lose their values. */
export const clearCsvSource = (): void => {
  csvSource.set(undefined);
  csvPreviewRow.set(0);
};

/** The row currently being previewed, clamped to what the CSV actually holds. */
export const previewRowValues = derived(
  [csvSource, csvPreviewRow],
  ([$csvSource, $csvPreviewRow]): CsvRow => {
    if ($csvSource === undefined || $csvSource.rows.length === 0) {
      return {};
    }

    const index = Math.min($csvSource.rows.length - 1, Math.max(0, $csvPreviewRow));

    return $csvSource.rows[index];
  },
);

/** The row currently being previewed, read outside a component. */
export const currentPreviewRow = (): CsvRow => get(previewRowValues);

/**
 * Everything the canvas can put a value to right now.
 *
 * The previewed row, plus the fields that come from this workstation rather
 * than from the spreadsheet. One derived store so the design canvas, the
 * field panel and the print preview cannot assemble a different set of
 * values and then show the user three different labels.
 */
export const previewValues = derived(
  [previewRowValues, operatorName],
  ([$previewRowValues, $operatorName]): Record<string, string> =>
    applyOperator({ ...$previewRowValues }, $operatorName),
);

/** The same values, read outside a component. */
export const currentPreviewValues = (): Record<string, string> => get(previewValues);
