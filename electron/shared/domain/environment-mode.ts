import type { BrokerMode, ExecutionMode } from "./enums";

export type GlobalEnvironmentMode = "paper" | "live";

export function executionModeForEnvironment(
  mode: GlobalEnvironmentMode,
): ExecutionMode {
  return mode === "live" ? "live_allowed" : "paper_only";
}

export function brokerModeForEnvironment(
  mode: GlobalEnvironmentMode,
): BrokerMode {
  return mode;
}

export function sessionMatchesEnvironment(
  sessionExecutionMode: ExecutionMode,
  environmentMode: GlobalEnvironmentMode,
): boolean {
  return (
    sessionExecutionMode === executionModeForEnvironment(environmentMode)
  );
}
