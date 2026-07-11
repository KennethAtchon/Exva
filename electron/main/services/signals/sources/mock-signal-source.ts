import type {
  PollResult,
  SignalEvent,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type {
  ISignalSource,
  SignalSourceActivityEntry,
  SignalSourceSnapshot,
} from "../ISignalSource";

export type MockSignalSourceConfig = {
  /** Ticker to emit on each fire (defaults to NVDA). */
  ticker?: string;
  companyName?: string;
  instrumentClass?:
    | "stock"
    | "crypto"
    | "futures"
    | "options"
    | "prediction_market";
  /** Milliseconds between automatic fires when running; 0 = manual/test only. */
  intervalMs?: number;
};

/**
 * Synthetic EDGAR-style signal source for scripted E2E testing.
 * Fires through the full bus → delivery → orchestrator path.
 */
export class MockSignalSource implements ISignalSource {
  readonly type = "mock" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: MockSignalSourceConfig;
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];

  constructor(
    public readonly id: string,
    configJson: string,
  ) {
    this.config = safeParseConfig(configJson);
  }

  async start(): Promise<void> {
    this.status = "running";
    this.lastError = null;
    const intervalMs = this.config.intervalMs ?? 0;
    if (intervalMs > 0) {
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        void this.fireOnce();
      }, intervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "paused";
  }

  async restart(newConfig: Record<string, unknown>): Promise<void> {
    this.status = "restarting";
    this.config = safeParseConfig(JSON.stringify(newConfig));
    await this.stop();
    await this.start();
  }

  async test(): Promise<PollResult> {
    return this.fireOnce();
  }

  snapshot(): SignalSourceSnapshot {
    return {
      lastPollAt: this.lastPollAt,
      lastPollResult: this.lastPollResult,
      lastSignalAt: this.lastSignalAt,
      lastSignalTicker: this.lastSignalTicker,
      recentActivity: [...this.recentActivity],
    };
  }

  onSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.add(handler);
  }

  offSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.delete(handler);
  }

  /** Emit one synthetic 8-K-style event immediately. */
  async fireOnce(): Promise<PollResult> {
    const result: PollResult = {
      detected: 1,
      passed: 1,
      dropped: 0,
      errors: [],
    };
    const polledAt = new Date().toISOString();
    const ticker = this.config.ticker ?? "NVDA";
    const event: SignalEvent = {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: "mock",
      ticker,
      companyName: this.config.companyName ?? `${ticker} Corp (mock)`,
      documentUrl: `https://mock.exva.test/8k/${ticker}`,
      accessionNumber: `mock-${Date.now()}`,
      payloadJson: {
        itemCodes: ["1.01", "8.01"],
        summary: "Scripted mock 8-K for E2E testing.",
        scripted: true,
        instrumentClass: this.config.instrumentClass ?? "stock",
      },
      filedAt: polledAt,
      detectedAt: polledAt,
    };
    this.lastSignalAt = event.detectedAt;
    this.lastSignalTicker = event.ticker;
    this.lastPollAt = polledAt;
    this.lastPollResult = result;
    this.pushActivity({
      at: polledAt,
      kind: "ok",
      summary: `Mock signal emitted for ${ticker}`,
    });
    for (const handler of this.handlers) handler(event);
    return result;
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

function safeParseConfig(raw: string): MockSignalSourceConfig {
  try {
    return JSON.parse(raw) as MockSignalSourceConfig;
  } catch {
    return {};
  }
}
