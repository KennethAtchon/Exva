import type { PollResult } from "@electron/shared/domain";
import {
  classifyPollError,
  type RecordSignalSourcePollInput,
  type SignalSourcePollOutcome,
} from "@electron/shared/domain/signal-source-health";
import type { SignalSourceRuntimeRepo } from "./repos/signal-source-runtime-repo";

export function emptyPollResult(): PollResult {
  return { detected: 0, passed: 0, dropped: 0, errors: [] };
}

/** Best-effort durable poll write — sources must remain usable in unit tests without a repo. */
export function persistSourcePoll(
  runtimeRepo: SignalSourceRuntimeRepo | null | undefined,
  input: RecordSignalSourcePollInput,
): void {
  runtimeRepo?.recordPoll(input);
}

export function httpStatusFromErrorMessage(message: string): number | null {
  const match = message.match(/\b(?:status|HTTP)\s+(\d{3})\b/i);
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function classifyPollFailure(message: string): {
  outcome: SignalSourcePollOutcome;
  httpStatus: number | null;
} {
  return {
    outcome: classifyPollError(message),
    httpStatus: httpStatusFromErrorMessage(message),
  };
}
