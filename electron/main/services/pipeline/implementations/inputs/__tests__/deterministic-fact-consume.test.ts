import { describe, expect, it, vi } from "vitest";
import type { DeterministicSignalFactV1 } from "@electron/shared/domain/deterministic-signal-fact";
import {
  isPrecomputedTradeSignal,
  readDeterministicFactFromCtx,
  tradeSignalFromDeterministicFact,
} from "../deterministic-fact-consume";
import { rulesMeanReversionInputBuilder } from "../rules-engine-input-builders";
import { rulesBreakoutInputBuilder } from "../rules-breakout-input-builders";

function sampleFact(
  overrides: Partial<DeterministicSignalFactV1> = {},
): DeterministicSignalFactV1 {
  return {
    schemaVersion: 1,
    signalId: "sig-1",
    originKind: "strategy",
    sessionInputGroupKey: "g1",
    strategyId: "mean-reversion",
    strategyImplementationVersion: 1,
    strategyParameters: { zScoreEntry: -2.5, timeframe: "4h" },
    symbol: "SPY",
    instrumentClass: "stock",
    timeframe: "4h",
    evaluatedAt: "2026-07-29T15:00:00.000Z",
    newestBarTs: "2026-07-29T14:00:00.000Z",
    barWindowHash: "abc123hash",
    action: "buy",
    strength: 0.72,
    evidence: { zScore: -2.6 },
    lifecycle: {
      initialStopPrice: 500,
      firstTarget: { price: 510, closeFraction: 0.5 },
      sessionEndTs: "2026-07-29T20:00:00.000Z",
      sameBarPriority: "stop_before_target",
    },
    ...overrides,
  };
}

describe("deterministic fact consumption", () => {
  it("reads fact from instrument metadata and synthesizes TradeSignal", () => {
    const fact = sampleFact();
    const ctx = {
      instrument: {
        symbol: "SPY",
        instrumentMetadataJson: JSON.stringify({
          analysisTimeframe: "4h",
          deterministicFact: fact,
        }),
      },
    } as never;

    expect(readDeterministicFactFromCtx(ctx)?.signalId).toBe("sig-1");
    const signal = tradeSignalFromDeterministicFact(fact, "mean_reversion");
    expect(signal.action).toBe("buy");
    expect(signal.strength).toBe(0.72);
    expect(signal.orderMetadata?.timeframe).toBe("4h");
    expect(signal.orderMetadata?.lifecycle).toEqual(fact.lifecycle);
    expect(signal.orderMetadata?.barWindowHash).toBe("abc123hash");
    expect(isPrecomputedTradeSignal(signal)).toBe(true);
  });

  it("mean-reversion builder skips OHLCV when fact is present", async () => {
    const fact = sampleFact();
    const getOhlcv = vi.fn();
    const built = await rulesMeanReversionInputBuilder.build({
      planCtx: {
        sessionId: "s1",
        cycleId: "c1",
        instrument: {
          symbol: "SPY",
          instrumentClass: "stock",
          instrumentMetadataJson: JSON.stringify({ deterministicFact: fact }),
        },
        services: {
          brokerRouting: {
            resolveAdapter: vi.fn().mockResolvedValue({
              adapter: { brokerType: "alpaca", getOhlcv },
            }),
          },
          instrumentNormalizer: { toBrokerSymbol: vi.fn() },
        },
      } as never,
      state: {} as never,
    });

    expect(getOhlcv).not.toHaveBeenCalled();
    const task = built.task as { action: string; orderMetadata: { barWindowHash: string } };
    expect(task.action).toBe("buy");
    expect(task.orderMetadata.barWindowHash).toBe("abc123hash");
  });

  it("digest change produces a distinct precomputed intent", async () => {
    const a = sampleFact({ barWindowHash: "hash-a", signalId: "a" });
    const b = sampleFact({ barWindowHash: "hash-b", signalId: "b" });
    const build = (fact: DeterministicSignalFactV1) =>
      rulesBreakoutInputBuilder.build({
        planCtx: {
          sessionId: "s1",
          instrument: {
            symbol: "SPY",
            instrumentClass: "stock",
            instrumentMetadataJson: JSON.stringify({ deterministicFact: fact }),
          },
          services: {},
        } as never,
        state: {} as never,
      });

    const left = await build(a);
    const right = await build(b);
    expect(
      (left.task as { orderMetadata: { barWindowHash: string } }).orderMetadata
        .barWindowHash,
    ).not.toBe(
      (right.task as { orderMetadata: { barWindowHash: string } }).orderMetadata
        .barWindowHash,
    );
  });

  it("scheduler action cannot disagree with synthesized downstream action", () => {
    const fact = sampleFact({ action: "sell" });
    const signal = tradeSignalFromDeterministicFact(fact, "breakout");
    expect(signal.action).toBe(fact.action);
  });
});
