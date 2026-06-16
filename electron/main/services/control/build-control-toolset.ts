import { randomUUID } from "node:crypto";
import { tool, type ToolSet } from "ai";
import type { AppServices } from "../app-services";
import type { EventBus } from "../infra/event-bus";
import type { ControlRepo } from "../../db/repositories/control/control-repo";
import type { Capability, CapabilityContext } from "./capability";

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
  /** Persists a "don't ask again" opt-in for this conversation. */
  addAutoApproved(confirmClass: string): void;
}

function summarizeResult(result: unknown): string {
  if (result == null) return "Done.";
  if (typeof result === "object") {
    const rejected = (result as { rejected?: unknown }).rejected === true;
    if (rejected) return "Skipped by operator.";
    const error = (result as { error?: unknown }).error;
    if (typeof error === "string") return `Failed: ${error}`;
  }
  return "Done.";
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
        resultSummary: "Done.",
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

  // Mutating capabilities: gate unless auto-approved.
  const risk = cap.risk?.(input, rt.services) ?? null;
  const liveRisk = risk != null && /live/i.test(risk);
  const needsConfirm =
    cap.alwaysConfirm === true ||
    liveRisk ||
    !(cap.confirmClass && rt.ctx.autoApproved.has(cap.confirmClass));

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
      alwaysConfirm: cap.alwaysConfirm === true || liveRisk,
      confirmClass: cap.confirmClass ?? null,
      risk,
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
    if (
      decision.alwaysApprove &&
      cap.alwaysConfirm !== true &&
      !liveRisk &&
      cap.confirmClass
    ) {
      rt.addAutoApproved(cap.confirmClass);
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
      resultSummary: summarizeResult(result),
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
