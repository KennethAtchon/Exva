import type { BrowserWindow } from "electron";
import type { DashboardStats, EventRow, Trade, TradeDecisionPayload } from "@/lib/types";
import type { ExvaEventName } from "@electron/shared/channels";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  session_started: {};
  session_stopped: { reason: string };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export class EventBus {
  private windows = new Set<BrowserWindow>();

  attach(window: BrowserWindow): void {
    this.windows.add(window);
    window.on("closed", () => this.windows.delete(window));
  }

  emit<K extends ExvaEventName>(name: K, payload: ExvaEventMap[K]): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) window.webContents.send(name, payload);
    }
  }
}
