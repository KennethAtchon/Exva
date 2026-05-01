import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function capitalPoolCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const workspace = deps.workspacePreferencesRepo.get();
  if (workspace.capitalAllocationMode !== "shared_global_pool") return { ok: true };

  const ceiling = workspace.globalCapitalPoolUsd;
  if (ceiling == null || ceiling <= 0) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "Shared global pool requires a positive global capital amount in workspace preferences.",
      details: { field: "globalCapitalPoolUsd" },
    };
  }

  const reserved = deps.capitalReservationsRepo.sumActiveReservedUsd();
  const requested = reserved + session.capitalLimitUsd;
  if (requested > ceiling) {
    return {
      ok: false,
      code: "CAPITAL_POOL_EXCEEDED",
      message: `Capital pool would be exceeded: ${requested} > ${ceiling} (reserved ${reserved} + this session ${session.capitalLimitUsd}).`,
      details: { reserved, requested, ceiling, sessionCapital: session.capitalLimitUsd },
    };
  }

  return { ok: true };
}
