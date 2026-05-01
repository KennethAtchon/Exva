import type { WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightResult } from "../session-types";

export async function capitalPoolCheck(
  _session: WorkspaceSession,
  _deps: OrchestratorDeps,
): Promise<PreflightResult> {
  return { ok: true };
}
