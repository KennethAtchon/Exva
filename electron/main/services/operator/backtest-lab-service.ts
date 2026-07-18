import { createHash } from "node:crypto";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { BacktestRun, BacktestVerdict } from "@electron/shared/domain";
import type { BacktestRunsRepo } from "../../db/repositories/research/experiment-repos";
import type { ExperienceExperimentsRepo } from "../../db/repositories/experiences/experience-experiments-repo";
import type { EventBus } from "../infra/event-bus";
import type { MarketDataService } from "../marketdata/market-data-service";
import {
  runBacktest,
  type BacktestCosts,
  type BacktestResult,
  type ExitPolicyConfig,
  type FoldConfig,
} from "../backtest/replay-engine";
import { getStrategyDefinitionRegistry } from "../strategies";
import { requireExperience } from "../../experiences";
import { safeJsonParse } from "../infra/safe-json-parse";

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
        failOnGaps: false,
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
      message: "Running walk-forward…",
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

    const result = runBacktest({
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
      }),
      verdict,
      createdAt: new Date().toISOString(),
    };
    this.deps.backtestRuns.insert(run);

    this.emitProgress({
      runId,
      phase: "done",
      message: "Complete",
      pct: 100,
    });

    return { run, result, determinismHash: contractHash };
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

function verdictFromResult(result: BacktestResult): BacktestVerdict {
  if (result.tradeCount < 5) return "inconclusive";
  if (result.expectancyBps > 0 && result.sharpe > 0) return "pass";
  if (result.expectancyBps < 0) return "fail";
  return "inconclusive";
}
