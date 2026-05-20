import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";
import { resolveSessionInstrumentClasses } from "../effective-instrument-classes";

type StepResult = { ok: true } | PreflightStepFailure;

export async function brokerReachabilityCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  const assignedIds = deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(
    session.id,
  );
  const instrumentClasses = resolveSessionInstrumentClasses(session, deps);
  if (assignedIds.length === 0) {
    return {
      ok: false,
      code: "NO_BROKER",
      message:
        "Assign at least one broker account to this session before starting.",
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
    const overlap = row.supportedInstrumentClasses.some((cls) =>
      instrumentClasses.includes(cls),
    );
    if (!overlap) {
      return {
        ok: false,
        code: "UNSUPPORTED_INSTRUMENT",
        message: `Broker "${row.name}" does not support any of this session's instrument classes.`,
        details: {
          brokerAccountId,
          supports: row.supportedInstrumentClasses,
          requested: instrumentClasses,
        },
      };
    }
  }

  for (const ic of instrumentClasses) {
    try {
      deps.brokerRouting.resolveBrokerAccountId(session.id, ic);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        code: "NO_BROKER",
        message: `Cannot resolve broker for instrument class "${ic}": ${message}`,
        details: { instrumentClass: ic },
      };
    }
  }

  for (const brokerAccountId of assignedIds) {
    const adapter = await deps.brokerRegistry.get(brokerAccountId);
    const result = await adapter.testConnection();
    if (!result.ok) {
      return {
        ok: false,
        code: "BROKER_UNREACHABLE",
        message:
          result.message || `Broker ${brokerAccountId} is not reachable.`,
        details: { brokerAccountId, brokerMessage: result.message },
      };
    }
  }

  return { ok: true };
}
