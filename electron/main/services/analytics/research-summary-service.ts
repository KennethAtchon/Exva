import type { ExperienceScorecardService } from "./experience-scorecard-service";

export type ResearchSummaryDelta = {
  experienceId: string;
  displayName: string;
  expectancyDelta: number;
  winRateDelta: number;
  calibrationDrift: "improved" | "degraded" | "stable";
  verdict: "improved" | "degraded" | "unchanged";
};

export class ResearchSummaryService {
  constructor(private readonly scorecardService: ExperienceScorecardService) {}

  generateSummary(
    priorMetrics: Record<
      string,
      { expectancy: number; winRate: number; brierScore?: number }
    > = {},
  ): {
    generatedAt: string;
    deltas: ResearchSummaryDelta[];
  } {
    const current = this.scorecardService.generateAll();
    const deltas: ResearchSummaryDelta[] = current.map((sc) => {
      const prior = priorMetrics[sc.experienceId];
      if (!prior) {
        return {
          experienceId: sc.experienceId,
          displayName: sc.displayName,
          expectancyDelta: sc.expectancy,
          winRateDelta: sc.winRate,
          calibrationDrift: "stable",
          verdict: sc.expectancy > 0 ? "improved" : "unchanged",
        };
      }
      const expDelta = sc.expectancy - prior.expectancy;
      const wrDelta = sc.winRate - prior.winRate;
      let verdict: ResearchSummaryDelta["verdict"] = "unchanged";
      if (expDelta > 0.005 && wrDelta >= 0) verdict = "improved";
      else if (expDelta < -0.005) verdict = "degraded";
      return {
        experienceId: sc.experienceId,
        displayName: sc.displayName,
        expectancyDelta: expDelta,
        winRateDelta: wrDelta,
        calibrationDrift:
          expDelta > 0 ? "improved" : expDelta < -0.01 ? "degraded" : "stable",
        verdict,
      };
    });
    return { generatedAt: new Date().toISOString(), deltas };
  }
}
