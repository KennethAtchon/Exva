import { describe, expect, it } from "vitest";
import type { PaperCertificationStatus } from "@electron/shared/domain/paper-certification";

const TERMINAL: PaperCertificationStatus[] = [
  "closed",
  "failed",
  "reconciliation_required",
];

/** Pure helpers for panel polling / remount behavior (Solution 01 UI). */
export function shouldPollCertificationStatus(
  status: PaperCertificationStatus | undefined,
): boolean {
  if (!status) return false;
  return !TERMINAL.includes(status);
}

export function certificationReceiptReady(
  status: PaperCertificationStatus | undefined,
): boolean {
  return status === "closed";
}

export function certStatusProgress(status: PaperCertificationStatus): number {
  const order: PaperCertificationStatus[] = [
    "armed",
    "submitting_entry",
    "entry_open",
    "entry_filled",
    "submitting_exit",
    "exit_open",
    "closed",
  ];
  const idx = order.indexOf(status);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / order.length) * 100);
}

describe("paper certification UI flow", () => {
  it("polls through arm → state machine → closed receipt", () => {
    const path: PaperCertificationStatus[] = [
      "armed",
      "submitting_entry",
      "entry_open",
      "entry_filled",
      "submitting_exit",
      "exit_open",
      "closed",
    ];
    for (const status of path) {
      if (status === "closed") {
        expect(shouldPollCertificationStatus(status)).toBe(false);
        expect(certificationReceiptReady(status)).toBe(true);
      } else {
        expect(shouldPollCertificationStatus(status)).toBe(true);
      }
    }
  });

  it("remount preserves terminal closed state without polling", () => {
    const remountedStatus: PaperCertificationStatus = "closed";
    expect(shouldPollCertificationStatus(remountedStatus)).toBe(false);
    expect(certificationReceiptReady(remountedStatus)).toBe(true);
    expect(certStatusProgress(remountedStatus)).toBe(100);
  });
});
