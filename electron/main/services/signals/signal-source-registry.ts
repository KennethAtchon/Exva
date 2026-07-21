import type { DbClient } from "../../db/client";
import type {
  SignalSourceRecord,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { ISignalSource, SignalSourceSnapshot } from "./ISignalSource";
import { CikTickerCache } from "./cache/cik-ticker-cache";
import { EdgarSignalSource } from "./sources/edgar-signal-source";
import { MockSignalSource } from "./sources/mock-signal-source";
import { PredictionEventSignalSource } from "./sources/prediction-event-signal-source";
import { KalshiMarketSource } from "./sources/kalshi-market-source";
import { CalendarSource } from "./sources/calendar-source";
import { NewsSource } from "./sources/news-source";
import { CalendarEventsRepo } from "../../db/repositories/signals/calendar-events-repo";
import { SignalBus } from "./signal-bus";
import { SignalSourceRuntimeRepo } from "./repos/signal-source-runtime-repo";

export class SignalSourceRegistry {
  private readonly sources = new Map<string, ISignalSource>();
  private readonly cikCache: CikTickerCache;
  private readonly calendarEventsRepo: CalendarEventsRepo;
  private readonly runtimeRepo: SignalSourceRuntimeRepo;

  constructor(
    private readonly db: DbClient,
    private readonly bus: SignalBus,
  ) {
    this.cikCache = new CikTickerCache(db);
    this.calendarEventsRepo = new CalendarEventsRepo(db);
    this.runtimeRepo = new SignalSourceRuntimeRepo(db);
  }

  /** Durable poll health — survives process exit. */
  getRuntimeRepo(): SignalSourceRuntimeRepo {
    return this.runtimeRepo;
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
    switch (record.type) {
      case "edgar_8k":
        return new EdgarSignalSource(
          record.id,
          record.configJson,
          this.cikCache,
          this.runtimeRepo,
        );
      case "mock":
        return new MockSignalSource(record.id, record.configJson);
      case "prediction_event":
        return new PredictionEventSignalSource(
          record.id,
          record.configJson,
          this.runtimeRepo,
        );
      case "kalshi_market":
        return new KalshiMarketSource(
          record.id,
          record.configJson,
          this.runtimeRepo,
        );
      case "calendar":
        return new CalendarSource(
          record.id,
          record.configJson,
          this.calendarEventsRepo,
          this.runtimeRepo,
        );
      case "news_rss":
        return new NewsSource(record.id, record.configJson, this.runtimeRepo);
      case "manual":
        throw new Error(
          `Signal source type "manual" is implicit and not instantiated via the registry`,
        );
      default:
        throw new Error(
          `Unknown signal source type: ${(record as { type: string }).type}`,
        );
    }
  }
}
