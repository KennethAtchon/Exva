import { createHash } from "node:crypto";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { BacktestRun, BacktestVerdict } from "@electron/shared/domain";
import {
  DEFAULT_BACKTEST_V2_EXECUTION,
  DEFAULT_BACKTEST_V2_PORTFOLIO,
  type BacktestRunSpecV2,
} from "@electron/shared/domain/backtest-v2";
import type { BacktestRunsRepo } from "../../db/repositories/research/experiment-repos";
import type { ExperienceExperimentsRepo } from "../../db/repositories/experiences/experience-experiments-repo";
import type { EventBus } from "../infra/event-bus";
import type { MarketDataService } from "../marketdata/market-data-service";
import { purgedWalkForwardFolds } from "@electron/shared/quant/statistics";
import {
  foldIndexForBar,
  runBacktest,
  type BacktestCosts,
  type BacktestResult,
  type ExitPolicyConfig,
  type FoldConfig,
} from "../backtest/replay-engine";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { PortfolioTrade } from "../backtest/portfolio-replay-engine";
import { PortfolioReplayEngine } from "../backtest/portfolio-replay-engine";
import { persistPortfolioReplayDetail } from "../backtest/persist-portfolio-replay";
import { getStrategyDefinitionRegistry } from "../strategies";
import { requireExperience } from "../../experiences";
import { safeJsonParse } from "../infra/safe-json-parse";
import type { DbClient } from "../../db/client";
import type { PortfolioReplayResult } from "../backtest/portfolio-replay-engine";
import type { BacktestRunSpecV2 as SpecV2 } from "@electron/shared/domain/backtest-v2";

const ENGINE_VERSION_V2 = 2;

/** Strategies that the V2 portfolio engine can drive today. */
const V2_OHLCV_STRATEGY_IDS = new Set([
  "mean-reversion",
  "breakout",
  "unusual-volume",
  "trend-following",
  "ny-range-breakout",
]);

export interface BacktestLabRunInput {
  experienceId: string;
  strategyId: string;
  strategyParams?: Record<string, unknown>;
  symbols: string[];
  timeframe: TradingTimeframe;
  windowStart: string;
  windowEnd: string;
  folds: number;
  foldConfig?: FoldConfig;
  costs?: Partial<BacktestCosts>;
  exitPolicy?: ExitPolicyConfig;
  instrumentClass?: string;
}

export interface ThresholdSweepInput extends BacktestLabRunInput {
  paramKey: string;
  values: number[];
}

export interface BacktestLabProgress {
  runId: string;
  phase: "loading" | "running" | "persisting" | "done" | "error";
  message: string;
  pct: number;
}

/**
 * Backtest Lab orchestration: run → persist backtest_runs → optional sweep
 * into experience_experiments (anti-cherry-pick bookkeeping).
 */
export class BacktestLabService {
  constructor(
    private readonly deps: {
      marketData: MarketDataService;
      backtestRuns: BacktestRunsRepo;
      experienceExperiments: ExperienceExperimentsRepo;
      eventBus: EventBus;
      db?: DbClient;
    },
  ) {}

  listStrategies(): Array<{ id: string; status: string }> {
    return getStrategyDefinitionRegistry()
      .list()
      .map((d) => ({ id: d.id, status: d.implementationStatus }));
  }

  listRuns(experienceId?: string, limit = 50): BacktestRun[] {
    if (experienceId) {
      return this.deps.backtestRuns
        .listByExperience(experienceId)
        .slice(-limit);
    }
    return this.deps.backtestRuns.listRecent(limit);
  }

  getRun(id: string): BacktestRun | null {
    return this.deps.backtestRuns.getById(id);
  }

