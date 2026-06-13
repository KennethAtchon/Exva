import type { DbClient } from "../../db/client";
import type {
  SignalSourceRecord,
  SignalSourceRuntimeStatus,
} from "@electron/shared/domain";
import type { ISignalSource, SignalSourceSnapshot } from "./ISignalSource";
import { CikTickerCache } from "./cache/cik-ticker-cache";
import { EdgarSignalSource } from "./sources/edgar-signal-source";
import { MockSignalSource } from "./sources/mock-signal-source";
import { TimerSignalSource } from "./sources/timer-signal-source";
import { WebSearchSignalSource } from "./sources/web-search-signal-source";
import { PredictionEventSignalSource } from "./sources/prediction-event-signal-source";
import { SignalBus } from "./signal-bus";

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
      return new WebSearchSignalSource(record.id);
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
    return new WebSearchSignalSource(record.id, record.configJson);
  }
}
