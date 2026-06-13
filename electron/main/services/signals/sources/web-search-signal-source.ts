import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { InstrumentClass } from "@/lib/types";
import type { ISignalSource, SignalSourceSnapshot } from "../ISignalSource";

export type WebSearchSignalSourceConfig = {
  /** Classes this search-style source scopes when emitting manual probe events. */
  instrumentClasses?: InstrumentClass[];
};

export class WebSearchSignalSource implements ISignalSource {
  readonly type = "web_search" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private config: WebSearchSignalSourceConfig;

  constructor(
    public readonly id: string,
    configJson = "{}",
  ) {
    this.config = safeParseConfig(configJson);
  }

  async start(): Promise<void> {
    this.status = "running";
    this.lastError = null;
  }

  async stop(): Promise<void> {
    this.status = "paused";
  }

  async restart(config: Record<string, unknown>): Promise<void> {
    this.status = "restarting";
    this.config = safeParseConfig(JSON.stringify(config));
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

  configuredInstrumentClasses(): InstrumentClass[] {
    return this.config.instrumentClasses?.length
      ? this.config.instrumentClasses
      : ["stock"];
  }
}

function safeParseConfig(configJson: string): WebSearchSignalSourceConfig {
  try {
    const parsed = JSON.parse(configJson) as WebSearchSignalSourceConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
