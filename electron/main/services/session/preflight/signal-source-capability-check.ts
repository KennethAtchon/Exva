import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Legacy check: now always passes since session_signal_sources is removed.
 * Instrument class compatibility is enforced via session_input_subscriptions (V2).
 */
export async function signalSourceCapabilityCheck(
  _session: WorkspaceSession,
  _deps: OrchestratorDeps,
): Promise<StepResult> {
  return { ok: true };
}
