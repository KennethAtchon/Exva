import type { ExecutionMode } from "@/lib/types";
import {
  executionModeForEnvironment,
  sessionMatchesEnvironment,
} from "@electron/shared/domain/environment-mode";
import { AppError } from "@electron/shared/infra/errors";
import type { AppServices } from "../services/app-services";

export function clearFocusIfEnvironmentMismatch(services: AppServices): void {
  const prefs = services.repos.workspacePreferences.get();
  const focused = services.repos.session.getFocused();
  if (
    focused &&
    !sessionMatchesEnvironment(
      focused.executionMode,
      prefs.globalEnvironmentMode,
    )
  ) {
    services.repos.session.clearFocus();
  }
}

export function assertExecutionModeMatchesWorkspace(
  services: AppServices,
  executionMode: ExecutionMode,
): void {
  const prefs = services.repos.workspacePreferences.get();
  const required = executionModeForEnvironment(prefs.globalEnvironmentMode);
  if (executionMode !== required) {
    throw new AppError(
      `Session execution mode must be ${required} while workspace is in ${prefs.globalEnvironmentMode} mode.`,
      "VALIDATION_FAILED",
      {
        executionMode,
        required,
        globalEnvironmentMode: prefs.globalEnvironmentMode,
      },
    );
  }
}

export function assertBrokerModeMatchesWorkspace(
  services: AppServices,
  mode: "paper" | "live",
): void {
  const prefs = services.repos.workspacePreferences.get();
  if (prefs.globalEnvironmentMode !== mode) {
    throw new AppError(
      `Broker mode must be ${prefs.globalEnvironmentMode} for the current workspace environment.`,
      "VALIDATION_FAILED",
      { mode, globalEnvironmentMode: prefs.globalEnvironmentMode },
    );
  }
}

export function assertFocusedSessionMatchesWorkspace(
  services: AppServices,
): string {
  const prefs = services.repos.workspacePreferences.get();
  const sessionId = services.repos.session.getFocusedSessionId();
  const session = services.repos.session.requireById(sessionId);
  if (
    !sessionMatchesEnvironment(
      session.executionMode,
      prefs.globalEnvironmentMode,
    )
  ) {
    throw new AppError(
      `Focused session "${session.name}" does not match the ${prefs.globalEnvironmentMode} workspace environment. Switch environment or change focus.`,
      "VALIDATION_FAILED",
      {
        sessionId,
        sessionExecutionMode: session.executionMode,
        globalEnvironmentMode: prefs.globalEnvironmentMode,
      },
    );
  }
  return sessionId;
}

export function assertSessionInWorkspaceEnvironment(
  services: AppServices,
  sessionId: string,
): void {
  const prefs = services.repos.workspacePreferences.get();
  const session = services.repos.session.requireById(sessionId);
  if (
    !sessionMatchesEnvironment(
      session.executionMode,
      prefs.globalEnvironmentMode,
    )
  ) {
    throw new AppError(
      `Session "${session.name}" is not in the current ${prefs.globalEnvironmentMode} workspace environment.`,
      "VALIDATION_FAILED",
      {
        sessionId,
        sessionExecutionMode: session.executionMode,
        globalEnvironmentMode: prefs.globalEnvironmentMode,
      },
    );
  }
}

export function workspaceEnvironmentSessionIds(
  services: AppServices,
): string[] {
  const prefs = services.repos.workspacePreferences.get();
  const executionMode = executionModeForEnvironment(
    prefs.globalEnvironmentMode,
  );
  return services.repos.session
    .list({ includeArchived: true, executionMode })
    .map((session) => session.id);
}
