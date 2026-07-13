import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Legacy OHLCV probe check: now always passes since session_signal_sources is
 * removed. OHLCV data availability is validated at subscription time in V2.
 */
export async function ohlcvDataProbeCheck(
  _session: WorkspaceSession,
  _deps: OrchestratorDeps,
): Promise<StepResult> {
  return { ok: true };
}
