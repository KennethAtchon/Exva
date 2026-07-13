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

export class SignalSourceRegistry {
  private readonly sources = new Map<string, ISignalSource>();
  private readonly cikCache: CikTickerCache;
  private readonly calendarEventsRepo: CalendarEventsRepo;

  constructor(
    private readonly db: DbClient,
    private readonly bus: SignalBus,
  ) {
    this.cikCache = new CikTickerCache(db);
    this.calendarEventsRepo = new CalendarEventsRepo(db);
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
    if (record.type === "mock") {
      return new MockSignalSource(record.id, record.configJson);
    }
    if (record.type === "prediction_event") {
      return new PredictionEventSignalSource(record.id, record.configJson);
    }
    if (record.type === "kalshi_market") {
      return new KalshiMarketSource(record.id, record.configJson);
    }
    if (record.type === "calendar") {
      return new CalendarSource(
        record.id,
        record.configJson,
        this.calendarEventsRepo,
      );
    }
    if (record.type === "news_rss") {
      return new NewsSource(record.id, record.configJson);
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
