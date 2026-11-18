/**
 * Stopping the server without leaving the last write behind.
 *
 * Two facts make this necessary rather than tidy.
 *
 * The container runs `node dist/server.js` directly, so Node is PID 1. A
 * process with no shutdown handler of its own does not stop on SIGTERM
 * there: Docker waits out its grace period and sends SIGKILL, which is how
 * every `docker compose stop`, image upgrade and host reboot used to end -
 * ten seconds of waiting, then exit 137.
 *
 * What that costs is worth being exact about, because it is not lost data.
 * A committed write is in the write-ahead log and fsynced before the API
 * answers, so SQLite replays it on the next open whatever killed the
 * process, and `scripts/backup.sh` reads through SQLite's online backup API
 * rather than copying the file, so backups were never affected. The costs
 * are a ten-second stall on every stop, an exit code that makes a routine
 * stop indistinguishable from a crash, requests cut off mid-response, and a
 * `labelbench.db` that is not a complete copy of the data on its own - which
 * matters to anything that copies the volume as files: a tar of the volume,
 * a VM snapshot, a restore drill.
 *
 * So shutdown is ordered, and deliberately so: stop listening and let
 * in-flight requests finish, then check the WAL into the file and close it.
 * Writes come from HTTP requests, so closing the database first would cut
 * off a request mid-write.
 *
 * Everything here takes its collaborators as arguments, because the useful
 * thing to test about a shutdown path is the ordering and what happens when
 * a step fails - neither of which can be tested by sending real signals to
 * the test runner's own process.
 */

/**
 * The deadline for the whole shutdown.
 *
 * It has to stay below the container's stop grace period (Docker's default
 * is 10s, and nothing in `docker-compose.yml` overrides it). A shutdown that
 * sits waiting for a stuck request until Docker loses patience ends in
 * exactly the SIGKILL this file exists to avoid, so we give up first, on our
 * own terms, with a line in the log saying so.
 */
export const SHUTDOWN_TIMEOUT_MS = 8_000;

export type ShutdownSteps = {
  /** Stop accepting connections and let in-flight requests finish. */
  closeServer: () => Promise<void>;
  /** Check the WAL into the database file and close it. */
  closeDb: () => void;
  log: (message: string) => void;
  warn: (message: string, error: unknown) => void;
  exit: (code: number) => void;
  timeoutMs?: number;
  /** Seam for the tests; `setTimeout` in production. */
  schedule?: (run: () => void, ms: number) => { cancel: () => void };
};

const realSchedule = (run: () => void, ms: number): { cancel: () => void } => {
  const timer = setTimeout(run, ms);

  // An unref'd timer cannot be the reason the process stays alive: if the
  // close steps finish early and nothing else is pending, Node should be
  // free to exit without waiting out the deadline.
  timer.unref();

  return { cancel: () => clearTimeout(timer) };
};

/**
 * Build the signal handler.
 *
 * Returns a function safe to call more than once: the second signal is read
 * as the operator saying they are done waiting, and exits immediately rather
 * than starting a second shutdown on top of the first.
 */
export const createShutdown = (steps: ShutdownSteps): ((signal: string) => Promise<void>) => {
  const timeoutMs = steps.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const schedule = steps.schedule ?? realSchedule;

  let shuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (shuttingDown) {
      steps.log(`${signal} received again, exiting now`);
      steps.exit(1);
      return;
    }

    shuttingDown = true;
    steps.log(`${signal} received, shutting down`);

    const deadline = schedule(() => {
      steps.warn(`shutdown did not finish within ${timeoutMs}ms, exiting anyway`, undefined);
      steps.exit(1);
    }, timeoutMs);

    // Each step gets its own guard. A server that refuses to close is a
    // reason to report a bad exit, never a reason to skip closing the
    // database - that would reintroduce the lost writes on the one path
    // where they are most likely.
    let code = 0;

    try {
      await steps.closeServer();
    } catch (error) {
      steps.warn("the HTTP server did not close cleanly", error);
      code = 1;
    }

    try {
      steps.closeDb();
    } catch (error) {
      steps.warn("the database did not close cleanly", error);
      code = 1;
    }

    deadline.cancel();
    steps.log("shutdown complete");
    steps.exit(code);
  };
};
