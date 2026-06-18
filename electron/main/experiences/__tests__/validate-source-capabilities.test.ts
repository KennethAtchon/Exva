import { describe, expect, it } from "vitest";
import { validateExperienceSourceEmissions } from "../validate-source-capabilities";

describe("validateExperienceSourceEmissions", () => {
  it("is a no-op — instrument class constraint removed", () => {
    expect(() => validateExperienceSourceEmissions()).not.toThrow();
  });
});
