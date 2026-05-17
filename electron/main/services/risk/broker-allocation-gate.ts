import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";

export type AllocationGateResult =
  | { ok: true; warning?: "over_allocated" }
  | { ok: false; reason: string; code: "BROKER_ALLOCATION_EXHAUSTED" | "INSTRUMENT_CONFLICT" };

export class BrokerAllocationGate {
  constructor(
    private readonly assignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly tradesRepo: TradesRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
  ) {}

  checkOrderFits(brokerAccountId: string, sessionId: string, sizeUsd: number): AllocationGateResult {
    const assignment = this.assignmentsRepo.findAssignment(sessionId, brokerAccountId);
    if (!assignment) return { ok: true };

    const openPositionSizeUsd = this.tradesRepo.sumOpenPositionSizeUsd(sessionId, brokerAccountId);
    const freeAllocation = assignment.allocatedUsd - openPositionSizeUsd;
    if (sizeUsd <= freeAllocation) return { ok: true };

    const enforcement = this.resolveEnforcement(brokerAccountId);
    if (enforcement === "warn") {
      return { ok: true, warning: "over_allocated" };
    }

    return {
      ok: false,
      reason: `Broker allocation exhausted: $${freeAllocation.toFixed(2)} free, order requires $${sizeUsd.toFixed(2)}.`,
      code: "BROKER_ALLOCATION_EXHAUSTED",
    };
  }

  checkInstrumentConflict(brokerAccountId: string, symbol: string, sessionId: string): AllocationGateResult {
    const conflict = this.tradesRepo.findOpenTradeOnBroker(brokerAccountId, symbol, sessionId);
    if (!conflict) return { ok: true };
    return {
      ok: false,
      reason: `${symbol} is already held on this broker by another session.`,
      code: "INSTRUMENT_CONFLICT",
    };
  }

  private resolveEnforcement(brokerAccountId: string): "hard" | "warn" {
    const prefs = this.workspacePrefsRepo.get();
    if (prefs.allocationEnforcementOverride) return prefs.allocationEnforcementOverride;
    return this.brokerAccountsRepo.find(brokerAccountId)?.allocationEnforcement ?? "hard";
  }
}
