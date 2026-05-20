import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function providerCredentialsCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  const phases = deps.sessionAiPhasesRepo.listBySession(session.id);
  for (const phase of phases) {
    if (!phase.providerKey.trim()) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `AI phase "${phase.phase}" has no provider selected. Connect a provider in Accounts or pick one in Strategy.`,
        details: { phase: phase.phase },
      };
    }
    const account = deps.providerAccountsRepo.find(phase.providerKey);
    if (!account) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Provider account "${phase.providerKey}" for phase "${phase.phase}" was not found.`,
        details: { phase: phase.phase, providerKey: phase.providerKey },
      };
    }
    if (account.category !== "ai") {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Provider "${account.name}" is not an AI provider.`,
        details: { phase: phase.phase, providerKey: phase.providerKey },
      };
    }
    if (!account.isConfigured) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Connect this provider in Accounts before assigning it to phase ${phase.phase}.`,
        details: { phase: phase.phase, providerKey: phase.providerKey },
      };
    }
    if (!phase.modelId.trim()) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: `Select a model for the ${phase.phase} phase.`,
        details: { phase: phase.phase },
      };
    }
  }

  return { ok: true };
}
