import { describe, expect, it } from "vitest";
import {
  buildToolStepSignature,
  canonicalizeToolInput,
} from "../tool-loop-guard";

describe("canonicalizeToolInput", () => {
  it("get_ohlcv includes timeframe and instrumentClass in signature", () => {
    const sig1h = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    const sig4h = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "4h",
      instrumentClass: "crypto",
    });
    expect(sig1h).not.toBe(sig4h);
    expect(sig1h).toBe("ETH:crypto:1h");
  });

  it("get_ohlcv same timeframe produces identical signatures (loop detection still works)", () => {
    const a = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    const b = canonicalizeToolInput("get_ohlcv", {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    });
    expect(a).toBe(b);
  });

  it("get_quote still uses symbol-only signature", () => {
    const sig = canonicalizeToolInput("get_quote", {
      symbol: "ETH",
      instrumentClass: "crypto",
    });
    expect(sig).toBe("ETH");
  });

  it("get_ohlcv with 3 different timeframes produces 3 distinct signatures", () => {
    const timeframes = ["1h", "4h", "1d"];
    const signatures = timeframes.map((timeframe) =>
      canonicalizeToolInput("get_ohlcv", {
        symbol: "ETH",
        timeframe,
        instrumentClass: "crypto",
      }),
    );
    expect(new Set(signatures).size).toBe(3);
  });
});

describe("verify tool loop detection", () => {
  function verifyCallsWouldStop(
    calls: Array<{ toolName: string; input: unknown }>,
  ): boolean {
    const recentCalls = calls
      .slice(-6)
      .map((call) => ({
        toolName: call.toolName,
        signature: canonicalizeToolInput(call.toolName, call.input),
      }));
    const verifyCalls = recentCalls.filter(
      (call) =>
        call.toolName === "get_quote" ||
        call.toolName === "get_news" ||
        call.toolName === "get_ohlcv",
    );
    return (
      verifyCalls.length >= 4 &&
      new Set(verifyCalls.map((call) => call.signature)).size === 1
    );
  }

  it("get_quote + 3x get_ohlcv different timeframes does NOT stop", () => {
    const calls = [
      { toolName: "get_quote", input: { symbol: "ETH", instrumentClass: "crypto" } },
      {
        toolName: "get_ohlcv",
        input: { symbol: "ETH", timeframe: "1h", instrumentClass: "crypto" },
      },
      {
        toolName: "get_ohlcv",
        input: { symbol: "ETH", timeframe: "4h", instrumentClass: "crypto" },
      },
      {
        toolName: "get_ohlcv",
        input: { symbol: "ETH", timeframe: "1d", instrumentClass: "crypto" },
      },
    ];
    expect(verifyCallsWouldStop(calls)).toBe(false);
    expect(
      new Set(calls.map((call) => canonicalizeToolInput(call.toolName, call.input)))
        .size,
    ).toBe(4);
  });

  it("4x get_ohlcv same timeframe DOES stop (genuine loop)", () => {
    const input = { symbol: "ETH", timeframe: "1h", instrumentClass: "crypto" };
    const calls = Array.from({ length: 4 }, () => ({
      toolName: "get_ohlcv",
      input,
    }));
    expect(verifyCallsWouldStop(calls)).toBe(true);
  });

  it("get_quote + 3x get_ohlcv same timeframe does NOT stop (not size===1)", () => {
    const ohlcvInput = {
      symbol: "ETH",
      timeframe: "1h",
      instrumentClass: "crypto",
    };
    const calls = [
      { toolName: "get_quote", input: { symbol: "ETH", instrumentClass: "crypto" } },
      { toolName: "get_ohlcv", input: ohlcvInput },
      { toolName: "get_ohlcv", input: ohlcvInput },
      { toolName: "get_ohlcv", input: ohlcvInput },
    ];
    expect(verifyCallsWouldStop(calls)).toBe(false);
    expect(
      new Set(
        calls.map((call) => canonicalizeToolInput(call.toolName, call.input)),
      ).size,
    ).toBe(2);
  });
});

describe("buildToolStepSignature", () => {
  it("distinguishes multi-timeframe get_ohlcv calls within one step", () => {
    const signature = buildToolStepSignature({
      toolCalls: [
        {
          toolName: "get_quote",
          input: { symbol: "ETH", instrumentClass: "crypto" },
        },
        {
          toolName: "get_ohlcv",
          input: { symbol: "ETH", timeframe: "1h", instrumentClass: "crypto" },
        },
        {
          toolName: "get_ohlcv",
          input: { symbol: "ETH", timeframe: "4h", instrumentClass: "crypto" },
        },
        {
          toolName: "get_ohlcv",
          input: { symbol: "ETH", timeframe: "1d", instrumentClass: "crypto" },
        },
      ],
    } as never);
    expect(signature).toContain("get_ohlcv:ETH:crypto:1h");
    expect(signature).toContain("get_ohlcv:ETH:crypto:4h");
    expect(signature).toContain("get_ohlcv:ETH:crypto:1d");
  });
});
