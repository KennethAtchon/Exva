import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { ISignalSource, SignalSourceSnapshot } from "../ISignalSource";

export class WebSearchSignalSource implements ISignalSource {
  readonly type = "web_search" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();

  constructor(public readonly id: string) {}

  async start(): Promise<void> {
    this.status = "running";
    this.lastError = null;
  }

  async stop(): Promise<void> {
    this.status = "paused";
  }

  async restart(_config: Record<string, unknown>): Promise<void> {
    void _config;
    this.status = "restarting";
    await this.start();
  }

  async test(): Promise<PollResult> {
    return { detected: 0, passed: 0, dropped: 0, errors: [] };
  }

  snapshot(): SignalSourceSnapshot {
    return {
      lastPollAt: null,
      lastPollResult: null,
      lastSignalAt: null,
      lastSignalTicker: null,
      recentActivity: [],
    };
  }

  onSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.add(handler);
  }

  offSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.delete(handler);
  }
}
