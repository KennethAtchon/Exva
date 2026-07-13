import type { WorkspaceSession } from "@/lib/types";
import { brokerAllocationCheck } from "./broker-allocation-check";
import { brokerReachabilityCheck } from "./broker-reachability-check";
import { instrumentConflictCheck } from "./instrument-conflict-check";
import { ohlcvDataProbeCheck } from "./ohlcv-data-probe-check";
import { providerCredentialsCheck } from "./provider-credentials-check";
import { selectorConfigCheck } from "./selector-config-check";
import { signalSourceCapabilityCheck } from "./signal-source-capability-check";
import type {
  OrchestratorDeps,
  PreflightResult,
  PreflightStepFailure,
} from "../session-types";
import { taskBoundaryCheck } from "./task-boundary-check";

type StepResult = { ok: true } | PreflightStepFailure;

export async function runPreflight(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<PreflightResult> {
  const steps: Array<{ check: string; run: () => Promise<StepResult> }> = [
    { check: "task-boundary", run: () => taskBoundaryCheck(session, deps) },
    {
      check: "provider-credentials",
      run: () => providerCredentialsCheck(session, deps),
    },
    {
      check: "broker-reachability",
      run: () => brokerReachabilityCheck(session, deps),
    },
    {
      check: "broker-allocation",
      run: () => brokerAllocationCheck(session, deps),
    },
    { check: "selector-config", run: () => selectorConfigCheck(session, deps) },
    {
      check: "instrument-conflict",
      run: () => instrumentConflictCheck(session, deps),
    },
    {
      check: "signal-source-capability",
      run: () => signalSourceCapabilityCheck(),
    },
    {
      check: "ohlcv-data-probe",
      run: () => ohlcvDataProbeCheck(),
    },
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
