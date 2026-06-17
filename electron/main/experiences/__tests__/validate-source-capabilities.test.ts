import { describe, expect, it } from "vitest";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { PREDICTION_EVENT_EDGE_EXPERIENCE } from "../prediction-event-edge/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";

describe("validateExperienceSourceEmissions", () => {
  it("accepts shipped experience cartridges", () => {
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

  it("rejects experiences whose signal emits an unsupported instrument class", () => {
    expect(() =>
      validateExperienceSourceEmissions({
        ...RULES_MEAN_REVERSION_EXPERIENCE,
        capabilities: {
          ...RULES_MEAN_REVERSION_EXPERIENCE.capabilities,
          instrumentClasses: ["stock"],
        },
        signals: [
          {
            ...(RULES_MEAN_REVERSION_EXPERIENCE.signals[0] ?? {}),
            instrumentClass: "crypto", // crypto not in capabilities.instrumentClasses
          },
        ],
      }),
    ).toThrow(/instrumentClass 'crypto'/i);
  });
});
