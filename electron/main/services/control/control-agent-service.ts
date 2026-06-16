import { randomUUID } from "node:crypto";
import { AppError } from "@electron/shared/infra/errors";
import type { ReasoningLevel } from "@electron/shared/ai/ai-phase";
import type { AppServices } from "../app-services";
import type { EventBus } from "../infra/event-bus";
import type { ProviderRegistry } from "../llm/provider-registry";
import type { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import type { ControlRepo } from "../../db/repositories/control/control-repo";
import type { LLMMessage } from "../llm/llm-types";
import { createLogger } from "../infra/log";
import { CONTROL_CAPABILITIES } from "./capabilities";
import { CONTROL_SYSTEM_PROMPT } from "./control-system-prompt";
import {
  buildControlToolset,
  type ConfirmationDecision,
  type ControlToolRuntime,
} from "./build-control-toolset";

const CONTROL_SPEND_CAP_USD = 0.5;
const CONTROL_MAX_STEPS = 12;

interface ActiveTurn {
  turnId: string;
  controller: AbortController;
  pending: Map<string, (decision: ConfirmationDecision) => void>;
}

export interface ControlAgentDeps {
  repo: ControlRepo;
  providerRegistry: ProviderRegistry;
  apiCallLog: ApiCallLogRepo;
  workspacePrefs: WorkspacePreferencesRepo;
  eventBus: EventBus;
  /** Lazy accessor — resolves the fully-built services container at call time. */
  getServices: () => AppServices;
}

export class ControlAgentService {
  private readonly logger = createLogger("control-agent");
  private readonly active = new Map<string, ActiveTurn>();

  constructor(private readonly deps: ControlAgentDeps) {}

  isEnabled(): boolean {
    return true;
  }

  isStreaming(conversationId: string): boolean {
    return this.active.has(conversationId);
  }

  /** Persists the user message, kicks off the turn, and returns immediately. */
  startTurn(input: { conversationId: string; message: string }): {
    turnId: string;
  } {
    const { conversationId, message } = input;
    if (this.active.has(conversationId)) {
      throw new AppError(
        "A turn is already streaming for this conversation.",
        "VALIDATION_FAILED",
      );
    }
    this.deps.repo.requireConversation(conversationId);
    const turnId = randomUUID();
    this.deps.repo.insertMessage({
      id: randomUUID(),
      conversationId,
      role: "user",
      content: message,
      status: "complete",
      turnId,
    });
    const controller = new AbortController();
    this.active.set(conversationId, {
      turnId,
      controller,
      pending: new Map(),
    });
    void this.runTurn({ conversationId, turnId, controller }).catch((error) => {
      this.emitError(conversationId, turnId, error);
    });
    return { turnId };
  }

  resolveConfirmation(input: {
    conversationId: string;
    toolCallId: string;
    decision: "confirm" | "reject";
    alwaysApprove?: boolean;
  }): void {
    const turn = this.active.get(input.conversationId);
    const resolver = turn?.pending.get(input.toolCallId);
    if (!turn || !resolver) {
      throw new AppError(
        "No pending confirmation for that tool call.",
        "VALIDATION_FAILED",
      );
    }
    turn.pending.delete(input.toolCallId);
    resolver({
      decision: input.decision,
      alwaysApprove: input.alwaysApprove,
    });
  }

  cancel(conversationId: string): void {
    const turn = this.active.get(conversationId);
    if (!turn) return;
    turn.controller.abort();
    for (const [, resolver] of turn.pending) {
      resolver({ decision: "cancel" });
    }
    turn.pending.clear();
  }

  private async runTurn(args: {
    conversationId: string;
    turnId: string;
    controller: AbortController;
  }): Promise<void> {
    const { conversationId, turnId, controller } = args;
    const repo = this.deps.repo;
    let costUsd = 0;
    try {
      const conversation = repo.requireConversation(conversationId);
      const ctx = {
        conversationId,
        scope: {
          kind: conversation.scopeKind,
          sessionId: conversation.scopeSessionId,
        },
        autoApproved: new Set(conversation.autoApproved),
      };

      const stateBlock = this.buildAppStateContext(ctx.scope.sessionId);
      const history = this.loadHistory(conversationId);
      const messages: LLMMessage[] = [
        {
          role: "system",
          content: `${CONTROL_SYSTEM_PROMPT}\n\n${stateBlock}`,
        },
        ...history,
      ];

      const prefs = this.deps.workspacePrefs.get();
      const providerKey = prefs.defaultModelProviderKey;
      const modelId = prefs.defaultModelModelId;
      if (!providerKey || !modelId) {
        throw new AppError(
          "No workspace default model is configured. Set one in Strategy → Workspace default model.",
          "PROVIDER_NOT_CONFIGURED",
        );
      }
      const reasoningLevel = prefs.defaultModelReasoningLevel as
        | ReasoningLevel
        | undefined;

      const services = this.deps.getServices();
      const rt: ControlToolRuntime = {
        services,
        repo,
        bus: this.deps.eventBus,
        ctx,
        turnId,
        abortSignal: controller.signal,
        awaitConfirmation: (toolCallId) =>
          new Promise<ConfirmationDecision>((resolve) => {
            const turn = this.active.get(conversationId);
            if (!turn) {
              resolve({ decision: "cancel" });
              return;
            }
            turn.pending.set(toolCallId, resolve);
          }),
        addAutoApproved: (confirmClass) => {
          ctx.autoApproved.add(confirmClass);
          repo.setAutoApproved(conversationId, [...ctx.autoApproved]);
        },
      };

      const tools = buildControlToolset(CONTROL_CAPABILITIES, rt);
      const adapter = await this.deps.providerRegistry.get(providerKey);
      const trace = await adapter.runAgent({
        model: modelId,
        role: "control",
        sessionId: ctx.scope.sessionId ?? undefined,
        messages,
        tools,
        maxSteps: CONTROL_MAX_STEPS,
        spendLimitUsd: CONTROL_SPEND_CAP_USD,
        reasoningLevel,
        abortSignal: controller.signal,
      });

      costUsd = trace.costUsd;
      const cancelled = controller.signal.aborted;
      const text =
        trace.assistantText.trim().length > 0
          ? trace.assistantText
          : cancelled
            ? "(cancelled)"
            : "(no response)";

      repo.insertMessage({
        id: randomUUID(),
        conversationId,
        role: "assistant",
        content: text,
        status: cancelled ? "cancelled" : "complete",
        turnId,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        costUsd: trace.costUsd,
      });
      repo.setAutoApproved(conversationId, [...ctx.autoApproved]);

      this.deps.eventBus.emit("control_delta", {
        conversationId,
        turnId,
        text,
      });
      this.logCost({
        providerKey,
        modelId,
        sessionId: ctx.scope.sessionId,
        trace,
      });
      this.deps.eventBus.emit("control_turn_complete", {
        conversationId,
        turnId,
        costUsd,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        repo.insertMessage({
          id: randomUUID(),
          conversationId,
          role: "assistant",
          content: "(cancelled)",
          status: "cancelled",
          turnId,
        });
        this.deps.eventBus.emit("control_turn_complete", {
          conversationId,
          turnId,
          costUsd,
        });
      } else {
        this.emitError(conversationId, turnId, error);
        repo.insertMessage({
          id: randomUUID(),
          conversationId,
          role: "assistant",
          content:
            error instanceof Error
              ? `Error: ${error.message}`
              : "Error running turn.",
          status: "error",
          turnId,
        });
      }
    } finally {
      const turn = this.active.get(conversationId);
      if (turn) {
        for (const [, resolver] of turn.pending) {
          resolver({ decision: "cancel" });
        }
      }
      this.active.delete(conversationId);
    }
  }

  private emitError(
    conversationId: string,
    turnId: string,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof AppError ? error.code : (null as string | null);
    this.logger.error(
      { err: error, conversationId, turnId },
      "control turn failed",
    );
    this.deps.eventBus.emit("control_error", {
      conversationId,
      turnId,
      message,
      code,
    });
  }

  private loadHistory(conversationId: string): LLMMessage[] {
    return this.deps.repo
      .listMessages(conversationId)
      .filter((m) => m.status === "complete" || m.status === "cancelled")
      .map((m) => {
        const role: LLMMessage["role"] =
          m.role === "assistant"
            ? "assistant"
            : m.role === "system"
              ? "system"
              : "user";
        return { role, content: m.content };
      });
  }

  /** Compact current-state snapshot appended to the system prompt each turn. */
  private buildAppStateContext(scopeSessionId: string | null): string {
    const services = this.deps.getServices();
    const lines: string[] = ["## Current app state"];
    try {
      const sessions = services.sessionListing.list({ includeArchived: false });
      const active = sessions.sessions.filter(
        (s) => s.status === "active" || s.status === "paused",
      );
      lines.push(
        active.length === 0
          ? "- No active or paused sessions."
          : `- Sessions: ${active
              .map((s) => `${s.name} [${s.status}, ${s.openTradeCount} open]`)
              .join("; ")}`,
      );
    } catch {
      lines.push("- Sessions: unavailable.");
    }
    try {
      const open = services.repos.trades
        .listAllFiltered({})
        .filter((t) => t.status === "open" || t.status === "pending");
      const notional = open.reduce(
        (acc, t) => acc + (t.position_size_usd ?? 0),
        0,
      );
      lines.push(
        `- Open trades: ${open.length} (~$${Math.round(notional)} notional).`,
      );
    } catch {
      lines.push("- Open trades: unavailable.");
    }
    try {
      const enabled = services.signals.listSources().filter((s) => s.enabled);
      lines.push(
        `- Enabled signal sources: ${enabled.length === 0 ? "none" : enabled.map((s) => s.name).join(", ")}.`,
      );
    } catch {
      lines.push("- Signal sources: unavailable.");
    }
    if (scopeSessionId) {
      lines.push(`- This conversation is scoped to session ${scopeSessionId}.`);
    }
    return lines.join("\n");
  }

  private logCost(args: {
    providerKey: string;
    modelId: string;
    sessionId: string | null;
    trace: { costUsd: number; durationMs: number };
  }): void {
    try {
      this.deps.apiCallLog.insert({
        id: randomUUID(),
        session_id: args.sessionId,
        trade_id: null,
        cycle_id: null,
        provider: args.providerKey,
        endpoint: args.modelId,
        call_type: "control",
        credits_used: null,
        cost_usd: args.trace.costUsd,
        latency_ms: args.trace.durationMs,
        status: "ok",
        from_cache: false,
        created_at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn({ err: error }, "failed to log control cost");
    }
  }
}
