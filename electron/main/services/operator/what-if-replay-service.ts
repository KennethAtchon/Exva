import { createHash } from "node:crypto";
import type { Trade } from "@/lib/types";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { DecisionTraceRepo } from "../../db/repositories/trades/decision-trace-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import type { ExperienceExperimentsRepo } from "../../db/repositories/experiences/experience-experiments-repo";
import {
  CycleReplayRunner,
  type CycleReplayService,
  type CycleFixture,
} from "../replay/cycle-replay-service";
import { getStrategyDefinitionRegistry } from "../strategies";
import type { MarketDataService } from "../marketdata/market-data-service";
import { createMeanReversionStrategy } from "../signals/strategy/mean-reversion-signal";
import type { DeterministicStrategy } from "../backtest/replay-engine";

export interface WhatIfParams {
  zScoreEntry?: number;
  maxPositionUsd?: number;
  stopLossPct?: number;
  strategyId?: string;
  strategyParams?: Record<string, unknown>;
}

export interface WhatIfResult {
  labeled: "counterfactual";
  tradeId: string;
  actual: {
    status: string;
    pnlUsd: number | null;
    sizeUsd: number | null;
  };
  counterfactual: {
    wouldSubmit: boolean;
    policyAllowed: boolean | null;
    candidateAllowed: boolean | null;
    positionSizeUsd: number | null;
    notes: string[];
  };
  frozenLlmStages: string[];
  deterministicStagesRerun: string[];
  experimentId: string | null;
}

/**
 * What-if replay: re-run deterministic stages only; LLM outputs stay frozen
 * (finish-line 08 T6).
 */
export class WhatIfReplayService {
  private readonly runner = new CycleReplayRunner();

  constructor(
    private readonly deps: {
      trades: TradesRepo;
      decisionTraces: DecisionTraceRepo;
      agentMessages: AgentMessagesRepo;
      cycleReplay: CycleReplayService;
      experienceExperiments: ExperienceExperimentsRepo;
      marketData?: MarketDataService;
    },
  ) {}

  async run(
    tradeId: string,
    params: WhatIfParams,
    opts?: { save?: boolean; experienceId?: string },
  ): Promise<WhatIfResult> {
    const trade = this.deps.trades.require(tradeId);
    const notes: string[] = [];
    const frozenLlmStages = [
      "technical",
      "fundamental",
      "review",
      "decision",
      "selector",
    ];
    const deterministicStagesRerun = [
      "candidate_validation",
      "order_policy_gate",
      "exit_policy",
    ];

    const cycleId = this.resolveCycleId(tradeId);
    let fixture: CycleFixture | null = null;
    if (cycleId) {
      fixture = this.deps.cycleReplay.buildFixture(cycleId);
    }

    if (!fixture) {
      return this.runStrategyCounterfactual(trade, params, opts, notes);
    }

    if (params.maxPositionUsd != null) {
      const snap = fixture.strategySnapshot as {
        risk?: { maxPositionUsd?: number };
      };
      if (snap.risk) {
        snap.risk.maxPositionUsd = params.maxPositionUsd;
        notes.push(`maxPositionUsd → ${params.maxPositionUsd}`);
      } else {
        notes.push("strategySnapshot.risk missing — size override skipped");
      }
    }
    if (params.stopLossPct != null) {
      notes.push(`stopLossPct override noted: ${params.stopLossPct}`);
    }

    const replay = this.runner.replay(fixture);
    const wouldSubmit = replay.scorecard.submissionFired;
    const policyAllowed = replay.policyGate?.allowed ?? null;
    const candidateAllowed =
      replay.candidateValidation.length === 0
        ? null
        : replay.candidateValidation.every((c) => c.allowed);

    const experimentId = opts?.save
      ? this.saveExperiment(
          trade,
          params,
          {
            wouldSubmit,
            policyAllowed,
            candidateAllowed,
            positionSizeUsd: replay.executionProfile?.positionSizeUsd ?? null,
          },
          opts.experienceId,
        )
      : null;

    return {
      labeled: "counterfactual",
      tradeId,
      actual: {
        status: trade.status,
        pnlUsd: trade.final_pnl_usd ?? trade.unrealized_pnl ?? null,
        sizeUsd: trade.position_size_usd ?? null,
      },
      counterfactual: {
        wouldSubmit,
        policyAllowed,
        candidateAllowed,
        positionSizeUsd: replay.executionProfile?.positionSizeUsd ?? null,
        notes,
      },
      frozenLlmStages,
      deterministicStagesRerun,
      experimentId,
    };
  }

