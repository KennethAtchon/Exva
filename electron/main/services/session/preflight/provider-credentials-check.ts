import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightResult } from "../session-types";

export async function providerCredentialsCheck(
  _session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<PreflightResult> {
  const hasProviderKey = await deps.ai.hasProviderKey();
  if (!hasProviderKey) {
    return {
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Anthropic API key is not configured.",
    };
  }
  return { ok: true };
}
