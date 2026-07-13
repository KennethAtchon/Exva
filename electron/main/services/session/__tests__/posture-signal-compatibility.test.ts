import { describe, expect, it } from "vitest";
import {
  postureRequiresEdgarCatalyst,
  postureSignalCompatible,
} from "../session-strategy-context-service";

// Why this matters: a catalyst-required posture makes the decision phase skip
// every cycle unless a material EDGAR 8-K exists. Only the EDGAR 8-K signal can
// supply one, so the posture/signal pairing must be rejected up front rather
// than producing a session that silently never trades.
// See docs/reviews/mock-no-trade-investigation.md.

describe("posture / signal compatibility", () => {
  it("flags catalyst-required postures", () => {
    expect(
      postureRequiresEdgarCatalyst({
        catalystMode: "required",
        processingMode: "manual",
      }),
    ).toBe(true);
    expect(
      postureRequiresEdgarCatalyst({
        catalystMode: "preferred",
        processingMode: "catalyst",
      }),
    ).toBe(true);
    expect(
      postureRequiresEdgarCatalyst({
        catalystMode: "preferred",
        processingMode: "contract",
      }),
    ).toBe(true);
  });

  it("does not flag non-catalyst postures", () => {
    expect(
      postureRequiresEdgarCatalyst({
        catalystMode: "preferred",
        processingMode: "manual",
      }),
    ).toBe(false);
  });

  it("rejects a catalyst posture without the EDGAR 8-K signal", () => {
    const posture = {
      catalystMode: "required" as const,
      processingMode: "catalyst" as const,
    };
    expect(postureSignalCompatible(posture, ["mock"])).toBe(false);
    expect(postureSignalCompatible(posture, [])).toBe(false);
  });

  it("accepts a catalyst posture driven by the EDGAR 8-K signal", () => {
    expect(
      postureSignalCompatible(
        { catalystMode: "required", processingMode: "catalyst" },
        ["edgar_8k"],
      ),
    ).toBe(true);
  });

  it("accepts a non-catalyst posture on any signal", () => {
    expect(
      postureSignalCompatible(
        { catalystMode: "preferred", processingMode: "manual" },
        ["mock"],
      ),
    ).toBe(true);
  });
});
