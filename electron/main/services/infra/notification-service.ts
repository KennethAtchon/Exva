import { Notification } from "electron";
import type { EventBus } from "./event-bus";

export class NotificationService {
  constructor(private readonly eventBus: EventBus) {}

  notify(title: string, body: string, level = "INFO"): void {
    this.eventBus.emit("notification", { title, body, level });
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  }
}
