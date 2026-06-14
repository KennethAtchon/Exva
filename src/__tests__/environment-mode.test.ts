import { describe, expect, it } from "vitest";
import {
  executionModeForEnvironment,
  sessionMatchesEnvironment,
} from "@/lib/environment-mode";
import {
  executionModeForEnvironment as sharedExecutionModeForEnvironment,
  sessionMatchesEnvironment as sharedSessionMatchesEnvironment,
} from "@electron/shared/domain/environment-mode";

describe("environment-mode re-export contract", () => {
  it("executionModeForEnvironment matches shared domain module", () => {
    for (const mode of ["paper", "live"] as const) {
      expect(executionModeForEnvironment(mode)).toBe(
        sharedExecutionModeForEnvironment(mode),
      );
    }
  });

  it("sessionMatchesEnvironment matches shared domain module", () => {
    const cases: Array<
      [
        Parameters<typeof sessionMatchesEnvironment>[0],
        Parameters<typeof sessionMatchesEnvironment>[1],
      ]
    > = [
      ["paper_only", "paper"],
      ["live_allowed", "live"],
      ["paper_only", "live"],
      ["live_allowed", "paper"],
    ];
    for (const [executionMode, environmentMode] of cases) {
      expect(sessionMatchesEnvironment(executionMode, environmentMode)).toBe(
        sharedSessionMatchesEnvironment(executionMode, environmentMode),
      );
    }
  });
});
