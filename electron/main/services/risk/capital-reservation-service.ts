import type { CapitalReservationsRepo } from "../../db/repositories/capital-reservations-repo";
import type { CapitalReservation } from "@/lib/types";

export class CapitalReservationService {
  constructor(private readonly repo: CapitalReservationsRepo) {}

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
