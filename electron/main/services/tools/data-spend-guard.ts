import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import { createOutcomeError } from "../orchestration/cycle/runtime-outcome";

export function assertSessionDataSpendAvailable(deps: {
  sessionId: string;
  apiCallLogRepo: ApiCallLogRepo;
  maxDataSpendUsd?: number | null;
}): void {
  if (deps.maxDataSpendUsd == null) return;
  if (
    deps.apiCallLogRepo.dailyDataSpendUsd(deps.sessionId) >=
    deps.maxDataSpendUsd
  ) {
    throw createOutcomeError(
      "Session max data spend reached; data tools blocked by runtime policy.",
      "SPEND_CAP_EXCEEDED",
      {
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      },
    );
  }
}
