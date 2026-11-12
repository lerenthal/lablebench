/**
 * CSV batch engine (§5.4).
 *
 * Import via PapaParse, detect the columns, bind them to the template's declared
 * variables, and resolve a row into the variable values the renderer substitutes.
 *
 * The column → variable binding is persisted with the template
 * (`template.variables.csv_mapping`), so re-importing a CSV of the same shape
 * "just works" — including a CSV whose headers have been renamed, as long as the
 * binding still points at a column that exists.
 */

import Papa from "papaparse";
import type { SerialConfig, TemplateVariable } from "$/types";

export type CsvRow = Record<string, string>;

export type ParsedCsv = {
  columns: string[];
  rows: CsvRow[];
  delimiter: string;
  errors: string[];
};

/**
 * Parse a CSV file.
 *
 * PapaParse handles the messy cases real lab spreadsheets throw at it: BOM,
 * ragged rows, quoted fields containing delimiters and newlines, and delimiter
 * sniffing.
 */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    transformHeader: (header) => header.trim(),
  });

  const columns = (result.meta.fields ?? []).filter((field) => field !== undefined && field !== "");

  const errors = result.errors.map(
    (error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`,
  );

  const rows = result.data.filter((row) =>
    Object.values(row).some((value) => value !== undefined && value !== ""),
  );

  return {
    columns,
    rows,
    delimiter: result.meta.delimiter,
    errors,
  };
}

/**
 * Auto-bind columns to variables by name.
 *
 * A column binds to a variable when their names match exactly, or when the
 * column name is the variable name with a common suffix stripped
 * (`lot_code` → `lot`). Existing bindings win over the guess.
 */
export function autoBind(
  columns: string[],
  variables: TemplateVariable[],
  existing: Record<string, string> = {},
): Record<string, string> {
  const binding: Record<string, string> = {};

  for (const variable of variables) {
    const existingColumn = existing[variable.name];

    if (existingColumn !== undefined && columns.includes(existingColumn)) {
      binding[variable.name] = existingColumn;
      continue;
    }

    const exact = columns.find((column) => column === variable.name);
    if (exact !== undefined) {
      binding[variable.name] = exact;
      continue;
    }

    const loose = columns.find(
      (column) => column.toLowerCase() === variable.name.toLowerCase(),
    );
    if (loose !== undefined) {
      binding[variable.name] = loose;
      continue;
    }

    const suffixed = columns.find((column) =>
      new RegExp(`^${escapeRegExp(variable.name)}(?:_.*)?$`, "i").test(column),
    );
    if (suffixed !== undefined) {
      binding[variable.name] = suffixed;
    }
  }

  return binding;
}

/** Serial-number value for a given row index. */
export function serialValue(config: SerialConfig, index: number): string {
  const number = config.start + index * config.step;
  const padded = config.pad > 0 ? String(Math.abs(number)).padStart(config.pad, "0") : String(number);

  return `${config.prefix}${padded}`;
}

/**
 * Resolve one CSV row into the variable values substituted into the label.
 *
 * A variable with no bound column falls back to its default value, then to an
 * empty string. Unbound variables never leak the raw `{placeholder}` text into
 * a printed label — they resolve to empty, which is visible in the preview.
 */
export function resolveVariables(
  row: CsvRow,
  variables: TemplateVariable[],
  binding: Record<string, string>,
  serial?: { config: SerialConfig; index: number },
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const variable of variables) {
    const column = binding[variable.name];
    const raw = column === undefined ? undefined : row[column];

    resolved[variable.name] = raw ?? variable.default_value ?? "";
  }

  if (serial !== undefined) {
    resolved[serial.config.variable] = serialValue(serial.config, serial.index);
  }

  return resolved;
}

/** Rows that are missing a value for a variable marked as required. */
export function findMissingRequired(
  variables: TemplateVariable[],
  binding: Record<string, string>,
  row: CsvRow,
): string[] {
  return variables
    .filter((variable) => variable.required)
    .filter((variable) => {
      const column = binding[variable.name];
      const value = column === undefined ? undefined : row[column];
      return value === undefined || value === "";
    })
    .map((variable) => variable.name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
