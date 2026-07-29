/**
 * Pre-spend AI budget gate (Solution 07 WS4).
 * Evaluated before the spend boundary — never after.
 */

export interface AiBudgetLimits {
  maxCycleUsd: number;
  maxSessionUsd: number;
  maxWorkspaceDayUsd: number;
}

export interface AiBudgetSnapshot {
  cycleSpendUsd: number;
  sessionSpendUsd: number;
  workspaceDaySpendUsd: number;
}

export type AiBudgetDecision =
  | { kind: "allow"; remainingCycleUsd: number }
  | {
      kind: "deny";
      reasonCode:
        | "cycle_budget_exhausted"
        | "session_budget_exhausted"
        | "workspace_day_budget_exhausted";
      limitUsd: number;
      spentUsd: number;
    };

const DEFAULT_LIMITS: AiBudgetLimits = {
  maxCycleUsd: 0.5,
  maxSessionUsd: 25,
  maxWorkspaceDayUsd: 100,
};

export class AiBudgetGuard {
  private cycleSpend = new Map<string, number>();
  private sessionSpend = new Map<string, number>();
  private workspaceDaySpend = new Map<string, number>();

  constructor(private readonly limits: AiBudgetLimits = DEFAULT_LIMITS) {}

  check(input: {
    cycleId: string;
    sessionId: string;
    workspaceDayKey: string;
    estimatedCostUsd: number;
  }): AiBudgetDecision {
    const cycle = this.cycleSpend.get(input.cycleId) ?? 0;
    const session = this.sessionSpend.get(input.sessionId) ?? 0;
    const day = this.workspaceDaySpend.get(input.workspaceDayKey) ?? 0;

    if (cycle + input.estimatedCostUsd > this.limits.maxCycleUsd) {
      return {
        kind: "deny",
        reasonCode: "cycle_budget_exhausted",
        limitUsd: this.limits.maxCycleUsd,
        spentUsd: cycle,
      };
    }
    if (session + input.estimatedCostUsd > this.limits.maxSessionUsd) {
      return {
        kind: "deny",
        reasonCode: "session_budget_exhausted",
        limitUsd: this.limits.maxSessionUsd,
        spentUsd: session,
      };
    }
    if (day + input.estimatedCostUsd > this.limits.maxWorkspaceDayUsd) {
      return {
        kind: "deny",
        reasonCode: "workspace_day_budget_exhausted",
        limitUsd: this.limits.maxWorkspaceDayUsd,
        spentUsd: day,
      };
    }
    return {
      kind: "allow",
      remainingCycleUsd: this.limits.maxCycleUsd - cycle - input.estimatedCostUsd,
    };
  }

  record(input: {
    cycleId: string;
    sessionId: string;
    workspaceDayKey: string;
    costUsd: number;
  }): void {
    this.cycleSpend.set(
      input.cycleId,
      (this.cycleSpend.get(input.cycleId) ?? 0) + input.costUsd,
    );
    this.sessionSpend.set(
      input.sessionId,
      (this.sessionSpend.get(input.sessionId) ?? 0) + input.costUsd,
    );
    this.workspaceDaySpend.set(
      input.workspaceDayKey,
      (this.workspaceDaySpend.get(input.workspaceDayKey) ?? 0) + input.costUsd,
    );
  }

  snapshot(input: {
    cycleId: string;
    sessionId: string;
    workspaceDayKey: string;
  }): AiBudgetSnapshot {
    return {
      cycleSpendUsd: this.cycleSpend.get(input.cycleId) ?? 0,
      sessionSpendUsd: this.sessionSpend.get(input.sessionId) ?? 0,
      workspaceDaySpendUsd:
        this.workspaceDaySpend.get(input.workspaceDayKey) ?? 0,
    };
  }

  clearCycle(cycleId: string): void {
    this.cycleSpend.delete(cycleId);
  }
}
