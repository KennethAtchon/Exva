import type { AgentMessage, Trade } from "@/lib/types";
import {
  parseAutopsyStructuredJson,
  type AddLessonInput,
  type AutopsyLesson,
  type AutopsyStructured,
  type AndonCordPayload,
  type LessonStatus,
  type PhaseKind,
  type PhaseTrace,
  type QualityGrade,
  type TradeAutopsyRecord,
  type UpdateLessonInput,
} from "@electron/shared/domain/autopsy";
import { AppError } from "@electron/shared/infra/errors";
import { z } from "zod";
import type { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import type { AutopsyLessonsRepo } from "../../db/repositories/trades/autopsy-lessons-repo";
import type { TradeAutopsiesRepo } from "../../db/repositories/trades/trade-autopsies-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import type { ProviderRegistry } from "../llm/provider-registry";
import { estimateCostUsd } from "../llm/model-pricing";
import type { EventBus } from "../infra/event-bus";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "have",
  "been",
  "were",
  "will",
  "would",
  "could",
  "should",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "which",
  "while",
  "than",
  "also",
  "just",
  "only",
  "very",
  "more",
  "most",
  "some",
  "such",
  "each",
  "other",
  "into",
  "your",
  "their",
  "what",
  "were",
  "does",
  "done",
  "being",
  "over",
  "both",
  "same",
  "those",
  "these",
  "trade",
  "agent",
]);

const synthesisLessonSchema = z.object({
  lesson: z.string(),
  severity: z
    .enum(["low", "medium", "high", "critical"])
    .optional()
    .default("medium"),
  category: z
    .enum(["strategy", "execution", "behavioral", "risk", "system"])
    .optional()
    .default("strategy"),
  proposedFix: z.string().optional().default(""),
});

const synthesisOutputSchema = z.object({
  executiveSummary: z.string(),
  qualityGrade: z.enum(["A+", "A", "B", "C", "D", "F"]),
  qualityScore: z.number(),
  thesisReview: z.object({
    valid: z.boolean().nullable(),
    analysis: z.string(),
    confirmatoryBias: z.boolean(),
    prematureConviction: z.boolean(),
    ignoredCounterSignals: z.array(z.string()),
  }),
  executionQuality: z.object({
    entryTiming: z.enum(["early", "good", "late", "unknown"]),
    sizingAdequacy: z.enum([
      "oversized",
      "appropriate",
      "undersized",
      "unknown",
    ]),
    exitManagement: z.string(),
    slippage: z.string().nullable(),
  }),
  behavioralFlags: z.array(
    z.object({
      flag: z.string(),
      description: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
    }),
  ),
  marketContext: z.object({
    regime: z.enum([
      "trending",
      "ranging",
      "volatile",
      "low_liquidity",
      "unknown",
    ]),
    macro: z.string(),
    volatility: z.string(),
    suitability: z.enum(["good_conditions", "neutral", "poor_conditions"]),
  }),
  whatWorked: z.array(z.string()),
  whatFailed: z.array(z.string()),
  rootCause: z.string().nullable(),
  processImprovements: z.array(z.string()),
  lessons: z.array(synthesisLessonSchema).max(3).optional().default([]),
});

export interface TradeAutopsyServiceDeps {
  trades: TradesRepo;
  agentMessages: AgentMessagesRepo;
  autopsies: TradeAutopsiesRepo;
  lessons: AutopsyLessonsRepo;
  events: EventsRepo;
  providerRegistry: ProviderRegistry;
  workspacePrefs: WorkspacePreferencesRepo;
  eventBus: EventBus;
}

export interface LessonValidationContext {
  sessionId: string;
  structured: AutopsyStructured;
  priorLessons: AutopsyLesson[];
  recentStructuredByTrade: Map<string, AutopsyStructured | null>;
}

export function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3 && !STOPWORDS.has(word)),
    ),
  ];
}

export function lessonMatchesStructured(
  lesson: AutopsyLesson,
  structured: AutopsyStructured,
): boolean {
  const keywords = extractKeywords(lesson.lesson);
  if (keywords.length === 0) return false;

  const haystack = [
    ...structured.behavioralFlags.map((f) => f.description),
    ...structured.whatFailed,
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => haystack.includes(keyword));
}

