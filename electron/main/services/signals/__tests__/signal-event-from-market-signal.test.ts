import { describe, expect, it } from "vitest";
import type { MarketSignal } from "@electron/shared/domain/market-signal";
import {
  assertCompleteSignalEvent,
  signalEventFromMarketSignal,
} from "../signal-event-from-market-signal";
import type { SignalEvent } from "@electron/shared/domain";

describe("signalEventFromMarketSignal", () => {
  it("projects MarketSignal fields into a complete SignalEvent", () => {
    const signal: MarketSignal = {
      id: "ms-1",
      sourceId: "src-1",
      kind: "filing",
      instrumentClass: "stock",
      symbols: ["AAPL"],
      occurredAt: "2026-07-11T10:00:00.000Z",
      detectedAt: "2026-07-11T10:05:00.000Z",
      ttl: "PT6H",
      dedupeKey: "0000320193-26-000001",
      provenance: { url: "https://sec.gov/filing" },
      payload: {
        filingType: "8-K",
        accessionNumber: "0000320193-26-000001",
        itemCodes: ["2.02"],
        companyName: "Apple",
        documentUrl: "https://sec.gov/filing",
        filedAt: "2026-07-11T10:00:00.000Z",
      },
    };

    const event = signalEventFromMarketSignal(signal, "edgar_8k");
    expect(event).toMatchObject({
      id: "ms-1",
      sourceId: "src-1",
      sourceType: "edgar_8k",
      ticker: "AAPL",
      companyName: "Apple",
      accessionNumber: "0000320193-26-000001",
      kind: "filing",
      dedupeKey: "0000320193-26-000001",
      ttl: "PT6H",
      occurredAt: "2026-07-11T10:00:00.000Z",
    });
    expect(event.payloadJson.instrumentClass).toBe("stock");
    expect(event.payloadV2).toBeUndefined();
  });
});

describe("assertCompleteSignalEvent", () => {
  it("throws when envelope fields are missing", () => {
    const incomplete = {
      id: "bad",
      sourceId: "s",
      sourceType: "manual",
      ticker: "SPY",
      companyName: null,
      documentUrl: null,
      accessionNumber: null,
      payloadJson: {},
      filedAt: "2026-07-11T10:00:00.000Z",
      detectedAt: "2026-07-11T10:00:00.000Z",
    } as unknown as SignalEvent;

    expect(() => assertCompleteSignalEvent(incomplete)).toThrow(
      /Incomplete SignalEvent/,
    );
  });
});
