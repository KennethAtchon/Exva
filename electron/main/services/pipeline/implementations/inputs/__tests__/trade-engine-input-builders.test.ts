import { describe, expect, it, vi } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
import { WAIT_FOR_OPEN_REJECTION_REASON } from "../../../../risk/risk-engine";
import { riskGateInputBuilder } from "../trade-engine-input-builders";
import type { InstrumentAnalysisState } from "../../../analysis/types";

function baseState(): InstrumentAnalysisState {
  return {
    decision: {
      output: {
        symbol: "ETH",
        action: "buy",
        executionStrategy: "breakout",
        entryPrice: null,
        confidence: 0.65,
        reasoning: "Moderate conviction setup.",
      },
      run: { cost_usd: 0.01 } as never,
      message: {} as never,
    },
    executionProfile: {
      orderType: "market",
      side: "BUY",
      positionSizeUsd: 500,
      limitPrice: null,
      stopLossPct: 2,
      takeProfitPct: 4,
      sizingTrace: {
        strategy: "breakout",
        instrumentClass: "crypto",
        maxPositionUsd: 1000,
        maxExposureUsd: null,
        kellyFraction: 0.25,
        confidence: 0.65,
        strategySizeFactor: 1,
        reviewRecommendation: null,
        baseUsd: 500,
        afterReviewReduceUsd: 500,
        finalUsd: 500,
        notes: [],
      },
    },
  };
}

describe("riskGateInputBuilder.applyOutput", () => {
  it("converts wait-for-open rejection into a skip decision instead of throwing", () => {
    const next = riskGateInputBuilder.applyOutput?.(baseState(), {
      allowed: false,
      reason: WAIT_FOR_OPEN_REJECTION_REASON,
    });

    expect(next?.decision?.output.action).toBe("skip");
    expect(next?.decision?.output.reasoning).toBe(
      WAIT_FOR_OPEN_REJECTION_REASON,
    );
    expect(next?.riskOrder).toBeUndefined();
    expect(next?.brokerAllocation).toBeUndefined();
  });

  it("maps concurrent-trade cap to a session-capacity outcome", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Maximum concurrent trades reached",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "session_capacity",
        reasonCategory: "session_capacity",
      });
    }
  });

  it("maps spend guardrails to operator-required outcomes via gateType", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Daily API budget reached",
        gateType: "api_budget",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
  });

  it("maps spend guardrails to operator-required outcomes", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Daily API budget reached",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
  });

  it("stores the risk order when allowed", () => {
    const order = {
      instrumentSymbol: "ETH",
      instrumentDisplayName: null,
      predictionOutcome: null,
      instrumentMetadataJson: null,
      instrumentType: "crypto" as const,
      side: "BUY" as const,
      sizeUsd: 500,
    };
    const next = riskGateInputBuilder.applyOutput?.(baseState(), {
      allowed: true,
      value: order,
    });

    expect(next?.riskOrder).toEqual(order);
    expect(next?.decision?.output.action).toBe("buy");
  });
});

describe("riskGateInputBuilder.build economics", () => {
  function buildContext(opts?: {
    confidence?: number;
    riskConfig?: Record<string, unknown>;
    getOhlcv?: () => Promise<unknown[]>;
  }) {
    const upsertFragment = vi.fn();
    const bars = Array.from({ length: 15 }, (_, index) => ({
      ts: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 1_000,
    }));
    const getOhlcv = vi.fn(opts?.getOhlcv ?? (async () => bars));
    const state = baseState();
    if (!state.decision || !state.executionProfile) {
      throw new Error(
        "test fixture must include decision and execution profile",
      );
    }
    state.decision.output.confidence = opts?.confidence ?? 0.65;
    state.executionProfile.stopLossPct = null;
    state.executionProfile.takeProfitPct = null;
    state.quoteSnapshot = { price: 100, timestamp: "2026-01-15T00:00:00.000Z" };
    return {
      state,
      upsertFragment,
      getOhlcv,
      planCtx: {
        sessionId: "session-1",
        cycleId: "cycle-1",
        instrument: { symbol: "SPY", instrumentClass: "stock" },
        strategyContext: {
          riskConfig: {
            maxPositionUsd: 500,
            maxExposureUsd: null,
            maxAiSpendUsd: 5,
            kellyFraction: 0.25,
            stopLossPct: null,
            takeProfitPct: null,
            stopLossType: "trailing_atr",
            atrStopMultiplier: 2,
            calendarBlackoutHours: null,
            volatilityHaltMaxSpreadPct: null,
            waitForOpenThreshold: 0.8,
            ...opts?.riskConfig,
          },
          timeframe: { holdingStyle: "multi_day_swing" },
        },
        services: {
          brokerRouting: {
            resolveAdapter: vi.fn().mockResolvedValue({
              adapter: { brokerType: "mock", getOhlcv },
            }),
          },
          instrumentNormalizer: { toBrokerSymbol: vi.fn(() => "SPY") },
          statsRepo: { dashboardStats: vi.fn(() => ({})) },
          sessionRepo: {
            getStatus: vi.fn(() => "running"),
            requireById: vi.fn(() => ({
              experienceId: "rules-mean-reversion",
            })),
            uptimeMin: vi.fn(() => 1),
          },
          sessionBrokerAssignmentsRepo: { listAssignments: vi.fn(() => []) },
          tradesRepo: { listOpenAndPending: vi.fn(() => []) },
          decisionTracesRepo: { upsertFragment },
        },
      },
    };
  }

  it("derives ATR stop/target, clears the cost floor, and traces proxy-2", async () => {
    const fixture = buildContext();
    const built = await riskGateInputBuilder.build({
      planCtx: fixture.planCtx as never,
      state: fixture.state,
    });

    expect(
      (built.task as { order: { sizeUsd: number } }).order.sizeUsd,
    ).toBeLessThanOrEqual(500);
    expect(fixture.getOhlcv).toHaveBeenCalledWith("SPY", "1h", 30);
    expect(fixture.upsertFragment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        edgeEstimate: expect.objectContaining({
          modelVersion: "proxy-2",
          expectedGrossReturnBps: 240,
        }),
        effectiveRisk: {
          stopLossPct: 8,
          takeProfitPct: 8,
          derivation: "atr_derived",
        },
      }),
    );
  });

  it("still rejects a coin-flip ATR setup after costs", async () => {
    const fixture = buildContext({ confidence: 0.5 });

    await expect(
      riskGateInputBuilder.build({
        planCtx: fixture.planCtx as never,
        state: fixture.state,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Net edge -3bps below floor 0bps"),
    });
  });

  it("keeps explicit stop/target values and falls back when ATR data fails", async () => {
    const explicit = buildContext({
      riskConfig: { stopLossPct: 2, takeProfitPct: 4 },
    });
    await riskGateInputBuilder.build({
      planCtx: explicit.planCtx as never,
      state: explicit.state,
    });
    expect(explicit.getOhlcv).not.toHaveBeenCalled();
    expect(explicit.upsertFragment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        effectiveRisk: {
          stopLossPct: 2,
          takeProfitPct: 4,
          derivation: "explicit",
        },
        edgeEstimate: expect.objectContaining({ expectedGrossReturnBps: 190 }),
      }),
    );

    const fallback = buildContext({
      getOhlcv: async () => {
        throw new Error("feed unavailable");
      },
    });
    await riskGateInputBuilder.build({
      planCtx: fallback.planCtx as never,
      state: fallback.state,
    });
    expect(fallback.upsertFragment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        effectiveRisk: {
          stopLossPct: 2,
          takeProfitPct: 2,
          derivation: "default_fallback",
        },
      }),
    );
  });
});
