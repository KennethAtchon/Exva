import { describe, expect, it } from "vitest";
import { resolveSourceDefinitionId } from "../resolve-source-definition-id";
import { SOURCE_DEFINITION_IDS } from "../source-definition-seeds";

describe("resolveSourceDefinitionId", () => {
  it("returns known definition ids directly", () => {
    expect(
      resolveSourceDefinitionId(
        SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
        "edgar_8k",
      ),
    ).toBe(SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST);
  });

  it("resolves active source types without source-id aliases", () => {
    expect(
      resolveSourceDefinitionId("custom-prediction-source", "prediction_event"),
    ).toBe(SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE);
  });

  it("maps mock by type or id substring", () => {
    expect(resolveSourceDefinitionId("some-mock-id", "mock")).toBe(
      SOURCE_DEFINITION_IDS.MOCK_REHEARSAL,
    );
    expect(resolveSourceDefinitionId("some-mock-id", "edgar_8k")).toBe(
      SOURCE_DEFINITION_IDS.MOCK_REHEARSAL,
    );
  });

  it("maps by live source type when id is unknown", () => {
    expect(resolveSourceDefinitionId("custom-edgar", "edgar_8k")).toBe(
      SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
    );
    expect(resolveSourceDefinitionId("custom-pred", "prediction_event")).toBe(
      SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE,
    );
  });

  it("returns null for unknown/manual types", () => {
    expect(
      resolveSourceDefinitionId("unknown-source", "unknown_type"),
    ).toBeNull();
    expect(resolveSourceDefinitionId("manual_source", "manual")).toBeNull();
  });
});
