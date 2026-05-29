import { describe, expect, it } from "vitest";
import { DECISION_PHASE } from "../definitions/decision.phase";
import { FUNDAMENTAL_PHASE } from "../definitions/fundamental.phase";
import { REVIEW_PHASE } from "../definitions/review.phase";
import { SELECTOR_PHASE } from "../definitions/selector.phase";
import { TECHNICAL_PHASE } from "../definitions/technical.phase";
import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";

function requireWorkers(
  resolver:
    | ((mode: "catalyst" | "contract") => readonly WorkerDefinition[])
    | undefined,
  mode: "catalyst" | "contract",
): readonly WorkerDefinition[] {
  if (!resolver) {
    throw new Error(`Expected resolveWorkersForMode for ${mode}`);
  }
  return resolver(mode);
}

describe("phase worker processing modes", () => {
  it("uses standard selector scouts by default", () => {
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "catalyst",
    );
    expect(workers.map((w) => w.id)).toEqual(["catalyst-feed-scout"]);
  });

  it("declares strategy context for standard selector scouts", () => {
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "catalyst",
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

  it("swaps selector scouts for contract mode", () => {
    const workers = requireWorkers(
      SELECTOR_PHASE.resolveWorkersForMode,
      "contract",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "event-web-scout",
      "event-prediction-scout",
    ]);
  });

  it("swaps technical workers for contract mode", () => {
    const workers = requireWorkers(
      TECHNICAL_PHASE.resolveWorkersForMode,
      "contract",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "implied-probability",
      "price-drift",
      "event-liquidity",
    ]);
  });

  it("uses catalyst technical workers for catalyst mode", () => {
    const workers = requireWorkers(
      TECHNICAL_PHASE.resolveWorkersForMode,
      "catalyst",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "price-reaction-checker",
      "volume-profile",
    ]);
  });

  it("swaps fundamental workers for contract mode", () => {
    const workers = requireWorkers(
      FUNDAMENTAL_PHASE.resolveWorkersForMode,
      "contract",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "resolution-context",
      "event-catalyst",
      "event-sentiment",
    ]);
  });

  it("uses catalyst fundamental workers for catalyst mode", () => {
    const workers = requireWorkers(
      FUNDAMENTAL_PHASE.resolveWorkersForMode,
      "catalyst",
    );
    expect(workers.map((w) => w.id)).toEqual([
      "document-extractor",
      "market-reaction-checker",
    ]);
  });

  it("review workers are mode-invariant", () => {
    const standard = requireWorkers(
      REVIEW_PHASE.resolveWorkersForMode,
      "catalyst",
    );
    const event = requireWorkers(
      REVIEW_PHASE.resolveWorkersForMode,
      "contract",
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
      "catalyst",
    );
    const event = requireWorkers(
      DECISION_PHASE.resolveWorkersForMode,
      "contract",
    );
    expect(standard.map((w) => w.id)).toEqual(event.map((w) => w.id));
    expect(standard.map((w) => w.id)).toEqual([
      "signal-classifier",
      "entry-timer",
    ]);
  });
});
