/**
 * Shared domain model for server-side serial counters.
 *
 * §5.4: the serial number printed on a label must be unique across every
 * workstation and every batch. The browser used to derive it from the CSV row
 * index, which restarts on every batch and collides between workstations, so
 * the counter lives on the server and the SPA asks for the next number.
 *
 * The name identifies the counter (one sequence per template, per lot, ...).
 * It is free-form text but deliberately narrow: it ends up in a URL path and
 * in a SQLite primary key, so it must be non-empty, bounded, and free of
 * control characters.
 */
import { z } from "zod";

/** C0 and C1 control characters. */
const CONTROL_CHARACTERS = /[\p{Cc}]/u;

export const SerialCounterNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((name) => !CONTROL_CHARACTERS.test(name), {
    message: "name must not contain control characters",
  });

/** Body of POST /api/serial-counters/:name/next */
export const SerialNextSchema = z.object({
  /** First number handed out when the counter does not exist yet. */
  start: z.number().int().optional(),
  /** Increment applied to every allocation after the first. */
  step: z.number().int().optional(),
});

export type SerialNext = z.infer<typeof SerialNextSchema>;

/** Body of POST /api/serial-counters/:name/reset */
export const SerialResetSchema = z.object({
  /** Value the counter is set back to. Defaults to 0. */
  value: z.number().int().optional(),
});

export type SerialReset = z.infer<typeof SerialResetSchema>;

/** A counter as returned by the API. */
export interface SerialCounter {
  name: string;
  value: number;
  updated_at: string;
}
