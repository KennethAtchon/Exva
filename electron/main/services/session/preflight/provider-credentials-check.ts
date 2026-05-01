import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function providerCredentialsCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const roles = deps.sessionAiRolesRepo.listBySession(session.id);
  for (const role of roles) {
    if (!role.providerKey.trim()) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `AI role "${role.role}" has no provider selected. Connect a provider in Accounts or pick one in Strategy.`,
        details: { role: role.role },
      };
    }
    const account = deps.providerAccountsRepo.find(role.providerKey);
    if (!account) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Provider account "${role.providerKey}" for role "${role.role}" was not found.`,
        details: { role: role.role, providerKey: role.providerKey },
      };
    }
    if (account.category !== "ai") {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Provider "${account.name}" is not an AI provider.`,
        details: { role: role.role, providerKey: role.providerKey },
      };
    }
    if (!account.isConfigured) {
      return {
        ok: false,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Connect this provider in Accounts before assigning it to ${role.role.replace(/_/g, " ")}.`,
        details: { role: role.role, providerKey: role.providerKey },
      };
    }
    if (!role.modelId.trim()) {
      return {
        ok: false,
        code: "VALIDATION_FAILED",
        message: `Select a model for the ${role.role.replace(/_/g, " ")} role.`,
        details: { role: role.role },
      };
    }
  }

  return { ok: true };
}
