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
import type { InstrumentHistoryContract } from "../marketdata/history-provisioning-service";
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
  provisionHistory?: (
    symbol: string,
    timeframe: TradingTimeframe,
    instrumentClass: InstrumentClass,
    contract: InstrumentHistoryContract,
    context: { subscriptionIds: string[] },
  ) => Promise<void>;
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
  /** Solution 06 WS4: persist each instrument evaluation for opportunity rate. */
  onEvaluations?: (
    plan: ScheduledRuntimePlan,
    instruments: InstrumentEvalOutcome[],
  ) => void;
  /**
   * Solution 10: option-chain fetch for options-flow scheduled producer.
   * When absent, options-flow stays no_setup with an explicit reason.
   */
  getOptionChain?: (
    symbol: string,
    context?: { subscriptionIds: string[] },
  ) => Promise<
    import("../broker/adapters/broker-adapter").OptionChainContract[]
  >;
}

export type InstrumentEvalKind =
  | "signal"
  | "no_setup"
  | "insufficient_bars"
  | "input_stale"
  | "bars_failed"
  | "evaluate_failed"
  | "empty_universe";

export type InstrumentEvalOutcome = {
  symbol: string;
  kind: InstrumentEvalKind;
  barsActual?: number;
  barsRequired?: number;
  preferredContextBars?: number;
  warmupBars?: number;
  error?: string;
  /**
   * Timestamp of the newest bar the evaluation actually saw. Present whenever
   * bars (or a chain snapshot) were fetched, including `no_setup`. Consumers
   * use it to tell a fresh chance from a re-look at the same window.
   */
  newestBarTs?: string;
  /**
   * Strategy-supplied window identity when a setup was produced. For quiet
   * evaluations the executor falls back to `newestBarTs`, so opportunity-rate
   * de-duplication works for both.
   */
  barWindowHash?: string;
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

/** Kinds where the lane never reached a strategy decision. */
export const UNEVALUABLE_KINDS: ReadonlySet<InstrumentEvalKind> = new Set([
  "insufficient_bars",
  "input_stale",
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
    const minEvaluableBars = strategyDef.requiredBarCount;
    const preferredContextBars = Math.max(minEvaluableBars * 4, 250);

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
            {
              minEvaluableBars,
              preferredContextBars,
              warmupBars: strategy.warmupBars,
              strategyImplementationVersion: strategyDef.implementationVersion,
              strategyParameters: plan.strategyParameters as Record<
                string,
                unknown
              >,
            },
          ),
        ),
      );
      for (const outcome of batchOutcomes) {
        instruments.push(outcome.diag);
        if (outcome.signal) signals.push(outcome.signal);
      }
    }

    this.deps.onEvaluations?.(plan, instruments);
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
    contract: {
      minEvaluableBars: number;
      preferredContextBars: number;
      warmupBars: number;
      strategyImplementationVersion: number;
      strategyParameters: Record<string, unknown>;
    },
  ): Promise<{
    signal: MarketSignal | null;
    diag: InstrumentEvalOutcome;
  }> {
    const barsRequired = contract.minEvaluableBars;
    const requestCount = Math.max(
      contract.preferredContextBars,
      contract.warmupBars + 1,
      barsRequired,
    );

    // Solution 10: options-flow scheduled path uses chain snapshot, not bars.
    if (plan.strategyId === "options-flow") {
      return this.evaluateOptionsFlow(
        displaySymbol,
        plan,
        now,
        instrumentClass,
        contract,
      );
    }

    let bars: OhlcvBar[];
    try {
      await this.deps.provisionHistory?.(
        displaySymbol,
        plan.analysisTimeframe,
        instrumentClass,
        contract,
        { subscriptionIds: plan.subscriptionIds },
      );
      bars = await getBars(
        displaySymbol,
        plan.analysisTimeframe,
        requestCount,
        instrumentClass,
        { subscriptionIds: plan.subscriptionIds },
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isStale =
        err instanceof Error &&
        (err.name === "InputStaleError" ||
          errorMessage.includes("still stale") ||
          errorMessage.includes("input_stale"));
      logger.warn({ symbol: displaySymbol, err }, "getBars failed");
      this.deps.onBarsFailed?.(plan, displaySymbol, errorMessage);
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: isStale ? "input_stale" : "bars_failed",
          barsRequired,
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          error: errorMessage,
        },
      };
    }

    const latestBarTs = bars[bars.length - 1]?.ts;

    if (bars.length < barsRequired) {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "insufficient_bars",
          barsActual: bars.length,
          barsRequired,
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          ...(latestBarTs ? { newestBarTs: latestBarTs } : {}),
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
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          error: errorMessage,
          ...(latestBarTs ? { newestBarTs: latestBarTs } : {}),
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
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          ...(latestBarTs ? { newestBarTs: latestBarTs } : {}),
        },
      };
    }

    if (!latestBarTs) {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "evaluate_failed",
          barsActual: 0,
          barsRequired,
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          error: "strategy produced a signal without market bars",
        },
      };
    }
    const newestBarTs = latestBarTs;
    const factPayload = {
      schemaVersion: 1 as const,
      signalId: crypto.randomUUID(),
      originKind: "strategy" as const,
      sessionInputGroupKey: plan.groupKey,
      strategyId: plan.strategyId,
      strategyImplementationVersion: contract.strategyImplementationVersion,
      strategyParameters: contract.strategyParameters,
      symbol: displaySymbol,
      instrumentClass,
      timeframe: plan.analysisTimeframe,
      evaluatedAt: now,
      newestBarTs,
      barWindowHash: signal.barWindowHash,
      action: signal.action,
      strength: signal.strength,
      evidence: signal.evidence,
      ...(signal.lifecycle ? { lifecycle: signal.lifecycle } : {}),
    };

    const payload: ScanHitPayload = {
      strategyId: plan.strategyId,
      evidence: signal.evidence,
      barWindowHash: signal.barWindowHash,
      proposedAction: signal.action,
      // Immutable fact travels with the sparse payload for downstream consumers.
      deterministicFact: factPayload,
    };

    const marketSignal: MarketSignal = {
      id: factPayload.signalId,
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
          originKind: "strategy",
          deterministicFact: factPayload,
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
        preferredContextBars: contract.preferredContextBars,
        warmupBars: contract.warmupBars,
        newestBarTs,
        barWindowHash: signal.barWindowHash,
      },
    };
  }

  private async evaluateOptionsFlow(
    displaySymbol: string,
    plan: ScheduledRuntimePlan,
    now: string,
    instrumentClass: InstrumentClass,
    contract: {
      minEvaluableBars: number;
      preferredContextBars: number;
      warmupBars: number;
      strategyImplementationVersion: number;
      strategyParameters: Record<string, unknown>;
    },
  ): Promise<{
    signal: MarketSignal | null;
    diag: InstrumentEvalOutcome;
  }> {
    const { produceOptionsFlowSignal } =
      await import("../signals/options-flow-producer");
    const getChain = this.deps.getOptionChain;
    if (!getChain) {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "evaluate_failed",
          error: "options-flow scheduled producer has no getOptionChain",
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
        },
      };
    }

    let chain: Awaited<ReturnType<typeof getChain>>;
    try {
      chain = await getChain(displaySymbol, {
        subscriptionIds: plan.subscriptionIds,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind: "bars_failed",
          error: errorMessage,
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
        },
      };
    }

    const produced = produceOptionsFlowSignal({
      underlyingSymbol: displaySymbol,
      chain,
      sessionInputGroupKey: plan.groupKey,
      strategyImplementationVersion: contract.strategyImplementationVersion,
      strategyParameters: contract.strategyParameters,
      volumeOiRatioThreshold:
        typeof contract.strategyParameters.volumeOiRatioThreshold === "number"
          ? contract.strategyParameters.volumeOiRatioThreshold
          : undefined,
      bullishSkewThreshold:
        typeof contract.strategyParameters.bullishSkewThreshold === "number"
          ? contract.strategyParameters.bullishSkewThreshold
          : undefined,
      targetWidth:
        typeof contract.strategyParameters.targetWidth === "number"
          ? contract.strategyParameters.targetWidth
          : undefined,
    });

    if (produced.kind !== "setup") {
      return {
        signal: null,
        diag: {
          symbol: displaySymbol,
          kind:
            produced.kind === "insufficient_chain"
              ? "insufficient_bars"
              : "no_setup",
          barsActual: chain.length,
          barsRequired: 1,
          preferredContextBars: contract.preferredContextBars,
          warmupBars: contract.warmupBars,
          error: produced.reason,
        },
      };
    }

    const fact = produced.fact;
    const payload: ScanHitPayload = {
      strategyId: plan.strategyId,
      evidence: fact.evidence,
      barWindowHash: fact.barWindowHash,
      proposedAction: fact.action,
      deterministicFact: fact,
    };

    const marketSignal: MarketSignal = {
      id: fact.signalId,
      sourceId: `schedule:${plan.groupKey}`,
      kind: "scan_hit",
      instrumentClass: "options",
      symbols: [displaySymbol],
      occurredAt: now,
      detectedAt: now,
      ttl: DEFAULT_SIGNAL_TTL["scan_hit"],
      dedupeKey: computeDedupeKey("scan_hit", {
        groupKey: plan.groupKey,
        symbol: displaySymbol,
        barWindowHash: fact.barWindowHash,
      }),
      provenance: {
        raw: {
          scheduleGroupKey: plan.groupKey,
          originKind: "strategy",
          deterministicFact: fact,
          optionsLegs: produced.legs,
          maxDebitUsd: produced.maxDebitUsd,
        },
      },
      payload,
    };

    void instrumentClass;
    return {
      signal: marketSignal,
      diag: {
        symbol: displaySymbol,
        kind: "signal",
        barsActual: chain.length,
        barsRequired: 1,
        preferredContextBars: contract.preferredContextBars,
        warmupBars: contract.warmupBars,
        barWindowHash: fact.barWindowHash,
      },
    };
  }
}
