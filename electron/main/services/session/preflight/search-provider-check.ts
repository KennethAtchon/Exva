import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";

type StepResult = { ok: true } | PreflightStepFailure;

export async function searchProviderCheck(session: WorkspaceSession, deps: OrchestratorDeps): Promise<StepResult> {
  const roles = deps.sessionAiRolesRepo.listBySession(session.id);
  const needsSearch = roles.some((r) => r.webSearchEnabled);
  if (!needsSearch) return { ok: true };

  const workspace = deps.workspacePreferencesRepo.get();
  const searchProviderId = session.defaultSearchProviderId ?? workspace.defaultSearchProviderId;
  if (!searchProviderId) {
    return {
      ok: false,
      code: "SEARCH_PROVIDER_REQUIRED",
      message:
        "Web search is enabled for at least one AI role. Set a search provider on this session or in workspace preferences.",
      details: { field: "defaultSearchProviderId" },
    };
  }

  const account = deps.providerAccountsRepo.find(searchProviderId);
  if (!account || account.category !== "search") {
    return {
      ok: false,
      code: "SEARCH_PROVIDER_REQUIRED",
      message: "Resolved search provider is missing or not a search provider account.",
      details: { providerId: searchProviderId },
    };
  }
  if (!account.isConfigured) {
    return {
      ok: false,
      code: "SEARCH_PROVIDER_REQUIRED",
      message: "Configure the selected web search provider in Accounts before starting.",
      details: { providerId: searchProviderId },
    };
  }

  return { ok: true };
}
