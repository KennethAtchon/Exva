import { expect } from "vitest";
import type { TechnicalSignal, TradeSignal } from "@electron/shared/ai/pipeline-signals";
import type { ReplayResult } from "../cycle-replay-service";

export function assertSubmissionFires(result: ReplayResult): void {
  expect(result.scorecard.submissionFired).toBe(true);
  expect(result.phaseOutputs.selector).not.toBeNull();
}

export function assertTechnicalSignalHasField(
  result: ReplayResult,
  field: keyof TechnicalSignal,
): void {
  const technical = result.phaseOutputs.technical;
  expect(technical).not.toBeNull();
  expect(technical && technical[field]).not.toBeUndefined();
}

export function assertTradeSignalAction(
  result: ReplayResult,
  action: TradeSignal["action"],
): void {
  expect(result.phaseOutputs.decision?.action).toBe(action);
}

export function assertCostBelowUsd(result: ReplayResult, maxUsd: number): void {
  expect(result.scorecard.totalCostUsd).toBeLessThanOrEqual(maxUsd);
}
