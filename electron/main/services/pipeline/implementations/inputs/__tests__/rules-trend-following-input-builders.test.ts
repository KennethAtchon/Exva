import { describe, expect, it, vi } from "vitest";
import { rulesTrendFollowingInputBuilder } from "../rules-trend-following-input-builders";

describe("rulesTrendFollowingInputBuilder", () => {
  it("maps cadence metadata to the expected timeframe and bar count", async () => {
    const getOhlcv = vi.fn().mockResolvedValue([{ close: 50 }, { close: 52 }]);
    const built = await rulesTrendFollowingInputBuilder.build({
      planCtx: {
        sessionId: "s1",
        instrument: {
          symbol: "BTC",
          instrumentClass: "crypto",
          instrumentMetadataJson: JSON.stringify({
            pollCadence: "4h",
            analysisTimeframe: "4h",
          }),
        },
        services: {
          brokerRouting: {
            resolveAdapter: vi.fn().mockResolvedValue({
              adapter: {
                brokerType: "mock",
                getOhlcv,
              },
            }),
          },
          instrumentNormalizer: {
            toBrokerSymbol: vi.fn().mockReturnValue("BTCUSD"),
          },
        },
      } as never,
      state: {} as never,
    });

    const task = built.task as {
      symbol: string;
      lookback: number;
      ohlcv: Array<{ close: number }>;
    };
    expect(task.symbol).toBe("BTC");
    expect(task.lookback).toBe(20);
    expect(task.ohlcv).toEqual([{ close: 50 }, { close: 52 }]);
    expect(getOhlcv).toHaveBeenCalledWith("BTCUSD", "4h", 30);
  });

  it("stores deterministic decision output in state", () => {
    const signal = {
      symbol: "BTC",
      action: "buy" as const,
      executionStrategy: "trend_following" as const,
      entryPrice: null,
      confidence: 0.65,
      reasoning: "Uptrend continuation.",
    };

    const next = rulesTrendFollowingInputBuilder.applyOutput?.(
      {} as never,
      signal,
    );

    expect(next?.decision?.output).toEqual(signal);
    expect(next?.decision?.run.provider_key).toBe("rules");
  });
});
