/**
 * The app's own log.
 *
 * When something goes wrong on a workstation, the question is always "what
 * did the app see?" — and the answer used to be whatever the browser's
 * console happened to be holding, which nobody can read over a screen
 * share and nobody can paste into a ticket.
 *
 * So the app keeps its own log: the connection attempts and how they went,
 * the prints, the batch runs, and the errors with their messages. It is
 * kept in the browser, on the workstation where the problem happened, and
 * it can be copied out as one block of text to send along.
 *
 * It is deliberately not sent to the server. A log is full of the names of
 * devices, ports and origins, and none of that belongs in a shared record
 * unless somebody asks for it.
 */

import { writable, get } from "svelte/store";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** When it happened, as the browser reported it. */
  at: string;
  level: LogLevel;
  /** What it was about: printer, print, batch, serial, template, app. */
  category: string;
  message: string;
  /** The error, the response body — whatever there was to say. */
  detail?: string;
}

const STORAGE_KEY = "labelbench_log";

/** How many entries are kept. A week of printing is a few hundred. */
const MAX_ENTRIES = 400;

const LEVEL_ORDER: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

const readStored = (): LogEntry[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
};

const writeStored = (entries: LogEntry[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // A full or disabled storage must not break the app.
  }
};

export const logEntries = writable<LogEntry[]>(readStored());

/**
 * Add an entry to the log.
 *
 * The log is also written to the console, so the browser's own developer
 * tools still show the same trail.
 */
export const logEvent = (
  level: LogLevel,
  category: string,
  message: string,
  detail?: unknown,
) => {
  const entry: LogEntry = {
    at: new Date().toISOString(),
    level,
    category,
    message,
  };

  if (detail !== undefined) {
    entry.detail =
      detail instanceof Error
        ? `${detail.name}: ${detail.message}`
        : typeof detail === "string"
          ? detail
          : safeStringify(detail);
  }

  const entries = [...get(logEntries), entry].slice(-MAX_ENTRIES);
  logEntries.set(entries);
  writeStored(entries);

  const line = `[${entry.at}] ${level.toUpperCase()} ${category}: ${message}`;
  const full = entry.detail === undefined ? line : `${line} — ${entry.detail}`;

  if (level === "error") {
    console.error(full);
  } else if (level === "warn") {
    console.warn(full);
  } else {
    console.log(full);
  }
};

export const logInfo = (category: string, message: string, detail?: unknown) =>
  logEvent("info", category, message, detail);

export const logWarn = (category: string, message: string, detail?: unknown) =>
  logEvent("warn", category, message, detail);

export const logError = (category: string, message: string, detail?: unknown) =>
  logEvent("error", category, message, detail);

/** Empty the log. */
export const clearLog = () => {
  logEntries.set([]);
  writeStored([]);
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * What the browser is, and what it can do.
 *
 * Half of the printer problems are "the browser would not let it", and the
 * answer to that is usually the origin, the browser version, or whether the
 * device API exists at all. It is three lines to include and it saves a
 * round of questions.
 */
const browserContext = (): string => {
  const lines = [
    `origin:        ${window.location.origin}`,
    `user agent:   ${navigator.userAgent}`,
    `secure:        ${window.isSecureContext}`,
    `web usb:       ${"usb" in navigator ? "yes" : "no"}`,
    `web serial:    ${"serial" in navigator ? "yes" : "no"}`,
    `web bluetooth: ${"bluetooth" in navigator ? "yes" : "no"}`,
    `language:      ${navigator.language}`,
  ];

  return lines.join("\n");
};

/**
 * The log as one block of text, ready to be copied and sent.
 *
 * The context comes first: it is what the reader needs before the trail.
 */
export const logReport = (): string => {
  const entries = get(logEntries);
  const header = [
    "LabelBench log",
    `generated: ${new Date().toISOString()}`,
    "",
    browserContext(),
    "",
    `entries: ${entries.length}`,
    "",
  ].join("\n");

  if (entries.length === 0) {
    return `${header}(the log is empty)`;
  }

  const lines = entries.map((entry) => {
    const detail = entry.detail === undefined ? "" : ` — ${entry.detail}`;
    return `${entry.at}  ${entry.level.toUpperCase().padEnd(5)} ${entry.category}: ${entry.message}${detail}`;
  });

  return `${header}${lines.join("\n")}`;
};

/**
 * The entries, newest first, with the worst first within each moment.
 *
 * The order matters when the log is read in a hurry: the errors are what
 * the reader came for.
 */
export const sortedEntries = (entries: LogEntry[]): LogEntry[] =>
  [...entries].sort((a, b) => {
    const level = LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level];
    return level !== 0 ? level : b.at.localeCompare(a.at);
  });
