import type { SessionRepo } from "../../db/repositories/session-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessions } from "../../db/schema";

export interface LiveReadinessCheck {
  name: string;
  passed: boolean;
  requiresAck: boolean;
  message?: string;
}

export interface LiveReadinessReport {
  sessionId: string;
  checks: LiveReadinessCheck[];
  allChecksPassed: boolean;
  acknowledgedAt: string | null;
  readyToStart: boolean;
}

export class LiveReadinessService {
  constructor(
    private readonly client: DbClient,
    private readonly sessionRepo: SessionRepo,
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly brokerRegistry: BrokerRegistry,
  ) {}

  async check(sessionId: string): Promise<LiveReadinessReport> {
    const session = this.sessionRepo.requireById(sessionId);
    const checks: LiveReadinessCheck[] = [];

    // Check 1: execution mode is live_allowed
    checks.push({
      name: "execution_mode",
      passed: session.executionMode === "live_allowed",
      requiresAck: false,
      message: session.executionMode !== "live_allowed" ? `Execution mode is '${session.executionMode}'` : undefined,
    });

    // Check 2: at least one broker assignment exists for the session
    const assignedIds = this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId);
    const hasBrokerAssignment = assignedIds.length > 0;
    checks.push({
      name: "broker_assigned",
      passed: hasBrokerAssignment,
      requiresAck: false,
      message: !hasBrokerAssignment ? "No broker account assigned to this session" : undefined,
    });

    // Check 3: assigned broker accounts are in live (non-paper) mode
    let brokerIsLive = false;
    if (hasBrokerAssignment) {
      const accounts = assignedIds
        .map((id) => this.brokerAccountsRepo.find(id))
        .filter(Boolean);
      brokerIsLive = accounts.length > 0 && accounts.every((a) => a && a.mode !== "paper");
    }
    checks.push({
      name: "broker_live_mode",
      passed: brokerIsLive,
      requiresAck: false,
      message: !brokerIsLive ? "Assigned broker account(s) are still in paper mode" : undefined,
    });

    // Check 4: ALL assigned brokers pass connection test (not just the first)
    let brokerConnected = false;
    let connectionFailures: string[] = [];
    if (hasBrokerAssignment) {
      const results = await Promise.all(
        assignedIds.map(async (id) => {
          try {
            const adapter = await this.brokerRegistry.get(id);
            const result = await adapter.testConnection();
            return { id, ok: result.ok };
          } catch {
            return { id, ok: false };
          }
        }),
      );
      connectionFailures = results.filter((r) => !r.ok).map((r) => r.id);
      brokerConnected = results.length > 0 && connectionFailures.length === 0;
    }
    checks.push({
      name: "broker_connected",
      passed: brokerConnected,
      requiresAck: false,
      message: !brokerConnected
        ? connectionFailures.length > 0
          ? `Broker connection test failed for: ${connectionFailures.join(", ")}`
          : "Broker connection test failed"
        : undefined,
    });

    // Check 4b: ALL assigned brokers must be launch-capable adapters
    // (close/flatten and positions implemented against the real API).
    let brokerLaunchCapable = false;
    let nonLaunchAdapters: string[] = [];
    if (hasBrokerAssignment) {
      const results = await Promise.all(
        assignedIds.map(async (id) => {
          try {
            const adapter = await this.brokerRegistry.get(id);
            return { id, capable: adapter.launchCapable };
          } catch {
            return { id, capable: false };
          }
        }),
      );
      nonLaunchAdapters = results.filter((r) => !r.capable).map((r) => r.id);
      brokerLaunchCapable = results.length > 0 && nonLaunchAdapters.length === 0;
    }
    checks.push({
      name: "broker_launch_capable",
      passed: brokerLaunchCapable,
      requiresAck: false,
      message: !brokerLaunchCapable
        ? nonLaunchAdapters.length > 0
          ? `Broker adapter(s) not launch-capable: ${nonLaunchAdapters.join(", ")}`
          : "Broker adapter is not launch-capable"
        : undefined,
    });

    // Check 5: explicit user acknowledgement (requires all others to pass)
    const acknowledgedAt = this.getAcknowledgedAt(sessionId);
    checks.push({
      name: "user_acknowledged",
      passed: acknowledgedAt !== null,
      requiresAck: true,
      message: acknowledgedAt === null ? "User must acknowledge readiness before starting a live session" : undefined,
    });

    const allChecksPassed = checks.every((c) => c.passed);
    return {
      sessionId,
      checks,
      allChecksPassed,
      acknowledgedAt,
      readyToStart: allChecksPassed,
    };
  }

  acknowledge(sessionId: string): void {
    this.client.db
      .update(sessions)
      .set({ liveReadinessAcknowledgedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  clearAcknowledgement(sessionId: string): void {
    this.client.db
      .update(sessions)
      .set({ liveReadinessAcknowledgedAt: null, updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  private getAcknowledgedAt(sessionId: string): string | null {
    const row = this.client.db
      .select({ liveReadinessAcknowledgedAt: sessions.liveReadinessAcknowledgedAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    return row?.liveReadinessAcknowledgedAt ?? null;
  }
}
