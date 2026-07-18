import { z } from "zod";
import { AppError } from "@electron/shared/infra/errors";
import { sessionCreateInputSchema } from "@electron/shared/validation/schemas";
import { defineCapability } from "./capability";
import {
  CONFIRM_CLASS,
  OPEN_TRADE_STATUSES,
  sessionRefSchema,
} from "./capabilities-shared";
import { resolveSession } from "./resolve-session";

const executionStageSchema = z.enum([
  "selector",
  "candidate_validation",
  "technical",
  "fundamental",
  "review",
  "decision",
  "risk_gate",
  "broker_order",
  "monitoring",
]);

export const updateSession = defineCapability<
  { session: string } & z.infer<typeof sessionCreateInputSchema>
>({
  key: "update_session",
  label: "Update session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description:
    "Update an existing session's identity/config (same fields as create_session). Read get_session_status first.",
  inputSchema: sessionCreateInputSchema
    .extend({ session: z.string().min(1) })
    .strict() as unknown as z.ZodType<
    { session: string } & z.infer<typeof sessionCreateInputSchema>
  >,
  describe: (input) =>
    `Update session "${input.session}" → "${input.name}" (${input.executionMode}).`,
  risk: (input) =>
    input.executionMode === "live_allowed"
      ? {
          level: "live",
          note: "This session would be configured for a LIVE broker account.",
        }
      : null,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const { session: sessionRef, ...patch } = input;
    const session = resolveSession(services, sessionRef);
    return services.sessionWrites.update(session.id, patch);
  },
});

export const archiveSession = defineCapability<{ session: string }>({
  key: "archive_session",
  label: "Archive session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description: "Archive a stopped session (cannot archive active/paused).",
  inputSchema: sessionRefSchema,
  describe: (input) => `Archive session "${input.session}".`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    if (session.status === "active" || session.status === "paused") {
      throw new AppError(
        "Stop the session before archiving it.",
        "INVALID_TRANSITION",
        { id: session.id },
      );
    }
    services.repos.session.setStatus("archived", session.id);
    if (session.isFocused) services.repos.session.clearFocus();
    return { sessionId: session.id, archived: true };
  },
});

export const duplicateSession = defineCapability<{
  session: string;
  name: string;
}>({
  key: "duplicate_session",
  label: "Duplicate session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description: "Clone a session into a new draft with a new name.",
  inputSchema: z.object({
    session: z.string().min(1),
    name: z.string().min(1).max(80),
  }),
  describe: (input) =>
    `Duplicate session "${input.session}" as "${input.name}".`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const cloned = services.repos.session.duplicate(session.id, {
      name: input.name,
    });
    return { id: cloned.id, status: "draft" as const };
  },
});

export const forceStopSession = defineCapability<{ session: string }>({
  key: "force_stop_session",
  label: "Force stop session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  alwaysConfirm: (input, services) => {
    try {
      const session = resolveSession(services, input.session);
      return services.repos.trades
        .listAllFiltered({ sessionId: session.id })
        .some((t) => OPEN_TRADE_STATUSES.has(t.status));
    } catch {
      return true;
    }
  },
  description:
    "Force-stop a session. Always confirms when open/pending trades exist.",
  inputSchema: sessionRefSchema,
  describe: (input) => `Force-stop session "${input.session}".`,
  risk: (input, services) => {
    try {
      const session = resolveSession(services, input.session);
      if (session.executionMode === "live_allowed") {
        return {
          level: "live",
          note: "Force-stopping a LIVE-allowed session.",
        };
      }
      return null;
    } catch {
      return null;
    }
  },
  affectedEntity: (input) => `session:${input.session}`,
  execute: async (input, services) => {
    const session = resolveSession(services, input.session);
    const status = await services.session.forceStop(session.id);
    return { sessionId: session.id, status };
  },
});

export const getExecutionProgress = defineCapability<{ session: string }>({
  key: "get_execution_progress",
  label: "Get execution progress",
  kind: "read",
  description:
    "Read the latest cycle execution steps for a session (stage status, retries, errors).",
  inputSchema: sessionRefSchema,
  describe: (input) => `Read execution progress for "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const { cycleId, steps } =
      services.repos.sessionExecutionSteps.getLatestCycleState(session.id);
    const openTradeCount = services.repos.trades
      .listAllFiltered({ sessionId: session.id })
      .filter((t) => OPEN_TRADE_STATUSES.has(t.status)).length;
    return {
      sessionId: session.id,
      cycleId,
      openTradeCount,
      steps: steps.map((step) => ({
        stage: step.stage,
        status: step.status,
        attempt: step.attempt,
        lastErrorCode: step.lastErrorCode,
        lastErrorMessage: step.lastErrorMessage,
        retryable: step.retryable,
      })),
    };
  },
});

export const retryStep = defineCapability<{
  session: string;
  cycleId: string;
  stage: z.infer<typeof executionStageSchema>;
}>({
  key: "retry_step",
  label: "Retry execution step",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description: "Retry a failed/retrying execution stage for a session cycle.",
  inputSchema: z.object({
    session: z.string().min(1),
    cycleId: z.string().min(1),
    stage: executionStageSchema,
  }),
  describe: (input) =>
    `Retry ${input.stage} on "${input.session}" (cycle ${input.cycleId}).`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
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
      session.id,
      input.cycleId,
      input.stage,
    );
    if (!step || (step.status !== "failed" && step.status !== "retrying")) {
      return {
        ok: false as const,
        reason: "Step is not retryable in its current state.",
      };
    }
    return services.runtimeManager.retryStep(
      session.id,
      input.cycleId,
      input.stage,
    );
  },
});

export const clearFailedStep = defineCapability<{
  session: string;
  cycleId: string;
  stage: z.infer<typeof executionStageSchema>;
}>({
  key: "clear_failed_step",
  label: "Clear failed step",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description: "Clear a failed/retrying execution step marker.",
  inputSchema: z.object({
    session: z.string().min(1),
    cycleId: z.string().min(1),
    stage: executionStageSchema,
  }),
  describe: (input) =>
    `Clear failed ${input.stage} on "${input.session}" (cycle ${input.cycleId}).`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const step = services.repos.sessionExecutionSteps.get(
      session.id,
      input.cycleId,
      input.stage,
    );
    if (!step || (step.status !== "failed" && step.status !== "retrying")) {
      return {
        ok: false as const,
        reason: "No failed step exists for that stage.",
      };
    }
    services.repos.sessionExecutionSteps.clearFailed(
      session.id,
      input.cycleId,
      input.stage,
    );
    return { ok: true as const };
  },
});

export const pauseAfterCurrentStep = defineCapability<{ session: string }>({
  key: "pause_after_current_step",
  label: "Pause after current step",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description:
    "Request the session runtime to pause after the current execution step finishes.",
  inputSchema: sessionRefSchema,
  describe: (input) =>
    `Pause session "${input.session}" after the current step.`,
  affectedEntity: (input) => `session:${input.session}`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    services.runtimeManager.pauseAfterCurrentStep(session.id);
    return { ok: true as const, sessionId: session.id };
  },
});

export const getLiveReadiness = defineCapability<{ session: string }>({
  key: "get_live_readiness",
  label: "Get live readiness",
  kind: "read",
  description:
    "Read live-trading readiness checks for a session. Acknowledging readiness stays UI-only.",
  inputSchema: sessionRefSchema,
  describe: (input) => `Check live readiness for "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.liveReadiness.check(session.id);
  },
});
