/**
 * Batch print runner (§5.4).
 *
 * Prints a set of merged rows to the locally connected printer, one after the
 * other. Requirements this implements:
 *
 *  - per-row success / failure reporting (one bad row must not abort the batch)
 *  - pause / cancel
 *  - copies per row
 *  - a clear error when a row would produce an over-wide raster (§5.1)
 *  - a template is never lost because a print failed (§8)
 *
 * The printer connection itself is the browser's, over Web Bluetooth or Web
 * Serial — the server is not involved.
 */

import {
  ImageEncoder,
  LabelType,
  PageColorType,
  type AbstractPrintTask,
  type EncodedImage,
  type NiimbotAbstractClient,
  type PrintPacketProgressEvent,
  type PrintProgressEvent,
  type PrintTaskName,
} from "@mmote/niimbluelib";
import { renderLabelCanvas, type RenderParams } from "$/utils/label_render";
import { allocateSerialValues } from "$/utils/dynamic_values";
import type { SerialConfig } from "$/types";
import { evaluateWidth, printableWidth } from "$/utils/print_limits";
import { logError, logInfo, logWarn } from "$/utils/app_log";
import type { FabricJson, LabelProps } from "$/types";

export type BatchRowStatus = "pending" | "printing" | "done" | "failed" | "skipped";

export type BatchRowState = {
  index: number;
  variables: Record<string, string>;
  copies: number;
  status: BatchRowStatus;
  error?: string;
};

/**
 * Where a batch's labels go.
 *
 * The transport is kept behind this, so the runner itself does not know how
 * a label reaches the printer. The runner owns the serial allocation, the
 * per-row error handling and the pause and cancel behaviour, and the sink
 * owns the sending.
 */
export interface BatchSink {
  /** Prepare the printer for the batch. */
  open: () => Promise<void>;
  /**
   * Print one label.
   *
   * @param canvas  the label, already rendered and processed to 1 bit
   * @param copies  how many of this label to print
   */
  printLabel: (canvas: HTMLCanvasElement, copies: number) => Promise<void>;
  /** Finish the batch and let the printer go. */
  close: () => Promise<void>;
  /**
   * The printer's own progress, when the printer reports it.
   *
   * Returns the function that stops listening.
   */
  onProgress?: (callback: (percent: number) => void) => () => void;
}

export type BatchPrinterOptions = {
  /** Where the labels go. */
  sink: BatchSink;
  fabricJson: FabricJson;
  labelProps: LabelProps;
  renderParams: RenderParams;
  /** Print head width in pixels. Rows wider than this are rejected, never sent. */
  headWidth?: number;
  /** The head width of the model the template targets. Rows wider than this are flagged, not rejected. */
  modelHeadWidth?: number;
  /**
   * The template's serial sequence, when it has one.
   *
   * A serial number comes from a central counter, so every copy of every row
   * takes its own number rather than repeating one across the copies.
   */
  serialConfig?: SerialConfig;
};

/** What a NIIMBOT batch needs to know about its printer. */
export type NiimbotSinkOptions = {
  client: NiimbotAbstractClient;
  printTaskName: PrintTaskName;
  density: number;
  labelType: LabelType;
  speed: 0 | 1;
  pageColor: PageColorType;
  printDirection: "left" | "top";
  /** How many labels the batch will print in all. */
  totalCopies: number;
};

/**
 * A sink that prints to a NIIMBOT.
 *
 * The NIIMBOT's print task takes a whole page at a time and can print
 * several copies of it in one go, which is why the copies are handed to the
 * task rather than printed one by one.
 */
export const niimbotSink = (options: NiimbotSinkOptions): BatchSink => {
  let printTask: AbstractPrintTask | undefined;

  return {
    open: async () => {
      options.client.stopHeartbeat();

      printTask = options.client.protocol.newPrintTask(options.printTaskName, {
        totalPages: options.totalCopies,
        density: options.density,
        speed: options.speed,
        labelType: options.labelType,
        statusPollIntervalMs: 100,
        statusTimeoutMs: 8_000,
        pageColor: options.pageColor,
      });

      await printTask.printInit();
    },

    printLabel: async (canvas, copies) => {
      if (printTask === undefined) {
        throw new Error("The print task was never started");
      }

      const encoded: EncodedImage = ImageEncoder.encodeCanvas(
        canvas,
        options.pageColor,
        options.printDirection,
      );

      await printTask.printPage(encoded, copies);
      await printTask.waitForPageFinished();
    },

    close: async () => {
      try {
        await printTask?.waitForFinished();
        await printTask?.printEnd();
      } catch {
        // The printer may already be gone; the batch result stands on its own.
      }

      options.client.startHeartbeat();
    },

    onProgress: (callback) => {
      const printListener = (event: PrintProgressEvent) => {
        const currentPageProgress = (event.pagePrintProgress + event.pageFeedProgress) / 2;
        const percents = Math.min(
          100,
          Math.floor(((event.page + currentPageProgress / 100) / Math.max(1, options.totalCopies)) * 100),
        );
        callback(percents);
      };

      const sendListener = (event: PrintPacketProgressEvent) => {
        callback(event.progress);
      };

      options.client.on("printprogress", printListener);
      options.client.on("printpacketprogress", sendListener);

      return () => {
        options.client.off("printprogress", printListener);
        options.client.off("printpacketprogress", sendListener);
      };
    },
  };
};

