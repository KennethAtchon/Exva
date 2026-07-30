import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { PaperScorecardService } from "../analytics/paper-scorecard-service";
import type { ExperienceScorecardService } from "../analytics/experience-scorecard-service";
import type { ResearchExperimentService } from "../research/research-experiment-service";
import type { AdapterCertificationService } from "../broker/adapter-certification-service";
import { adapterCertIsFresh } from "@electron/shared/domain/adapter-certification";
import { requireExperience } from "../../experiences/index";
import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessions } from "../../db/schema";

interface LiveReadinessCheck {
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

function safeContract(experienceId: string) {
  try {
    return requireExperience(experienceId).researchContract;
  } catch {
    return null;
  }
}

export class LiveReadinessService {
  constructor(
    private readonly client: DbClient,
    private readonly sessionRepo: SessionRepo,
    private readonly brokerAccountsRepo: BrokerAccountsRepo,
    private readonly sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly researchExperiment: ResearchExperimentService,
    private readonly paperScorecard?: PaperScorecardService,
    private readonly experienceScorecard?: ExperienceScorecardService,
    private readonly adapterCertification?: AdapterCertificationService,
  ) {}

  async check(sessionId: string): Promise<LiveReadinessReport> {
    const session = this.sessionRepo.requireById(sessionId);
    const checks: LiveReadinessCheck[] = [];

    // Check 1: execution mode is live_allowed
    checks.push({
      name: "execution_mode",
      passed: session.executionMode === "live_allowed",
      requiresAck: false,
      message:
        session.executionMode !== "live_allowed"
          ? `Execution mode is '${session.executionMode}'`
          : undefined,
    });

    // Check 2: at least one broker assignment exists for the session
    const assignedIds =
      this.sessionBrokerAssignmentsRepo.listBrokerAccountIds(sessionId);
    const hasBrokerAssignment = assignedIds.length > 0;
    checks.push({
      name: "broker_assigned",
      passed: hasBrokerAssignment,
      requiresAck: false,
      message: !hasBrokerAssignment
        ? "No broker account assigned to this session"
        : undefined,
    });

    // Check 3: assigned broker accounts are in live (non-paper) mode
    let brokerIsLive = false;
    if (hasBrokerAssignment) {
      const accounts = assignedIds
        .map((id) => this.brokerAccountsRepo.find(id))
        .filter(Boolean);
      brokerIsLive =
        accounts.length > 0 && accounts.every((a) => a && a.mode !== "paper");
    }
    checks.push({
      name: "broker_live_mode",
      passed: brokerIsLive,
      requiresAck: false,
      message: !brokerIsLive
        ? "Assigned broker account(s) are still in paper mode"
        : undefined,
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
    // Non-Alpaca adapters with launchCapable=false may pass when adapter cert
    // has succeeded (Solution 04).
    let brokerLaunchCapable = false;
    let nonLaunchAdapters: string[] = [];
    if (hasBrokerAssignment) {
      const results = await Promise.all(
        assignedIds.map(async (id) => {
          try {
            const adapter = await this.brokerRegistry.get(id);
            const account = this.brokerAccountsRepo.find(id);
            const certPassed =
              this.adapterCertification?.isEffectivelyLaunchCapable(id) ??
              false;
            const effectiveCapable =
              adapter.launchCapable ||
              (certPassed && account?.brokerType !== "alpaca");
            return { id, capable: effectiveCapable };
          } catch {
            return { id, capable: false };
          }
        }),
      );
      nonLaunchAdapters = results.filter((r) => !r.capable).map((r) => r.id);
      brokerLaunchCapable =
        results.length > 0 && nonLaunchAdapters.length === 0;
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

    // Check 4c: Alpaca (and any adapter exposing entitlements) account honesty
    let entitlementsOk = true;
    let entitlementsMessage: string | undefined;
    if (hasBrokerAssignment) {
      const entitlementFailures: string[] = [];
      for (const id of assignedIds) {
        try {
          const adapter = await this.brokerRegistry.get(id);
          if (!adapter.getTradingEntitlements) continue;
          const ent = await adapter.getTradingEntitlements();
          if (ent.tradingBlocked) {
            entitlementFailures.push(`${id}: trading_blocked`);
          }
          if (ent.buyingPower != null && ent.buyingPower <= 0) {
            entitlementFailures.push(`${id}: buying_power<=0`);
          }
        } catch (err) {
          entitlementFailures.push(
            `${id}: entitlements_unavailable (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
      entitlementsOk = entitlementFailures.length === 0;
      entitlementsMessage = entitlementsOk
        ? undefined
        : `Account entitlement check failed: ${entitlementFailures.join("; ")}`;
    }
    checks.push({
      name: "broker_account_entitlements",
      passed: entitlementsOk,
      requiresAck: false,
      message: entitlementsMessage,
    });

    // Check 4d: non-Alpaca brokers require a fresh persisted adapter cert.
    let adapterCertOk = true;
    let adapterCertMessage: string | undefined;
    if (hasBrokerAssignment && this.adapterCertification) {
      const certFailures: string[] = [];
      for (const id of assignedIds) {
        const account = this.brokerAccountsRepo.find(id);
        if (!account || account.brokerType === "alpaca") continue;
        const latest = this.adapterCertification.getLatest(id);
        if (!latest?.passed) {
          certFailures.push(`${id}: no passing adapter cert`);
          continue;
        }
        if (!adapterCertIsFresh(latest.certifiedAt)) {
          certFailures.push(`${id}: adapter cert stale`);
        }
      }
      adapterCertOk = certFailures.length === 0;
      adapterCertMessage = adapterCertOk
        ? undefined
        : `Adapter certification required: ${certFailures.join("; ")}`;
    }
    checks.push({
      name: "broker_capability_certified",
      passed: adapterCertOk,
      requiresAck: false,
      message: adapterCertMessage,
    });

    // Check 5: paper scorecard meets promotion criteria (experience-level)
    let paperScorecardPassed = false;
    let paperScorecardMessage: string | undefined;
    if (this.experienceScorecard) {
      const scorecard = this.experienceScorecard.generateForExperience(
        session.experienceId,
      );
      paperScorecardPassed = scorecard.meetsPromotion;
      if (!paperScorecardPassed) {
        paperScorecardMessage = `Experience '${scorecard.displayName}' does not meet promotion criteria: ${scorecard.failedPromotionCriteria.join(", ")}`;
      }
    } else {
      paperScorecardPassed = true;
    }
    checks.push({
      name: "paper_scorecard_meets_promotion",
      passed: paperScorecardPassed,
      requiresAck: false,
      message: paperScorecardMessage,
    });

    // Check 5b: statistical promotion (P7 / remediation #8). The experience
    // must have cleared the statistical promotion gate to the "live" tier —
    // not just the descriptive paper scorecard.
    const tier = this.researchExperiment.currentTier(session.experienceId);
    const passed = tier === "live";
    const contract = safeContract(session.experienceId);
    checks.push({
      name: "statistical_promotion",
      passed,
      requiresAck: false,
      message: passed
        ? undefined
        : `Experience has not been statistically promoted to live (current tier: ${tier}).` +
          (contract
            ? ` Requires >= ${contract.validation.minOutOfSampleTrades} out-of-sample labeled opportunities with positive lower-bound expectancy.`
            : ""),
    });

    // Check 6: explicit user acknowledgement (requires all others to pass)
    const acknowledgedAt = this.getAcknowledgedAt(sessionId);
    checks.push({
      name: "user_acknowledged",
      passed: acknowledgedAt !== null,
      requiresAck: true,
      message:
        acknowledgedAt === null
          ? "User must acknowledge readiness before starting a live session"
          : undefined,
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
      .set({
        liveReadinessAcknowledgedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  clearAcknowledgement(sessionId: string): void {
    this.client.db
      .update(sessions)
      .set({
        liveReadinessAcknowledgedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  getAcknowledgedAt(sessionId: string): string | null {
    const row = this.client.db
      .select({
        liveReadinessAcknowledgedAt: sessions.liveReadinessAcknowledgedAt,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    return row?.liveReadinessAcknowledgedAt ?? null;
  }
}
