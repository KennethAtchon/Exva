#!/usr/bin/env bun
/**
 * Unusual-volume launch gate: sweep params on backfilled bars and judge
 * against the candidate research-contract thresholds.
 *
 * Run under Electron's Node (better-sqlite3 ABI):
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     ./node_modules/vite-node/vite-node.mjs --config vitest.config.ts \
 *     scripts/unusual-volume-gate.ts
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createDbClient } from "../electron/main/db/client";
import { BacktestRunsRepo } from "../electron/main/db/repositories/research/experiment-repos";
import { ExperienceExperimentsRepo } from "../electron/main/db/repositories/experiences/experience-experiments-repo";
import { EventBus } from "../electron/main/services/infra/event-bus";
import { MarketDataService } from "../electron/main/services/marketdata/market-data-service";
import { BacktestLabService } from "../electron/main/services/operator/backtest-lab-service";
import type { TradingTimeframe } from "../electron/shared/domain/enums";

const SYMBOLS = ["SPY", "QQQ", "AAPL", "NVDA"];
const WINDOW_START = "2026-01-23T00:00:00.000Z";
const WINDOW_END = "2026-07-23T00:00:00.000Z";
const FOLDS = 3;

/** Candidate contract thresholds (stock costs; same shape as mean-reversion). */
const VALIDATION = {
  minOutOfSampleTrades: 100,
  minNetExpectancyBps: 0,
  minSharpe: 0,
  /** Replay engine returns percent points (3 ≈ 3%), not a 0–1 fraction. */
  maxDrawdownPct: 20,
  requiredFolds: 3,
};
const COSTS = { spreadBps: 1, slippageBps: 2, feeBps: 0 };

const RVOL_VALUES = [2.0, 2.5, 3.0, 3.5];
const PRICE_BREAK_VALUES = [0.003, 0.005, 0.01];

type TrialJudgment = {
  timeframe: TradingTimeframe;
  paramKey: string;
  paramValue: number;
  strategyParams: Record<string, number>;
  tradeCount: number;
  expectancyBps: number;
  sharpe: number;
  maxDrawdownPct: number;
  foldsPositive: number;
  runHash: string;
  pass: boolean;
  failed: string[];
};

function judge(metrics: {
  tradeCount: number;
  expectancyBps: number;
  sharpe: number;
  maxDrawdownPct: number;
  folds?: Array<{ expectancyBps: number }>;
}): { pass: boolean; failed: string[]; foldsPositive: number } {
  const failed: string[] = [];
  const foldsPositive = (metrics.folds ?? []).filter(
    (f) => f.expectancyBps > 0,
  ).length;
  if (metrics.tradeCount < VALIDATION.minOutOfSampleTrades) {
    failed.push("minOutOfSampleTrades");
  }
  if (metrics.expectancyBps <= VALIDATION.minNetExpectancyBps) {
    failed.push("minNetExpectancyBps");
  }
  if (metrics.sharpe <= VALIDATION.minSharpe) {
    failed.push("minSharpe");
  }
  if (metrics.maxDrawdownPct > VALIDATION.maxDrawdownPct) {
    failed.push("maxDrawdownPct");
  }
  if (foldsPositive < VALIDATION.requiredFolds) {
    failed.push("requiredFolds");
  }
  return { pass: failed.length === 0, failed, foldsPositive };
}

async function main(): Promise<void> {
  const db = createDbClient(
    process.env.EXVA_USER_DATA_DIR ??
      join(homedir(), "Library", "Application Support", "exva"),
  );
  try {
    const lab = new BacktestLabService({
      marketData: new MarketDataService(db),
      backtestRuns: new BacktestRunsRepo(db),
      experienceExperiments: new ExperienceExperimentsRepo(db),
      eventBus: new EventBus(),
    });

    const judgments: TrialJudgment[] = [];

    for (const timeframe of ["15m", "1h"] as TradingTimeframe[]) {
      for (const rvol of RVOL_VALUES) {
        for (const priceBreakPct of PRICE_BREAK_VALUES) {
          const { result } = await lab.run({
            experienceId: "unusual-volume-gate",
            strategyId: "unusual-volume",
            strategyParams: {
              rvolThreshold: rvol,
              priceBreakPct,
              baselineBars: 20,
            },
            symbols: SYMBOLS,
            timeframe,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            folds: FOLDS,
            costs: COSTS,
            exitPolicy: { maxHoldBars: 20, stopLossPct: 0.02 },
          });
          const j = judge(result);
          judgments.push({
            timeframe,
            paramKey: "priceBreakPct",
            paramValue: priceBreakPct,
            strategyParams: {
              rvolThreshold: rvol,
              priceBreakPct,
              baselineBars: 20,
            },
            tradeCount: result.tradeCount,
            expectancyBps: result.expectancyBps,
            sharpe: result.sharpe,
            maxDrawdownPct: result.maxDrawdownPct,
            foldsPositive: j.foldsPositive,
            runHash: result.runHash,
            pass: j.pass,
            failed: j.failed,
          });
        }
      }
    }

    const passed = judgments.filter((j) => j.pass);
    const ranked = [...judgments].sort(
      (a, b) => b.expectancyBps - a.expectancyBps || b.sharpe - a.sharpe,
    );

    console.log(
      JSON.stringify(
        {
          validation: VALIDATION,
          costs: COSTS,
          symbols: SYMBOLS,
          window: { start: WINDOW_START, end: WINDOW_END },
          trialCount: judgments.length,
          passCount: passed.length,
          best: ranked[0] ?? null,
          passed,
          all: ranked,
        },
        null,
        2,
      ),
    );
  } finally {
    db.sqlite.close();
  }
}

await main();
