import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function selectorConfigCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const selectorSettings = deps.sessionSelectorSettingsRepo.get(session.id);
  if (session.selectionMode !== "ai_selected_universe" || !selectorSettings.aiPickerEnabled) {
    return { ok: true };
  }

  const searchProviderId = session.defaultSearchProviderId ?? deps.workspacePreferencesRepo.get().defaultSearchProviderId ?? null;
  if (!searchProviderId) {
    return {
      ok: false,
      code: "SEARCH_PROVIDER_REQUIRED",
      message: "AI-selected universe needs a search provider. Use the built-in DuckDuckGo default or configure Brave/Tavily in Accounts. OpenRouter model accounts do not satisfy this requirement.",
      details: { sessionId: session.id },
    };
  }
  const searchAccount = deps.providerAccountsRepo.find(searchProviderId);
  if (!searchAccount || searchAccount.category !== "search" || !searchAccount.isConfigured) {
    return {
      ok: false,
      code: "SEARCH_PROVIDER_REQUIRED",
      message: "The configured search provider for AI-selected universe is missing or not connected. Fix the search provider setting in Accounts before starting.",
      details: { sessionId: session.id, providerKey: searchProviderId },
    };
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
