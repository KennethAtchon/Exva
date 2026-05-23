import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_RISK_RULE_SET,
  DEFAULT_SCORING_WEIGHTS,
  phaseSpendCapUsd,
} from "@electron/shared/ai/pipeline-config";

describe("pipeline-config", () => {
  it("exposes default scoring weights summing to 1", () => {
    const sum =
      DEFAULT_SCORING_WEIGHTS.hype +
      DEFAULT_SCORING_WEIGHTS.volume +
      DEFAULT_SCORING_WEIGHTS.catalyst +
      DEFAULT_SCORING_WEIGHTS.liquidity;
    expect(sum).toBeCloseTo(1, 5);
  });

  it("defines spend caps for every phase", () => {
    for (const phase of [
      "selector",
      "technical",
      "fundamental",
      "review",
      "decision",
    ] as const) {
      expect(phaseSpendCapUsd(phase)).toBeGreaterThan(0);
      expect(DEFAULT_PIPELINE_CONFIG.phases[phase].phaseSpendCapUsd).toBe(
        phaseSpendCapUsd(phase),
      );
    }
  });

  it("defines selector risk rules", () => {
    expect(DEFAULT_RISK_RULE_SET.minFinalScore).toBeGreaterThan(0);
  });
});
