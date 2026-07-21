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

  it("passes scan_hit metadata through to the instrument for rules pipelines", () => {
    const ctx = buildCtx(
      {
        sourceType: "mock",
        ticker: "SPY",
        payloadJson: {
          cadence: "15m",
          pollCadence: "15m",
          analysisTimeframe: "1h",
          instrumentClass: "stock",
        },
      },
      ["stock"],
    );

    expect(engine().resolve(ctx)).toEqual({
      instruments: [
        expect.objectContaining({
          symbol: "SPY",
          instrumentClass: "stock",
          instrumentMetadataJson: JSON.stringify({
            pollCadence: "15m",
            analysisTimeframe: "1h",
          }),
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

  it("passes prediction-market executable metadata from the signal payload", () => {
    const ctx = buildCtx(
      {
        sourceType: "prediction_event",
        ticker: "pm:cond-abc",
        companyName: "Will CPI beat?",
        payloadJson: {
          instrumentClass: "prediction_market",
          conditionId: "cond-abc",
          predictionOutcome: "YES",
          outcomeTokenId: "yes-token",
          yesOutcomeTokenId: "yes-token",
          noOutcomeTokenId: "no-token",
          marketMid: 0.42,
          slug: "cpi-beat",
          liquidityUsd: 20_000,
          resolutionTime: "2026-08-01T00:00:00Z",
        },
      },
      ["prediction_market"],
    );

    const resolved = engine().resolve(ctx) as {
      instruments: Array<{
        symbol: string;
        instrumentClass: string;
        predictionOutcome?: string | null;
        instrumentMetadataJson?: string | null;
      }>;
    };
    expect(resolved).toEqual({
      instruments: [
        expect.objectContaining({
          symbol: "pm:cond-abc",
          instrumentClass: "prediction_market",
          predictionOutcome: "YES",
          instrumentMetadataJson: expect.stringContaining("cond-abc"),
        }),
      ],
    });
    const meta = JSON.parse(
      resolved.instruments[0]?.instrumentMetadataJson ?? "{}",
    );
    expect(meta).toMatchObject({
      conditionId: "cond-abc",
      outcomeTokenId: "yes-token",
      marketMid: 0.42,
      yesOutcomeTokenId: "yes-token",
      noOutcomeTokenId: "no-token",
    });
  });
});