  async run(input: BacktestLabRunInput): Promise<{
    run: BacktestRun;
    result: BacktestResult;
    determinismHash: string;
  }> {
    const runId = crypto.randomUUID();
    this.emitProgress({
      runId,
      phase: "loading",
      message: "Loading bars…",
      pct: 5,
    });

    const registry = getStrategyDefinitionRegistry();
    const def = registry.require(input.strategyId);
    const params = def.parameterSchema.parse(input.strategyParams ?? {});
    const strategy = def.create(params);

    const barsBySymbol: Record<
      string,
      Awaited<ReturnType<MarketDataService["getBars"]>>
    > = {};
    const instrumentClass = input.instrumentClass ?? "stock";
    for (let i = 0; i < input.symbols.length; i++) {
      const symbol = input.symbols[i];
      if (!symbol) continue;
      barsBySymbol[symbol] = await this.deps.marketData.getBars({
        symbol,
        instrumentClass,
        timeframe: input.timeframe,
        window: { start: input.windowStart, end: input.windowEnd },
        // An empty requested window makes any result meaningless. Historical
        // population is an explicit operator action through backfill.
        failOnGaps: true,
      });
      this.emitProgress({
        runId,
        phase: "loading",
        message: `Loaded ${symbol}`,
        pct: 5 + Math.round(((i + 1) / input.symbols.length) * 25),
      });
    }

    this.emitProgress({
      runId,
      phase: "running",
      message: "Running portfolio replay…",
      pct: 40,
    });

    const costs: BacktestCosts = {
      spreadBps: input.costs?.spreadBps ?? 2,
      feeBps: input.costs?.feeBps ?? 1,
      slippageBps: input.costs?.slippageBps ?? 2,
    };
    try {
      const experience = requireExperience(input.experienceId);
      const rc = experience.researchContract;
      if (rc.costs) {
        costs.spreadBps = input.costs?.spreadBps ?? rc.costs.spreadBps;
        costs.feeBps = input.costs?.feeBps ?? rc.costs.commissionBps;
        costs.slippageBps = input.costs?.slippageBps ?? rc.costs.slippageBps;
      }
    } catch {
      // Experience may be a free-form lab id.
    }

    const useV2 = V2_OHLCV_STRATEGY_IDS.has(input.strategyId);
    let result: BacktestResult;
    let portfolioExtras: {
      netPnlUsd: number;
      endingEquityUsd: number;
      maxDrawdownUsd: number;
      equityPointCount: number;
    } | null = null;
    let specHash: string | null = null;
    let datasetHash: string | null = null;
    let portfolioDetail: {
      spec: SpecV2;
      portfolio: PortfolioReplayResult;
      barsMap: Map<string, { length: number }>;
    } | null = null;

    if (useV2) {
      const barsMap = new Map(
        Object.entries(barsBySymbol).map(([symbol, bars]) => [symbol, bars]),
      );
      datasetHash = createHash("sha256")
        .update(
          [...barsMap.entries()]
            .map(
              ([symbol, bars]) =>
                `${symbol}:${bars.map((b) => `${b.ts}:${b.close}`).join(",")}`,
            )
            .join("|"),
        )
        .digest("hex")
        .slice(0, 16);

      const spec: BacktestRunSpecV2 = {
        schemaVersion: 2,
        experienceId: input.experienceId,
        strategy: {
          id: input.strategyId,
          implementationVersion: def.implementationVersion,
          parameters: params as Record<string, unknown>,
        },
        instruments: input.symbols.map((symbol) => ({
          symbol,
          instrumentClass: (input.instrumentClass ?? "stock") as
            | "stock"
            | "crypto"
            | "futures"
            | "options"
            | "prediction_market",
          timeframe: input.timeframe,
        })),
        window: { start: input.windowStart, end: input.windowEnd },
        folds: {
          count: input.folds,
          purgeBars: input.foldConfig?.purge ?? 1,
        },
        portfolio: { ...DEFAULT_BACKTEST_V2_PORTFOLIO },
        execution: { ...DEFAULT_BACKTEST_V2_EXECUTION },
        costs: {
          spreadBps: costs.spreadBps,
          commissionBps: costs.feeBps,
          slippageBps: costs.slippageBps,
        },
      };
      specHash = createHash("sha256")
        .update(JSON.stringify(spec))
        .digest("hex")
        .slice(0, 16);

      const portfolio = new PortfolioReplayEngine().run({
        spec,
        strategy,
        barsBySymbol: barsMap,
      });
      portfolioDetail = {
        spec,
        portfolio,
        barsMap: new Map(
          [...barsMap.entries()].map(([symbol, bars]) => [
            symbol,
            { length: bars.length },
          ]),
        ),
      };
      portfolioExtras = {
        netPnlUsd: portfolio.netPnlUsd,
        endingEquityUsd: portfolio.endingEquityUsd,
        maxDrawdownUsd: portfolio.maxDrawdownUsd,
        equityPointCount: portfolio.equity.length,
      };

      const closed = portfolio.trades.filter((t) => t.exitTs != null);
      const expectancyBps =
        closed.length > 0
          ? closed.reduce((sum, t) => sum + (t.returnBps ?? 0), 0) /
            closed.length
          : 0;
      // The portfolio engine runs one continuous pass, so folds are assigned
      // after the fact by entry timestamp. Reporting a single aggregate fold
      // would make `requiredFolds` in the research contract unverifiable.
      const foldOfTrade = assignPortfolioFolds({
        trades: closed,
        barsBySymbol: barsMap,
        folds: input.folds,
        purge: input.foldConfig?.purge ?? 1,
      });
      const foldTrades = closed.map((t) => ({
        symbol: t.symbol,
        side: t.side === "long" ? ("buy" as const) : ("sell" as const),
        entryTs: t.entryTs,
        exitTs: t.exitTs!,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice!,
        returnBps: t.returnBps ?? 0,
        netReturnBps: t.returnBps ?? 0,
        fold: foldOfTrade.get(t.id) ?? 0,
        evidence: {},
      }));
      result = {
        runHash: createHash("sha256")
          .update(`${specHash}:${datasetHash}:${portfolio.netPnlUsd}`)
          .digest("hex")
          .slice(0, 16),
        experienceId: input.experienceId,
        strategyId: input.strategyId,
        trades: foldTrades,
        folds: summarizePortfolioFolds(
          foldTrades,
          closed,
          foldOfTrade,
          Math.max(1, input.folds),
        ),
        tradeCount: closed.length,
        expectancyBps,
        sharpe: 0,
        maxDrawdownPct: portfolio.maxDrawdownPct,
        costDragBps: costs.spreadBps + costs.feeBps + costs.slippageBps,
      };
    } else {
      result = runBacktest({
        experienceId: input.experienceId,
        strategy,
        symbols: input.symbols,
        timeframe: input.timeframe,
        window: { start: input.windowStart, end: input.windowEnd },
        folds: input.folds,
        foldConfig: input.foldConfig,
        costs,
        exitPolicy: input.exitPolicy ?? { maxHoldBars: 20, stopLossPct: 0.02 },
        barsBySymbol,
      });
    }

    this.emitProgress({
      runId,
      phase: "persisting",
      message: "Saving run…",
      pct: 90,
    });

    const contractHash = result.runHash;
    const verdict = verdictFromResult(result);
    const run: BacktestRun = {
      id: runId,
      experienceId: input.experienceId,
      modelVersionId: null,
      contractHash,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      foldConfigJson: JSON.stringify({
        folds: input.folds,
        foldConfig: input.foldConfig ?? {},
        strategyId: input.strategyId,
        strategyParams: params,
        symbols: input.symbols,
        timeframe: input.timeframe,
        exitPolicy: input.exitPolicy ?? {},
        engineVersion: useV2 ? ENGINE_VERSION_V2 : 1,
      }),
      costModelJson: JSON.stringify(costs),
      metricsJson: JSON.stringify({
        tradeCount: result.tradeCount,
        expectancyBps: result.expectancyBps,
        sharpe: result.sharpe,
        maxDrawdownPct: result.maxDrawdownPct,
        costDragBps: result.costDragBps,
        folds: result.folds,
        strategyId: result.strategyId,
        runHash: result.runHash,
        ...(portfolioExtras ?? {}),
      }),
      verdict,
      createdAt: new Date().toISOString(),
      engineVersion: useV2 ? ENGINE_VERSION_V2 : 1,
      specHash,
      datasetHash,
      researchContractHash: contractHash,
    };
    this.deps.backtestRuns.insert(run);

    if (useV2 && portfolioDetail && this.deps.db) {
      persistPortfolioReplayDetail(this.deps.db, {
        runId,
        spec: portfolioDetail.spec,
        specHash: specHash ?? run.contractHash,
        datasetHash: datasetHash ?? run.contractHash,
        researchContractHash: contractHash,
        portfolio: portfolioDetail.portfolio,
        barsBySymbol: portfolioDetail.barsMap,
      });
    }

    this.emitProgress({
      runId,
      phase: "done",
      message: "Complete",
      pct: 100,
    });

    return {
      run,
      result: {
        ...result,
        ...(portfolioExtras ?? {}),
      },
      determinismHash: contractHash,
    };
  }

