import type { EngineEvent, WsMessage } from "@shared/types.ts";
import type { Store } from "../store/store.ts";
import type { Clock } from "./clock.ts";

export interface EventSink {
  /** Broadcast to UI listeners (not persisted). */
  emit(msg: WsMessage): void;
  /** Persist a user-visible engine event and broadcast it. */
  event(
    level: EngineEvent["level"],
    kind: string,
    message: string,
    data?: Record<string, unknown>,
  ): void;
}

export const nullSink: EventSink = { emit() {}, event() {} };

export class EventBus implements EventSink {
  private readonly listeners = new Set<(msg: WsMessage) => void>();

  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
  ) {}

  subscribe(fn: (msg: WsMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(msg: WsMessage): void {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {}
    }
  }

  event(
    level: EngineEvent["level"],
    kind: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const e = this.store.addEvent(this.clock.now(), level, kind, message, data);
    if (level !== "info") console[level === "error" ? "error" : "warn"](`[${kind}] ${message}`);
    this.emit({ type: "event", data: e });
  }
}
