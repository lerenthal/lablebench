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
import { evaluateWidth, printableWidth } from "$/utils/print_limits";
import type { FabricJson, LabelProps } from "$/types";

export type BatchRowStatus = "pending" | "printing" | "done" | "failed" | "skipped";

export type BatchRowState = {
  index: number;
  variables: Record<string, string>;
  copies: number;
  status: BatchRowStatus;
  error?: string;
};

export type BatchPrinterOptions = {
  client: NiimbotAbstractClient;
  fabricJson: FabricJson;
  labelProps: LabelProps;
  renderParams: RenderParams;
  printTaskName: PrintTaskName;
  density: number;
  labelType: LabelType;
  speed: 0 | 1;
  pageColor: PageColorType;
  /** Print head width in pixels. Rows wider than this are rejected, never sent. */
  headWidth?: number;
  /** The head width of the model the template targets. Rows wider than this are flagged, not rejected. */
  modelHeadWidth?: number;
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

  const client = options.client;

  const printListener = (event: PrintProgressEvent) => {
    const currentPageProgress = (event.pagePrintProgress + event.pageFeedProgress) / 2;
    const percents = Math.min(
      100,
      Math.floor(((event.page + currentPageProgress / 100) / Math.max(1, totalCopies)) * 100),
    );
    callbacks.onProgress?.(percents);
  };

  const sendListener = (event: PrintPacketProgressEvent) => {
    callbacks.onProgress?.(event.progress);
  };

  client.on("printprogress", printListener);
  client.on("printpacketprogress", sendListener);

  let printTask: AbstractPrintTask | undefined;

  try {
    client.stopHeartbeat();

    printTask = client.protocol.newPrintTask(options.printTaskName, {
      totalPages: totalCopies,
      density: options.density,
      speed: options.speed,
      labelType: options.labelType,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8_000,
      pageColor: options.pageColor,
    });

    await printTask.printInit();

    for (let index = 0; index < results.length; index++) {
      if (control?.isCancelled() === true) {
        throw new BatchCancelledError();
      }

      await control?.waitUntilRunnable();

      const row = results[index]!;
      const copies = Math.max(1, row.copies);

      update(index, { status: "printing", error: undefined });

      try {
        const canvas = await renderLabelCanvas(
          options.fabricJson,
          options.labelProps,
          row.variables,
          options.renderParams,
        );

        // §5.1: never send an over-wide raster. Reject the row with a clear
        // message instead of letting the printer receive something it cannot print.
        const evaluation = evaluateWidth(
          printableWidth(canvas, options.labelProps.printDirection),
          options.headWidth,
          options.modelHeadWidth,
        );

        if (evaluation.blocked !== undefined) {
          throw new Error(
            `Label is ${evaluation.printWidth} px wide but the ${options.printTaskName} print head is ${options.headWidth} px. ` +
              `Reduce the label width or choose a template for this printer.`,
          );
        }

        const encoded: EncodedImage = ImageEncoder.encodeCanvas(
          canvas,
          options.pageColor,
          options.labelProps.printDirection,
        );

        await printTask.printPage(encoded, copies);
        await printTask.waitForPageFinished();

        printedCopies += copies;
        callbacks.onProgress?.(Math.floor((printedCopies / Math.max(1, totalCopies)) * 100));
        update(index, { status: "done" });
      } catch (e) {
        // A failed row is recorded and the batch continues.
        update(index, { status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }

    await printTask.waitForFinished();
  } catch (e) {
    if (e instanceof BatchCancelledError) {
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
    client.off("printprogress", printListener);
    client.off("printpacketprogress", sendListener);

    try {
      if (printTask !== undefined) {
        await printTask.printEnd();
      }
    } catch {
      // The printer may already be gone; the batch result stands on its own.
    }

    client.startHeartbeat();
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