  /**
   * Re-execute from the immutable foldConfigJson stored on a prior run,
   * then compare the new output hash to the original contractHash.
   */
  async rerunFromSpec(runId: string): Promise<{
    original: BacktestRun;
    rerun: BacktestRun;
    result: BacktestResult;
    hashMatches: boolean;
  }> {
    const original = this.deps.backtestRuns.getById(runId);
    if (!original) throw new Error(`backtest run not found: ${runId}`);
    const spec = safeJsonParse<{
      folds: number;
      foldConfig?: FoldConfig;
      strategyId: string;
      strategyParams?: Record<string, unknown>;
      symbols: string[];
      timeframe: TradingTimeframe;
      exitPolicy?: ExitPolicyConfig;
    }>(original.foldConfigJson, undefined, "backtest-lab.foldConfig");
    if (!spec) {
      throw new Error(`backtest run ${runId} has invalid foldConfigJson`);
    }
    if (!spec.strategyId || !spec.symbols?.length || !spec.timeframe) {
      throw new Error(
        `backtest run ${runId} foldConfigJson missing required fields`,
      );
    }
    const costs =
      safeJsonParse<Partial<BacktestCosts>>(
        original.costModelJson,
        undefined,
        "backtest-lab.costModel",
      ) ?? undefined;
    const { run, result } = await this.run({
      experienceId: original.experienceId,
      strategyId: spec.strategyId,
      strategyParams: spec.strategyParams,
      symbols: spec.symbols,
      timeframe: spec.timeframe,
      windowStart: original.windowStart,
      windowEnd: original.windowEnd,
      folds: spec.folds,
      foldConfig: spec.foldConfig,
      costs,
      exitPolicy: spec.exitPolicy,
    });
    return {
      original,
      rerun: run,
      result,
      hashMatches: result.runHash === original.contractHash,
    };
  }

