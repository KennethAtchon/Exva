import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Verifies each broker assigned to the session exists, then runs a single adapter connectivity test
 * (current app uses one live broker adapter in BrokerService).
 */
export async function brokerReachabilityCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const assignedIds = deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(session.id);
  if (assignedIds.length === 0) {
    return {
      ok: false,
      code: "NO_BROKER",
      message: "Assign at least one broker account to this session before starting.",
      details: { sessionId: session.id },
    };
  }

  for (const brokerAccountId of assignedIds) {
    const row = deps.brokerAccountsRepo.find(brokerAccountId);
    if (!row) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `Broker account ${brokerAccountId} is no longer available.`,
        details: { brokerAccountId },
      };
    }
    const overlap = row.supportedInstrumentClasses.some((cls) => session.instrumentClasses.includes(cls));
    if (!overlap) {
      return {
        ok: false,
        code: "UNSUPPORTED_INSTRUMENT",
        message: `Broker "${row.name}" does not support any of this session's instrument classes.`,
        details: { brokerAccountId, supports: row.supportedInstrumentClasses, requested: session.instrumentClasses },
      };
    }
  }

  for (const ic of session.instrumentClasses) {
    const resolved = deps.brokerRoutingRepo.resolveBrokerAccountId(session.id, ic);
    if (!resolved) {
      return {
        ok: false,
        code: "NO_BROKER",
        message: `No broker routing is configured for instrument class "${ic}". Set defaults in Accounts or session overrides.`,
        details: { instrumentClass: ic },
      };
    }
    if (!assignedIds.includes(resolved)) {
      return {
        ok: false,
        code: "ROUTING_AMBIGUOUS",
        message: `Resolved broker for ${ic} is not among this session's assigned brokers.`,
        details: { instrumentClass: ic, brokerAccountId: resolved },
      };
    }
  }

  const result = await deps.broker.testConnection();
  if (!result.ok) {
    return {
      ok: false,
      code: "BROKER_UNREACHABLE",
      message: result.message || "Broker is not reachable.",
      details: { brokerMessage: result.message },
    };
  }
  return { ok: true };
}
