import fs from "node:fs";
import path from "node:path";
import type { AgentRole, InstrumentClass, StrategySnapshot } from "@/lib/types";
import type { AgentMessagesRepo } from "../../db/repositories/agent-messages-repo";
import type { InstrumentCacheRepo } from "../../db/repositories/instrument-cache-repo";
import type { SqliteSessionExecutionStepsRepo } from "../../db/repositories/session-execution-steps-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { MarketSnapshot } from "../broker/adapters/broker-adapter";
import type { MockOhlcvBar } from "../broker/adapters/mock-adapter";
import { CandidateValidationService } from "./candidate-validation-service";
import type { CandidateValidationResult } from "./candidate-validation-service";
import { OrderPolicyGate } from "./order-policy-gate";
import type { PolicyGateResult } from "./order-policy-gate";
import { ExitPolicyEvaluator } from "../risk/exit-policy-evaluator";
import type { ExitDecision } from "../risk/exit-policy-evaluator";

export interface CycleFixture {
  version: 1;
  exportedAt: string;
  sessionId: string;
  cycleId: string;
  strategySnapshot: StrategySnapshot;
  selectedInstruments: Array<{
    symbol: string;
    instrumentClass: InstrumentClass;
    rationale: string;
  }>;
  marketData: Array<{
    symbol: string;
    quote: MarketSnapshot;
    ohlcvBars: MockOhlcvBar[];
    newsHeadlines: string[];
    redditPosts: Array<{ body: string; score: number }>;
  }>;
  agentRuns: Array<{
    role: AgentRole;
    modelId: string;
    promptSummary: string;
    outputSummary: string;
    toolCalls: Array<{ tool: string; argsJson: string; resultJson: string }>;
  }>;
  decision: {
    action: "trade" | "no_trade";
    side?: "BUY" | "SELL";
    symbol?: string;
    sizeUsd?: number;
    confidence: number;
    reasoning: string;
  };
  riskOutcome: {
    allowed: boolean;
    reason?: string;
    gatesFailed?: string[];
  };
  trade: {
    id: string;
    brokerOrderId: string;
    entryPrice: number;
    sizeUsd: number;
    exitPrice?: number;
    realizedPnlUsd?: number;
    exitReason?: string;
    openedAt: string;
    closedAt?: string;
  } | null;
}

export interface ReplayResult {
  cycleId: string;
  candidateValidation: CandidateValidationResult[];
  policyGate: PolicyGateResult | null;
  exitDecision: ExitDecision | null;
  matchesOriginal: {
    riskOutcomeMatches: boolean;
    tradeOpenedMatches: boolean;
  };
}

interface CycleReplayServiceDeps {
  agentMessages: AgentMessagesRepo;
  trades: TradesRepo;
  instrumentCache: InstrumentCacheRepo;
  sessionExecutionSteps: SqliteSessionExecutionStepsRepo;
  userDataPath: string;
}

export class CycleReplayService {
  constructor(private readonly deps: CycleReplayServiceDeps) {}

