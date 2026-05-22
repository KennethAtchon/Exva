import { ipcMain } from "electron";
import { isSessionEditable } from "@electron/shared/domain";
import { AppError } from "@electron/shared/infra/errors";
import { channels } from "@electron/shared/ipc/channels";
import {
  sessionArchiveSchema,
  sessionCreateInputSchema,
  sessionDuplicateInputSchema,
  sessionExecutionProgressSchema,
  sessionExecutionStepActionSchema,
  sessionFocusSchema,
  sessionIdParamSchema,
  sessionListFiltersSchema,
  sessionUpdateInputSchema,
} from "@electron/shared/validation/schemas";
import { sessionMatchesEnvironment } from "@electron/shared/domain/environment-mode";
import type { AppServices } from "../services/app-services";
import { resolveExecutionModeFilter } from "../services/workspace/environment-scope";
import {
  assertExecutionModeMatchesWorkspace,
  assertFocusedSessionMatchesWorkspace,
} from "./environment-guards";
import { handle } from "./handle";

export function registerSessionHandlers(services: AppServices): void {
  handle(ipcMain, channels.session.start, async () => {
    assertFocusedSessionMatchesWorkspace(services);
    return services.session.start();
  });
  handle(ipcMain, channels.session.pause, async () => {
    assertFocusedSessionMatchesWorkspace(services);
    return services.session.pause();
  });
  handle(ipcMain, channels.session.resume, async () => {
    assertFocusedSessionMatchesWorkspace(services);
    return services.session.resume();
  });
  handle(ipcMain, channels.session.stop, async () => {
    assertFocusedSessionMatchesWorkspace(services);
    return services.session.stop();
  });
  handle(ipcMain, channels.session.getStatus, async () =>
    services.session.getStatus(),
  );
  handle(ipcMain, channels.session.getExecutionProgress, async (payload) => {
    const { sessionId } = sessionExecutionProgressSchema.parse(payload);
    const { cycleId, steps } =
      services.repos.sessionExecutionSteps.getLatestCycleState(sessionId);
    return {
      steps: steps.map((step) => ({
        stage: step.stage,
        status: step.status,
        attempt: step.attempt,
        nextRetryAt: step.nextRetryAt,
        lastErrorCode: step.lastErrorCode,
        lastErrorMessage: step.lastErrorMessage,
        retryable: step.retryable,
        updatedAt: step.updatedAt,
      })),
      cycleId,
    };
  });
  handle(ipcMain, channels.session.retryStep, async (payload) => {
    const { sessionId, cycleId, stage } =
      sessionExecutionStepActionSchema.parse(payload);
    const session = services.repos.session.requireById(sessionId);
    if (
      session.status !== "active" &&
      session.status !== "attention_required"
    ) {
      return {
        ok: false as const,
        reason: "Session must be active or attention_required.",
      };
    }
    const step = services.repos.sessionExecutionSteps.get(
      sessionId,
      cycleId,
      stage,
    );
    if (!step || (step.status !== "failed" && step.status !== "retrying")) {
      return {
        ok: false as const,
        reason: "Step is not retryable in its current state.",
      };
    }
    if (
      (stage === "risk_gate" || stage === "broker_order") &&
      step.status !== "failed"
    ) {
      return {
        ok: false as const,
        reason: `${stage} cannot be retried while mid-flight.`,
      };
    }
    return services.runtimeManager.retryStep(sessionId, cycleId, stage);
  });
  handle(ipcMain, channels.session.pauseAfterCurrentStep, async (payload) => {
    const { sessionId } = sessionIdParamSchema.parse(payload);
    services.runtimeManager.pauseAfterCurrentStep(sessionId);
    return { ok: true as const };
  });
  handle(ipcMain, channels.session.clearFailedStep, async (payload) => {
    const { sessionId, cycleId, stage } =
      sessionExecutionStepActionSchema.parse(payload);
    const step = services.repos.sessionExecutionSteps.get(
      sessionId,
      cycleId,
      stage,
    );
    if (!step || (step.status !== "failed" && step.status !== "retrying")) {
      return {
        ok: false as const,
        reason: "No failed step exists for that stage.",
      };
    }
    services.repos.sessionExecutionSteps.clearFailed(sessionId, cycleId, stage);
    return { ok: true as const };
  });

  handle(ipcMain, channels.session.list, async (payload) => {
    const parsed = sessionListFiltersSchema.parse(payload) ?? {};
    const prefs = services.repos.workspacePreferences.get();
    const executionMode = resolveExecutionModeFilter(prefs, parsed);
    return services.sessionListing.list({
      ...parsed,
      executionMode,
    });
  });

  handle(ipcMain, channels.session.create, async (payload) => {
    const input = sessionCreateInputSchema.parse(payload);
    assertExecutionModeMatchesWorkspace(services, input.executionMode);
    return services.sessionWrites.create(input);
  });

  handle(ipcMain, channels.session.update, async (payload) => {
    const { id, input } = sessionUpdateInputSchema.parse(payload);
    assertExecutionModeMatchesWorkspace(services, input.executionMode);
    return services.sessionWrites.update(id, input);
  });

  handle(ipcMain, channels.session.focus, async (payload) => {
    const { id } = sessionFocusSchema.parse(payload);
    const session = services.repos.session.requireById(id);
    const prefs = services.repos.workspacePreferences.get();
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
          sessionId: id,
          sessionExecutionMode: session.executionMode,
          globalEnvironmentMode: prefs.globalEnvironmentMode,
        },
      );
    }
    services.repos.session.setFocus(id);
    return { workspaceViewMode: "session" as const, focusedSessionId: id };
  });

  handle(ipcMain, channels.session.goGlobal, async () => {
    const sessions = services.repos.session
      .list({ includeArchived: false })
      .filter((session) => session.status !== "archived");
    if (sessions.length === 0) {
      throw new AppError(
        "Cannot switch to global mode without sessions.",
        "VALIDATION_FAILED",
      );
    }
    services.repos.session.clearFocus();
    return { workspaceViewMode: "global" as const, focusedSessionId: null };
  });

  handle(ipcMain, channels.session.archive, async (payload) => {
    const { id } = sessionArchiveSchema.parse(payload);
    const session = services.repos.session.requireById(id);
    if (session.status === "active" || session.status === "paused") {
      throw new AppError(
        "Stop the session before archiving it.",
        "INVALID_TRANSITION",
        { id },
      );
    }
    services.repos.session.setStatus("archived", id);
    if (session.isFocused) {
      services.repos.session.clearFocus();
    }
    return { archived: true };
  });

  handle(ipcMain, channels.session.duplicate, async (payload) => {
    const { sourceId, name } = sessionDuplicateInputSchema.parse(payload);
    const session = services.repos.session.duplicate(sourceId, { name });
    return { id: session.id, status: "draft" as const };
  });

  handle(ipcMain, channels.session.instrumentCacheGet, async (payload) => {
    const { sessionId } = sessionIdParamSchema.parse(payload);
    const session = services.repos.session.requireById(sessionId);
    return services.instrumentCacheService.getView(session);
  });

  handle(ipcMain, channels.session.instrumentCacheClear, async (payload) => {
    const { sessionId } = sessionIdParamSchema.parse(payload);
    const session = services.repos.session.requireById(sessionId);
    if (!isSessionEditable(session.status)) {
      throw new AppError(
        "Stop the session before clearing the instrument cache.",
        "LOCKED",
        { sessionId },
      );
    }
    services.instrumentCacheService.clear(sessionId);
    return { cleared: true as const };
  });

  handle(ipcMain, channels.session.getLiveReadiness, async (payload) => {
    const { sessionId } = sessionIdParamSchema.parse(payload);
    return services.liveReadiness.check(sessionId);
  });

  handle(
    ipcMain,
    channels.session.acknowledgeLiveReadiness,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      const report = await services.liveReadiness.check(sessionId);
      const nonAckChecks = report.checks.filter(
        (c) => !c.requiresAck && !c.passed,
      );
      if (nonAckChecks.length > 0) {
        throw new AppError(
          `Cannot acknowledge: ${nonAckChecks.map((c) => c.name).join(", ")} checks still failing`,
          "VALIDATION_FAILED",
          { failedChecks: nonAckChecks.map((c) => c.name) },
        );
      }
      services.liveReadiness.acknowledge(sessionId);
      const updated = await services.liveReadiness.check(sessionId);
      return {
        acknowledgedAt: updated.acknowledgedAt ?? new Date().toISOString(),
      };
    },
  );

  handle(
    ipcMain,
    channels.session.testLiveBrokerConnection,
    async (payload) => {
      const { sessionId } = sessionIdParamSchema.parse(payload);
      const assignedIds =
        services.repos.sessionBrokerAssignments.listBrokerAccountIds(sessionId);
      const firstId = assignedIds[0];
      if (!firstId) {
        return { ok: false as const, message: "No broker account assigned" };
      }
      try {
        const adapter = await services.brokerRegistry.get(firstId);
        const result = await adapter.testConnection();
        return result;
      } catch (err) {
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
