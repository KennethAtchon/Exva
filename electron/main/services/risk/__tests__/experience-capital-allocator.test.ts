import { describe, expect, it, vi } from "vitest";
import { ExperienceCapitalAllocator } from "../experience-capital-allocator";

describe("ExperienceCapitalAllocator", () => {
  const scorecardService = {
    generateAll: vi.fn(),
  };
  const allocator = new ExperienceCapitalAllocator(scorecardService as never);

  it("returns neutral weight when sample size is too small", () => {
    scorecardService.generateAll.mockReturnValue([
      {
        experienceId: "exp-new",
        tradeCount: 3,
        expectancy: -0.1,
        meetsPromotion: false,
      },
    ]);

    expect(allocator.computeWeights()).toEqual([
      {
        experienceId: "exp-new",
        sizeMultiplier: 1,
        reason: "insufficient_sample",
      },
    ]);
  });

  it("throttles negative-expectancy experiences below promotion", () => {
    scorecardService.generateAll.mockReturnValue([
      {
        experienceId: "exp-weak",
        tradeCount: 12,
        expectancy: -0.2,
        meetsPromotion: false,
      },
    ]);

    expect(allocator.multiplierForExperience("exp-weak")).toBe(0.25);
  });

  it("boosts promoted experiences with enough trades and positive expectancy", () => {
    scorecardService.generateAll.mockReturnValue([
      {
        experienceId: "exp-strong",
        tradeCount: 25,
        expectancy: 0.4,
        meetsPromotion: true,
      },
    ]);

    const weight = allocator.computeWeights()[0];
    expect(weight?.sizeMultiplier).toBeGreaterThan(1);
    expect(weight?.sizeMultiplier).toBeLessThanOrEqual(1.5);
    expect(weight?.reason).toBe("promoted_positive_edge");
  });

  it("returns neutral weight for positive expectancy below promotion", () => {
    scorecardService.generateAll.mockReturnValue([
      {
        experienceId: "exp-ok",
        tradeCount: 10,
        expectancy: 0.1,
        meetsPromotion: false,
      },
    ]);

    expect(allocator.multiplierForExperience("exp-ok")).toBe(1);
  });
});
