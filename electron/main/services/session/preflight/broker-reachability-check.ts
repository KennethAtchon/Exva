import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightResult } from "../session-types";

export async function brokerReachabilityCheck(
  _session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<PreflightResult> {
  const result = await deps.broker.testConnection();
  if (!result.ok) {
    return {
      ok: false,
      code: "BROKER_UNREACHABLE",
      message: result.message || "Broker is not reachable.",
    };
  }
  return { ok: true };
}
