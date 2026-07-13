import type { InputProfileRepo } from "./input-profile-repo";
import { TEMPLATE_IDS } from "./experience-template-seeds";
import { INSTRUMENT_SET_IDS } from "../instruments/instrument-set-seeds";
import { SOURCE_DEFINITION_IDS } from "../signals/source-definition-seeds";

// ---------------------------------------------------------------------------
// Profile IDs
// ---------------------------------------------------------------------------

export const INPUT_PROFILE_IDS = {
  MEAN_REVERSION_DEFAULT: "profile/mean-reversion-default",
  BREAKOUT_DEFAULT: "profile/breakout-default",
  TREND_DEFAULT: "profile/trend-default",
  OPTIONS_FLOW_DEFAULT: "profile/options-flow-default",
  EDGAR_DEFAULT: "profile/edgar-default",
  PREDICTION_DEFAULT: "profile/prediction-default",
} as const;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seedInputProfiles(repo: InputProfileRepo): void {
  seedMeanReversionProfile(repo);
  seedBreakoutProfile(repo);
  seedTrendProfile(repo);
  seedOptionsFlowProfile(repo);
  seedEdgarProfile(repo);
  seedPredictionProfile(repo);
}

function seedMeanReversionProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.MEAN_REVERSION_DEFAULT,
    templateId: TEMPLATE_IDS.MEAN_REVERSION,
    templateVersion: 1,
    mode: "scheduled_scan",
    name: "Default — NYSE Regular Hours",
    instrumentSetId: INSTRUMENT_SET_IDS.LIQUID_US_ETFS,
    instrumentSetRevision: 1,
    cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
    analysisTimeframe: "1h",
    marketCalendarId: "nyse-regular",
    strategyParameters: { zScoreEntry: -2 },
  });
}

function seedBreakoutProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.BREAKOUT_DEFAULT,
    templateId: TEMPLATE_IDS.BREAKOUT,
    templateVersion: 1,
    mode: "scheduled_scan",
    name: "Default — Always Open",
    instrumentSetId: INSTRUMENT_SET_IDS.MAJOR_CRYPTO,
    instrumentSetRevision: 1,
    cadence: { kind: "interval", every: 1, unit: "hour", jitterPct: 0.05 },
    analysisTimeframe: "4h",
    marketCalendarId: "always-open",
    strategyParameters: {},
  });
}

function seedTrendProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.TREND_DEFAULT,
    templateId: TEMPLATE_IDS.TREND_FOLLOWING,
    templateVersion: 1,
    mode: "scheduled_scan",
    name: "Default — Always Open",
    instrumentSetId: INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH,
    instrumentSetRevision: 1,
    cadence: { kind: "interval", every: 4, unit: "hour", jitterPct: 0.05 },
    analysisTimeframe: "4h",
    marketCalendarId: "always-open",
    strategyParameters: {},
  });
}

function seedOptionsFlowProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.OPTIONS_FLOW_DEFAULT,
    templateId: TEMPLATE_IDS.OPTIONS_FLOW,
    templateVersion: 1,
    mode: "scheduled_scan",
    name: "Default — NYSE Regular Hours",
    instrumentSetId: INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS,
    instrumentSetRevision: 1,
    cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
    analysisTimeframe: "1d",
    marketCalendarId: "nyse-regular",
    strategyParameters: {},
  });
}

function seedEdgarProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.EDGAR_DEFAULT,
    templateId: TEMPLATE_IDS.EDGAR_CATALYST,
    templateVersion: 1,
    mode: "event_source",
    name: "Default — EDGAR 8-K",
    sourceDefinitionId: SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
    sourceRevision: 1,
    filters: {},
    analysisTimeframe: "1d",
  });
}

function seedPredictionProfile(repo: InputProfileRepo): void {
  repo.createIfAbsent({
    id: INPUT_PROFILE_IDS.PREDICTION_DEFAULT,
    templateId: TEMPLATE_IDS.PREDICTION_EVENT,
    templateVersion: 1,
    mode: "event_source",
    name: "Default — Prediction Event",
    sourceDefinitionId: SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE,
    sourceRevision: 1,
    filters: {},
    analysisTimeframe: "1d",
  });
}
