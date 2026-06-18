import { afterEach, describe, expect, it, vi } from "vitest";
import { TimerSignalSource } from "../timer-signal-source";

describe("TimerSignalSource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires symbol and cadence in config", () => {
    expect(() => new TimerSignalSource("timer-bad", "{}")).toThrow(
      /requires symbol and cadence/,
    );
  });

  it("emits a timer tick with instrument metadata", async () => {
    const source = new TimerSignalSource(
      "timer-1",
      JSON.stringify({
        symbol: "SPY",
        cadence: "15m",
        instrumentClass: "stock",
      }),
    );
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    const result = await source.test();

    expect(result).toEqual({ detected: 1, passed: 1, dropped: 0, errors: [] });
    expect(events[0]).toMatchObject({
      sourceId: "timer-1",
      sourceType: "timer",
      ticker: "SPY",
      payloadJson: {
        cadence: "15m",
        instrumentClass: "stock",
        barCloseAt: expect.any(String),
      },
    });
    expect(source.snapshot().lastSignalTicker).toBe("SPY");
  });

  it("starts and stops interval ticks", async () => {
    vi.useFakeTimers();
    const source = new TimerSignalSource(
      "timer-2",
      JSON.stringify({ symbol: "QQQ", cadence: "15m", intervalMs: 1000 }),
    );
    let tickCount = 0;
    source.onSignal(() => {
      tickCount += 1;
    });

    await source.start();
    expect(source.status).toBe("running");
    expect(tickCount).toBe(1);

    await vi.advanceTimersByTimeAsync(2500);
    expect(tickCount).toBeGreaterThanOrEqual(2);

    await source.stop();
    expect(source.status).toBe("paused");
  });

  it("exposes nextFireAt while running and clears it on stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T00:00:00.000Z"));
    const source = new TimerSignalSource(
      "timer-3",
      JSON.stringify({ symbol: "SPY", cadence: "15m", intervalMs: 60_000 }),
    );

    // nextFireAt is anchored to the last fire + intervalMs.
    await source.start();
    expect(source.snapshot().nextFireAt).toBe("2026-06-17T00:01:00.000Z");

    // It advances on each subsequent tick.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(source.snapshot().nextFireAt).toBe("2026-06-17T00:02:00.000Z");

    // Stopping clears the schedule so the card shows no countdown.
    await source.stop();
    expect(source.snapshot().nextFireAt).toBeNull();
  });
});
