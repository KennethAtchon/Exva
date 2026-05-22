import type { ExecutionMode, WorkspacePreferences } from "@/lib/types";
import {
  brokerModeForEnvironment,
  executionModeForEnvironment,
} from "@electron/shared/domain/environment-mode";

export type EnvironmentScopedFilters = {
  executionMode?: ExecutionMode;
  includeAllEnvironments?: boolean;
};

export function resolveExecutionModeFilter(
  prefs: WorkspacePreferences,
  filters: EnvironmentScopedFilters = {},
): ExecutionMode | undefined {
  if (filters.includeAllEnvironments) {
    return filters.executionMode;
  }
  if (filters.executionMode) {
    return filters.executionMode;
  }
  return executionModeForEnvironment(prefs.globalEnvironmentMode);
}

export function resolveBrokerModeFilter(
  prefs: WorkspacePreferences,
  options: { includeAllEnvironments?: boolean; mode?: "paper" | "live" } = {},
): "paper" | "live" | undefined {
  if (options.includeAllEnvironments) {
    return options.mode;
  }
  if (options.mode) {
    return options.mode;
  }
  return brokerModeForEnvironment(prefs.globalEnvironmentMode);
}
