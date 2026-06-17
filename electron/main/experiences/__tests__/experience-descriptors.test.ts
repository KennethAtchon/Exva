import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import { describeExperienceSteps, validateExperienceRegistry } from "../index";
import {
  registerPipeline,
  requirePipelineDescriptor,
} from "../../services/pipeline/implementations/registry/pipeline-router";
import { ALL_PIPELINES } from "../../services/pipeline/implementations/registry/pipelines";
import { signalDisplayName } from "@electron/shared/domain/signal-descriptor";
import { loadExperiencePresetBundle } from "../session-bootstrap";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "../prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";
import { RULES_TREND_FOLLOWING_EXPERIENCE } from "../rules-trend-following/descriptor";
import { RULES_BREAKOUT_EXPERIENCE } from "../rules-breakout/descriptor";
import type { ExperienceDescriptor } from "../types";

beforeAll(() => {
  for (const p of ALL_PIPELINES) {
    try {
      registerPipeline(p);
    } catch {
      /* already registered in this worker */
    }
  }
});

type DescriptorContract = {
  experience: ExperienceDescriptor;
  id: string;
  displayName: string;
  pipelineId: string;
  signalIds: string[];
  instrumentClasses: ExperienceDescriptor["capabilities"]["instrumentClasses"];
  signalSourceTypes: ExperienceDescriptor["capabilities"]["signalSourceTypes"];
  brokerRequirement: ExperienceDescriptor["capabilities"]["brokerRequirement"];
  defaultPresets: ExperienceDescriptor["defaultPresets"];
};