export type BatchCallbacks = {
  onRowUpdate?: (row: BatchRowState) => void;
  onProgress?: (percent: number) => void;
};

export type BatchControl = {
  /** Ask the runner to stop after the current row. */
  cancel: () => void;
  /** Ask the runner to wait before starting the next row. */
  pause: () => void;
  /** Resume a paused runner. */
  resume: () => void;
  isCancelled: () => boolean;
  isPaused: () => boolean;
  /** Resolves once the runner is allowed to print the next row. */
  waitUntilRunnable: () => Promise<void>;
};

export class BatchCancelledError extends Error {
  constructor() {
    super("Batch printing was cancelled");
    this.name = "BatchCancelledError";
  }
}

/**
 * Run a batch.
 *
 * Returns the final state of every row so the UI can show what happened.
 */
export async function runBatch(
  options: BatchPrinterOptions,
  rows: BatchRowState[],
  callbacks: BatchCallbacks = {},
  control?: BatchControl,
): Promise<BatchRowState[]> {
  const results = rows.map((row) => ({ ...row }));
  const totalCopies = results.reduce((sum, row) => sum + Math.max(1, row.copies), 0);

  let printedCopies = 0;

  const update = (index: number, patch: Partial<BatchRowState>) => {
    const row = results[index];
    if (row === undefined) {
      return;
    }
    Object.assign(row, patch);
    callbacks.onRowUpdate?.({ ...row });
  };

  const sink = options.sink;

  const stopListening = sink.onProgress?.((percent) => {
    callbacks.onProgress?.(percent);
  });

  logInfo("batch", `Batch started: ${results.length} row(s), ${totalCopies} label(s)`);

  try {
    await sink.open();

    for (let index = 0; index < results.length; index++) {
      if (control?.isCancelled() === true) {
        throw new BatchCancelledError();
      }

      await control?.waitUntilRunnable();

      const row = results[index]!;
      const copies = Math.max(1, row.copies);

      update(index, { status: "printing", error: undefined });

      try {
        // Without a serial sequence a row is rendered once and its copies are
        // printed together, exactly as before. With one, every copy is its own
        // label, so each takes the next number from the central counter and is
        // rendered separately.
        const serialConfig = options.serialConfig;
        const iterations = serialConfig === undefined ? 1 : copies;

        for (let copy = 0; copy < iterations; copy++) {
          const variables =
            serialConfig === undefined
              ? row.variables
              : { ...row.variables, ...(await allocateSerialValues(serialConfig)) };

          const canvas = await renderLabelCanvas(
            options.fabricJson,
            options.labelProps,
            variables,
            options.renderParams,
          );

          // §5.1: never send an over-wide raster. Reject the row with a clear
          // message instead of letting the printer receive something it cannot print.
          //
          // The raster is measured in the head's own dots, so it is put back
          // into the app's canvas pixels before it is compared with a head
          // width, which is always in those.
          const evaluation = evaluateWidth(
            printableWidth(canvas, options.labelProps.printDirection),
            options.headWidth,
            options.modelHeadWidth,
          );

          if (evaluation.blocked !== undefined) {
            throw new Error(
              `Label is ${evaluation.printWidth} px wide but the print head is ${options.headWidth} px. ` +
                `Reduce the label width or choose a template for this printer.`,
            );
          }

          await sink.printLabel(canvas, serialConfig === undefined ? copies : 1);
        }

        printedCopies += copies;
        callbacks.onProgress?.(Math.floor((printedCopies / Math.max(1, totalCopies)) * 100));
        update(index, { status: "done" });
      } catch (e) {
        // A failed row is recorded and the batch continues.
        const message = e instanceof Error ? e.message : String(e);
        logError("batch", `Row ${index + 1} failed`, e);
        update(index, { status: "failed", error: message });
      }
    }

  } catch (e) {
    if (e instanceof BatchCancelledError) {
      logWarn("batch", "The batch was cancelled");
      for (let index = 0; index < results.length; index++) {
        if (results[index]!.status === "pending") {
          update(index, { status: "skipped" });
        }
      }
    } else {
      // A whole-batch failure (disconnect, protocol error) marks the rows that
      // never ran as skipped rather than leaving them stuck on "printing".
      for (let index = 0; index < results.length; index++) {
        if (results[index]!.status === "pending" || results[index]!.status === "printing") {
          update(index, {
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      throw e;
    }
  } finally {
    stopListening?.();

    try {
      await sink.close();
    } catch {
      // The printer may already be gone; the batch result stands on its own.
    }
  }

  return results;
}

/** Create a control handle for pausing and cancelling a running batch. */
export function createBatchControl(): BatchControl {
  let cancelled = false;
  let paused = false;

  let resolveGate: (() => void) | undefined;
  let gate = Promise.resolve();

  const openGate = () => {
    const resolver = resolveGate;
    resolveGate = undefined;
    resolver?.();
  };

  const closeGate = () => {
    if (resolveGate === undefined) {
      gate = new Promise<void>((resolve) => {
        resolveGate = resolve;
      });
    }
  };

  return {
    cancel: () => {
      cancelled = true;
      paused = false;
      openGate();
    },
    pause: () => {
      paused = true;
      closeGate();
    },
    resume: () => {
      paused = false;
      openGate();
    },
    isCancelled: () => cancelled,
    isPaused: () => paused,
    waitUntilRunnable: async () => {
      while (paused && !cancelled) {
        await gate;
      }
    },
  };
}
