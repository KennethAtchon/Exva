import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  instrumentSetMembers,
  instrumentSetRevisions,
} from "../../db/schema";
import type { MarketSignal, ScanHitPayload } from "@electron/shared/domain/market-signal";
import {
  DEFAULT_SIGNAL_TTL,
  computeDedupeKey,
} from "@electron/shared/domain/market-signal";
import type {
  InstrumentClass,
  TradingTimeframe,
} from "@electron/shared/domain/enums";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { DeterministicStrategy } from "../backtest/replay-engine";
import type { StrategyDefinitionRegistry } from "../strategies/strategy-definition-registry";
import type { ScheduledRuntimePlan } from "./session-input-runtime-planner";

// ---------------------------------------------------------------------------
// Injection interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal market data interface injected into the executor.
 * Callers wire this to their BrokerAdapter or MarketDataService.
 */
export type GetBarsCallback = (
  symbol: string,
  timeframe: TradingTimeframe,
  barCount: number,
  instrumentClass: string,
) => Promise<OhlcvBar[]>;

export interface ScheduledStrategyExecutorDeps {
  db: DbClient;
  strategyRegistry: StrategyDefinitionRegistry;
  getBars: GetBarsCallback;
  /** Maximum concurrent instrument evaluations. Default: 4. */
  concurrency?: number;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a single `ScheduledRuntimePlan`:
 *
 * 1. Load instrument set members from DB.
 * 2. For each instrument (bounded concurrency), fetch OHLCV bars.
 * 3. Evaluate the strategy via its `DeterministicStrategy.evaluate()`.
 * 4. Emit `scan_hit` `MarketSignal`s for positive evaluations.
 *    Quiet evaluations produce no signal.
 */
export class ScheduledStrategyExecutor {
  private readonly concurrency: number;

  constructor(private readonly deps: ScheduledStrategyExecutorDeps) {
    this.concurrency = deps.concurrency ?? 4;
  }

  async execute(plan: ScheduledRuntimePlan): Promise<MarketSignal[]> {
    const { db, strategyRegistry, getBars } = this.deps;

    // Load instrument set members.
    const memberRows = db.db
      .select()
      .from(instrumentSetMembers)
      .where(
        and(
          eq(instrumentSetMembers.setId, plan.instrumentSetId),
          eq(instrumentSetMembers.setRevision, plan.instrumentSetRevision),
        ),
      )
      .all();

    if (memberRows.length === 0) {
      return [];
    }

    const setRevision = db.db
      .select()
      .from(instrumentSetRevisions)
      .where(
        and(
          eq(instrumentSetRevisions.setId, plan.instrumentSetId),
          eq(instrumentSetRevisions.revision, plan.instrumentSetRevision),
        ),
      )
      .get();
    const instrumentClass = (setRevision?.instrumentClass ??
      "stock") as InstrumentClass;

    // Resolve strategy definition and create instance.
    const strategyDef = strategyRegistry.require(plan.strategyId);
    const strategy = strategyDef.create(plan.strategyParameters);

    const results: MarketSignal[] = [];
    const now = new Date().toISOString();

    // Process instruments in bounded-concurrency batches.
    for (
      let offset = 0;
      offset < memberRows.length;
      offset += this.concurrency
    ) {
      const batch = memberRows.slice(offset, offset + this.concurrency);
      const batchSignals = await Promise.all(
        batch.map((member) =>
          this.evaluateInstrument(
            member.displaySymbol,
            member.canonicalId,
            plan,
            strategy,
            getBars,
            now,
            instrumentClass,
          ),
        ),
      );
      for (const sig of batchSignals) {
        if (sig) results.push(sig);
      }
    }

    return results;
  }

  private async evaluateInstrument(
    displaySymbol: string,
    canonicalId: string,
    plan: ScheduledRuntimePlan,
    strategy: DeterministicStrategy,
    getBars: GetBarsCallback,
    now: string,
    instrumentClass: InstrumentClass,
  ): Promise<MarketSignal | null> {
    let bars: OhlcvBar[];
    try {
      bars = await getBars(
        displaySymbol,
        plan.analysisTimeframe,
        strategy.warmupBars + 1,
        instrumentClass,
      );
    } catch (err) {
      console.warn(
        `[ScheduledStrategyExecutor] getBars failed for ${displaySymbol}: ${String(err)}`,
      );
      return null;
    }

    if (bars.length < strategy.warmupBars) {
      return null;
    }

    let signal: ReturnType<typeof strategy.evaluate>;
    try {
      signal = strategy.evaluate(bars, {
        symbol: canonicalId,
        timeframe: plan.analysisTimeframe,
      });
    } catch (err) {
      console.warn(
        `[ScheduledStrategyExecutor] evaluate failed for ${displaySymbol} / ${plan.strategyId}: ${String(err)}`,
      );
      return null;
    }

    if (!signal) return null;

    const payload: ScanHitPayload = {
      strategyId: plan.strategyId,
      evidence: signal.evidence,
      barWindowHash: signal.barWindowHash,
      proposedAction: signal.action,
    };

    const marketSignal: MarketSignal = {
      id: crypto.randomUUID(),
      sourceId: `schedule:${plan.groupKey}`,
      kind: "scan_hit",
      instrumentClass,
      symbols: [displaySymbol],
      occurredAt: now,
      detectedAt: now,
      ttl: DEFAULT_SIGNAL_TTL["scan_hit"],
      dedupeKey: computeDedupeKey("scan_hit", {
        groupKey: plan.groupKey,
        symbol: canonicalId,
        barWindowHash: signal.barWindowHash,
      }),
      provenance: {
        raw: {
          scheduleGroupKey: plan.groupKey,
          originKind: "scheduled_scan",
        },
      },
      payload,
    };

    return marketSignal;
  }
}
