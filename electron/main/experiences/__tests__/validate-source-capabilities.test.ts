import { describe, expect, it } from "vitest";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "../prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";

describe("validateExperienceSourceEmissions", () => {
  it("accepts shipped experience cartridges (no-op — instrument class constraint removed)", () => {
    expect(() =>
      validateExperienceSourceEmissions(EDGAR_CATALYST_EXPERIENCE),
    ).not.toThrow();
    expect(() =>
      validateExperienceSourceEmissions(RULES_MEAN_REVERSION_EXPERIENCE),
    ).not.toThrow();
    expect(() =>
      validateExperienceSourceEmissions(PREDICTION_EVENT_EDGE_EXPERIENCE),
    ).not.toThrow();
  });
});
