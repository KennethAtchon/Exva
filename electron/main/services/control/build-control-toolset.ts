import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import type { AppServices } from "../app-services";
import type { EventBus } from "../infra/event-bus";
import type { ControlRepo } from "../../db/repositories/control/control-repo";
import type { Capability, CapabilityContext } from "./capability";
import { resolveSession } from "./resolve-session";

export interface ConfirmationDecision {
  decision: "confirm" | "reject" | "cancel";
  alwaysApprove?: boolean;
  reason?: string;
}

/** Per-turn runtime threaded into every capability execution. */
export interface ControlToolRuntime {
  services: AppServices;
  repo: ControlRepo;
  bus: EventBus;
  ctx: CapabilityContext;
  turnId: string;
  abortSignal: AbortSignal;
  /** Suspends the run until the renderer confirms/rejects/cancels this tool call. */
  awaitConfirmation(toolCallId: string): Promise<ConfirmationDecision>;
  /** Persists a "don't ask again" opt-in for this conversation (capability key). */
  addAutoApproved(key: string): void;
}

/** True if this capability was auto-approved. */
export function isCapabilityAutoApproved(
  autoApproved: Set<string>,
  cap: Pick<Capability<unknown>, "key">,
): boolean {
  return autoApproved.has(cap.key);
}

function summarizeResult(
  result: unknown,
  affectedEntity: string | null,
): string {
  if (result == null) {
    return affectedEntity ? `Done (${affectedEntity}).` : "Done.";
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (obj.rejected === true) return "Skipped by operator.";
    if (typeof obj.error === "string") return `Failed: ${obj.error}`;
    if (typeof obj.reason === "string" && obj.ok === false) {
      return `Failed: ${obj.reason}`;
    }
    const bits: string[] = [];
    if (affectedEntity) bits.push(affectedEntity);
    if (typeof obj.id === "string") bits.push(`id=${obj.id}`);
    if (typeof obj.sessionId === "string")
      bits.push(`session=${obj.sessionId}`);
    if (typeof obj.status === "string") bits.push(String(obj.status));
    if (typeof obj.count === "number") bits.push(`${obj.count} items`);
    if (Array.isArray(obj.paused)) bits.push(`paused ${obj.paused.length}`);
    if (Array.isArray(obj.closed)) bits.push(`closed ${obj.closed.length}`);
    if (typeof obj.balanceUsd === "number") {
      bits.push(`balance=$${Math.round(obj.balanceUsd)}`);
    }
    if (typeof obj.ok === "boolean") bits.push(obj.ok ? "ok" : "not ok");
    if (typeof obj.complete === "boolean") {
      bits.push(obj.complete ? "complete" : "incomplete");
    }
    if (bits.length > 0) return bits.join(" · ");
  }
  return affectedEntity ? `Done (${affectedEntity}).` : "Done.";
}

/** Resolve the session a capability targets from its input, if any. */
function resolveTargetSessionId(
  input: unknown,
  services: AppServices,
): string | null {
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.session === "string" && obj.session.length > 0) {
    try {
      return resolveSession(services, obj.session).id;
    } catch {
      return null;
    }
  }
  if (typeof obj.tradeId === "string" && obj.tradeId.length > 0) {
    try {
      const trade = services.repos.trades.require(obj.tradeId);
      return trade.sessionId ?? null;
    } catch {
      return null;
    }
  }
  if (typeof obj.approvalId === "string" && obj.approvalId.length > 0) {
    try {
      return services.repos.tradeApprovals.require(obj.approvalId).sessionId;
    } catch {
      return null;
    }
  }
  return null;
}

function isOutOfScope(
  ctx: CapabilityContext,
  input: unknown,
  services: AppServices,
): boolean {
  if (ctx.scope.kind !== "session" || ctx.scope.sessionId == null) return false;
  const targetId = resolveTargetSessionId(input, services);
  if (targetId == null) return false;
  return targetId !== ctx.scope.sessionId;
}

