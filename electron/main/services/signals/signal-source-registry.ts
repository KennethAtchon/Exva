import type { DbClient } from "../../db/client";
import type {
  PollResult,
  SignalEvent,
  SignalSourceRecord,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { InstrumentClass } from "@/lib/types";
import type { ISignalSource, SignalSourceSnapshot } from "./ISignalSource";
import { CikTickerCache } from "./cache/cik-ticker-cache";
import { EdgarSignalSource } from "./sources/edgar-signal-source";
import { MockSignalSource } from "./sources/mock-signal-source";
import { TimerSignalSource } from "./sources/timer-signal-source";
import { PredictionEventSignalSource } from "./sources/prediction-event-signal-source";
import { SignalBus } from "./signal-bus";

/**
 * DB-compat stub for deprecated `web_search` rows. Never emits; start() marks
 * the source as error so operators delete it. New creates are blocked in
 * SignalService.createSource.
 */
class DeprecatedWebSearchStub implements ISignalSource {
  readonly type = "web_search" as const;
  status: SignalSourceRuntimeStatus = "idle";
  lastError: string | null =
    "web_search signal source is deprecated and no longer runs";

  constructor(public readonly id: string) {}

  async start(): Promise<void> {
    this.status = "error";
    this.lastError =
      "web_search signal source is deprecated; delete this source and use edgar_8k, timer, or prediction_event";
  }

  async stop(): Promise<void> {
    this.status = "paused";
  }

  async restart(_config: Record<string, unknown>): Promise<void> {
    void _config;
    await this.start();
  }

  async test(): Promise<PollResult> {
    return {
      detected: 0,
      passed: 0,
      dropped: 0,
      errors: [this.lastError ?? "web_search deprecated"],
    };
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
    void handler;
  }
  offSignal(handler: (event: SignalEvent) => void): void {
    void handler;
  }

  configuredInstrumentClasses(): InstrumentClass[] {
    return ["stock"];
  }
}

export class SignalSourceRegistry {
  private readonly sources = new Map<string, ISignalSource>();
  private readonly cikCache: CikTickerCache;

  constructor(
    private readonly db: DbClient,
    private readonly bus: SignalBus,
  ) {
    this.cikCache = new CikTickerCache(db);
  }

  create(record: SignalSourceRecord): ISignalSource {
    const source = this.instantiate(record);
    this.sources.set(record.id, source);
    this.bus.register(source);
    return source;
  }

  get(sourceId: string): ISignalSource | null {
    return this.sources.get(sourceId) ?? null;
  }

  status(sourceId: string): {
    status: SignalSourceRuntimeStatus;
    lastError: string | null;
  } | null {
    const source = this.get(sourceId);
    if (!source) return null;
    return { status: source.status, lastError: source.lastError };
  }

  async start(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    await source.start();
  }

  async stop(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    await source.stop();
  }

  async restart(
    sourceId: string,
    config: Record<string, unknown>,
  ): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    await source.restart(config);
  }

  async test(sourceId: string) {
    const source = this.sources.get(sourceId);
    if (!source) return null;
    return source.test();
  }

  snapshot(sourceId: string): SignalSourceSnapshot | null {
    const source = this.sources.get(sourceId);
    if (!source) return null;
    return source.snapshot();
  }

  async remove(sourceId: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    await source.stop();
    this.bus.unregister(sourceId, source);
    this.sources.delete(sourceId);
  }

  private instantiate(record: SignalSourceRecord): ISignalSource {
    if (record.type === "edgar_8k") {
      return new EdgarSignalSource(record.id, record.configJson, this.cikCache);
    }
    if (record.type === "web_search") {
      return new DeprecatedWebSearchStub(record.id);
    }
    if (record.type === "mock") {
      return new MockSignalSource(record.id, record.configJson);
    }
    if (record.type === "timer") {
      return new TimerSignalSource(record.id, record.configJson);
    }
    if (record.type === "prediction_event") {
      return new PredictionEventSignalSource(record.id, record.configJson);
    }
    if (record.type === "manual") {
      throw new Error(
        `Signal source type "manual" is implicit and not instantiated via the registry`,
      );
    }
    throw new Error(
      `Unknown signal source type: ${(record as { type: string }).type}`,
    );
  }
}
