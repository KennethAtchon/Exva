import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function selectorConfigCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const selectorSettings = deps.sessionSelectorSettingsRepo.get(session.id);
  if (session.selectionMode !== "ai_selected_universe" || !selectorSettings.aiPickerEnabled) {
    return { ok: true };
  }

  const role = deps.sessionAiRolesRepo.getByRole(session.id, "instrument_selector");
  if (!role) {
    return {
      ok: false,
      code: "SELECTOR_NOT_CONFIGURED",
      message: "Instrument selector AI role is missing from this session.",
      details: { sessionId: session.id },
    };
  }
  if (!role.providerKey.trim() || !role.modelId.trim()) {
    return {
      ok: false,
      code: "SELECTOR_NOT_CONFIGURED",
      message: "When AI-selected universe is enabled, configure provider and model for the instrument selector role in Strategy.",
      details: { role: "instrument_selector" },
    };
  }
  const account = deps.providerAccountsRepo.find(role.providerKey);
  if (!account?.isConfigured || account.category !== "ai") {
    return {
      ok: false,
      code: "SELECTOR_NOT_CONFIGURED",
      message: "Connect a valid AI provider for the instrument selector role before starting.",
      details: { providerKey: role.providerKey },
    };
  }

  return { ok: true };
}