  private resolveCycleId(tradeId: string): string | null {
    const msg = this.deps.agentMessages.listByTrade(tradeId)[0];
    if (msg?.cycle_id) return msg.cycle_id;
    return null;
  }

  private saveExperiment(
    trade: Trade,
    params: WhatIfParams,
    metrics: Record<string, unknown>,
    experienceId?: string,
  ): string {
    const exp = this.deps.experienceExperiments.insert({
      id: crypto.randomUUID(),
      experienceId: experienceId ?? "what-if",
      configHash: createHash("sha256")
        .update(JSON.stringify({ tradeId: trade.id, params, kind: "what-if" }))
        .digest("hex")
        .slice(0, 16),
      datasetWindowStart: trade.opened_at,
      datasetWindowEnd: trade.closed_at,
      metrics: { kind: "what-if", tradeId: trade.id, params, ...metrics },
      notes: `Counterfactual what-if for trade ${trade.id}`,
      verdict: "inconclusive",
    });
    return exp.id;
  }

  private async runStrategyCounterfactual(
    trade: Trade,
    params: WhatIfParams,
    opts: { save?: boolean; experienceId?: string } | undefined,
    notes: string[],
  ): Promise<WhatIfResult> {
    notes.push("No cycle fixture — deterministic strategy evaluate only");
    const strategyId = params.strategyId ?? "mean-reversion";
    let strategy: DeterministicStrategy;
    try {
      const def = getStrategyDefinitionRegistry().require(strategyId);
      strategy = def.create(
        def.parameterSchema.parse({
          ...(params.strategyParams ?? {}),
          ...(params.zScoreEntry != null
            ? { zScoreEntry: params.zScoreEntry }
            : {}),
        }),
      );
    } catch {
      strategy = createMeanReversionStrategy({
        zScoreEntry: params.zScoreEntry ?? -2,
      });
    }

    let wouldSignal = false;
    if (this.deps.marketData) {
      try {
        const bars = await this.deps.marketData.getBars({
          symbol: trade.instrumentSymbol,
          instrumentClass: "stock",
          timeframe: "1h" as TradingTimeframe,
          barCount: 100,
          failOnGaps: false,
        });
        const signal = strategy.evaluate(bars, {
          symbol: trade.instrumentSymbol,
          timeframe: "1h",
        });
        wouldSignal = signal != null;
        notes.push(
          wouldSignal
            ? `Strategy ${strategy.id} would fire`
            : `Strategy ${strategy.id} would skip`,
        );
      } catch (err) {
        notes.push(
          `Bar load failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      notes.push("MarketData unavailable — counterfactual incomplete");
    }

    const experimentId = opts?.save
      ? this.saveExperiment(trade, params, { wouldSignal }, opts.experienceId)
      : null;

    return {
      labeled: "counterfactual",
      tradeId: trade.id,
      actual: {
        status: trade.status,
        pnlUsd: trade.final_pnl_usd ?? trade.unrealized_pnl ?? null,
        sizeUsd: trade.position_size_usd ?? null,
      },
      counterfactual: {
        wouldSubmit: wouldSignal,
        policyAllowed: null,
        candidateAllowed: wouldSignal,
        positionSizeUsd: params.maxPositionUsd ?? trade.position_size_usd,
        notes,
      },
      frozenLlmStages: [
        "technical",
        "fundamental",
        "review",
        "decision",
        "selector",
      ],
      deterministicStagesRerun: ["strategy_evaluate"],
      experimentId,
    };
  }
}
