import { describe, expect, it, vi } from "vitest";
import { rulesMeanReversionInputBuilder } from "../rules-engine-input-builders";

describe("rulesMeanReversionInputBuilder", () => {
  it("builds OHLCV task input from broker adapter data", async () => {
    const getOhlcv = vi
      .fn()
      .mockResolvedValue([{ close: 100 }, { close: 98 }, { close: 96 }]);
    const built = await rulesMeanReversionInputBuilder.build({
      planCtx: {
        sessionId: "s1",
        instrument: {
          symbol: "ETH",
          instrumentClass: "crypto",
          instrumentMetadataJson: JSON.stringify({ cadence: "15m" }),
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
            toBrokerSymbol: vi.fn().mockReturnValue("ETHUSD"),
          },
        },
      } as never,
      state: {} as never,
    });

    const task = built.task as {
      symbol: string;
      ohlcv: Array<{ close: number }>;
      zScoreEntry: number;
    };
    expect(task.symbol).toBe("ETH");
    expect(task.ohlcv).toEqual([{ close: 100 }, { close: 98 }, { close: 96 }]);
    expect(task.zScoreEntry).toBe(-2);
    expect(getOhlcv).toHaveBeenCalledWith("ETHUSD", "15m", 40);
  });

  it("stores deterministic decision output in state", () => {
    const signal = {
      symbol: "ETH",
      action: "buy" as const,
      executionStrategy: "mean_reversion" as const,
      entryPrice: null,
      confidence: 0.7,
      reasoning: "Oversold bounce.",
    };

    const next = rulesMeanReversionInputBuilder.applyOutput?.(
      {} as never,
      signal,
    );

    expect(next?.decision?.output).toEqual(signal);
    expect(next?.decision?.run.provider_key).toBe("rules");
  });
});
