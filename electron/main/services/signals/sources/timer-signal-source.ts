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

export type TimerSignalSourceConfig = {
  /** Instrument symbol, e.g. SPY, BTC-USD */
  symbol: string;
  /** Bar cadence label, e.g. 15m, 1h, 4h, 1d */
  cadence: string;
  /** Milliseconds between ticks (default 15 minutes). */
  intervalMs?: number;
  instrumentClass?: "stock" | "crypto" | "futures" | "prediction_market";
};

/**
 * Clock-driven signal source for rules-based pipelines.
 * Emits a timer tick per (symbol, cadence) on a fixed interval.
 */
export class TimerSignalSource implements ISignalSource {
  readonly type = "timer" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null = null;
  private handlers = new Set<(event: SignalEvent) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number | null = null;
  private config: TimerSignalSourceConfig;
  private lastPollAt: string | null = null;
  private lastPollResult: PollResult | null = null;
  private lastSignalAt: string | null = null;
  private lastSignalTicker: string | null = null;
  private nextFireAt: string | null = null;
  private recentActivity: SignalSourceActivityEntry[] = [];

  constructor(
    public readonly id: string,
    configJson: string,
  ) {
    const parsed = safeParseConfig(configJson);
    if (!parsed.symbol || !parsed.cadence) {
      throw new Error(
        "TimerSignalSource requires symbol and cadence in configJson",
      );
    }
    this.config = parsed;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.status = "running";
    this.lastError = null;
    const intervalMs = Math.max(
      1000,
      this.config.intervalMs ?? cadenceToMs(this.config.cadence),
    );
    this.intervalMs = intervalMs;
    await this.emitTick();
    this.timer = setInterval(() => {
      void this.emitTick();
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextFireAt = null;
    this.status = "paused";
  }

  async restart(newConfig: Record<string, unknown>): Promise<void> {
    this.status = "restarting";
    this.config = safeParseConfig(JSON.stringify(newConfig));
    await this.stop();
    await this.start();
  }

  async test(): Promise<PollResult> {
    return this.emitTick();
  }

  snapshot(): SignalSourceSnapshot {
    return {
      lastPollAt: this.lastPollAt,
      lastPollResult: this.lastPollResult,
      lastSignalAt: this.lastSignalAt,
      lastSignalTicker: this.lastSignalTicker,
      recentActivity: [...this.recentActivity],
      nextFireAt: this.nextFireAt,
    };
  }

  onSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.add(handler);
  }

  offSignal(handler: (event: SignalEvent) => void): void {
    this.handlers.delete(handler);
  }

  private async emitTick(): Promise<PollResult> {
    const result: PollResult = {
      detected: 1,
      passed: 1,
      dropped: 0,
      errors: [],
    };
    const at = new Date().toISOString();
    const event: SignalEvent = {
      id: crypto.randomUUID(),
      sourceId: this.id,
      sourceType: "timer",
      ticker: this.config.symbol,
      companyName: null,
      documentUrl: null,
      accessionNumber: null,
      payloadJson: {
        cadence: this.config.cadence,
        instrumentClass: this.config.instrumentClass ?? "stock",
        barCloseAt: at,
      },
      filedAt: at,
      detectedAt: at,
    };
    this.lastSignalAt = at;
    this.lastSignalTicker = event.ticker;
    this.lastPollAt = at;
    this.lastPollResult = result;
    this.nextFireAt =
      this.intervalMs != null
        ? new Date(Date.now() + this.intervalMs).toISOString()
        : null;
    this.pushActivity({
      at,
      kind: "ok",
      summary: `Timer tick ${this.config.symbol}@${this.config.cadence}`,
    });
    for (const handler of this.handlers) handler(event);
    return result;
  }

  private pushActivity(entry: SignalSourceActivityEntry): void {
    this.recentActivity = [entry, ...this.recentActivity].slice(0, 20);
  }
}

function safeParseConfig(raw: string): TimerSignalSourceConfig {
  try {
    return JSON.parse(raw) as TimerSignalSourceConfig;
  } catch {
    return { symbol: "SPY", cadence: "15m" };
  }
}

function cadenceToMs(cadence: string): number {
  const match = cadence.match(/^(\d+)(m|h|d)$/);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
}
