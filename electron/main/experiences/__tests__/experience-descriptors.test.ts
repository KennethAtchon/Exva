import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import { describeExperienceSteps, validateExperienceRegistry } from "../index";
import {
  registerPipeline,
  requirePipelineDescriptor,
} from "../../services/pipeline/implementations/registry/pipeline-router";
import { ALL_PIPELINES } from "../../services/pipeline/implementations/registry/pipelines";
import { loadExperiencePresetBundle } from "../session-bootstrap";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "../prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";
import { RULES_TREND_FOLLOWING_EXPERIENCE } from "../rules-trend-following/descriptor";
import { RULES_BREAKOUT_EXPERIENCE } from "../rules-breakout/descriptor";
import { OPTIONS_FLOW_EDGE_EXPERIENCE } from "../options-flow-edge/descriptor";
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
  signalSourceTypes: ExperienceDescriptor["capabilities"]["signalSourceTypes"];
  brokerRequirement: ExperienceDescriptor["capabilities"]["brokerRequirement"];
  defaultPresets: ExperienceDescriptor["defaultPresets"];
  acceptsScanHit: boolean;
};

const SHIPPED_DESCRIPTOR_CONTRACTS: DescriptorContract[] = [
  {
    experience: EDGAR_CATALYST_EXPERIENCE,
    id: "edgar-catalyst",
    displayName: "EDGAR Catalyst",
    pipelineId: "edgar-8k-cycle",
    signalSourceTypes: ["edgar_8k"],
    brokerRequirement: "any_supported_class",
    acceptsScanHit: false,
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
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
    acceptsScanHit: true,
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
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
    acceptsScanHit: true,
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
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
    acceptsScanHit: true,
    defaultPresets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
  },
  {
    experience: OPTIONS_FLOW_EDGE_EXPERIENCE,
    id: "options-flow-edge",
    displayName: "Options Flow Edge",
    pipelineId: "options-flow-cycle",
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
    acceptsScanHit: true,
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
    signalSourceTypes: ["prediction_event"],
    brokerRequirement: "polymarket_broker",
    acceptsScanHit: false,
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
    "%s declares id, displayName, pipelineId, capabilities, and acceptsScanHit",
    (_id, contract) => {
      const { experience } = contract;

      expect(experience.id).toBe(contract.id);
      expect(experience.displayName).toBe(contract.displayName);
      expect(experience.pipelineId).toBe(contract.pipelineId);
      expect(experience.capabilities.brokerRequirement).toBe(
        contract.brokerRequirement,
      );
      expect(experience.capabilities.signalSourceTypes).toEqual(
        contract.signalSourceTypes,
      );
      expect(experience.acceptsScanHit ?? false).toBe(contract.acceptsScanHit);
    },
  );

  it("scan_hit experiences (rules/options) set acceptsScanHit: true", () => {
    const scanHitExperiences = SHIPPED_DESCRIPTOR_CONTRACTS.filter(
      (c) => c.acceptsScanHit,
    );
    expect(scanHitExperiences.map((c) => c.id).sort()).toEqual([
      "options-flow-edge",
      "rules-breakout",
      "rules-mean-reversion",
      "rules-trend-following",
    ]);
    for (const { experience } of scanHitExperiences) {
      expect(experience.acceptsScanHit).toBe(true);
      expect(experience.capabilities.signalSourceTypes).toEqual([]);
    }
  });

  it("event-driven experiences do not set acceptsScanHit and declare signalSourceTypes", () => {
    const eventDriven = SHIPPED_DESCRIPTOR_CONTRACTS.filter(
      (c) => !c.acceptsScanHit,
    );
    expect(eventDriven.map((c) => c.id).sort()).toEqual([
      "edgar-catalyst",
      "prediction-event-edge",
    ]);
    for (const { experience } of eventDriven) {
      expect(experience.acceptsScanHit ?? false).toBe(false);
      expect(experience.capabilities.signalSourceTypes.length).toBeGreaterThan(
        0,
      );
    }
  });

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
    "%s pipeline declared in pipelineId exists (pipeline check)",
    (_id, contract) => {
      expect(() =>
        requirePipelineDescriptor(contract.experience.pipelineId),
      ).not.toThrow();
    },
  );

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
