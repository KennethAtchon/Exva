import type { CapitalReservationsRepo } from "../../db/repositories/capital-reservations-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { CapitalReservation } from "@/lib/types";

export class CapitalReservationService {
  constructor(
    private readonly repo: CapitalReservationsRepo,
    private readonly workspacePreferencesRepo: WorkspacePreferencesRepo,
  ) {}

  checkSessionStartFits(
    sessionId: string,
    capitalLimitUsd: number,
  ): { ok: true } | { ok: false; reserved: number; ceiling: number } {
    void sessionId;
    const workspace = this.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode !== "shared_global_pool") {
      return { ok: true };
    }
    const ceiling = workspace.globalCapitalPoolUsd;
    if (ceiling == null || ceiling <= 0) {
      return { ok: false, reserved: this.repo.sumActiveReservedUsd(), ceiling: 0 };
    }
    const reserved = this.repo.sumActiveReservedUsd();
    if (reserved + capitalLimitUsd > ceiling) {
      return { ok: false, reserved, ceiling };
    }
    return { ok: true };
  }

  checkOrderFits(amountUsd: number): { ok: true } | { ok: false; reserved: number; ceiling: number } {
    const workspace = this.workspacePreferencesRepo.get();
    if (workspace.capitalAllocationMode !== "shared_global_pool") return { ok: true };
    const ceiling = workspace.globalCapitalPoolUsd;
    if (ceiling == null || ceiling <= 0) return { ok: false, reserved: this.repo.sumActiveReservedUsd(), ceiling: 0 };
    const reserved = this.repo.sumActiveReservedUsd();
    if (reserved + amountUsd > ceiling) return { ok: false, reserved, ceiling };
    return { ok: true };
  }

  reserveForOrder(input: { sessionId: string; tradeId: string; amountUsd: number }) {
    return this.repo.reserveForOrder(input);
  }

  reserveForApproval(input: { sessionId: string; approvalId: string; amountUsd: number }) {
    return this.repo.reserveForApproval(input);
  }

  releaseByApproval(approvalId: string): void {
    this.repo.releaseByApproval(approvalId);
  }

  convertApprovalToOpenOrder(approvalId: string, tradeId: string): void {
    this.repo.convertApprovalToOpenOrder(approvalId, tradeId);
  }

  convertOrderToPosition(tradeId: string): void {
    this.repo.convertOrderToPosition(tradeId);
  }

  releaseOnCancel(tradeId: string): void {
    this.repo.releaseOnCancel(tradeId);
  }

  releaseOnFailure(tradeId: string): void {
    this.repo.releaseOnFailure(tradeId);
  }

  releaseOnClose(tradeId: string): void {
    this.repo.releaseOnClose(tradeId);
  }

  sumActiveReservedUsd(): number {
    return this.repo.sumActiveReservedUsd();
  }

  listActiveBySession(sessionId: string): CapitalReservation[] {
    return this.repo.listActiveBySession(sessionId);
  }

  updateReservedAmountForApproval(approvalId: string, amountUsd: number): void {
    this.repo.updateReservedAmountForApproval(approvalId, amountUsd);
  }
}
