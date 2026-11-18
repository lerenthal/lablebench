/**
 * What the shutdown path has to get right.
 *
 * Signals cannot be tested by sending real ones - the test runner is the
 * process that would receive them - so `createShutdown` takes its steps as
 * arguments and the tests drive it directly. What is being pinned down is
 * the ordering, what happens when a step fails, and the deadline, because
 * those are the three ways a shutdown handler quietly fails to do the one
 * job it was added for.
 *
 * The last test is about the file on disk rather than the handler. A killed
 * server leaves its writes in the write-ahead log, where SQLite replays
 * them on the next open; checking them in is what makes the database file a
 * complete copy of the data on its own, which is what anything copying the
 * volume as files ends up with.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createShutdown } from "../shutdown.js";
import { openDb } from "../db/index.js";

/** A shutdown wired to recorders, so the tests can watch what it did. */
const harness = (over: { closeServer?: () => Promise<void>; closeDb?: () => void } = {}) => {
  const order: string[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const exits: number[] = [];

  const shutdown = createShutdown({
    closeServer:
      over.closeServer ??
      (async () => {
        order.push("server");
      }),
    closeDb:
      over.closeDb ??
      (() => {
        order.push("db");
      }),
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
    exit: (code) => exits.push(code),
    // Short enough that a hanging step is a fast test rather than a slow one.
    timeoutMs: 20,
  });

  return { shutdown, order, logs, warnings, exits };
};

describe("shutting down", () => {
  it("stops listening before it closes the database", async () => {
    const h = harness();

    await h.shutdown("SIGTERM");

    // Writes arrive as HTTP requests. Closing the database first would cut
    // one off in the middle.
    assert.deepEqual(h.order, ["server", "db"]);
    assert.deepEqual(h.exits, [0]);
  });

  it("names the signal it is acting on", async () => {
    const h = harness();

    await h.shutdown("SIGINT");

    const [first] = h.logs;

    assert.ok(first?.includes("SIGINT"), `expected the signal in ${JSON.stringify(first)}`);
  });

  it("still closes the database when the server will not close", async () => {
    const h = harness({
      closeServer: async () => {
        throw new Error("a request is stuck");
      },
    });

    await h.shutdown("SIGTERM");

    // The whole point of the handler. A server that refuses to close is the
    // case where unflushed writes are most likely, so skipping the database
    // here would lose them exactly when it matters.
    assert.deepEqual(h.order, ["db"]);
    assert.equal(h.warnings.length, 1);
    assert.deepEqual(h.exits, [1]);
  });

  it("reports a bad exit when the database will not close", async () => {
    const h = harness({
      closeDb: () => {
        throw new Error("disk is gone");
      },
    });

    await h.shutdown("SIGTERM");

    assert.deepEqual(h.exits, [1]);
    assert.equal(h.warnings.length, 1);
  });

  it("takes a second signal as a demand to exit now", async () => {
    let release = (): void => {};
    const h = harness({
      closeServer: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });

    const first = h.shutdown("SIGTERM");
    await h.shutdown("SIGTERM");

    // The second signal exits; it does not start a second shutdown on top
    // of the first, so neither step has run twice and the first is still
    // waiting on its stuck server.
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.order, []);

    release();
    await first;

    // The stuck step records nothing of its own. What matters is that the
    // database was closed once, by the first shutdown, after it finished.
    assert.deepEqual(h.order, ["db"]);
    assert.deepEqual(h.exits, [1, 0]);
  });

  it("gives up on its own terms rather than waiting for the kill", async () => {
    const h = harness({
      closeServer: () => new Promise<void>(() => {}),
    });

    void h.shutdown("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Docker's grace period ends in SIGKILL. Exiting first, with a line in
    // the log, is the difference between a diagnosable stop and exit 137.
    assert.deepEqual(h.exits, [1]);
    assert.equal(h.warnings.length, 1);
    const [warning] = h.warnings;

    assert.ok(warning?.includes("20ms"), `expected the deadline in ${JSON.stringify(warning)}`);
  });
});

describe("the database file a volume copy would pick up", () => {
  it("holds the last write once the WAL has been checked in", () => {
    const dir = mkdtempSync(join(tmpdir(), "labelbench-shutdown-"));
    const path = join(dir, "labelbench.db");

    try {
      const db = openDb({ path });

      db.exec("CREATE TABLE note (body TEXT)");
      db.prepare("INSERT INTO note (body) VALUES (?)").run("the last write before the stop");

      // In WAL mode that write is in the log, not yet in the file.
      assert.ok(existsSync(`${path}-wal`), "expected a write-ahead log");
      assert.ok(statSync(`${path}-wal`).size > 0, "expected the write to be in the log");

      // What the shutdown handler does.
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();

      // Re-open the file alone and read it back, which is what restoring a
      // file-level copy of the volume amounts to.
      const reopened = openDb({ path });
      const row = reopened.prepare("SELECT body FROM note").get() as { body: string };

      assert.equal(row.body, "the last write before the stop");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
