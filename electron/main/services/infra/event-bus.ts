import type { BrowserWindow } from "electron";
import type { SessionRuntimeStatus } from "@/lib/types";
import type { AndonCordPayload } from "@electron/shared/domain/autopsy";
import type {
  DashboardStats,
  EventRow,
  ExecutionStage,
  SessionStatus,
  Trade,
  TradeDecisionPayload,
} from "@/lib/types";
import type { CapabilityRisk } from "@electron/shared/domain/control";
import type { SessionActivitySnapshot } from "@electron/shared/domain/session-activity";
import type { ExvaEventName } from "@electron/shared/ipc/channels";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: {
    approvalId: string;
    tradeId: string;
    status: "approved" | "rejected";
  };
  session_started: Record<string, never>;
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  research_phase_started: { sessionId: string; phase: string; cycleId: string };
  research_phase_step: {
    sessionId: string;
    phase: string;
    message: string;
    cycleId: string;
  };
  research_phase_complete: {
    sessionId: string;
    phase: string;
    cycleId: string;
    instrumentCount: number;
  };
  research_phase_failed: {
    sessionId: string;
    phase: string;
    cycleId: string;
    error: string;
  };
  "step:started": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    attempt: number;
  };
  "step:succeeded": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
  };
  "step:failed": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
    nextRetryAt: string | null;
  };
  "step:retrying": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    attempt: number;
    nextRetryAt: string;
  };
  broker_balance_updated: {
    brokerAccountId: string;
    balanceUsd: number;
    cachedAt: string;
  };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
  andon_cord_fired: AndonCordPayload;
  signal_received: {
    signalId: string;
    sourceId: string;
    sourceType: string;
    ticker: string;
    companyName: string | null;
    detectedAt: string;
  };
  signal_delivery_updated: {
    deliveryId: string;
    sessionId: string;
    signalId: string;
    status:
      | "queued"
      | "waiting_for_resume"
      | "processing"
      | "triggered"
      | "traded"
      | "rejected"
      | "dropped"
      | "expired";
    statusBucket: "pending" | "completed" | "dropped";
  };
  signal_dead_lettered: {
    deadLetterId: string;
    sessionId: string;
    signalId: string;
    reason:
      | "unsupported_by_experience"
      | "unsupported_by_signal_source"
      | "unsupported_by_assigned_broker"
      | "no_compatible_broker_route";
    ticker: string;
  };
  control_delta: { conversationId: string; turnId: string; text: string };
  control_tool_call: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    capability: string;
    label: string;
    kind: "read" | "mutating";
    summary: string;
    inputJson: string;
    status:
      | "running"
      | "awaiting_confirm"
      | "succeeded"
      | "rejected"
      | "failed";
  };
  control_tool_result: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    status: "succeeded" | "rejected" | "failed";
    resultSummary: string;
    resultJson: string | null;
  };
  control_confirmation_required: {
    conversationId: string;
    turnId: string;
    toolCallId: string;
    capability: string;
    label: string;
    preview: string;
    inputJson: string;
    alwaysConfirm: boolean;
    confirmClass: string | null;
    risk: CapabilityRisk | null;
    outOfScope: boolean;
  };
  control_turn_complete: {
    conversationId: string;
    turnId: string;
    costUsd: number;
  };
  control_error: {
    conversationId: string;
    turnId: string;
    message: string;
    code: string | null;
  };
  backtest_progress: {
    runId: string;
    phase: "loading" | "running" | "persisting" | "done" | "error";
    message: string;
    pct: number;
  };
  equity_snapshot: {
    ts: string;
    total: number;
    marksStale: boolean;
  };
  session_activity_changed: SessionActivitySnapshot;
}

export class EventBus {
  private windows = new Set<BrowserWindow>();
  private runtimeStatuses = new Map<string, SessionRuntimeStatus>();
  private listeners = new Map<ExvaEventName, Set<(payload: unknown) => void>>();

  attach(window: BrowserWindow): void {
    this.windows.add(window);
    window.on("closed", () => this.windows.delete(window));
  }

  emit<K extends ExvaEventName>(name: K, payload: ExvaEventMap[K]): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) window.webContents.send(name, payload);
    }
    const handlers = this.listeners.get(name);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  on<K extends ExvaEventName>(
    name: K,
    handler: (payload: ExvaEventMap[K]) => void,
  ): () => void {
    const handlers = this.listeners.get(name) ?? new Set();
    handlers.add(handler as (payload: unknown) => void);
    this.listeners.set(name, handlers);
    return () => {
      const next = this.listeners.get(name);
      if (!next) return;
      next.delete(handler as (payload: unknown) => void);
      if (next.size === 0) this.listeners.delete(name);
    };
  }

  setRuntimeStatus(sessionId: string, status: SessionRuntimeStatus): void {
    this.runtimeStatuses.set(sessionId, status);
  }

  runtimeStatus(sessionId: string): SessionRuntimeStatus | null {
    return this.runtimeStatuses.get(sessionId) ?? null;
  }

  clearRuntimeStatus(sessionId: string): void {
    this.runtimeStatuses.delete(sessionId);
  }
}
