import { describe, expect, it, vi } from "vitest";
import { ohlcvDataProbeCheck } from "./ohlcv-data-probe-check";

const session = { id: "session-1" } as const;

function bars(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: `2026-06-12T0${i}:00:00Z`,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));
}

function depsWith(opts: {
  source: Record<string, unknown> | null;
  getOhlcv?: ReturnType<typeof vi.fn>;
  resolveThrows?: boolean;
  warn?: ReturnType<typeof vi.fn>;
}) {
  const warn = opts.warn ?? vi.fn();
  return {
    deps: {
      signalSourcesRepo: {
        subscribedSourceIdsForSession: () => ["src-1"],
        get: () => opts.source,
      },
      brokerRouting: {
        resolveAdapter: opts.resolveThrows
          ? vi.fn().mockRejectedValue(new Error("no broker"))
          : vi.fn().mockResolvedValue({
              adapter: { brokerType: "alpaca", getOhlcv: opts.getOhlcv },
            }),
      },
      instrumentNormalizer: {
        toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
      },
      logger: { warn },
    } as never,
    warn,
  };
}

const stockSource = {
  name: "SPY mean-rev",
  instrumentClass: "stock",
  analysisTimeframe: "1h",
  configJson: JSON.stringify({ symbol: "SPY" }),
};

describe("ohlcvDataProbeCheck", () => {
  it("warns when the feed returns fewer than 20 bars (the silent-starvation bug)", async () => {
    const getOhlcv = vi.fn().mockResolvedValue(bars(0));
    const { deps, warn } = depsWith({ source: stockSource, getOhlcv });

    const result = await ohlcvDataProbeCheck(session as never, deps);

    expect(result).toEqual({ ok: true }); // warn-only, never blocks
    expect(getOhlcv).toHaveBeenCalledWith("SPY", "1h", 30);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][1]).toContain("insufficient bars");
  });

  it("stays silent when the feed returns a healthy window", async () => {
    const getOhlcv = vi.fn().mockResolvedValue(bars(30));
    const { deps, warn } = depsWith({ source: stockSource, getOhlcv });

    const result = await ohlcvDataProbeCheck(session as never, deps);

    expect(result).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips prediction-market sources (they do not trade on OHLCV bars)", async () => {
    const getOhlcv = vi.fn();
    const { deps, warn } = depsWith({
      source: {
        name: "Prediction",
        instrumentClass: "prediction_market",
        analysisTimeframe: "1h",
        configJson: "{}",
      },
      getOhlcv,
    });

    await ohlcvDataProbeCheck(session as never, deps);

    expect(getOhlcv).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips selector-driven sources that have no fixed symbol", async () => {
    const getOhlcv = vi.fn();
    const { deps } = depsWith({
      source: { ...stockSource, configJson: "{}" },
      getOhlcv,
    });

    await ohlcvDataProbeCheck(session as never, deps);

    expect(getOhlcv).not.toHaveBeenCalled();
  });

  it("does not block when broker resolution fails (covered by other checks)", async () => {
    const { deps, warn } = depsWith({
      source: stockSource,
      resolveThrows: true,
    });

    const result = await ohlcvDataProbeCheck(session as never, deps);

    expect(result).toEqual({ ok: true });
    expect(warn).not.toHaveBeenCalled();
  });
});
