import type { PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

/**
 * Legacy check: now always passes since session_signal_sources is removed.
 * Instrument class compatibility is enforced via session_input_subscriptions (V2).
 */
export async function signalSourceCapabilityCheck(): Promise<StepResult> {
  return { ok: true };
}
