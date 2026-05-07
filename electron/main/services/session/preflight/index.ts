import type { WorkspaceSession } from "@/lib/types";
import { brokerReachabilityCheck } from "./broker-reachability-check";
import { capitalPoolCheck } from "./capital-pool-check";
import { instrumentConflictCheck } from "./instrument-conflict-check";
import { providerCredentialsCheck } from "./provider-credentials-check";
import { selectorConfigCheck } from "./selector-config-check";
import type { OrchestratorDeps, PreflightResult, PreflightStepFailure } from "../session-types";
import { taskBoundaryCheck } from "./task-boundary-check";

type StepResult = { ok: true } | PreflightStepFailure;

export async function runPreflight(session: WorkspaceSession, deps: OrchestratorDeps): Promise<PreflightResult> {
  const steps: Array<{ check: string; run: () => Promise<StepResult> }> = [
    { check: "task-boundary", run: () => taskBoundaryCheck(session) },
    { check: "provider-credentials", run: () => providerCredentialsCheck(session, deps) },
    { check: "broker-reachability", run: () => brokerReachabilityCheck(session, deps) },
    { check: "capital-pool", run: () => capitalPoolCheck(session, deps) },
    { check: "selector-config", run: () => selectorConfigCheck(session, deps) },
    { check: "instrument-conflict", run: () => instrumentConflictCheck(session, deps) },
  ];

  for (const step of steps) {
    const result = await step.run();
    if (!result.ok) {
      return {
        ok: false,
        check: step.check,
        code: result.code,
        message: result.message,
        details: result.details,
      };
    }
  }

  return { ok: true };
}
