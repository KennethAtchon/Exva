import type { WorkspaceSession } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type {
  OrchestratorDeps,
  PreflightResult,
  SessionLifecycleDeps,
} from "./session-types";

/**
 * Shared start/resume gate (Solution 02 WS8).
 * Live readiness + preflight must run on every activation, including resume.
 */
export async function prepareForActivation(input: {
  session: WorkspaceSession;
  liveReadiness: SessionLifecycleDeps["liveReadiness"];
  preflight: (
    session: WorkspaceSession,
    deps: OrchestratorDeps,
  ) => Promise<PreflightResult>;
  orchestratorDeps: OrchestratorDeps;
  emitSessionEvent: (
    sessionId: string,
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    agentType: "session" | "preflight",
  ) => void;
  /** Optional history depth provision before preflight (Solution 06). */
  provisionHistory?: (session: WorkspaceSession) => Promise<void>;
}): Promise<void> {
  const { session } = input;

  if (session.executionMode === "live_allowed") {
    const readiness = await input.liveReadiness.check(session.id);
    if (!readiness.readyToStart) {
      const blockedBy = readiness.checks
        .filter((c) => !c.passed)
        .map((c) => c.name);
      const message = `Live readiness gate failed: ${blockedBy.join(", ")}`;
      input.emitSessionEvent(session.id, "ERROR", message, "preflight");
      throw new AppError(message, "VALIDATION_FAILED", {
        blockedBy,
        checks: readiness.checks,
      });
    }
  }

  if (input.provisionHistory) {
    await input.provisionHistory(session);
  }

  const preflight = await input.preflight(session, input.orchestratorDeps);
  if (!preflight.ok) {
    const fullMessage = `Preflight ${preflight.check} failed: ${preflight.message}`;
    input.emitSessionEvent(session.id, "ERROR", fullMessage, "preflight");
    throw new AppError(fullMessage, preflight.code, preflight.details);
  }
}
