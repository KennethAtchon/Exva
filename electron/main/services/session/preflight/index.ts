import type { WorkspaceSession } from "@/lib/types";
import { brokerReachabilityCheck } from "./broker-reachability-check";
import { capitalPoolCheck } from "./capital-pool-check";
import { instrumentConflictCheck } from "./instrument-conflict-check";
import { providerCredentialsCheck } from "./provider-credentials-check";
import { searchProviderCheck } from "./search-provider-check";
import { selectorConfigCheck } from "./selector-config-check";
import type { OrchestratorDeps, PreflightResult } from "../session-types";
import { taskBoundaryCheck } from "./task-boundary-check";

export async function runPreflight(session: WorkspaceSession, deps: OrchestratorDeps): Promise<PreflightResult> {
  const checks = [
    () => taskBoundaryCheck(session),
    () => providerCredentialsCheck(session, deps),
    () => brokerReachabilityCheck(session, deps),
    () => searchProviderCheck(session, deps),
    () => capitalPoolCheck(session, deps),
    () => selectorConfigCheck(session, deps),
    () => instrumentConflictCheck(session, deps),
  ];

  for (const check of checks) {
    const result = await check();
    if (!result.ok) return result;
  }

  return { ok: true };
}