  buildFixture(cycleId: string): CycleFixture | null {
    const messages = this.deps.agentMessages.listByCycle(cycleId);
    if (messages.length === 0) return null;

    const firstMsg = messages[0]!;
    const sessionId = firstMsg.session_id;

    let strategySnapshot: StrategySnapshot | null = null;
    try {
      strategySnapshot = JSON.parse(firstMsg.strategy_snapshot_json) as StrategySnapshot;
    } catch {
      return null;
    }

    // selectedInstruments from cache (filter to cycles that match)
    const cacheRow = this.deps.instrumentCache.get(sessionId);
    const selectedInstruments: CycleFixture["selectedInstruments"] = [];
    if (cacheRow && cacheRow.cycleId === cycleId) {
      try {
        const parsed = JSON.parse(cacheRow.instruments) as Array<{
          symbol: string;
          instrumentClass?: InstrumentClass;
          rationale?: string;
        }>;
        for (const item of parsed) {
          selectedInstruments.push({
            symbol: item.symbol,
            instrumentClass: item.instrumentClass ?? "stock",
            rationale: item.rationale ?? "",
          });
        }
      } catch {
        // leave empty
      }
    }

    // Collect market snapshots and tool calls from all messages
    const marketDataMap = new Map<string, CycleFixture["marketData"][number]>();

    const agentRuns: CycleFixture["agentRuns"] = [];
    for (const msg of messages) {
      const toolCalls: CycleFixture["agentRuns"][number]["toolCalls"] = [];
      if (msg.tool_calls_json) {
        try {
          const rawCalls = JSON.parse(msg.tool_calls_json) as Array<{
            tool?: string;
            name?: string;
            args?: unknown;
            result?: unknown;
          }>;
          for (const call of rawCalls) {
            const tool = call.tool ?? call.name ?? "unknown";
            toolCalls.push({
              tool,
              argsJson: JSON.stringify(call.args ?? {}),
              resultJson: JSON.stringify(call.result ?? {}),
            });

            // Extract quote from get_quote tool call results
            if ((tool === "get_quote" || tool === "get_market_snapshot") && call.result) {
              const quote = call.result as MarketSnapshot & { symbol?: string };
              const sym = quote.instrumentSymbol ?? quote.symbol;
              if (sym && !marketDataMap.has(sym)) {
                marketDataMap.set(sym, {
                  symbol: sym,
                  quote,
                  ohlcvBars: [],
                  newsHeadlines: [],
                  redditPosts: [],
                });
              }
            }

            // Extract ohlcv from get_ohlcv calls
            if (tool === "get_ohlcv" && call.result) {
              const result = call.result as { symbol?: string; bars?: MockOhlcvBar[] };
              if (result.symbol && result.bars) {
                const entry = marketDataMap.get(result.symbol);
                if (entry) {
                  entry.ohlcvBars = result.bars;
                } else {
                  marketDataMap.set(result.symbol, {
                    symbol: result.symbol,
                    quote: { instrumentSymbol: result.symbol, price: 0, timestamp: "" },
                    ohlcvBars: result.bars,
                    newsHeadlines: [],
                    redditPosts: [],
                  });
                }
              }
            }
          }
        } catch {
          // malformed tool_calls_json; skip
        }
      }

      // Use market_snapshot_json if present
      if (msg.market_snapshot_json) {
        try {
          const snap = JSON.parse(msg.market_snapshot_json) as MarketSnapshot;
          const sym = snap.instrumentSymbol;
          if (!marketDataMap.has(sym)) {
            marketDataMap.set(sym, {
              symbol: sym,
              quote: snap,
              ohlcvBars: [],
              newsHeadlines: [],
              redditPosts: [],
            });
          }
        } catch {
          // skip
        }
      }

      // Build prompt/output summaries
      let promptSummary = "";
      let outputSummary = "";
      try {
        const parsed = JSON.parse(msg.messages_json) as Array<{ role: string; content: string | unknown[] }>;
        const userMsg = parsed.find((m) => m.role === "user");
        const content = typeof userMsg?.content === "string" ? userMsg.content : JSON.stringify(userMsg?.content ?? "");
        promptSummary = content.slice(0, 200);
      } catch {
        // skip
      }
      if (msg.output_json) {
        try {
          outputSummary = JSON.stringify(JSON.parse(msg.output_json)).slice(0, 200);
        } catch {
          outputSummary = msg.output_json.slice(0, 200);
        }
      }

      agentRuns.push({
        role: msg.role,
        modelId: msg.model_id,
        promptSummary,
        outputSummary,
        toolCalls,
      });
    }

    // Decision from decision_maker output
    const decisionMsg = [...messages].reverse().find((m) => m.role === "decision_maker");
    let decision: CycleFixture["decision"] = { action: "no_trade", confidence: 0, reasoning: "" };
    if (decisionMsg?.output_json) {
      try {
        const out = JSON.parse(decisionMsg.output_json) as {
          action?: string;
          side?: string;
          symbol?: string;
          size_usd?: number;
          sizeUsd?: number;
          confidence?: number;
          reasoning?: string;
        };
        decision = {
          action: out.action === "trade" ? "trade" : "no_trade",
          side: out.side === "BUY" || out.side === "SELL" ? out.side : undefined,
          symbol: out.symbol,
          sizeUsd: out.size_usd ?? out.sizeUsd,
          confidence: out.confidence ?? 0,
          reasoning: out.reasoning ?? "",
        };
      } catch {
        // leave default
      }
    }

    // Risk outcome from session execution steps
    let riskOutcome: CycleFixture["riskOutcome"] = { allowed: true };
    const steps = this.deps.sessionExecutionSteps.getLatestByCycle(sessionId, cycleId);
    const riskStep = steps.find((s) => s.stage === "risk_gate");
    if (riskStep) {
      riskOutcome = {
        allowed: riskStep.status === "succeeded",
        reason: riskStep.lastErrorMessage ?? undefined,
        gatesFailed: riskStep.lastErrorCode ? [riskStep.lastErrorCode] : undefined,
      };
    }

    // Trade
    const tradesForCycle = this.deps.trades.listByCycle(cycleId);
    const tradeRecord = tradesForCycle[0] ?? null;
    let trade: CycleFixture["trade"] = null;
    if (tradeRecord) {
      trade = {
        id: tradeRecord.id,
        brokerOrderId: tradeRecord.broker_order_id ?? "",
        entryPrice: tradeRecord.entry_price ?? 0,
        sizeUsd: tradeRecord.position_size_usd,
        exitPrice: undefined,
        realizedPnlUsd: tradeRecord.final_pnl_usd ?? undefined,
        exitReason: tradeRecord.exit_reason ?? undefined,
        openedAt: tradeRecord.opened_at ?? new Date().toISOString(),
        closedAt: tradeRecord.closed_at ?? undefined,
      };
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessionId,
      cycleId,
      strategySnapshot,
      selectedInstruments,
      marketData: Array.from(marketDataMap.values()),
      agentRuns,
      decision,
      riskOutcome,
      trade,
    };
  }

