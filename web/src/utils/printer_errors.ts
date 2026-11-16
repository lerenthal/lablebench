/**
 * The printer's error codes, and what they mean.
 *
 * A printer error is the printer refusing the job, and it arrives as a
 * number. The number is all the app has to work with, so each one that a
 * user can do something about is given a plain-language meaning.
 *
 * Error 20 — "WriteRfidFail" — is the one worth understanding properly,
 * because it is the most common complaint about this printer and the least
 * obvious from its name.
 *
 * Every NIIMBOT label roll carries a small NFC tag. The tag holds the
 * label's size, its type and how many labels are left on the roll. When a
 * print finishes, the printer writes the new count back to that tag — that
 * is what decrements the roll.
 *
 * So error 20 means: the printer tried to write the count back and the
 * write failed. It is not about the label being too wide, and it is not
 * about the label type. The usual causes are:
 *
 *   - the roll has no tag at all (plain thermal paper, or a tag that has
 *     been removed or damaged), so there is nothing to write to
 *   - the roll's tag is there but has been read too many times
 *   - the counter has run out, so the write would be refused
 *   - the printer's firmware is doing something the app cannot see
 *
 * None of those is something the app can talk the printer out of: the
 * write is the printer's own business, and the protocol has no command to
 * skip it. What the app CAN do is notice the situation coming and say so,
 * rather than letting the print die with a number.
 */

import type { HeartbeatData, RfidInfo } from "@mmote/niimbluelib";

/** The printer's own error code for a failed write to the roll's tag. */
export const WRITE_RFID_FAIL = 20;

/** What the app knows about the roll's tag and the printer's read of it. */
export interface RollTagState {
  /** The roll's tag, as the printer reported it. Absent when there is none. */
  tag?: RfidInfo;
  /** The printer's live report of whether it can read the paper's tag. */
  heartbeat?: HeartbeatData;
}

/**
 * Whether the printer is likely to fail to write to the roll's tag.
 *
 * The printer reports both what it read from the tag and whether the read
 * succeeded, so the app can see the problem before the print rather than
 * after it.
 */
export interface TagWarning {
  /** What is wrong, for the app to explain. */
  kind: "no_tag" | "unreadable" | "exhausted";
  /** What the printer said, in numbers, when it said anything. */
  detail?: string;
}

/**
 * Look at what the printer says about the roll's tag.
 *
 * The heart of it is the counter: the tag holds how many labels are left,
 * and a roll that has been printed to the end cannot take another write.
 */
export const inspectRollTag = (state: RollTagState): TagWarning | undefined => {
  const { tag, heartbeat } = state;

  // The printer says plainly whether it could read the tag on the paper.
  // That is the closest thing to the error itself, and it comes before the
  // print rather than after it.
  if (heartbeat?.paperRfidSuccess === false) {
    return { kind: "unreadable" };
  }

  if (tag === undefined) {
    return undefined;
  }

  if (tag.tagPresent === false) {
    return { kind: "no_tag" };
  }

  // The counter is the other thing that can run out. The printer writes the
  // new count back to the tag, and a roll with nothing left on it refuses
  // the write.
  if (tag.allPaper > 0 && tag.usedPaper >= tag.allPaper) {
    return { kind: "exhausted", detail: `${tag.usedPaper}/${tag.allPaper}` };
  }

  return undefined;
};

/**
 * The reason a printer error carries, as a number.
 *
 * The library's error carries the code in `reasonId`; the message it builds
 * has it in the text. Both are read, so the code is found whichever way the
 * error arrived.
 */
export const printerErrorCode = (error: unknown): number | undefined => {
  if (error instanceof Error) {
    const withReason = error as Error & { reasonId?: number };
    if (typeof withReason.reasonId === "number") {
      return withReason.reasonId;
    }

    const matched = /Print error (\d+)/.exec(error.message);
    if (matched !== null) {
      return Number(matched[1]);
    }
  }

  return undefined;
};

/** Whether an error is the printer failing to write to the roll's tag. */
export const isWriteRfidFail = (error: unknown): boolean =>
  printerErrorCode(error) === WRITE_RFID_FAIL;
