import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import { describeExperienceSteps, validateExperienceRegistry } from "../index";
import {
  registerPipeline,
  requirePipelineDescriptor,
} from "../../services/pipeline/implementations/registry/pipeline-router";
import { ALL_PIPELINES } from "../../services/pipeline/implementations/registry/pipelines";
import {
  scheduleDisplayName,
  signalDisplayName,
} from "@electron/shared/domain/signal-descriptor";
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
  scheduleIds: string[];
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
    scheduleIds: [],
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
    signalIds: [],
    scheduleIds: ["spy-15m-meanrev", "qqq-15m-meanrev"],
    signalSourceTypes: [],
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
    signalIds: [],
    scheduleIds: ["gc-4h-trend", "cl-4h-trend"],
    signalSourceTypes: [],
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
    signalIds: [],
    scheduleIds: ["btc-1h-breakout"],
    signalSourceTypes: [],
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
    scheduleIds: [],
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
    "%s declares id, displayName, pipelineId, signals/schedules, and capabilities",
    (_id, contract) => {
      const { experience } = contract;

      expect(experience.id).toBe(contract.id);
      expect(experience.displayName).toBe(contract.displayName);
      expect(experience.pipelineId).toBe(contract.pipelineId);
      expect(
        experience.signals.length + (experience.schedules?.length ?? 0),
      ).toBeGreaterThanOrEqual(1);
      expect(experience.signals.map((s) => s.id)).toEqual(contract.signalIds);
      expect((experience.schedules ?? []).map((s) => s.id)).toEqual(
        contract.scheduleIds,
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

  it("validateExperienceSourceEmissions is a no-op and never throws", () => {
    expect(() => validateExperienceSourceEmissions()).not.toThrow();
  });

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

  it("rules-mean-reversion has cadence and timeframe distinct on each schedule (I4)", () => {
    for (const schedule of RULES_MEAN_REVERSION_EXPERIENCE.schedules ?? []) {
      expect(schedule.cadence).not.toBe(schedule.defaultAnalysisTimeframe);
      expect(schedule.cadence).toBeTruthy();
      expect(schedule.defaultAnalysisTimeframe).toBeTruthy();
      expect(schedule.symbol).toBeTruthy();
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

describe("signalDisplayName / scheduleDisplayName format", () => {
  it("includes poll cadence and trading timeframe distinctly for schedules", () => {
    const spy = RULES_MEAN_REVERSION_EXPERIENCE.schedules?.[0];
    if (!spy) throw new Error("Expected at least one schedule");
    const name = scheduleDisplayName(spy);
    expect(name).toContain("polls every 15m");
    expect(name).toContain("trades on 1h bars");
    expect(spy.cadence).not.toBe(spy.defaultAnalysisTimeframe);
  });

  it("still formats event-driven SignalDescriptors", () => {
    const edgar = EDGAR_CATALYST_EXPERIENCE.signals[0];
    if (!edgar) throw new Error("Expected edgar signal");
    expect(signalDisplayName(edgar)).toContain("EDGAR 8-K");
  });
});
