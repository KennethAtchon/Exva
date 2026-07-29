/**
 * Production scheduled callers for non-OHLCV alpha sources:
 * funding/basis, Form 4 clusters, cross-venue dislocation.
 */

import type { MarketSignal } from "@electron/shared/domain/market-signal";
import type { CrossVenueMarketLinksRepo } from "../../db/repositories/signals/cross-venue-market-links-repo";
import type { Form4TransactionsRepo } from "../../db/repositories/signals/form4-transactions-repo";
import type { FundingRatesRepo } from "../../db/repositories/marketdata/funding-rates-repo";
import { createLogger } from "../infra/log";
import {
  runCrossVenueDislocationScan,
  type VenueQuote,
} from "./strategy/cross-venue-dislocation";
import { scanForm4Clusters } from "./strategy/form4-cluster-scan";
import {
  detectFundingDislocations,
  fetchKrakenFundingRates,
  fundingHitToMarketSignal,
  type FundingObservation,
} from "./strategy/funding-basis-scan";

const logger = createLogger("alpha-source-scan");

const DEFAULT_INTERVAL_MS = 30 * 60_000;
const FUNDING_HISTORY_DAYS = 30;

export type AlphaEmitFn = (
  signals: MarketSignal[],
  groupKey: string,
) => Promise<void>;

export type FetchVenueQuotesFn = (input: {
  polymarketIds: string[];
  kalshiTickers: string[];
}) => Promise<{
  polymarketQuotes: Map<string, VenueQuote>;
  kalshiQuotes: Map<string, VenueQuote>;
}>;

export interface AlphaSourceScanDeps {
  fundingRates: FundingRatesRepo;
  form4Transactions: Form4TransactionsRepo;
  crossVenueLinks: CrossVenueMarketLinksRepo;
  emitSignals: AlphaEmitFn;
  /** Optional; when omitted, cross-venue scan skips with a warn. */
  fetchVenueQuotes?: FetchVenueQuotesFn;
  fetchFundingRates?: () => Promise<FundingObservation[]>;
  intervalMs?: number;
}

export interface AlphaSourceScanTickResult {
  fundingSignals: number;
  form4Signals: number;
  crossVenueSignals: number;
}

export class AlphaSourceScanService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private tickInFlight = false;
  private readonly intervalMs: number;

  constructor(private readonly deps: AlphaSourceScanDeps) {
    this.intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Immediate first tick (Solution 08 WS2) — do not wait a full interval.
    void this.tick().finally(() => {
      if (this.running) this.arm();
    });
    logger.info({ intervalMs: this.intervalMs }, "alpha source scans armed");
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Immediate fire for tests / Dev Panel. */
  async tickNow(): Promise<AlphaSourceScanTickResult> {
    return this.tick();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.tick().finally(() => {
        if (this.running) this.arm();
      });
    }, this.intervalMs);
  }

  private async tick(): Promise<AlphaSourceScanTickResult> {
    if (this.tickInFlight) {
      logger.warn("alpha source scan still in flight; skipping tick");
      return { fundingSignals: 0, form4Signals: 0, crossVenueSignals: 0 };
    }
    this.tickInFlight = true;
    const result: AlphaSourceScanTickResult = {
      fundingSignals: 0,
      form4Signals: 0,
      crossVenueSignals: 0,
    };
    try {
      result.fundingSignals = await this.runFundingScan();
      result.form4Signals = await this.runForm4Scan();
      result.crossVenueSignals = await this.runCrossVenueScan();
      logger.info(result, "alpha source scan tick complete");
    } catch (err) {
      logger.error({ err }, "alpha source scan tick failed");
      throw err;
    } finally {
      this.tickInFlight = false;
    }
    return result;
  }

  private async runFundingScan(): Promise<number> {
    const fetchRates = this.deps.fetchFundingRates ?? fetchKrakenFundingRates;
    const latest = await fetchRates();
    if (latest.length === 0) return 0;

    const now = new Date().toISOString();
    const fromTs = new Date(
      Date.now() - FUNDING_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const signals: MarketSignal[] = [];

    for (const obs of latest) {
      this.deps.fundingRates.upsert({
        venue: obs.venue,
        symbol: obs.symbol,
        ts: obs.ts,
        rate: obs.rate,
      });
      const historyRows = this.deps.fundingRates.listHistory({
        venue: obs.venue,
        symbol: obs.symbol,
        fromTs,
        toTs: now,
      });
      const history: FundingObservation[] = historyRows.map((r) => ({
        venue: r.venue,
        symbol: r.symbol,
        ts: r.ts,
        rate: r.rate,
      }));
      const hit = detectFundingDislocations(history, obs);
      if (hit) signals.push(fundingHitToMarketSignal(hit, { now }));
    }

    if (signals.length > 0) {
      await this.deps.emitSignals(signals, "alpha:funding-basis");
    }
    return signals.length;
  }

  private async runForm4Scan(): Promise<number> {
    const txs = this.deps.form4Transactions.listRecentOpenMarketBuys();
    if (txs.length === 0) return 0;
    const signals = scanForm4Clusters(txs);
    if (signals.length > 0) {
      await this.deps.emitSignals(signals, "alpha:form4-insider-cluster");
    }
    return signals.length;
  }

  private async runCrossVenueScan(): Promise<number> {
    const links = this.deps.crossVenueLinks.list({ approvedOnly: true });
    if (links.length === 0) return 0;

    if (!this.deps.fetchVenueQuotes) {
      logger.warn(
        { approvedLinks: links.length },
        "cross-venue scan skipped: no quote fetcher wired",
      );
      return 0;
    }

    const quotes = await this.deps.fetchVenueQuotes({
      polymarketIds: links.map((l) => l.polymarketId),
      kalshiTickers: links.map((l) => l.kalshiTicker),
    });

    const result = runCrossVenueDislocationScan({
      links,
      polymarketQuotes: quotes.polymarketQuotes,
      kalshiQuotes: quotes.kalshiQuotes,
    });

    if (result.signals.length > 0) {
      await this.deps.emitSignals(
        result.signals,
        "alpha:cross-venue-dislocation",
      );
    }
    return result.signals.length;
  }
}
