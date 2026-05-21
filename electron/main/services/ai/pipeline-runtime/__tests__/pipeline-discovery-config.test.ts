import { describe, expect, it } from "vitest";
import {
  fundamentalWorkersForMode,
  selectorDiscoveryWorkersForMode,
  technicalWorkersForMode,
} from "../pipeline-discovery-config";

describe("pipeline-discovery-config", () => {
  it("uses standard selector scouts by default", () => {
    const workers = selectorDiscoveryWorkersForMode("trend_scan");
    expect(workers.map((w) => w.id)).toEqual([
      "web-scout",
      "reddit-scout",
      "trend-scout",
    ]);
  });

  it("declares strategy context for standard selector scouts", () => {
    const workers = selectorDiscoveryWorkersForMode("trend_scan");
    for (const worker of workers) {
      expect(worker.strategyContext?.fields).toEqual(
        expect.arrayContaining([
          "researchPosture",
          "tradeRules",
          "riskLimits",
          "timeframe",
          "presetBehavior",
        ]),
      );
      expect(worker.strategyContext?.guidance).toEqual(
        expect.arrayContaining(["whatToLookFor", "howToEvaluate", "avoid"]),
      );
    }
  });

  it("swaps selector scouts for event_contract_scan", () => {
    const workers = selectorDiscoveryWorkersForMode("event_contract_scan");
    expect(workers.map((w) => w.id)).toEqual([
      "event-web-scout",
      "event-prediction-scout",
    ]);
  });

  it("swaps technical workers for event_contract_scan", () => {
    const workers = technicalWorkersForMode("event_contract_scan");
    expect(workers.map((w) => w.id)).toEqual([
      "implied-probability",
      "price-drift",
      "event-liquidity",
    ]);
  });

  it("swaps fundamental workers for event_contract_scan", () => {
    const workers = fundamentalWorkersForMode("event_contract_scan");
    expect(workers.map((w) => w.id)).toEqual([
      "resolution-context",
      "event-catalyst",
      "event-sentiment",
    ]);
  });
});
