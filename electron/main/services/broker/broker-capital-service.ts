import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type {
  AllocationEnforcement,
  BrokerAccountWithState,
} from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";

export interface AllocationCheckFailure {
  brokerAccountId: string;
  brokerName: string;
  reason: "over_allocated" | "session_cap_exceeded";
  detail: string;
}

export class BrokerCapitalService {
  constructor(
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly assignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly sessionRepo: SessionRepo,
  ) {}

  listWithState(): BrokerAccountWithState[] {
    const accounts = this.brokerAccountsRepo.list();
    const activeSessions = this.sessionRepo.listByStatuses([
      "active",
      "paused",
    ]);
    const activeIds = new Set(activeSessions.map((session) => session.id));
    const sessionMap = new Map(
      activeSessions.map((session) => [session.id, session]),
    );

    return accounts.map((account) => {
      const allAssignments = this.assignmentsRepo.listAssignmentsForBroker(
        account.id,
      );
      const activeAssignments = allAssignments.filter((assignment) =>
        activeIds.has(assignment.sessionId),
      );
      const totalAllocatedUsd = activeAssignments.reduce(
        (sum, assignment) => sum + assignment.allocatedUsd,
        0,
      );
      const freeCapitalUsd =
        account.balanceCacheUsd != null
          ? account.balanceCacheUsd - totalAllocatedUsd
          : null;
      const staleLimitMs = account.balanceRefreshIntervalMin * 60 * 1000;
      const isStale =
        !account.balanceCachedAt ||
        Date.now() - Date.parse(account.balanceCachedAt) > staleLimitMs;

      return {
        ...account,
        isStale,
        sessions: activeAssignments.map((assignment) => ({
          sessionId: assignment.sessionId,
          sessionName:
            sessionMap.get(assignment.sessionId)?.name ?? assignment.sessionId,
          status: sessionMap.get(assignment.sessionId)?.status ?? "draft",
          allocatedUsd: assignment.allocatedUsd,
        })),
        activeSessionCount: activeAssignments.length,
        totalAllocatedUsd,
        freeCapitalUsd,
        isOverAllocated: freeCapitalUsd != null && freeCapitalUsd < 0,
        atSessionCap: activeAssignments.length >= account.maxSessions,
      };
    });
  }

  checkSessionStartFits(
    sessionId: string,
  ): { ok: true } | { ok: false; failures: AllocationCheckFailure[] } {
    const assignments = this.assignmentsRepo.listAssignments(sessionId);
    const activeSessions = this.sessionRepo.listByStatuses([
      "active",
      "paused",
    ]);
    const otherActiveIds = activeSessions
      .filter((session) => session.id !== sessionId)
      .map((session) => session.id);
    const failures: AllocationCheckFailure[] = [];

    for (const assignment of assignments) {
      const account = this.brokerAccountsRepo.require(
        assignment.brokerAccountId,
      );
      const currentCount = this.assignmentsRepo.countActiveSessionsForBroker(
        account.id,
        otherActiveIds,
      );
      if (currentCount >= account.maxSessions) {
        failures.push({
          brokerAccountId: account.id,
          brokerName: account.name,
          reason: "session_cap_exceeded",
          detail: `${account.name} already has ${currentCount} active sessions (cap: ${account.maxSessions}).`,
        });
        continue;
      }

      if (account.balanceCacheUsd != null) {
        const currentlyAllocated =
          this.assignmentsRepo.sumAllocatedUsdForBroker(
            account.id,
            otherActiveIds,
          );
        const freeCapital = account.balanceCacheUsd - currentlyAllocated;
        if (assignment.allocatedUsd > freeCapital) {
          failures.push({
            brokerAccountId: account.id,
            brokerName: account.name,
            reason: "over_allocated",
            detail: `${account.name} has $${freeCapital.toFixed(2)} free but session requests $${assignment.allocatedUsd.toFixed(2)}.`,
          });
        }
      }
    }

    return failures.length === 0 ? { ok: true } : { ok: false, failures };
  }

  updateSettings(
    brokerAccountId: string,
    patch: {
      maxSessions?: number;
      allocationEnforcement?: AllocationEnforcement;
      balanceRefreshIntervalMin?: number;
      mockScenarioKind?: MockScenarioKind | null;
    },
  ): void {
    if (patch.maxSessions !== undefined) {
      if (patch.maxSessions < 1 || patch.maxSessions > 50) {
        throw new AppError(
          "maxSessions must be between 1 and 50",
          "VALIDATION_FAILED",
        );
      }
      const activeSessions = this.sessionRepo.listByStatuses([
        "active",
        "paused",
      ]);
      const activeIds = activeSessions.map((session) => session.id);
      const currentCount = this.assignmentsRepo.countActiveSessionsForBroker(
        brokerAccountId,
        activeIds,
      );
      if (patch.maxSessions < currentCount) {
        throw new AppError(
          `Cannot reduce cap to ${patch.maxSessions}; broker has ${currentCount} active sessions.`,
          "VALIDATION_FAILED",
        );
      }
    }
    if (patch.balanceRefreshIntervalMin !== undefined) {
      if (
        patch.balanceRefreshIntervalMin < 1 ||
        patch.balanceRefreshIntervalMin > 60
      ) {
        throw new AppError(
          "balanceRefreshIntervalMin must be between 1 and 60",
          "VALIDATION_FAILED",
        );
      }
    }
    this.brokerAccountsRepo.updateSettings(brokerAccountId, patch);
  }
}
