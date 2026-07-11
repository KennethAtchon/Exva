import { Notification } from "electron";
import type { EventBus } from "./event-bus";

/**
 * Desktop + renderer notifications. OS toast is driven by the bus listener so
 * worker-forwarded `notification` events (consecutive-skip alarm, supervisor)
 * also reach the operator without an OrchestratorDeps RPC hop.
 */
export class NotificationService {
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly eventBus: EventBus) {
    this.unsubscribe = this.eventBus.on("notification", ({ title, body }) => {
      this.showOsToast(title, body);
    });
  }

  notify(title: string, body: string, level = "INFO"): void {
    this.eventBus.emit("notification", { title, body, level });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private showOsToast(title: string, body: string): void {
    try {
      if (!Notification.isSupported()) return;
      new Notification({ title, body }).show();
    } catch {
      // Headless / vitest / non-Electron shells — bus emit still reaches UI.
    }
  }
}
