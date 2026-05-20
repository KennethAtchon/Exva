import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function brokerAllocationCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  const assignmentIds = deps.sessionBrokerAssignmentsRepo.listBrokerAccountIds(
    session.id,
  );
  if (assignmentIds.length === 0) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "No broker accounts assigned. Add at least one to start.",
    };
  }

  const refreshResults =
    await deps.brokerBalanceCache.refreshAll(assignmentIds);
  for (const result of refreshResults) {
    if (!result.error) continue;
    return {
      ok: false,
      code: "BROKER_UNREACHABLE",
      message: `Could not fetch balance for broker ${result.id}: ${result.error}`,
      details: { brokerAccountId: result.id },
    };
  }

  const capitalCheck = deps.brokerCapital.checkSessionStartFits(session.id);
  if (!capitalCheck.ok) {
    const first = capitalCheck.failures[0];
    if (!first) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: "Broker allocation check failed.",
      };
    }
    return {
      ok: false,
      code:
        first.reason === "session_cap_exceeded"
          ? "BROKER_SESSION_CAP_EXCEEDED"
          : "BROKER_ALLOCATION_EXCEEDED",
      message: first.detail,
      details: { failures: capitalCheck.failures },
    };
  }

  return { ok: true };
}
