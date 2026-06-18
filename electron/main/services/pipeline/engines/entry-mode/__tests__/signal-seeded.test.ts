import { describe, expect, it } from "vitest";
import type { AIPhaseContext } from "../../../phases/types";
import { resolveEngine } from "../../registry";
import "../../index";

function buildCtx(
  signalTrigger: Record<string, unknown>,
  instrumentClasses: AIPhaseContext["instrumentClasses"] = ["stock"],
): AIPhaseContext {
  return {
    phase: "selector",
    pipelineId: "default",
    sessionId: "session-1",
    cycleId: "cycle-1",
    tradeId: null,
    instrumentClasses,
    session: {
      id: "session-1",
      selectionMode: "signal_driven",
      instrumentScope: "",
      instrumentClasses,
    } as AIPhaseContext["session"],
    strategyContext: {
      riskConfig: { maxConcurrentTrades: 3 },
    } as AIPhaseContext["strategyContext"],
    toolContext: {} as AIPhaseContext["toolContext"],
    services: {} as never,
    runner: {} as AIPhaseContext["runner"],
    input: { signalTrigger },
  };
}

describe("signal-seeded entry engine", () => {
  const engine = () =>
    resolveEngine<import("../../registry").EntryModeEngine>(
      "signal-seeded",
      "entry_mode",
    );

  it("trusts the signal's instrument class even when the session config omits it", () => {
    // The delivery gate already verified broker support upstream; the engine
    // must not downgrade a crypto signal to stock just because the session's
    // configured classes are stale.
    const ctx = buildCtx(
      {
        sourceType: "manual",
        ticker: "BTC/USD",
        payloadJson: { instrumentClass: "crypto" },
      },
      ["stock"],
    );

    expect(engine().resolve(ctx)).toEqual({
      instruments: [
        expect.objectContaining({
          symbol: "BTC/USD",
          instrumentClass: "crypto",
        }),
      ],
    });
  });

  it("falls back to a stock convention for edgar signals with no payload class", () => {
    const ctx = buildCtx({ sourceType: "edgar_8k", ticker: "NVDA" }, [
      "crypto",
      "stock",
    ]);

    expect(engine().resolve(ctx)).toEqual({
      instruments: [
        expect.objectContaining({ symbol: "NVDA", instrumentClass: "stock" }),
      ],
    });
  });
});
