import type { BrowserWindow } from "electron";
import type { SessionRuntimeStatus } from "@/lib/types";
import type { DashboardStats, EventRow, SessionStatus, Trade, TradeDecisionPayload } from "@/lib/types";
import type { ExvaEventName } from "@electron/shared/channels";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: { approvalId: string; status: "approved" | "rejected" };
  session_started: {};
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export class EventBus {
  private windows = new Set<BrowserWindow>();
  private runtimeStatuses = new Map<string, SessionRuntimeStatus>();

  attach(window: BrowserWindow): void {
    this.windows.add(window);
    window.on("closed", () => this.windows.delete(window));
  }

  emit<K extends ExvaEventName>(name: K, payload: ExvaEventMap[K]): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) window.webContents.send(name, payload);
    }
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