  async compare(runIds: string[]): Promise<{
    runs: BacktestRun[];
    metrics: Array<Record<string, unknown>>;
    hashMatches: boolean[];
  }> {
    const runs = runIds
      .map((id) => this.deps.backtestRuns.getById(id))
      .filter((r): r is BacktestRun => r != null);
    const metrics = runs.map((r) => {
      return (
        safeJsonParse<Record<string, unknown>>(
          r.metricsJson,
          undefined,
          "backtest-lab.metrics",
        ) ?? {}
      );
    });
    const hashMatches = runs.map((r, i) => {
      const m = metrics[i];
      return m?.runHash === r.contractHash;
    });
    return { runs, metrics, hashMatches };
  }

  async sweep(input: ThresholdSweepInput): Promise<{
    experimentIds: string[];
    trials: Array<{
      value: number;
      runId: string;
      metrics: Record<string, unknown>;
    }>;
  }> {
    const experimentIds: string[] = [];
    const trials: Array<{
      value: number;
      runId: string;
      metrics: Record<string, unknown>;
    }> = [];

    for (const value of input.values) {
      const strategyParams = {
        ...(input.strategyParams ?? {}),
        [input.paramKey]: value,
      };
      const { run, result } = await this.run({ ...input, strategyParams });
      const metrics = {
        tradeCount: result.tradeCount,
        expectancyBps: result.expectancyBps,
        sharpe: result.sharpe,
        maxDrawdownPct: result.maxDrawdownPct,
        costDragBps: result.costDragBps,
        paramKey: input.paramKey,
        paramValue: value,
        runHash: result.runHash,
        foldCount: result.folds.length,
      };
      const configHash = createHash("sha256")
        .update(
          JSON.stringify({
            ...input,
            strategyParams,
            sweep: true,
          }),
        )
        .digest("hex")
        .slice(0, 16);
      const exp = this.deps.experienceExperiments.insert({
        id: crypto.randomUUID(),
        experienceId: input.experienceId,
        configHash,
        datasetWindowStart: input.windowStart,
        datasetWindowEnd: input.windowEnd,
        metrics,
        notes: `Threshold sweep ${input.paramKey}=${value} (Backtest Lab)`,
        verdict: "inconclusive",
      });
      experimentIds.push(exp.id);
      trials.push({ value, runId: run.id, metrics });
    }

    return { experimentIds, trials };
  }

