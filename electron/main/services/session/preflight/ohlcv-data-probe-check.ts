import type { PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Legacy OHLCV probe check: now always passes since session_signal_sources is
 * removed. OHLCV data availability is validated at subscription time in V2.
 */
export async function ohlcvDataProbeCheck(): Promise<StepResult> {
  return { ok: true };
}
