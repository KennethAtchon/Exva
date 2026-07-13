import type { SourceDefinitionRepo } from "./source-definition-repo";

// ---------------------------------------------------------------------------
// Source definition IDs
// ---------------------------------------------------------------------------

export const SOURCE_DEFINITION_IDS = {
  EDGAR_8K_CATALYST: "source-def/edgar-8k-catalyst",
  PREDICTION_EVENT_EDGE: "source-def/prediction-event-edge",
  MOCK_REHEARSAL: "source-def/mock-rehearsal",
} as const;

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seedSourceDefinitions(repo: SourceDefinitionRepo): void {
  repo.createIfAbsent({
    id: SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
    kind: "edgar_8k",
    name: "EDGAR 8-K Catalyst",
    description:
      "Monitors SEC EDGAR for 8-K filings that may indicate catalyst events.",
    enabled: true,
    integrationId: null,
    outputContractId: "signal/filing",
    configSchemaVersion: 1,
    config: {},
  });

  repo.createIfAbsent({
    id: SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE,
    kind: "prediction_event",
    name: "Prediction Event Edge",
    description:
      "Monitors prediction markets for odds/volume dislocations.",
    enabled: true,
    integrationId: null,
    outputContractId: "signal/prediction-event",
    configSchemaVersion: 1,
    config: {},
  });

  repo.createIfAbsent({
    id: SOURCE_DEFINITION_IDS.MOCK_REHEARSAL,
    kind: "mock",
    name: "Mock Rehearsal",
    description:
      "Synthetic signal source for paper-mode rehearsal and testing.",
    enabled: true,
    integrationId: null,
    outputContractId: "signal/mock",
    configSchemaVersion: 1,
    config: {},
  });
}