export interface LessonUpdate {
  lessonId: string;
  recurrenceCount?: number;
  status?: LessonStatus;
  validatedAt?: string | null;
}

export function runLessonValidation(
  ctx: LessonValidationContext,
): { updates: LessonUpdate[]; andonCords: AndonCordPayload[] } {
  const updates: LessonUpdate[] = [];
  const andonCords: AndonCordPayload[] = [];

  for (const lesson of ctx.priorLessons) {
    const matched = lessonMatchesStructured(lesson, ctx.structured);

    if (matched) {
      const nextCount = lesson.recurrenceCount + 1;
      const nextStatus: LessonStatus =
        nextCount >= 2 && lesson.status !== "validated"
          ? "recurring"
          : lesson.status;

      updates.push({
        lessonId: lesson.id,
        recurrenceCount: nextCount,
        status: nextStatus,
      });

      if (
        (lesson.severity === "high" || lesson.severity === "critical") &&
        nextStatus === "recurring" &&
        nextCount >= 3
      ) {
        andonCords.push({
          lessonId: lesson.id,
          lessonText: lesson.lesson,
          recurrenceCount: nextCount,
          sessionId: ctx.sessionId,
        });
      }
      continue;
    }

    if (lesson.status !== "implemented") continue;
    if (ctx.recentStructuredByTrade.size < 5) continue;

    const anyRecentMatch = [...ctx.recentStructuredByTrade.values()].some(
      (structured) =>
        structured ? lessonMatchesStructured(lesson, structured) : false,
    );
    if (!anyRecentMatch) {
      updates.push({
        lessonId: lesson.id,
        status: "validated",
        validatedAt: new Date().toISOString(),
      });
    }
  }

  return { updates, andonCords };
}

export class TradeAutopsyService {
  constructor(private readonly deps: TradeAutopsyServiceDeps) {}

  async summarize(tradeId: string): Promise<TradeAutopsyRecord> {
    const trade = this.deps.trades.require(tradeId);
    if (trade.status !== "closed") {
      throw new AppError(
        "Trade must be closed before generating an autopsy.",
        "VALIDATION_FAILED",
        { tradeId },
      );
    }

    const sessionId = trade.sessionId;
    if (!sessionId) {
      throw new AppError(
        "Trade is missing session context.",
        "VALIDATION_FAILED",
        { tradeId },
      );
    }

    const messages = this.deps.agentMessages.listByTrade(tradeId);
    const { providerKey, modelId } = resolveModel(
      this.deps.workspacePrefs.get(),
    );

    const phaseOutputs: Partial<Record<PhaseKind, string>> = {};
    const traces: PhaseTrace[] = [];

    const thesisTrace = await this.runPhase(
      "thesis",
      THESIS_SYSTEM,
      buildThesisPrompt(trade, messages),
      providerKey,
      modelId,
    );
    traces.push(thesisTrace);
    phaseOutputs.thesis = thesisTrace.responseText;

    const executionTrace = await this.runPhase(
      "execution",
      EXECUTION_SYSTEM,
      buildExecutionPrompt(trade),
      providerKey,
      modelId,
    );
    traces.push(executionTrace);
    phaseOutputs.execution = executionTrace.responseText;

    const behavioralTrace = await this.runPhase(
      "behavioral",
      BEHAVIORAL_SYSTEM,
      buildBehavioralPrompt(messages),
      providerKey,
      modelId,
    );
    traces.push(behavioralTrace);
    phaseOutputs.behavioral = behavioralTrace.responseText;

    const marketTrace = await this.runPhase(
      "market_context",
      MARKET_CONTEXT_SYSTEM,
      buildMarketContextPrompt(trade, messages),
      providerKey,
      modelId,
    );
    traces.push(marketTrace);
    phaseOutputs.market_context = marketTrace.responseText;

    const synthesisTrace = await this.runPhase(
      "synthesis",
      SYNTHESIS_SYSTEM,
      buildSynthesisPrompt(trade, phaseOutputs),
      providerKey,
      modelId,
      1200,
    );
    traces.push(synthesisTrace);

    const parsed = parseSynthesis(synthesisTrace.responseText);
    const isFallback = parsed === null || synthesisTrace.error !== null;
    const structured = parsed?.structured ?? emptyStructured(trade);
    const summary = isFallback
      ? fallbackSummary(trade)
      : structured.executiveSummary;
    const qualityGrade = parsed?.qualityGrade ?? null;
    const qualityScore = parsed?.qualityScore ?? null;
    const now = new Date().toISOString();

    const record = this.deps.autopsies.insert({
      tradeId,
      sessionId,
      modelId,
      summary,
      summaryStructuredJson: JSON.stringify(structured),
      phaseTracesJson: JSON.stringify(traces),
      qualityGrade,
      qualityScore,
      isFallback,
      createdAt: now,
      createdBy: "user",
    });

    for (const item of parsed?.lessons ?? []) {
      this.deps.lessons.insert({
        autopsyId: record.id,
        tradeId,
        sessionId,
        lesson: item.lesson,
        severity: item.severity,
        category: item.category,
        proposedFix: item.proposedFix,
        status: "pending",
        recurrenceCount: 0,
        createdAt: now,
        updatedAt: now,
        validatedAt: null,
      });
    }

    this.validateLessons(sessionId, record.id, structured);
    return record;
  }

