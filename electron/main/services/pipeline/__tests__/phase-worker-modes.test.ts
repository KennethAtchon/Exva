import { describe, expect, it } from "vitest";
import { DECISION_PHASE } from "../definitions/decision.phase";
import { FUNDAMENTAL_PHASE } from "../definitions/fundamental.phase";
import { REVIEW_PHASE } from "../definitions/review.phase";
import { SELECTOR_PHASE } from "../definitions/selector.phase";
import { TECHNICAL_PHASE } from "../definitions/technical.phase";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";

function requireWorkers(
  resolver:
    | ((
        mode: "trend_scan" | "event_contract_scan",
      ) => readonly WorkerDefinition[])
    | undefined,
  mode: "trend_scan" | "event_contract_scan",
): readonly WorkerDefinition[] {
  if (!resolver) {
    throw new Error(`Expected resolveWorkersForMode for ${mode}`);
  }
  return resolver(mode);
}

describe("phase worker discovery modes", () => {
  it("uses standard selector scouts by default", () => {
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "trend_scan",
    );
    expect(workers.map((w) => w.id)).toEqual(["web-scout", "trend-scout"]);
  });

  it("declares strategy context for standard selector scouts", () => {
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "trend_scan",
    );
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
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "event_contract_scan",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "event-web-scout",
      "event-prediction-scout",
    ]);
  });

  it("swaps technical workers for event_contract_scan", () => {
    const workers = requireWorkers(
      TECHNICAL_PHASE.resolveWorkersForMode,
      "event_contract_scan",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "implied-probability",
      "price-drift",
      "event-liquidity",
    ]);
  });

  it("swaps fundamental workers for event_contract_scan", () => {
    const workers = requireWorkers(
      FUNDAMENTAL_PHASE.resolveWorkersForMode,
      "event_contract_scan",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "resolution-context",
      "event-catalyst",
      "event-sentiment",
    ]);
  });

  it("review workers are mode-invariant", () => {
    const standard = requireWorkers(
      REVIEW_PHASE.resolveWorkersForMode,
      "trend_scan",
    );
    const event = requireWorkers(
      REVIEW_PHASE.resolveWorkersForMode,
      "event_contract_scan",
    );
    expect(standard.map((w) => w.id)).toEqual(event.map((w) => w.id));
    expect(standard.map((w) => w.id)).toEqual([
      "conflict-detector",
      "risk-assessor",
    ]);
  });

  it("decision workers are mode-invariant", () => {
    const standard = requireWorkers(
      DECISION_PHASE.resolveWorkersForMode,
      "trend_scan",
    );
    const event = requireWorkers(
      DECISION_PHASE.resolveWorkersForMode,
      "event_contract_scan",
    );
    expect(standard.map((w) => w.id)).toEqual(event.map((w) => w.id));
    expect(standard.map((w) => w.id)).toEqual([
      "signal-classifier",
      "entry-timer",
    ]);
  });
});