  private emitProgress(progress: BacktestLabProgress): void {
    this.deps.eventBus.emit("backtest_progress", progress);
  }
}

/**
 * Map each closed portfolio trade to a purged walk-forward test fold by the
 * bar index of its entry. Trades that land in a train or purge segment have no
 * fold and are excluded from fold metrics (they stay in the trade list).
 */
function assignPortfolioFolds(input: {
  trades: PortfolioTrade[];
  barsBySymbol: Map<string, OhlcvBar[]>;
  folds: number;
  purge: number;
}): Map<string, number | null> {
  const assignment = new Map<string, number | null>();
  const foldsBySymbol = new Map<string, ReturnType<typeof purgedWalkForwardFolds>>();
  const indexBySymbol = new Map<string, Map<string, number>>();

  for (const [symbol, bars] of input.barsBySymbol) {
    foldsBySymbol.set(
      symbol,
      purgedWalkForwardFolds(
        bars.length,
        Math.max(1, input.folds),
        input.purge,
      ),
    );
    indexBySymbol.set(symbol, new Map(bars.map((bar, i) => [bar.ts, i])));
  }

  for (const trade of input.trades) {
    const barIndex = indexBySymbol.get(trade.symbol)?.get(trade.entryTs);
    const folds = foldsBySymbol.get(trade.symbol);
    if (barIndex === undefined || !folds) {
      assignment.set(trade.id, null);
      continue;
    }
    assignment.set(trade.id, foldIndexForBar(barIndex, folds));
  }
  return assignment;
}

/** `closed` and `foldTrades` are 1:1 in the same order, so zip by index. */
function summarizePortfolioFolds(
  foldTrades: BacktestResult["trades"],
  closed: PortfolioTrade[],
  foldOfTrade: Map<string, number | null>,
  foldCount: number,
): BacktestResult["folds"] {
  const foldByIndex = closed.map((trade) => foldOfTrade.get(trade.id) ?? null);

  return Array.from({ length: foldCount }, (_unused, fold) => {
    const members = foldTrades.filter((_trade, i) => foldByIndex[i] === fold);
    const wins = closed.filter(
      (trade) => foldOfTrade.get(trade.id) === fold && trade.realizedPnlUsd > 0,
    ).length;
    const expectancyBps =
      members.length > 0
        ? members.reduce((sum, t) => sum + t.netReturnBps, 0) / members.length
        : 0;
    return {
      fold,
      tradeCount: members.length,
      expectancyBps,
      sharpe: 0,
      maxDrawdownPct: foldMaxDrawdownPct(members),
      winRate: members.length > 0 ? wins / members.length : 0,
    };
  });
}

/** Peak-to-trough of the fold's cumulative bps curve, as a fraction. */
function foldMaxDrawdownPct(trades: BacktestResult["trades"]): number {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    cumulative += trade.netReturnBps;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return maxDrawdown / 10_000;
}

function verdictFromResult(result: BacktestResult): BacktestVerdict {
  if (result.tradeCount < 5) return "inconclusive";
  if (result.expectancyBps > 0 && result.sharpe > 0) return "pass";
  if (result.expectancyBps < 0) return "fail";
  return "inconclusive";
}
