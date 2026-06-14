import { describe, expect, it } from "vitest";
import { MockSignalSource } from "../mock-signal-source";

describe("MockSignalSource", () => {
  it("fires deterministic mock 8-K style signals", async () => {
    const source = new MockSignalSource(
      "mock-1",
      JSON.stringify({
        ticker: "TSLA",
        companyName: "Tesla Inc (fixture)",
        instrumentClass: "stock",
      }),
    );
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));

    const result = await source.test();

    expect(result).toEqual({ detected: 1, passed: 1, dropped: 0, errors: [] });
    expect(events[0]).toMatchObject({
      sourceId: "mock-1",
      sourceType: "mock",
      ticker: "TSLA",
      companyName: "Tesla Inc (fixture)",
      payloadJson: {
        itemCodes: ["1.01", "8.01"],
        scripted: true,
        instrumentClass: "stock",
        summary: expect.any(String),
      },
      documentUrl: "https://mock.exva.test/8k/TSLA",
    });
  });

  it("restarts with updated ticker config", async () => {
    const source = new MockSignalSource(
      "mock-2",
      JSON.stringify({ ticker: "NVDA" }),
    );

    await source.restart({ ticker: "AMD", instrumentClass: "stock" });
    const events: unknown[] = [];
    source.onSignal((event) => events.push(event));
    await source.fireOnce();

    expect(events[0]).toMatchObject({
      ticker: "AMD",
      payloadJson: expect.objectContaining({ instrumentClass: "stock" }),
    });
    expect(source.status).toBe("running");
  });
});