async function runCapability(
  cap: Capability<unknown>,
  input: unknown,
  rt: ControlToolRuntime,
): Promise<unknown> {
  const toolCallId = randomUUID();
  const inputJson = JSON.stringify(input ?? {});
  const affectedEntity = cap.affectedEntity?.(input) ?? null;
  const summary = (() => {
    try {
      return cap.describe(input, rt.services);
    } catch {
      return cap.label;
    }
  })();
  const base = {
    conversationId: rt.ctx.conversationId,
    turnId: rt.turnId,
    toolCallId,
    capability: cap.key,
    label: cap.label,
  };

  // Read capabilities execute immediately, no gate.
  if (cap.kind === "read") {
    rt.repo.insertToolCall({
      id: toolCallId,
      conversationId: rt.ctx.conversationId,
      turnId: rt.turnId,
      capability: cap.key,
      kind: "read",
      inputJson,
      status: "running",
      confirmation: "not_required",
      affectedEntity: null,
    });
    rt.bus.emit("control_tool_call", {
      ...base,
      kind: "read",
      summary,
      inputJson,
      status: "running",
    });
    try {
      const result = await cap.execute(input, rt.services, rt.ctx);
      const resultJson = JSON.stringify(result ?? null);
      rt.repo.updateToolCall(toolCallId, {
        status: "succeeded",
        resultJson,
        finishedAt: new Date().toISOString(),
      });
      rt.bus.emit("control_tool_result", {
        ...base,
        status: "succeeded",
        resultSummary: summarizeResult(result, affectedEntity),
        resultJson,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rt.repo.updateToolCall(toolCallId, {
        status: "failed",
        resultJson: JSON.stringify({ error: message }),
        finishedAt: new Date().toISOString(),
      });
      rt.bus.emit("control_tool_result", {
        ...base,
        status: "failed",
        resultSummary: `Failed: ${message}`,
        resultJson: JSON.stringify({ error: message }),
      });
      return { error: message };
    }
  }

  // Mutating capabilities: gate unless auto-approved for this capability key.
  // liveRisk / alwaysConfirm / outOfScope always force confirm.
  const risk = cap.risk?.(input, rt.services) ?? null;
  const liveRisk = risk?.level === "live";
  const outOfScope = isOutOfScope(rt.ctx, input, rt.services);
  const alwaysConfirm =
    typeof cap.alwaysConfirm === "function"
      ? cap.alwaysConfirm(input, rt.services)
      : cap.alwaysConfirm === true;
  const forceConfirm = alwaysConfirm || liveRisk || outOfScope;
  const needsConfirm =
    forceConfirm || !isCapabilityAutoApproved(rt.ctx.autoApproved, cap);

  if (needsConfirm) {
    rt.repo.insertToolCall({
      id: toolCallId,
      conversationId: rt.ctx.conversationId,
      turnId: rt.turnId,
      capability: cap.key,
      kind: "mutating",
      inputJson,
      status: "awaiting_confirm",
      confirmation: null,
      affectedEntity,
    });
    rt.bus.emit("control_tool_call", {
      ...base,
      kind: "mutating",
      summary,
      inputJson,
      status: "awaiting_confirm",
    });
    rt.bus.emit("control_confirmation_required", {
      ...base,
      preview: summary,
      inputJson,
      alwaysConfirm: forceConfirm,
      confirmClass: cap.confirmClass ?? null,
      risk,
      outOfScope,
    });

    const decision = await rt.awaitConfirmation(toolCallId);
    if (decision.decision !== "confirm") {
      const reason =
        decision.decision === "cancel" ? "cancelled" : decision.reason;
      const resultJson = JSON.stringify({ rejected: true, reason });
      rt.repo.updateToolCall(toolCallId, {
        status: "rejected",
        confirmation: "rejected",
        resultJson,
        finishedAt: new Date().toISOString(),
      });
      rt.bus.emit("control_tool_result", {
        ...base,
        status: "rejected",
        resultSummary:
          decision.decision === "cancel"
            ? "Cancelled."
            : "Skipped by operator.",
        resultJson,
      });
      return { rejected: true, reason };
    }
    if (decision.alwaysApprove && !forceConfirm) {
      rt.addAutoApproved(cap.key);
    }
    // Flip the card to running.
    rt.repo.updateToolCall(toolCallId, {
      status: "running",
      confirmation: "confirmed",
    });
    rt.bus.emit("control_tool_call", {
      ...base,
      kind: "mutating",
      summary,
      inputJson,
      status: "running",
    });
  } else {
    rt.repo.insertToolCall({
      id: toolCallId,
      conversationId: rt.ctx.conversationId,
      turnId: rt.turnId,
      capability: cap.key,
      kind: "mutating",
      inputJson,
      status: "running",
      confirmation: "auto_approved",
      affectedEntity,
    });
    rt.bus.emit("control_tool_call", {
      ...base,
      kind: "mutating",
      summary,
      inputJson,
      status: "running",
    });
  }

  try {
    const result = await cap.execute(input, rt.services, rt.ctx);
    const resultJson = JSON.stringify(result ?? null);
    rt.repo.updateToolCall(toolCallId, {
      status: "succeeded",
      resultJson,
      finishedAt: new Date().toISOString(),
    });
    rt.bus.emit("control_tool_result", {
      ...base,
      status: "succeeded",
      resultSummary: summarizeResult(result, affectedEntity),
      resultJson,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rt.repo.updateToolCall(toolCallId, {
      status: "failed",
      resultJson: JSON.stringify({ error: message }),
      finishedAt: new Date().toISOString(),
    });
    rt.bus.emit("control_tool_result", {
      ...base,
      status: "failed",
      resultSummary: `Failed: ${message}`,
      resultJson: JSON.stringify({ error: message }),
    });
    return { error: message };
  }
}

export function buildControlToolset(
  registry: Capability<unknown>[],
  rt: ControlToolRuntime,
): ToolSet {
  return Object.fromEntries(
    registry.map((cap) => [
      cap.key,
      tool({
        description: cap.description,
        inputSchema: cap.inputSchema,
        execute: (input: unknown) => runCapability(cap, input, rt),
      }),
    ]),
  );
}
