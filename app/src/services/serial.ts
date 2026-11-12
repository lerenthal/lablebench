/**
 * Serial counter service.
 *
 * §5.4: the serial number printed on a label must be unique across every
 * workstation and every batch. The SPA used to derive it from the CSV row
 * index, which restarts on every batch and collides between workstations, so
 * the counter lives on the server and the browser asks for the next number.
 *
 * The stored `value` is the number last handed out. The next allocation is
 * `value + step`, which keeps the counter monotonic and makes a reset to 0
 * behave exactly like a counter that never ran: the next allocation is 1.
 *
 * Allocation is a read-modify-write, so it runs inside a single immediate
 * transaction. better-sqlite3 is synchronous, so the transaction also covers
 * the window between the SELECT and the UPDATE for any other process sharing
 * the database file.
 */
import type { Db } from "../db/index.js";
import { z } from "zod";
import {
  SerialCounterNameSchema,
  SerialNextSchema,
  SerialResetSchema,
  type SerialCounter,
} from "../domain/serial.js";

export type { SerialCounter };

/** Thrown when a counter name (or an option) does not pass validation. */
export class SerialValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(message);
    this.name = "SerialValidationError";
    this.issues = issues;
  }
}

/** Every counter, ordered by name. */
export function listCounters(db: Db): SerialCounter[] {
  const rows = db
    .prepare("SELECT name, value, updated_at FROM serial_counters ORDER BY name ASC")
    .all() as SerialCounter[];

  return rows;
}

/**
 * Hand out the next number for `name` and persist it.
 *
 * - No row yet: the first allocation returns `start ?? 1` and stores it.
 * - Row exists: the allocation returns the stored value plus `step`
 *   (`step` defaults to 1) and stores the new value.
 */
export function nextValue(
  db: Db,
  name: string,
  opts: { start?: number; step?: number } = {},
): SerialCounter {
  const counterName = parseName(name);
  const options = parseOptions(opts);

  const allocate = db.transaction(() => {
    const row = db
      .prepare("SELECT value FROM serial_counters WHERE name = ?")
      .get(counterName) as { value: number } | undefined;

    const now = new Date().toISOString();

    if (row === undefined) {
      const value = options.start ?? 1;

      db.prepare(
        "INSERT INTO serial_counters (name, value, updated_at) VALUES (?, ?, ?)",
      ).run(counterName, value, now);

      return { name: counterName, value, updated_at: now };
    }

    const value = row.value + options.step;

    db.prepare("UPDATE serial_counters SET value = ?, updated_at = ? WHERE name = ?").run(
      value,
      now,
      counterName,
    );

    return { name: counterName, value, updated_at: now };
  });

  // `immediate` takes the write lock up front: a deferred transaction that
  // reads first and writes later can fail to upgrade under WAL.
  return allocate.immediate();
}

/** Set a counter back to `value` (0 by default), creating it if needed. */
export function resetValue(db: Db, name: string, value: number = 0): SerialCounter {
  const counterName = parseName(name);
  const parsed = SerialResetSchema.safeParse({ value });

  if (!parsed.success) {
    throw new SerialValidationError("Invalid serial counter value", parsed.error.issues);
  }

  const now = new Date().toISOString();

  const reset = db.transaction(() => {
    db.prepare(
      `INSERT INTO serial_counters (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(counterName, parsed.data.value ?? 0, now);
  });

  reset.immediate();

  return {
    name: counterName,
    value: parsed.data.value ?? 0,
    updated_at: now,
  };
}

function parseName(name: string): string {
  const parsed = SerialCounterNameSchema.safeParse(name);

  if (!parsed.success) {
    throw new SerialValidationError("Invalid serial counter name", parsed.error.issues);
  }

  return parsed.data;
}

function parseOptions(opts: { start?: number; step?: number }): {
  start?: number;
  step: number;
} {
  const parsed = SerialNextSchema.safeParse(opts);

  if (!parsed.success) {
    throw new SerialValidationError("Invalid serial counter options", parsed.error.issues);
  }

  return { start: parsed.data.start, step: parsed.data.step ?? 1 };
}
