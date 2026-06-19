import fs from "node:fs";
import path from "node:path";
import type { InstrumentClass, StrategySnapshot } from "@/lib/types";
import {
  instrumentSelectionSchema,
  type InstrumentSelection,
} from "@/lib/schemas";
import {
  reviewSignalSchema,
  technicalSignalSchema,
  fundamentalSignalSchema,
  tradeSignalSchema,
  type ReviewSignal,
  type TechnicalSignal,
  type FundamentalSignal,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { AIPhaseTrace } from "@electron/shared/ai/ai-phase-trace";
import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import type { InstrumentCacheRepo } from "../../db/repositories/market/instrument-cache-repo";
import type { SqliteSessionExecutionStepsRepo } from "../../db/repositories/sessions/session-execution-steps-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { MarketSnapshot } from "../broker/adapters/broker-adapter";
import type { MockOhlcvBar } from "../broker/adapters/mock-adapter";
import { CandidateValidationService } from "../orchestration/policy/candidate-validation-service";
import type { CandidateValidationResult } from "../orchestration/policy/candidate-validation-service";
import { OrderPolicyGate } from "../orchestration/policy/order-policy-gate";
import type { PolicyGateResult } from "../orchestration/policy/order-policy-gate";
import { ExitPolicyEvaluator } from "../risk/exit-policy-evaluator";
import type { ExitDecision } from "../risk/exit-policy-evaluator";
import {
  computeTradeTradeExecutionProfile,
  priceLevelsFromProfile,
} from "../signal/execution/trade-execution-profile";

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
    role: string;
    modelId: string;
    promptSummary: string;
    outputSummary: string;
    outputJson: string | null;
    outputSchemaName: string | null;
    toolCalls: Array<{ tool: string; argsJson: string; resultJson: string }>;
  }>;
  phaseOutputs: {
    selector: InstrumentSelection | null;
    technical: TechnicalSignal | null;
    fundamental: FundamentalSignal | null;
    review: ReviewSignal | null;
    decision: TradeSignal | null;
  };
  phaseTraces: Partial<Record<PipelinePhase, AIPhaseTrace>>;
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
  phaseOutputs: CycleFixture["phaseOutputs"];
  scorecard: {
    submissionFired: boolean;
    totalCostUsd: number;
    aiAuthoredSizingFieldCount: number;
  };
  executionProfile: {
    positionSizeUsd: number;
    orderType: "market" | "limit";
    limitPrice: number | null;
    stopLossPrice: number | null;
    takeProfitPrice: number | null;
  } | null;
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

    const firstMsg = messages[0];
    if (!firstMsg) return null;
    const sessionId = firstMsg.session_id;

    let strategySnapshot: StrategySnapshot | null = null;
    try {
      strategySnapshot = JSON.parse(
        firstMsg.strategy_snapshot_json,
      ) as StrategySnapshot;
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
    const phaseOutputs = emptyPhaseOutputs();
    const phaseTraces: CycleFixture["phaseTraces"] = {};

    const agentRuns: CycleFixture["agentRuns"] = [];
    for (const msg of messages) {
      const toolCalls: CycleFixture["agentRuns"][number]["toolCalls"] = [];
      if (msg.tool_calls_json) {
        try {
          const parsed = JSON.parse(msg.tool_calls_json) as Array<
            RawToolCall | { toolCalls?: RawToolCall[] }
          >;
          const rawCalls = normalizeToolCalls(parsed);

          for (const call of rawCalls) {
            const tool = call.tool ?? call.name ?? "unknown";
            const argsJson = call.argsJson ?? JSON.stringify(call.args ?? {});
            const resultJson =
              call.resultJson ?? JSON.stringify(call.result ?? {});
            toolCalls.push({
              tool,
              argsJson,
              resultJson,
            });

            const callResult = call.resultJson
              ? safeParseJson(call.resultJson)
              : call.result;

            // Extract quote from get_quote tool call results
            if (
              (tool === "get_quote" || tool === "get_market_snapshot") &&
              callResult
            ) {
              const quote = callResult as MarketSnapshot & { symbol?: string };
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
            if (tool === "get_ohlcv" && callResult) {
              const result = callResult as {
                symbol?: string;
                bars?: MockOhlcvBar[];
              };
              if (result.symbol && result.bars) {
                const entry = marketDataMap.get(result.symbol);
                if (entry) {
                  entry.ohlcvBars = result.bars;
                } else {
                  marketDataMap.set(result.symbol, {
                    symbol: result.symbol,
                    quote: {
                      instrumentSymbol: result.symbol,
                      price: 0,
                      timestamp: "",
                    },
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

      const parsedOutput = parsePhaseOutput(
        msg.output_schema_name,
        msg.output_json,
      );
      if (parsedOutput) {
        (phaseOutputs as Record<string, unknown>)[parsedOutput.phase] =
          parsedOutput.output;
      }

      const phaseTrace = parsePhaseTrace(msg.tool_calls_json);
      if (phaseTrace) {
        phaseTraces[phaseTrace.phase] = phaseTrace;
      }

      // Build prompt/output summaries
      let promptSummary = "";
      let outputSummary = "";
      try {
        const parsed = JSON.parse(msg.messages_json) as Array<{
          role: string;
          content: string | unknown[];
        }>;
        const userMsg = parsed.find((m) => m.role === "user");
        const content =
          typeof userMsg?.content === "string"
            ? userMsg.content
            : JSON.stringify(userMsg?.content ?? "");
        promptSummary = content.slice(0, 200);
      } catch {
        // skip
      }
      if (msg.output_json) {
        try {
          outputSummary = JSON.stringify(JSON.parse(msg.output_json)).slice(
            0,
            200,
          );
        } catch {
          outputSummary = msg.output_json.slice(0, 200);
        }
      }

      agentRuns.push({
        role: msg.role,
        modelId: msg.model_id,
        promptSummary,
        outputSummary,
        outputJson: msg.output_json,
        outputSchemaName: msg.output_schema_name,
        toolCalls,
      });
    }

    if (phaseOutputs.selector) {
      selectedInstruments.splice(
        0,
        selectedInstruments.length,
        ...phaseOutputs.selector.instruments.map((instrument) => ({
          symbol: instrument.symbol,
          instrumentClass: instrument.instrumentClass,
          rationale: instrument.rationale ?? "",
        })),
      );
    }

    const decision = buildDecision(phaseOutputs, messages);

    // Risk outcome from session execution steps
    let riskOutcome: CycleFixture["riskOutcome"] = { allowed: true };
    const steps = this.deps.sessionExecutionSteps.getLatestByCycle(
      sessionId,
      cycleId,
    );
    const riskStep = steps.find((s) => s.stage === "risk_gate");
    if (riskStep) {
      riskOutcome = {
        allowed: riskStep.status === "succeeded",
        reason: riskStep.lastErrorMessage ?? undefined,
        gatesFailed: riskStep.lastErrorCode
          ? [riskStep.lastErrorCode]
          : undefined,
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
      phaseOutputs,
      phaseTraces,
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
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") {
      throw new Error(`Invalid fixture at ${filePath}: not an object`);
    }
    const fixture = raw as Record<string, unknown>;
    if (fixture["version"] !== 1) {
      throw new Error(
        `Invalid fixture at ${filePath}: expected version 1, got ${String(fixture["version"])}`,
      );
    }
    if (
      !fixture["sessionId"] ||
      !fixture["cycleId"] ||
      !Array.isArray(fixture["agentRuns"])
    ) {
      throw new Error(
        `Invalid fixture at ${filePath}: missing required fields (sessionId, cycleId, agentRuns)`,
      );
    }
    return fixture as unknown as CycleFixture;
  }
}

type RawToolCall = {
  tool?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  argsJson?: string;
  resultJson?: string;
};

function normalizeToolCalls(
  parsed: Array<RawToolCall | { toolCalls?: RawToolCall[] }>,
): RawToolCall[] {
  const [first] = parsed;
  if (!first) return [];
  if ("toolCalls" in first) {
    return (parsed as Array<{ toolCalls?: RawToolCall[] }>).flatMap(
      (step) => step.toolCalls ?? [],
    );
  }
  return parsed as RawToolCall[];
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class CycleReplayRunner {
  private readonly candidateValidation = new CandidateValidationService();
  private readonly policyGate = new OrderPolicyGate();
  private readonly exitEvaluator = new ExitPolicyEvaluator();

  replay(fixture: CycleFixture): ReplayResult {
    const {
      cycleId,
      strategySnapshot,
      selectedInstruments,
      marketData,
      decision,
      riskOutcome,
      trade,
    } = fixture;
    const phaseOutputs = validatePhaseOutputs(fixture.phaseOutputs);

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
        max_consecutive_losers:
          strategySnapshot.riskConfig.maxConsecutiveLosers,
        research_depth: "balanced" as const,
        daily_loss_limit_usd: strategySnapshot.riskConfig.dailyLossLimitUsd,
        profit_target_usd: strategySnapshot.riskConfig.profitTargetUsd,
        max_api_spend_usd: strategySnapshot.riskConfig.maxAiSpendUsd,
        human_approval_required:
          strategySnapshot.riskConfig.humanApprovalRequired,
        // Snapshots predate off-hours policy; replays use regular-hours rules.
        off_hours_trading: "disabled" as const,
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
            portfolio_value_source: "broker",
            portfolio_broker_count: 0,
            unrealized_pnl: 0,
            consecutive_losers: 0,
            session_uptime_min: 0,
          },
          order: {
            instrumentSymbol: decision.symbol,
            side: decision.side,
            sizeUsd: decision.sizeUsd ?? 0,
            instrumentType:
              selectedInstruments.find((i) => i.symbol === decision.symbol)
                ?.instrumentClass ?? "stock",
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
      const lastBar =
        md && md.ohlcvBars.length > 0
          ? md.ohlcvBars[md.ohlcvBars.length - 1]
          : null;
      if (md && lastBar) {
        replayExitDecision = this.exitEvaluator.evaluate({
          trade: {
            id: trade.id,
            entryPrice: trade.entryPrice,
            side: decision.side ?? "BUY",
            instrumentType:
              selectedInstruments.find((i) => i.symbol === decision.symbol)
                ?.instrumentClass ?? "stock",
            highWaterMarkPrice: null,
          },
          currentPrice: lastBar.close,
          ohlcvBars: md.ohlcvBars.map((b) => ({
            high: b.high,
            low: b.low,
            close: b.close,
          })),
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
    const tradeOpenedMatches =
      (trade !== null) === (decision.action === "trade" && riskOutcome.allowed);

    let executionProfile: ReplayResult["executionProfile"] = null;
    const tradeSignal = phaseOutputs.decision;
    if (
      decision.action === "trade" &&
      tradeSignal &&
      tradeSignal.action !== "skip"
    ) {
      const instrumentClass =
        selectedInstruments.find((i) => i.symbol === tradeSignal.symbol)
          ?.instrumentClass ?? "stock";
      const profile = computeTradeTradeExecutionProfile({
        signal: tradeSignal,
        instrumentClass,
        maxPositionUsd: strategySnapshot.riskConfig.maxPositionUsd,
        maxExposureUsd: strategySnapshot.riskConfig.maxExposureUsd ?? null,
        risk: {
          stopLossPct: strategySnapshot.riskConfig.stopLossPct,
          takeProfitPct: strategySnapshot.riskConfig.takeProfitPct,
          kellyFraction: strategySnapshot.riskConfig.kellyFraction,
        },
        reviewRecommendation: phaseOutputs.review?.recommendation,
      });
      const levels =
        profile.limitPrice != null
          ? priceLevelsFromProfile(profile.side, profile.limitPrice, profile)
          : { stopLossPrice: null, takeProfitPrice: null };

      executionProfile = {
        positionSizeUsd: profile.positionSizeUsd,
        orderType: profile.orderType,
        limitPrice: profile.limitPrice,
        stopLossPrice: levels.stopLossPrice,
        takeProfitPrice: levels.takeProfitPrice,
      };
    }

    return {
      cycleId,
      candidateValidation: candidateResults,
      policyGate: replayPolicyGate,
      exitDecision: replayExitDecision,
      phaseOutputs,
      scorecard: {
        submissionFired: phaseOutputs.selector !== null,
        totalCostUsd: totalFixtureCostUsd(fixture),
        aiAuthoredSizingFieldCount: countLegacyDecisionSizingFields(
          fixture.agentRuns,
        ),
      },
      executionProfile,
      matchesOriginal: { riskOutcomeMatches, tradeOpenedMatches },
    };
  }
}

function buildDecision(
  phaseOutputs: CycleFixture["phaseOutputs"],
  messages: Array<{ role: string; output_json: string | null }>,
): CycleFixture["decision"] {
  if (phaseOutputs.decision) {
    const d = phaseOutputs.decision;
    return {
      action: d.action === "skip" ? "no_trade" : "trade",
      side:
        d.action === "buy" ? "BUY" : d.action === "sell" ? "SELL" : undefined,
      symbol: d.symbol,
      sizeUsd: undefined,
      confidence: d.confidence,
      reasoning: d.reasoning,
    };
  }
  const decisionMsg = [...messages]
    .reverse()
    .find((m) => m.role === "decision");
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
      return {
        action: out.action === "trade" ? "trade" : "no_trade",
        side: out.side === "BUY" || out.side === "SELL" ? out.side : undefined,
        symbol: out.symbol,
        sizeUsd: out.size_usd ?? out.sizeUsd,
        confidence: out.confidence ?? 0,
        reasoning: out.reasoning ?? "",
      };
    } catch {
      // fall through to default
    }
  }
  return { action: "no_trade", confidence: 0, reasoning: "" };
}

function emptyPhaseOutputs(): CycleFixture["phaseOutputs"] {
  return {
    selector: null,
    technical: null,
    fundamental: null,
    review: null,
    decision: null,
  };
}

const PHASE_SCHEMA_MAP: Record<
  string,
  {
    phase: keyof CycleFixture["phaseOutputs"];
    schema: { parse(v: unknown): unknown };
  }
> = {
  instrumentSelection: { phase: "selector", schema: instrumentSelectionSchema },
  technicalSignal: { phase: "technical", schema: technicalSignalSchema },
  fundamentalSignal: { phase: "fundamental", schema: fundamentalSignalSchema },
  reviewSignal: { phase: "review", schema: reviewSignalSchema },
  tradeSignal: { phase: "decision", schema: tradeSignalSchema },
};

function parsePhaseOutput(
  schemaName: string | null,
  outputJson: string | null,
): { phase: keyof CycleFixture["phaseOutputs"]; output: unknown } | null {
  if (!schemaName || !outputJson) return null;
  const entry = PHASE_SCHEMA_MAP[schemaName];
  if (!entry) return null;
  const parsed = safeParseJson(outputJson);
  if (!parsed) return null;
  return { phase: entry.phase, output: entry.schema.parse(parsed) };
}

function parsePhaseTrace(raw: string | null): AIPhaseTrace | null {
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const trace = parsed as Partial<AIPhaseTrace>;
  if (trace.version !== 1) return null;
  if (typeof trace.phase !== "string") return null;
  if (!Array.isArray(trace.frontiers) || !Array.isArray(trace.workers))
    return null;
  return trace as AIPhaseTrace;
}

function validatePhaseOutputs(
  outputs: CycleFixture["phaseOutputs"],
): CycleFixture["phaseOutputs"] {
  return {
    selector: outputs.selector
      ? instrumentSelectionSchema.parse(outputs.selector)
      : null,
    technical: outputs.technical
      ? technicalSignalSchema.parse(outputs.technical)
      : null,
    fundamental: outputs.fundamental
      ? fundamentalSignalSchema.parse(outputs.fundamental)
      : null,
    review: outputs.review ? reviewSignalSchema.parse(outputs.review) : null,
    decision: outputs.decision
      ? tradeSignalSchema.parse(outputs.decision)
      : null,
  };
}

function totalFixtureCostUsd(fixture: CycleFixture): number {
  return Object.values(fixture.phaseTraces).reduce(
    (sum, trace) => sum + (trace?.totalCostUsd ?? 0),
    0,
  );
}

function countLegacyDecisionSizingFields(
  agentRuns: CycleFixture["agentRuns"],
): number {
  let count = 0;
  for (const run of agentRuns) {
    if (run.outputSchemaName !== "tradeSignal" && run.role !== "decision")
      continue;
    if (!run.outputJson) continue;
    const parsed = safeParseJson(run.outputJson);
    if (!parsed || typeof parsed !== "object") continue;
    const output = parsed as Record<string, unknown>;
    if ("sizeUsd" in output || "size_usd" in output) count += 1;
    if ("stopLossPct" in output || "stop_loss_pct" in output) count += 1;
    if ("takeProfitPct" in output || "take_profit_pct" in output) count += 1;
  }
  return count;
}
