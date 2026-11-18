/**
 * What the printer says about the roll it is holding.
 *
 * Three different facts get confused here, so they are kept apart on purpose:
 *
 *   - what is physically in the machine — the printer's answer, and only
 *     when the media carries a tag it could read;
 *   - what the open template was designed for — the document's answer, which
 *     has to exist with no printer in the room at all;
 *   - whether those two agree, which is the only one that saves a tray of
 *     labels.
 *
 * Everything here is arithmetic over the readings the library hands us, with
 * no canvas and no printer client, so the decisions can be checked without a
 * browser and without hardware.
 */

import type { HeartbeatData, PaperInfo, RfidInfo } from "@mmote/niimbluelib";
import type { ConnectedPrinter, PhysicalLabel } from "$/utils/printer_profile";
import { loadedLabelOf } from "$/utils/printer_profile";

/**
 * How much of the roll is left.
 *
 * The tag carries two counters, written back by the printer as it prints.
 * They are the only source for this: a roll with no tag has no count, and
 * saying "0 left" about an unknown quantity would stop a lab that has a full
 * roll in the machine. `undefined` means "the roll did not say", and the
 * panel must word it that way.
 *
 * The library's parser seeds both counters with -1 when the field is absent,
 * so a non-positive total is "not reported" rather than an empty roll.
 *
 * The unit is the tag's own and is not documented by the library. It behaves
 * as a count of labels - the printer refuses to print when `usedPaper`
 * reaches `allPaper` - and is shown as one, but it has not been checked
 * against a roll of known length on real hardware.
 */
export const labelsLeft = (
  tag: RfidInfo | undefined,
): { left: number; total: number } | undefined => {
  if (tag?.tagPresent !== true) {
    return undefined;
  }

  const { allPaper: total, usedPaper: used } = tag;

  if (!Number.isFinite(total) || total <= 0) return undefined;
  if (!Number.isFinite(used) || used < 0) return undefined;

  return { left: Math.max(0, total - used), total };
};

/**
 * Whether the heartbeat has just reported media being changed.
 *
 * The printer sends a heartbeat roughly every two seconds carrying, among
 * other things, whether its lid is shut and whether it can feel paper. Those
 * two transitions are what a roll change looks like from outside the
 * machine, and they are a far better trigger for re-reading the tag than
 * asking the operator to remember a button.
 *
 * Only transitions count. A printer that reports `lidClosed: true` forever
 * must not cause a re-read on every heartbeat, and one that reports neither
 * field says nothing either way - the button stays for those.
 */
export const heartbeatSaysNewMedia = (
  prev: HeartbeatData | undefined,
  next: HeartbeatData | undefined,
): boolean => {
  if (prev === undefined || next === undefined) {
    return false;
  }

  // The lid has just been shut. Nobody changes a roll without opening it.
  if (prev.lidClosed === false && next.lidClosed === true) {
    return true;
  }

  // Media has appeared where a moment ago there was none.
  if (prev.paperInserted === false && next.paperInserted === true) {
    return true;
  }

  return false;
};

/**
 * What the panel has to say about the roll.
 *
 * Each case is a different thing to tell the operator, and collapsing any
 * two of them produces a panel that lies. "No tag" is not "no printer", and
 * neither is "the tag is there and unreadable" - a third-party roll works
 * perfectly and will never have a tag, while an unreadable one usually means
 * the roll is seated wrong.
 */
export type RollState =
  /** No printer is connected, so there is nothing to report. */
  | { kind: "disconnected" }
  /** The lid is open. Nothing will print until it is shut. */
  | { kind: "lid_open" }
  /** There is a tag and the printer could not read it. */
  | { kind: "unreadable" }
  /** The media carries no tag. Normal for third-party stock. */
  | { kind: "no_tag" }
  /**
   * The reading is wider than the print head, so it is the backing paper
   * rather than the label. Believing it would put the design on a label
   * wider than the one in the machine.
   */
  | { kind: "too_wide"; acrossMm: number; headMm: number }
  /** A tag was read but it does not describe a label of a usable size. */
  | { kind: "no_size" }
  /** A label of a known size is loaded. */
  | { kind: "loaded"; label: PhysicalLabel; gapMm?: number };

export const rollStateOf = (state: {
  connected: boolean;
  printer: ConnectedPrinter | undefined;
  paperInfo: PaperInfo | undefined;
  tag: RfidInfo | undefined;
  heartbeat: HeartbeatData | undefined;
}): RollState => {
  const { connected, printer, paperInfo, tag, heartbeat } = state;

  if (!connected) {
    return { kind: "disconnected" };
  }

  // The lid comes first: with it open, every other reading is stale by
  // definition, and it is also the likeliest reason a print just failed.
  if (heartbeat?.lidClosed === false) {
    return { kind: "lid_open" };
  }

  const measured = loadedLabelOf(paperInfo);

  if (measured !== undefined) {
    if (printer !== undefined && measured.acrossMm > printer.headMm) {
      return { kind: "too_wide", acrossMm: measured.acrossMm, headMm: printer.headMm };
    }

    return { kind: "loaded", label: measured, gapMm: paperInfo?.gapHeight };
  }

  // No usable size. Why not is the useful part.
  if (heartbeat?.paperRfidSuccess === false) {
    return { kind: "unreadable" };
  }

  if (tag !== undefined && tag.tagPresent === false) {
    return { kind: "no_tag" };
  }

  return { kind: "no_size" };
};

/**
 * Whether the loaded roll and the open design are different sizes.
 *
 * Compared as whole canvas pixels rather than as millimetres, because the
 * canvas is a whole number of printer dots and a millimetre is not: two
 * sizes that differ by less than a dot are the same label, and floating
 * point on the millimetre values would report a mismatch that no printer
 * could express.
 */
export const labelMismatch = (
  canvas: { width: number; height: number } | undefined,
  roll: { width: number; height: number } | undefined,
): boolean => {
  if (canvas === undefined || roll === undefined) {
    return false;
  }

  return canvas.width !== roll.width || canvas.height !== roll.height;
};

/** A length in printer dots, as millimetres, for display. */
export const dotsToMm = (dots: number, dpmm: number): number =>
  Math.round((dots / dpmm) * 10) / 10;

/**
 * Millimetres as whole printer dots.
 *
 * The head prints dots, so a millimetre figure a person types is only ever
 * an approximation of one. Rounding here rather than at the call site keeps
 * every input in the app snapping the same way.
 */
export const mmToDots = (mm: number, dpmm: number): number => Math.round(mm * dpmm);
