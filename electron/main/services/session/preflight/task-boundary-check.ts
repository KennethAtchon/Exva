import type { WorkspaceSession } from "@/lib/types";
import { sessionRequiresInstrumentScope } from "@electron/shared/domain";
import { resolveSessionInstrumentClasses } from "../effective-instrument-classes";
import type { OrchestratorDeps } from "../session-types";
import type { PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function taskBoundaryCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  if (!session.name.trim()) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Session name is required.",
    };
  }
  if (!session.objective.trim()) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Session objective is required.",
    };
  }
  if (resolveSessionInstrumentClasses(session, deps).length === 0) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "At least one instrument class is required.",
    };
  }
  const subscribedSourceTypes =
    deps.signalSourcesRepo.subscribedSourceTypesForSession(session.id);
  const requiresInstrumentScope = sessionRequiresInstrumentScope(
    subscribedSourceTypes.map((type) => ({ type })),
  );
  if (requiresInstrumentScope && !session.instrumentScope.trim()) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Instrument scope is required.",
    };
  }
  if (!session.executionMode) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Execution mode is required.",
    };
  }
  return { ok: true };
}
