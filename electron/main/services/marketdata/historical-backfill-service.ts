import type {
  InstrumentClass,
  TradingTimeframe,
} from "@electron/shared/domain/enums";
import { AppError } from "@electron/shared/infra/errors";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { EventBus } from "../infra/event-bus";
import type { MarketDataService } from "./market-data-service";

export interface HistoricalBackfillInput {
  symbol: string;
  instrumentClass: InstrumentClass;
  timeframe: TradingTimeframe;
  startIso: string;
  endIso: string;
  brokerAccountId?: string;
}

type RangeAdapter = {
  brokerType: string;
  getOhlcvRange?: (
    symbol: string,
    timeframe: TradingTimeframe,
    window: { startIso: string; endIso: string },
  ) => Promise<OhlcvBar[]>;
};

/**
 * Fetches every requested chunk every time. Coverage is an operator readout,
 * not a resumability cursor: provider ranges are idempotently upserted.
 */
export class HistoricalBackfillService {
  constructor(
    private readonly deps: {
      marketData: Pick<MarketDataService, "writeBars">;
      eventBus: Pick<EventBus, "emit">;
      resolveAdapter: (input: HistoricalBackfillInput) => Promise<RangeAdapter>;
      normalizeWireSymbol: (input: {
        symbol: string;
        instrumentClass: InstrumentClass;
        brokerType: string;
      }) => string;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {}

  async backfill(
    input: HistoricalBackfillInput,
  ): Promise<{ chunks: number; barsWritten: number }> {
    const start = new Date(input.startIso);
    const end = new Date(input.endIso);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start >= end
    ) {
      throw new AppError(
        "Backfill range must be valid and ascending",
        "VALIDATION_FAILED",
      );
    }
    const adapter = await this.deps.resolveAdapter(input);
    if (!adapter.getOhlcvRange) {
      throw new AppError(
        `Broker ${adapter.brokerType} does not support historical OHLCV ranges`,
        "UNSUPPORTED_INSTRUMENT",
      );
    }
    const wireSymbol = this.deps.normalizeWireSymbol({
      symbol: input.symbol,
      instrumentClass: input.instrumentClass,
      brokerType: adapter.brokerType,
    });
    let chunkStart = start;
    let chunks = 0;
    let barsWritten = 0;
    while (chunkStart < end) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setUTCMonth(chunkEnd.getUTCMonth() + 1);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
      const startIso = chunkStart.toISOString();
      const endIso = chunkEnd.toISOString();
      const bars = await adapter.getOhlcvRange(wireSymbol, input.timeframe, {
        startIso,
        endIso,
      });
      this.deps.marketData.writeBars(
        input.symbol,
        input.instrumentClass,
        input.timeframe,
        bars,
        "alpaca",
      );
      chunks += 1;
      barsWritten += bars.length;
      const done = chunkEnd.getTime() === end.getTime();
      this.deps.eventBus.emit("backfill_progress", {
        symbol: input.symbol,
        timeframe: input.timeframe,
        chunkStart: startIso,
        chunkEnd: endIso,
        barsWritten: bars.length,
        done,
      });
      if (!done) await (this.deps.sleep ?? defaultSleep)(100);
      chunkStart = chunkEnd;
    }
    return { chunks, barsWritten };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