  saveFixture(fixture: CycleFixture): string {
    const dir = path.join(this.deps.userDataPath, "replays", fixture.sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${fixture.cycleId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), "utf-8");
    return filePath;
  }

  loadFixture(filePath: string): CycleFixture {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as CycleFixture;
  }
}

export class CycleReplayRunner {
  private readonly candidateValidation = new CandidateValidationService();
  private readonly policyGate = new OrderPolicyGate();
  private readonly exitEvaluator = new ExitPolicyEvaluator();

  replay(fixture: CycleFixture): ReplayResult {
    const { cycleId, strategySnapshot, selectedInstruments, marketData, decision, riskOutcome, trade } = fixture;

    // Re-run candidate validation for each selected instrument
    const candidateResults: CandidateValidationResult[] = [];
    for (const instrument of selectedInstruments) {
      const md = marketData.find((d) => d.symbol === instrument.symbol);
      if (!md) continue;
      candidateResults.push(
        this.candidateValidation.validate({
          sessionId: fixture.sessionId,
          cycleId,
          instrument: {
            symbol: instrument.symbol,
            instrumentClass: instrument.instrumentClass,
          },
          sideBias: strategySnapshot.rules.sideBias,
          holdingStyle: strategySnapshot.timeframe.holdingStyle,
          selectorTrace: [],
          quoteSnapshot: md.quote,
        }),
      );
    }

    // Re-run policy gate if this was a trade decision
    let replayPolicyGate: PolicyGateResult | null = null;
    if (decision.action === "trade" && decision.symbol && decision.side) {
      const md = marketData.find((d) => d.symbol === decision.symbol);
      const config = {
        strategy: strategySnapshot.rules.setupType,
        max_position_usd: strategySnapshot.riskConfig.maxPositionUsd,
        stop_loss_pct: strategySnapshot.riskConfig.stopLossPct ?? 0,
        take_profit_pct: strategySnapshot.riskConfig.takeProfitPct ?? 0,
        max_concurrent_trades: strategySnapshot.riskConfig.maxConcurrentTrades,
        research_depth: "balanced" as const,
        daily_loss_limit_usd: strategySnapshot.riskConfig.dailyLossLimitUsd,
        profit_target_usd: strategySnapshot.riskConfig.profitTargetUsd,
        max_api_spend_usd: strategySnapshot.riskConfig.maxAiSpendUsd,
        human_approval_required: strategySnapshot.riskConfig.humanApprovalRequired,
      };
      replayPolicyGate = this.policyGate.evaluate({
        sessionId: fixture.sessionId,
        cycleId,
        tradeId: trade?.id ?? `${cycleId}:replay`,
        brokerAccountId: "",
        decisionRiskInput: {
          config,
          stats: {
            session_status: "active" as const,
            daily_pnl_usd: 0,
            daily_pnl_pct: 0,
            total_trades_today: 0,
            closed_trades_today: 0,
            win_rate_today: 0,
            open_trades: 0,
            daily_api_spend: 0,
            api_budget: strategySnapshot.riskConfig.maxAiSpendUsd,
            portfolio_value: 0,
            unrealized_pnl: 0,
            session_uptime_min: 0,
          },
          order: {
            instrumentSymbol: decision.symbol,
            side: decision.side,
            sizeUsd: decision.sizeUsd ?? 0,
            instrumentType: selectedInstruments.find((i) => i.symbol === decision.symbol)?.instrumentClass ?? "stock",
          },
          confidence: decision.confidence,
          quoteSnapshot: md?.quote,
          side: decision.side,
          exitPolicy: {
            stopLossPct: strategySnapshot.riskConfig.stopLossPct,
            atrStopMultiplier: strategySnapshot.riskConfig.atrStopMultiplier,
            takeProfitPct: strategySnapshot.riskConfig.takeProfitPct,
            maxHoldDays: strategySnapshot.timeframe.maxHoldDays,
          },
          strategyRules: { sideBias: strategySnapshot.rules.sideBias },
          sessionMode: "paper",
          brokerSupportsClass: true,
          marketIsOpen: true,
        },
        existingOrderCheck: () => false,
        sessionIsPaused: () => false,
      });
    }

    // Re-run exit evaluator if there's a trade with market data
    let replayExitDecision: ExitDecision | null = null;
    if (trade && decision.symbol) {
      const md = marketData.find((d) => d.symbol === decision.symbol);
      if (md && md.ohlcvBars.length > 0) {
        const lastBar = md.ohlcvBars[md.ohlcvBars.length - 1]!;
        replayExitDecision = this.exitEvaluator.evaluate({
          trade: {
            id: trade.id,
            entryPrice: trade.entryPrice,
            side: decision.side ?? "BUY",
            instrumentType:
              selectedInstruments.find((i) => i.symbol === decision.symbol)?.instrumentClass ?? "stock",
            highWaterMarkPrice: null,
          },
          currentPrice: lastBar.close,
          ohlcvBars: md.ohlcvBars.map((b) => ({ high: b.high, low: b.low, close: b.close })),
          riskConfig: {
            stopLossType: strategySnapshot.riskConfig.stopLossType,
            stopLossPct: strategySnapshot.riskConfig.stopLossPct,
            atrStopMultiplier: strategySnapshot.riskConfig.atrStopMultiplier,
            takeProfitPct: strategySnapshot.riskConfig.takeProfitPct,
          },
        });
      }
    }

    const replayAllowed = replayPolicyGate ? replayPolicyGate.allowed : true;
    const riskOutcomeMatches = replayAllowed === riskOutcome.allowed;
    const tradeOpenedMatches = (trade !== null) === (decision.action === "trade" && riskOutcome.allowed);

    return {
      cycleId,
      candidateValidation: candidateResults,
      policyGate: replayPolicyGate,
      exitDecision: replayExitDecision,
      matchesOriginal: { riskOutcomeMatches, tradeOpenedMatches },
    };
  }
}
