import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { instrumentSetMembers, instrumentSetRevisions } from "../../db/schema";
import type {
  MarketSignal,
  ScanHitPayload,
} from "@electron/shared/domain/market-signal";
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
import { createLogger } from "../infra/log";

const logger = createLogger("scheduled-strategy-executor");

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
  context?: { subscriptionIds: string[] },
) => Promise<OhlcvBar[]>;

export interface ScheduledStrategyExecutorDeps {
  db: DbClient;
  strategyRegistry: StrategyDefinitionRegistry;
  getBars: GetBarsCallback;
  /** Maximum concurrent instrument evaluations. Default: 4. */
  concurrency?: number;
  /**
   * Observability hook: a per-instrument bar fetch failed. Per-instrument
   * isolation (one bar outage must not kill the scan batch) is unchanged —
   * this is fail-loud reporting only, never a control-flow input.
   */
  onBarsFailed?: (
    plan: ScheduledRuntimePlan,
    symbol: string,
    errorMessage: string,
  ) => void;
}

export type InstrumentEvalKind =
  | "signal"
  | "no_setup"
  | "insufficient_bars"
  | "bars_failed"
  | "evaluate_failed"
  | "empty_universe";

export type InstrumentEvalOutcome = {
  symbol: string;
  kind: InstrumentEvalKind;
  barsActual?: number;
  barsRequired?: number;
  error?: string;
};

export type ScheduledExecutionResult = {
  signals: MarketSignal[];
  instruments: InstrumentEvalOutcome[];
};

export function summarizeScanExecution(
  result: ScheduledExecutionResult,
): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const row of result.instruments) {
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  }
  return {
    signalCount: result.signals.length,
    instrumentCount: result.instruments.length,
    counts,
    instruments: result.instruments,
  };
}

const UNEVALUABLE_KINDS: ReadonlySet<InstrumentEvalKind> = new Set([
  "insufficient_bars",
  "bars_failed",
  "evaluate_failed",
  "empty_universe",
]);

/** True when every instrument was unevaluable (no strategy evaluation reached). */
export function isAllInstrumentsUnevaluable(
  result: ScheduledExecutionResult,
): boolean {
  return (
    result.instruments.length === 0 ||
    result.instruments.every((row) => UNEVALUABLE_KINDS.has(row.kind))
  );
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
 *    Quiet evaluations produce no signal but are recorded as `no_setup`.
 */
export class ScheduledStrategyExecutor {
  private readonly concurrency: number;

  constructor(private readonly deps: ScheduledStrategyExecutorDeps) {
    this.concurrency = deps.concurrency ?? 4;
  }

  async execute(plan: ScheduledRuntimePlan): Promise<ScheduledExecutionResult> {
    const { db, strategyRegistry, getBars } = this.deps;

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
      return {
        signals: [],
        instruments: [
          {
            symbol: "*",
            kind: "empty_universe",
            error: "instrument set has no members",
          },
        ],
      };
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

    const strategyDef = strategyRegistry.require(plan.strategyId);
    const strategy = strategyDef.create(plan.strategyParameters);

    const signals: MarketSignal[] = [];
    const instruments: InstrumentEvalOutcome[] = [];
    const now = new Date().toISOString();

    for (
      let offset = 0;
      offset < memberRows.length;
      offset += this.concurrency
    ) {
      const batch = memberRows.slice(offset, offset + this.concurrency);
      const batchOutcomes = await Promise.all(
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
      for (const outcome of batchOutcomes) {
        instruments.push(outcome.diag);
        if (outcome.signal) signals.push(outcome.signal);
      }
    }

    return { signals, instruments };
  }

  private async evaluateInstrument(
    displaySymbol: string,
    canonicalId: string,
    plan: ScheduledRuntimePlan,
    strategy: DeterministicStrategy,
    getBars: GetBarsCallback,
    now: string,
    instrumentClass: InstrumentClass,
  ): Promise<{
    signal: MarketSignal | null;
    diag: InstrumentEvalOutcome;
  }> {
    const barsRequired = strategy.warmupBars;
    let bars: OhlcvBar[];
    try {
      bars = await getBars(
        displaySymbol,
        plan.analysisTimeframe,
        strategy.warmupBars + 1,
        instrumentClass,
        { subscriptionIds: plan.subscriptionIds },
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn({ symbol: displaySymbol, err }, "getBars failed");
      this.deps.onBarsFailed?.(plan, displaySymbol, errorMessage);
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "bars_failed",
          barsRequired,
          error: errorMessage,
        },
      };
    }

    if (bars.length < strategy.warmupBars) {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "insufficient_bars",
          barsActual: bars.length,
          barsRequired,
        },
      };
    }

    let signal: ReturnType<typeof strategy.evaluate>;
    try {
      signal = strategy.evaluate(bars, {
        symbol: canonicalId,
        timeframe: plan.analysisTimeframe,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { symbol: displaySymbol, strategyId: plan.strategyId, err },
        "evaluate failed",
      );
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "evaluate_failed",
          barsActual: bars.length,
          barsRequired,
          error: errorMessage,
        },
      };
    }

    if (!signal) {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "no_setup",
          barsActual: bars.length,
          barsRequired,
        },
      };
    }

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

    return {
      signal: marketSignal,
      diag: {
        symbol: displaySymbol,
        kind: "signal",
        barsActual: bars.length,
        barsRequired,
      },
    };
  }
}
