import { describe, expect, it } from "vitest";
import { createTestDb } from "../../db/test-helpers";
import { validateExperienceRegistry } from "../index";
import { loadExperiencePresetBundle } from "../session-bootstrap";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";
import { BTC_MOMENTUM_BREAKOUT_EXPERIENCE } from "../btc-momentum-breakout/descriptor";
import { COMMODITIES_TREND_FOLLOWING_EXPERIENCE } from "../commodities-trend-following/descriptor";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "../prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";
import { RULES_QQQ_MEAN_REVERSION_EXPERIENCE } from "../rules-qqq-mean-reversion/descriptor";
import type { ExperienceDescriptor } from "../types";

type DescriptorContract = {
  experience: ExperienceDescriptor;
  id: string;
  displayName: string;
  pipelineId: string;
  signalSourceType: ExperienceDescriptor["signalSource"]["type"];
  instrumentClasses: ExperienceDescriptor["capabilities"]["instrumentClasses"];
  brokerRequirement: ExperienceDescriptor["capabilities"]["brokerRequirement"];
  signalSourceTypes: ExperienceDescriptor["capabilities"]["signalSourceTypes"];
  defaultInstrumentClass: ExperienceDescriptor["capabilities"]["defaultInstrumentClass"];
  presets: ExperienceDescriptor["presets"];
  defaultConfig: Record<string, unknown>;
};

const SHIPPED_DESCRIPTOR_CONTRACTS: DescriptorContract[] = [
  {
    experience: EDGAR_CATALYST_EXPERIENCE,
    id: "edgar-catalyst",
    displayName: "EDGAR 8-K catalyst drift",
    pipelineId: "edgar-8k-cycle",
    signalSourceType: "edgar_8k",
    instrumentClasses: ["stock"],
    brokerRequirement: "any_supported_class",
    signalSourceTypes: ["edgar_8k", "mock"],
    defaultInstrumentClass: "stock",
    presets: {
      posturePresetId: "edgar_catalyst",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "catalyst",
    },
    defaultConfig: {
      itemCodeWhitelist: [
        "1.01",
        "1.03",
        "2.02",
        "2.03",
        "3.02",
        "5.02",
        "8.01",
      ],
      minFilingAgeMinutes: 0,
    },
  },
  {
    experience: RULES_MEAN_REVERSION_EXPERIENCE,
    id: "rules-mean-reversion",
    displayName: "SPY 15m mean reversion (rules)",
    pipelineId: "rules-mean-reversion-cycle",
    signalSourceType: "timer",
    instrumentClasses: ["stock"],
    brokerRequirement: "any_supported_class",
    signalSourceTypes: ["timer"],
    defaultInstrumentClass: "stock",
    presets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    defaultConfig: {
      symbol: "SPY",
      cadence: "15m",
      instrumentClass: "stock",
    },
  },
  {
    experience: RULES_QQQ_MEAN_REVERSION_EXPERIENCE,
    id: "rules-qqq-mean-reversion",
    displayName: "QQQ 15m mean reversion (rules)",
    pipelineId: "rules-mean-reversion-cycle",
    signalSourceType: "timer",
    instrumentClasses: ["stock"],
    brokerRequirement: "any_supported_class",
    signalSourceTypes: ["timer"],
    defaultInstrumentClass: "stock",
    presets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    defaultConfig: {
      symbol: "QQQ",
      cadence: "15m",
      instrumentClass: "stock",
    },
  },
  {
    experience: BTC_MOMENTUM_BREAKOUT_EXPERIENCE,
    id: "btc-momentum-breakout",
    displayName: "BTC-USD 1h momentum breakout (rules)",
    pipelineId: "rules-mean-reversion-cycle",
    signalSourceType: "timer",
    instrumentClasses: ["crypto"],
    brokerRequirement: "any_supported_class",
    signalSourceTypes: ["timer"],
    defaultInstrumentClass: "crypto",
    presets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    defaultConfig: {
      symbol: "BTC-USD",
      cadence: "1h",
      instrumentClass: "crypto",
    },
  },
  {
    experience: COMMODITIES_TREND_FOLLOWING_EXPERIENCE,
    id: "commodities-trend-following",
    displayName: "GC/CL 4h trend following (rules)",
    pipelineId: "rules-trend-following-cycle",
    signalSourceType: "timer",
    instrumentClasses: ["futures"],
    brokerRequirement: "any_supported_class",
    signalSourceTypes: ["timer"],
    defaultInstrumentClass: "futures",
    presets: {
      posturePresetId: "manual_watchlist",
      rulesPresetId: "catalyst_entry",
      riskPresetId: "moderate",
      timeframePresetId: "swing",
    },
    defaultConfig: {
      symbol: "GC",
      cadence: "4h",
      instrumentClass: "futures",
    },
  },
  {
    experience: PREDICTION_EVENT_EDGE_EXPERIENCE,
    id: "prediction-event-edge",
    displayName: "Prediction event edge",
    pipelineId: "prediction-event-cycle",
    signalSourceType: "prediction_event",
    instrumentClasses: ["prediction_market"],
    brokerRequirement: "polymarket_broker",
    signalSourceTypes: ["prediction_event"],
    defaultInstrumentClass: "prediction_market",
    presets: {
      posturePresetId: "prediction_event_edge",
      rulesPresetId: "probability_edge",
      riskPresetId: "prediction_market",
      timeframePresetId: "prediction",
    },
    defaultConfig: {
      triggerKind: "odds_volume_dislocation",
      pollIntervalMinutes: 15,
      minLiquidityUsd: 5000,
      minPriceDeviation: 0.12,
      categoryWhitelist: [],
    },
  },
];

