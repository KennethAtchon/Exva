import type { ExperienceScorecardService } from "../analytics/experience-scorecard-service";

export type ExperienceCapitalWeight = {
  experienceId: string;
  sizeMultiplier: number;
  reason: string;
};

const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 1.5;
const MIN_TRADES_FOR_BOOST = 20;

/**
 * Scales position size by recent experience performance.
 * Weak edges get throttled; strong edges get modest boost.
 */
export class ExperienceCapitalAllocator {
  constructor(private readonly scorecardService: ExperienceScorecardService) {}

  computeWeights(): ExperienceCapitalWeight[] {
    const scorecards = this.scorecardService.generateAll();
    return scorecards.map((sc) => {
      if (sc.tradeCount < 5) {
        return {
          experienceId: sc.experienceId,
          sizeMultiplier: 1,
          reason: "insufficient_sample",
        };
      }
      if (!sc.meetsPromotion && sc.expectancy <= 0) {
        return {
          experienceId: sc.experienceId,
          sizeMultiplier: MIN_MULTIPLIER,
          reason: "negative_expectancy",
        };
      }
      if (
        sc.meetsPromotion &&
        sc.expectancy > 0 &&
        sc.tradeCount >= MIN_TRADES_FOR_BOOST
      ) {
        const boost = Math.min(MAX_MULTIPLIER, 1 + sc.expectancy * 0.5);
        return {
          experienceId: sc.experienceId,
          sizeMultiplier: boost,
          reason: "promoted_positive_edge",
        };
      }
      if (sc.expectancy > 0) {
        return {
          experienceId: sc.experienceId,
          sizeMultiplier: 1,
          reason: "positive_expectancy",
        };
      }
      return {
        experienceId: sc.experienceId,
        sizeMultiplier: 0.5,
        reason: "below_promotion",
      };
    });
  }

  multiplierForExperience(experienceId: string): number {
    const weights = this.computeWeights();
    return (
      weights.find((w) => w.experienceId === experienceId)?.sizeMultiplier ?? 1
    );
  }
}
