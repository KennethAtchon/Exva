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

  it("maps edgar experience source id", () => {
    expect(
      resolveSourceDefinitionId("edgar-catalyst/edgar-8k-catalyst", "edgar_8k"),
    ).toBe(SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST);
  });

  it("maps prediction experience source id", () => {
    expect(
      resolveSourceDefinitionId(
        "prediction-event-edge/prediction-event-edge",
        "prediction_event",
      ),
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