describe("experience descriptor contracts", () => {
  it.each(
    SHIPPED_DESCRIPTOR_CONTRACTS.map((contract) => [contract.id, contract]),
  )(
    "%s declares id, displayName, pipeline, signal source, and capabilities",
    (_id, contract) => {
      const { experience } = contract;

      expect(experience.id).toBe(contract.id);
      expect(experience.displayName).toBe(contract.displayName);
      expect(experience.pipeline.id).toBe(contract.pipelineId);
      expect(experience.signalSource.type).toBe(contract.signalSourceType);
      expect(experience.capabilities.instrumentClasses).toEqual(
        contract.instrumentClasses,
      );
      expect(experience.capabilities.brokerRequirement).toBe(
        contract.brokerRequirement,
      );
      expect(experience.capabilities.signalSourceTypes).toEqual(
        contract.signalSourceTypes,
      );
      expect(experience.capabilities.defaultInstrumentClass).toBe(
        contract.defaultInstrumentClass,
      );
      expect(experience.capabilities.signalSourceTypes).toContain(
        experience.signalSource.type,
      );
      expect(experience.pipeline.signalSources).toContain(
        experience.signalSource.type,
      );
    },
  );

  it.each(
    SHIPPED_DESCRIPTOR_CONTRACTS.map((contract) => [contract.id, contract]),
  )(
    "%s declares experience-specific signal source defaults",
    (_id, contract) => {
      expect(contract.experience.signalSource.defaultConfig).toEqual(
        contract.defaultConfig,
      );
    },
  );

  it.each(
    SHIPPED_DESCRIPTOR_CONTRACTS.map((contract) => [contract.id, contract]),
  )(
    "%s declares preset ids that resolve in the seeded database",
    (_id, contract) => {
      const db = createTestDb();
      try {
        const bundle = loadExperiencePresetBundle(db, contract.id);

        expect(bundle.posturePreset.id).toBe(contract.presets.posturePresetId);
        expect(bundle.rulesPreset.id).toBe(contract.presets.rulesPresetId);
        expect(bundle.riskPreset.id).toBe(contract.presets.riskPresetId);
        expect(bundle.timeframePreset.id).toBe(
          contract.presets.timeframePresetId,
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

  it.each(
    SHIPPED_DESCRIPTOR_CONTRACTS.map((contract) => [contract.id, contract]),
  )(
    "%s passes validateExperienceSourceEmissions for its signal source types",
    (_id, contract) => {
      expect(() =>
        validateExperienceSourceEmissions(contract.experience),
      ).not.toThrow();
    },
  );
});