const SHIPPED_DESCRIPTOR_CONTRACTS: DescriptorContract[] = [
  {
    experience: EDGAR_CATALYST_EXPERIENCE,
    id: "edgar-catalyst",
    displayName: "EDGAR Catalyst",
    pipelineId: "edgar-8k-cycle",
    signalIds: ["edgar-8k-catalyst"],
    instrumentClasses: ["stock"],
    signalSourceTypes: ["edgar_8k"],
    brokerRequirement: "any_supported_class",
    defaultPresets: {
      posturePresetId: "edgar_catalyst",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "catalyst",
    },
  },
  {
    experience: RULES_MEAN_REVERSION_EXPERIENCE,
    id: "rules-mean-reversion",
    displayName: "Rules: Mean Reversion",
    pipelineId: "rules-mean-reversion-cycle",
    signalIds: ["spy-15m-meanrev", "qqq-15m-meanrev"],
    instrumentClasses: ["stock"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultPresets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
  },
  {
    experience: RULES_TREND_FOLLOWING_EXPERIENCE,
    id: "rules-trend-following",
    displayName: "Rules: Trend Following",
    pipelineId: "rules-trend-following-cycle",
    signalIds: ["gc-4h-trend", "cl-4h-trend"],
    instrumentClasses: ["futures"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultPresets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
  },
  {
    experience: RULES_BREAKOUT_EXPERIENCE,
    id: "rules-breakout",
    displayName: "Rules: Momentum Breakout",
    pipelineId: "rules-breakout-cycle",
    signalIds: ["btc-1h-breakout"],
    instrumentClasses: ["crypto"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultPresets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
  },
  {
    experience: PREDICTION_EVENT_EDGE_EXPERIENCE,
    id: "prediction-event-edge",
    displayName: "Prediction Event Edge",
    pipelineId: "prediction-event-cycle",
    signalIds: ["prediction-event-edge"],
    instrumentClasses: ["prediction_market"],
    signalSourceTypes: ["prediction_event"],
    brokerRequirement: "polymarket_broker",
    defaultPresets: {
      posturePresetId: "prediction_event_edge",
      rulesPresetId: "probability_edge",
      riskPresetId: "prediction_market",
      timeframePresetId: "prediction",
    },
  },
];

describe("experience descriptor contracts", () => {
  it.each(SHIPPED_DESCRIPTOR_CONTRACTS.map((c) => [c.id, c]))(
    "%s declares id, displayName, pipelineId, signals, and capabilities",
    (_id, contract) => {
      const { experience } = contract;

      expect(experience.id).toBe(contract.id);
      expect(experience.displayName).toBe(contract.displayName);
      expect(experience.pipelineId).toBe(contract.pipelineId);
      expect(experience.signals.length).toBeGreaterThanOrEqual(1);
      expect(experience.signals.map((s) => s.id)).toEqual(contract.signalIds);
      expect(experience.capabilities.instrumentClasses).toEqual(
        contract.instrumentClasses,
      );
      expect(experience.capabilities.brokerRequirement).toBe(
        contract.brokerRequirement,
      );
      expect(experience.capabilities.signalSourceTypes).toEqual(
        contract.signalSourceTypes,
      );
    },
  );

  it.each(SHIPPED_DESCRIPTOR_CONTRACTS.map((c) => [c.id, c]))(
    "%s declares defaultPresets that resolve in the seeded database",
    (_id, contract) => {
      const db = createTestDb();
      try {
        const bundle = loadExperiencePresetBundle(db, contract.id);

        expect(bundle.posturePreset.id).toBe(
          contract.defaultPresets.posturePresetId,
        );
        expect(bundle.rulesPreset.id).toBe(
          contract.defaultPresets.rulesPresetId,
        );
        expect(bundle.riskPreset.id).toBe(contract.defaultPresets.riskPresetId);
        expect(bundle.timeframePreset.id).toBe(
          contract.defaultPresets.timeframePresetId,
        );
      } finally {
        db.sqlite.close();
      }
    },
  );
});

describe("experience descriptor validation", () => {
  it("passes validateExperienceRegistry for all shipped descriptors", () => {
    expect(() => validateExperienceRegistry()).not.toThrow();
  });

  it.each(SHIPPED_DESCRIPTOR_CONTRACTS.map((c) => [c.id, c]))(
    "%s passes validateExperienceSourceEmissions",
    (_id, contract) => {
      expect(() =>
        validateExperienceSourceEmissions(contract.experience),
      ).not.toThrow();
    },
  );

  it.each(SHIPPED_DESCRIPTOR_CONTRACTS.map((c) => [c.id, c]))(
    "%s: every signal.sourceType is in its pipeline.signalSources (I1)",
    (_id, contract) => {
      const { experience } = contract;
      const pipeline = requirePipelineDescriptor(experience.pipelineId);
      for (const signal of experience.signals) {
        expect(pipeline.signalSources).toContain(signal.sourceType);
      }
    },
  );

  it.each(SHIPPED_DESCRIPTOR_CONTRACTS.map((c) => [c.id, c]))(
    "%s: capabilities.signalSourceTypes equals union of signals[].sourceType (I3)",
    (_id, contract) => {
      const { experience } = contract;
      const signalTypes = new Set(experience.signals.map((s) => s.sourceType));
      const capTypes = new Set(experience.capabilities.signalSourceTypes);
      expect(signalTypes).toEqual(capTypes);
    },
  );

  it("rules-mean-reversion has cadence and timeframe distinct on each signal (I4)", () => {
    for (const signal of RULES_MEAN_REVERSION_EXPERIENCE.signals) {
      expect(signal.pollCadence).not.toBe(signal.defaultAnalysisTimeframe);
      expect(signal.pollCadence).toBeTruthy();
      expect(signal.defaultAnalysisTimeframe).toBeTruthy();
    }
  });

  it("no trend/breakout experience runs rules-mean-reversion-cycle (I5 regression)", () => {
    const trendOrBreakout = SHIPPED_DESCRIPTOR_CONTRACTS.filter(
      (c) => c.id.includes("trend") || c.id.includes("breakout"),
    );
    for (const { experience } of trendOrBreakout) {
      expect(experience.pipelineId).not.toBe("rules-mean-reversion-cycle");
    }
  });

  it("rules-breakout runs rules-breakout-cycle, not mean-reversion (I5)", () => {
    expect(RULES_BREAKOUT_EXPERIENCE.pipelineId).toBe("rules-breakout-cycle");
  });
});

describe("pipeline automation invariant (I2)", () => {
  it("deterministic rules experiences describe steps with kind: deterministic", () => {
    for (const id of [
      "rules-mean-reversion",
      "rules-trend-following",
      "rules-breakout",
    ]) {
      const steps = describeExperienceSteps(id);
      expect(steps.length).toBeGreaterThanOrEqual(1);
      for (const step of steps) {
        expect(step.kind).toBe("deterministic");
      }
    }
  });

  it("rules-mean-reversion has exactly [rules_decision, risk_gate] steps (G8)", () => {
    const steps = describeExperienceSteps("rules-mean-reversion");
    expect(steps.map((s) => s.id)).toEqual(["rules_decision", "risk_gate"]);
    expect(steps.every((s) => s.kind === "deterministic")).toBe(true);
  });
});

describe("signalDisplayName format", () => {
  it("includes both analysisTimeframe and pollCadence distinctly", () => {
    const spy = RULES_MEAN_REVERSION_EXPERIENCE.signals[0];
    if (!spy) throw new Error("Expected at least one signal");
    const name = signalDisplayName(spy);
    expect(name).toContain(spy.defaultAnalysisTimeframe);
    expect(name).toContain(spy.pollCadence ?? "");
    expect(spy.pollCadence).not.toBe(spy.defaultAnalysisTimeframe);
  });
});