  listByTrade(tradeId: string): TradeAutopsyRecord[] {
    return this.deps.autopsies.listByTrade(tradeId);
  }

  listLessons(autopsyId: string): AutopsyLesson[] {
    return this.deps.lessons.listByAutopsy(autopsyId);
  }

  updateLesson(lessonId: string, patch: UpdateLessonInput): void {
    const existing = this.deps.lessons.require(lessonId);
    this.deps.lessons.update(lessonId, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.lesson !== undefined ? { lesson: patch.lesson } : {}),
      ...(patch.proposedFix !== undefined
        ? { proposedFix: patch.proposedFix }
        : {}),
      ...(patch.status === "validated"
        ? { validatedAt: new Date().toISOString() }
        : {}),
      updatedAt: new Date().toISOString(),
    });
    if (patch.status && patch.status !== existing.status) {
      void existing;
    }
  }

  addLesson(input: AddLessonInput): AutopsyLesson {
    const now = new Date().toISOString();
    return this.deps.lessons.insert({
      autopsyId: input.autopsyId,
      tradeId: input.tradeId,
      sessionId: input.sessionId,
      lesson: input.lesson,
      severity: input.severity,
      category: input.category,
      proposedFix: input.proposedFix,
      status: "pending",
      recurrenceCount: 0,
      createdAt: now,
      updatedAt: now,
      validatedAt: null,
    });
  }

  validateLessons(
    sessionId: string,
    newAutopsyId: string,
    structured: AutopsyStructured,
  ): void {
    const priorLessons = this.deps.lessons
      .listBySession(sessionId, ["pending", "implemented"])
      .filter((lesson) => lesson.autopsyId !== newAutopsyId);
    if (priorLessons.length === 0) return;

    const closedTrades = this.deps.trades.listClosed(sessionId);
    const recentTrades = closedTrades.slice(-5);
    const recentStructuredByTrade = new Map<string, AutopsyStructured | null>();
    for (const recentTrade of recentTrades) {
      const latest = this.deps.autopsies.findLatest(recentTrade.id);
      if (!latest) {
        recentStructuredByTrade.set(recentTrade.id, null);
        continue;
      }
      recentStructuredByTrade.set(
        recentTrade.id,
        parseAutopsyStructuredJson(latest.summaryStructuredJson),
      );
    }

    const { updates, andonCords } = runLessonValidation({
      sessionId,
      structured,
      priorLessons,
      recentStructuredByTrade,
    });

    for (const update of updates) {
      this.deps.lessons.update(update.lessonId, {
        ...(update.recurrenceCount !== undefined
          ? { recurrenceCount: update.recurrenceCount }
          : {}),
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.validatedAt !== undefined
          ? { validatedAt: update.validatedAt }
          : {}),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const cord of andonCords) {
      this.deps.eventBus.emit("andon_cord_fired", cord);
      this.deps.events.insert({
        session_id: sessionId,
        trade_id: null,
        level: "WARN",
        message: `Andon Cord: ${cord.lessonText} (recurred ${cord.recurrenceCount} times)`,
        agent_type: "orchestrator",
      });
    }
  }

  private async runPhase(
    name: PhaseKind,
    systemPrompt: string,
    userPrompt: string,
    providerKey: string,
    modelId: string,
    maxTokens?: number,
  ): Promise<PhaseTrace> {
    const started = Date.now();
    try {
      const adapter = await this.deps.providerRegistry.get(providerKey);
      const result = await adapter.generateText({
        model: modelId,
        systemPrompt,
        userPrompt,
        maxTokens: maxTokens ?? phaseMaxTokens(name),
        temperature: 0.2,
      });
      const costUsd = estimateCostUsd(
        modelId,
        result.inputTokens,
        result.outputTokens,
      );
      return {
        phase: name,
        modelId,
        providerKey,
        systemPrompt,
        userPrompt,
        toolCallsJson: null,
        responseText: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
        durationMs: result.durationMs,
        error: null,
      };
    } catch (error) {
      return {
        phase: name,
        modelId,
        providerKey,
        systemPrompt,
        userPrompt,
        toolCallsJson: null,
        responseText: "",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function resolveModel(prefs: {
  defaultModelProviderKey: string;
  defaultModelModelId: string;
}): { providerKey: string; modelId: string } {
  return {
    providerKey: prefs.defaultModelProviderKey || "openrouter",
    modelId: prefs.defaultModelModelId || "google/gemma-4-31b-it",
  };
}

function phaseMaxTokens(phase: PhaseKind): number {
  switch (phase) {
    case "thesis":
      return 600;
    case "execution":
      return 500;
    case "behavioral":
      return 600;
    case "market_context":
      return 500;
    case "synthesis":
      return 1200;
  }
}

function parseSynthesis(text: string): {
  structured: AutopsyStructured;
  qualityGrade: QualityGrade;
  qualityScore: number;
  lessons: z.infer<typeof synthesisLessonSchema>[];
} | null {
  const jsonText = extractJson(text);
  if (!jsonText) return null;
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const parsed = synthesisOutputSchema.parse(raw);
    const { lessons, qualityGrade, qualityScore, ...structured } = parsed;
    return { structured, qualityGrade, qualityScore, lessons };
  } catch {
    return null;
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function fallbackSummary(trade: Trade): string {
  const pnl = trade.final_pnl_usd ?? 0;
  return `${trade.instrumentSymbol} ${trade.side} closed with P&L ${pnl.toFixed(2)} USD. Structured analysis unavailable — LLM synthesis failed.`;
}

function emptyStructured(trade: Trade): AutopsyStructured {
  return {
    executiveSummary: fallbackSummary(trade),
    thesisReview: {
      valid: null,
      analysis: "Analysis unavailable.",
      confirmatoryBias: false,
      prematureConviction: false,
      ignoredCounterSignals: [],
    },
    executionQuality: {
      entryTiming: "unknown",
      sizingAdequacy: "unknown",
      exitManagement: "Analysis unavailable.",
      slippage: null,
    },
    behavioralFlags: [],
    marketContext: {
      regime: "unknown",
      macro: "Analysis unavailable.",
      volatility: "Analysis unavailable.",
      suitability: "neutral",
    },
    whatWorked: [],
    whatFailed: [],
    rootCause: null,
    processImprovements: [],
  };
}

function formatHoldDuration(trade: Trade): string {
  if (!trade.opened_at || !trade.closed_at) return "unknown";
  const ms =
    new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function formatPnlPct(trade: Trade): string {
  if (trade.final_pnl_usd == null || trade.position_size_usd <= 0) {
    return "N/A";
  }
  return ((trade.final_pnl_usd / trade.position_size_usd) * 100).toFixed(2);
}

function earliestMessage(messages: AgentMessage[]): AgentMessage | null {
  return messages.length > 0 ? messages[0] ?? null : null;
}

function decisionMessage(messages: AgentMessage[]): AgentMessage | null {
  return (
    messages.find((m) => m.role === "decision" || m.output_json) ??
    messages[messages.length - 1] ??
    null
  );
}

const THESIS_SYSTEM =
  "You are reviewing whether an AI trading agent's thesis was logically valid. Focus only on reasoning quality — not on outcome. A bad thesis that wins is still a bad thesis. A good thesis that loses to noise is still good. Answer with JSON matching the ThesisReview schema.";

const EXECUTION_SYSTEM =
  "You are reviewing trade execution mechanics. Assess entry timing, position sizing relative to conviction, and exit management. Do not comment on the thesis. Answer with JSON matching the ExecutionQuality schema.";

const BEHAVIORAL_SYSTEM =
  "You are a trading psychologist reviewing an AI agent's message transcript for behavioral failure patterns (FOMO, revenge, overconfidence, panic exit, rule violation, stop movement, etc.). List only patterns that have clear textual evidence in the transcript. Answer with JSON matching BehavioralFlags schema.";

const MARKET_CONTEXT_SYSTEM =
  "You are a market analyst. Based on the market snapshot provided, describe the regime, volatility conditions, and whether these conditions were suitable for the stated strategy. Answer with JSON matching MarketContext schema.";

const SYNTHESIS_SYSTEM =
  "You are a senior prop-firm mentor reviewing a trade autopsy. You have been given four specialist analyses. Your job: write a concise executive summary, assign a letter grade (A+ through F) and numeric score (0–100), list what worked, what failed, the root cause of failure (if any), and 1–3 actionable process improvements. Extract 0–3 structured lessons. Answer with JSON matching AutopsySynthesis schema.";

function buildThesisPrompt(trade: Trade, messages: AgentMessage[]): string {
  const earliest = earliestMessage(messages);
  const decision = decisionMessage(messages);
  return [
    `Trade: ${trade.instrumentSymbol} ${trade.side} | P&L: ${trade.final_pnl_usd ?? 0} | Confidence: ${trade.confidence_score ?? "N/A"}`,
    `Strategy: ${trade.strategy}`,
    `Strategy Snapshot: ${earliest?.strategy_snapshot_json ?? "{}"}`,
    "",
    "Decision agent output:",
    decision?.output_json ?? decision?.messages_json ?? "No decision output available.",
    "",
    "Was the thesis logically valid given these inputs?",
  ].join("\n");
}

function buildExecutionPrompt(trade: Trade): string {
  return [
    `Trade: ${trade.instrumentSymbol} ${trade.side}`,
    `Entry: ${trade.entry_price ?? "N/A"} | Stop Loss: ${trade.stop_loss_price ?? "N/A"} | Take Profit: ${trade.take_profit_price ?? "N/A"}`,
    `Position Size: ${trade.position_size_usd} | Final P&L: ${trade.final_pnl_usd ?? 0}`,
    `Hold Duration: ${formatHoldDuration(trade)}`,
    `Confidence Score: ${trade.confidence_score ?? "N/A"}`,
    "",
    "Assess the execution mechanics only.",
  ].join("\n");
}

function buildBehavioralPrompt(messages: AgentMessage[]): string {
  const lines = [
    `Full agent transcript for this trade (${messages.length} messages):`,
    "",
  ];
  for (const message of messages) {
    lines.push(
      "---",
      `Role: ${message.role} | Model: ${message.model_id}`,
      `Messages: ${message.messages_json}`,
      `Output: ${message.output_json ?? "null"}`,
      "---",
    );
  }
  lines.push(
    "",
    "Identify behavioral failure patterns. Only cite patterns with direct textual evidence.",
  );
  return lines.join("\n");
}

function buildMarketContextPrompt(
  trade: Trade,
  messages: AgentMessage[],
): string {
  const earliest = earliestMessage(messages);
  return [
    `Trade opened: ${trade.opened_at ?? "N/A"} | Closed: ${trade.closed_at ?? "N/A"}`,
    `Symbol: ${trade.instrumentSymbol} | Strategy timeframe: 1d`,
    "",
    "Market snapshot at trade entry:",
    earliest?.market_snapshot_json ?? "No market snapshot available.",
    "",
    "Describe market conditions and suitability for this trade.",
  ].join("\n");
}

function buildSynthesisPrompt(
  trade: Trade,
  phaseOutputs: Partial<Record<PhaseKind, string>>,
): string {
  return [
    "THESIS REVIEW:",
    phaseOutputs.thesis ?? "",
    "",
    "EXECUTION QUALITY:",
    phaseOutputs.execution ?? "",
    "",
    "BEHAVIORAL FLAGS:",
    phaseOutputs.behavioral ?? "",
    "",
    "MARKET CONTEXT:",
    phaseOutputs.market_context ?? "",
    "",
    `Trade outcome: ${trade.instrumentSymbol} ${trade.side} | P&L: ${trade.final_pnl_usd ?? 0} (${formatPnlPct(trade)}%) | Grade this trade.`,
  ].join("\n");
}

// TODO: semantic similarity via LLM when config flag enabled
