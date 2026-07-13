import { describe, expect, it } from "vitest";
import { mapLegacySourceToDefinitionId } from "../legacy-source-definition-map";
import { SOURCE_DEFINITION_IDS } from "../source-definition-seeds";

describe("mapLegacySourceToDefinitionId", () => {
  it("maps edgar experience source id", () => {
    expect(
      mapLegacySourceToDefinitionId(
        "edgar-catalyst/edgar-8k-catalyst",
        "edgar_8k",
      ),
    ).toBe(SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST);
  });

  it("maps prediction experience source id", () => {
    expect(
      mapLegacySourceToDefinitionId(
        "prediction-event-edge/prediction-event-edge",
        "prediction_event",
      ),
    ).toBe(SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE);
  });

  it("maps mock by type", () => {
    expect(mapLegacySourceToDefinitionId("some-mock-id", "mock")).toBe(
      SOURCE_DEFINITION_IDS.MOCK_REHEARSAL,
    );
  });

  it("returns null for unknown/manual types", () => {
    expect(mapLegacySourceToDefinitionId("unknown-source", "unknown_type")).toBeNull();
    expect(mapLegacySourceToDefinitionId("manual_source", "manual")).toBeNull();
  });
});
