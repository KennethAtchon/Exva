import type { AgentMessage, Trade, WorkspaceSession } from "@/lib/types";
import {
  parseAutopsyStructuredJson,
  type AndonCordPayload,
  type AutopsyLesson,
  type AutopsyScope,
  type PeriodAutopsyAddLessonInput,
  type PeriodAutopsyFilters,
  type PeriodAutopsyLessonsListInput,
  type PeriodAutopsyListInput,
  type PeriodAutopsyPreview,
  type PeriodAutopsyPromoteLessonInput,
  type PeriodAutopsyRecord,
  type PeriodAutopsyRunInput,
  type PeriodAutopsyStructured,
  type PhaseKind,
  type PhaseTrace,
  type UpdateLessonInput,
} from "@electron/shared/domain/autopsy";
import { AppError } from "@electron/shared/infra/errors";
import { z } from "zod";
import type { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { AutopsiesRepo } from "../../db/repositories/trades/autopsies-repo";
import type { AutopsyLessonsRepo } from "../../db/repositories/trades/autopsy-lessons-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import { estimateCostUsd } from "../llm/model-pricing";
import type { ProviderRegistry } from "../llm/provider-registry";
import type { EventBus } from "../infra/event-bus";

const HARD_PROMPT_TOKEN_CAP = 120_000;
const HIGH_COST_CONFIRM_USD = 5;

const patternAnalysisSchema = z.object({
  recurringFailureModes: z
    .array(
      z.object({
        category: z.string(),
        count: z.number().int().min(2),
        description: z.string(),
        tradeIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  sizingConsistency: z.string().default("Sizing consistency unavailable."),
  entryTimingPattern: z.string().default("Entry timing pattern unavailable."),
  regimeNotes: z.string().default("Regime notes unavailable."),
  behavioralDrift: z.string().default("No clear behavioral drift detected."),
  outlierTradeIds: z.array(z.string()).default([]),
});

const lessonValidationSchema = z.object({
  evaluations: z
    .array(
      z.object({
        lessonId: z.string(),
        status: z.enum(["resolved", "recurring", "inconclusive"]),
        reason: z.string().default(""),
      }),
    )
    .default([]),
});

const periodLessonInputSchema = z.object({
  lesson: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  category: z
    .enum(["strategy", "execution", "behavioral", "risk", "system"])
    .default("strategy"),
  proposedFix: z.string().default(""),
});

const synthesisSchema = z.object({
  executiveSummary: z.string(),
  qualityGrade: z.enum(["A+", "A", "B", "C", "D", "F"]).nullable().optional(),
  qualityScore: z.number().nullable().optional(),
  lessonsNew: z.array(periodLessonInputSchema).max(5).default([]),
  processImprovements: z.array(z.string()).max(3).default([]),
  andonAssessment: z
    .object({
      shouldFire: z.boolean().default(false),
      reasons: z
        .array(
          z.object({
            lessonId: z.string(),
            lessonText: z.string(),
            recurrenceCount: z.number(),
          }),
        )
        .default([]),
    })
    .default({ shouldFire: false, reasons: [] }),
});

type PatternAnalysisOutput = z.infer<typeof patternAnalysisSchema>;
type LessonValidationOutput = z.infer<typeof lessonValidationSchema>;
type SynthesisOutput = z.infer<typeof synthesisSchema>;

export interface PeriodAutopsyServiceDeps {
  sessions: SessionRepo;
  trades: TradesRepo;
  agentMessages: AgentMessagesRepo;
  autopsies: AutopsiesRepo;
  lessons: AutopsyLessonsRepo;
  events: EventsRepo;
  providerRegistry: ProviderRegistry;
  workspacePrefs: WorkspacePreferencesRepo;
  eventBus: EventBus;
}

type ResolvedModel = {
  providerKey: string;
  modelId: string;
};

type AggregateStats = PeriodAutopsyStructured["performancePatterns"];

type TradePromptContext = {
  trade: Trade;
  behavioralFlags: string[];
  decisionExcerpt: string;
};

type PromptPlan = {
  patternPrompt: string;
  secondPatternPrompt: string | null;
  lessonValidationPrompt: string;
  synthesisPrompt: string;
  estimatedPromptTokens: number;
  estimatedCostUsd: number;
};

export class PeriodAutopsyService {
  constructor(private readonly deps: PeriodAutopsyServiceDeps) {}

  listByScope(input: PeriodAutopsyListInput): {
    items: PeriodAutopsyRecord[];
    total: number;
  } {
    return this.deps.autopsies.listByScope({
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      limit: input.limit,
      offset: input.offset,
    });
  }

  getById(periodAutopsyId: string): PeriodAutopsyRecord {
    return this.deps.autopsies.requirePeriod(periodAutopsyId);
  }

  preview(input: PeriodAutopsyRunInput): PeriodAutopsyPreview {
    const sessions = this.resolveScopeSessions(input.scope, input.sessionId);
    const filters = normalizeFilters(input.filters);
    const trades = this.deps.trades.listClosedInWindow({
      sessionId: input.scope === "session" ? input.sessionId : undefined,
      sessionIds:
        input.scope === "global"
          ? sessions.map((session) => session.id)
          : undefined,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      instrumentClasses: filters.instrumentClasses,
      brokerAccountIds: filters.brokerAccountIds,
      outcome: filters.outcome,
      minPositionSizeUsd: filters.minPositionSizeUsd,
    });
    const latest = this.deps.autopsies.findLatestByScope(
      input.scope,
      input.sessionId ?? null,
    );
    const model = this.resolveModel(input);
    const aggregate = computeAggregateStats(trades);
    const tradeContexts = buildTradePromptContexts(
      trades,
      this.deps.agentMessages.listByTrades(trades.map((trade) => trade.id)),
      this.deps.autopsies,
      filters.includeAgentPhases,
    );
    const priorLessons = this.deps.lessons.listByScope({
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      statuses: ["pending", "implemented", "recurring"],
      sources: ["period", "manual"],
    });
    const plan = buildPromptPlan({
      modelId: model.modelId,
      aggregate,
      filters,
      tradeContexts,
      priorLessons,
      maxPromptTokens: HARD_PROMPT_TOKEN_CAP,
    });
    return {
      tradeCount: trades.length,
      estimatedPromptTokens: plan.estimatedPromptTokens,
      estimatedCostUsd: plan.estimatedCostUsd,
      lastAutopsyAt: latest?.createdAt ?? null,
      lastAutopsyTradeCount: latest?.tradeCount ?? 0,
    };
  }

  run(input: PeriodAutopsyRunInput): Promise<PeriodAutopsyRecord> {
    return this.runInternal(input);
  }

  listLessons(input: PeriodAutopsyLessonsListInput): AutopsyLesson[] {
    return this.deps.lessons.listByScope({
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      statuses: input.status,
      sources: ["period", "manual"],
    });
  }

  updateLesson(lessonId: string, patch: UpdateLessonInput): AutopsyLesson {
    const existing = this.deps.lessons.require(lessonId);
    if (existing.source === "trade") {
      throw new AppError(
        "Trade-sourced lessons cannot be edited from the period ledger.",
        "VALIDATION_FAILED",
      );
    }
    return this.deps.lessons.update(lessonId, {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.lesson !== undefined ? { lesson: patch.lesson } : {}),
      ...(patch.proposedFix !== undefined
        ? { proposedFix: patch.proposedFix }
        : {}),
      ...(patch.status === "validated"
        ? { validatedAt: new Date().toISOString(), recurrenceCount: 0 }
        : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  addLesson(input: PeriodAutopsyAddLessonInput): AutopsyLesson {
    if (input.scope === "session" && !input.sessionId) {
      throw new AppError(
        "sessionId is required for session-scoped autopsy.",
        "VALIDATION_FAILED",
      );
    }
    const duplicate = this.deps.lessons.findSimilar({
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      lesson: input.lesson,
      sources: ["period", "manual"],
    });
    if (duplicate) {
      throw new AppError(
        `A similar lesson already exists in the ${input.scope} ledger.`,
        "VALIDATION_FAILED",
      );
    }

    const now = new Date().toISOString();
    return this.deps.lessons.insert({
      autopsyId: null,
      tradeId: null,
      sessionId: input.scope === "session" ? (input.sessionId ?? null) : null,
      lesson: input.lesson.trim(),
      severity: input.severity,
      category: input.category,
      proposedFix: input.proposedFix.trim(),
      status: "pending",
      recurrenceCount: 0,
      source: "manual",
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
      validatedAt: null,
    });
  }

  promoteLesson(input: PeriodAutopsyPromoteLessonInput): AutopsyLesson {
    const source = this.deps.lessons.require(input.lessonId);
    if (source.source !== "trade") {
      throw new AppError(
        "Only trade review lessons can be promoted.",
        "VALIDATION_FAILED",
      );
    }
    if (input.targetScope === "session" && !input.targetSessionId) {
      throw new AppError(
        "targetSessionId is required for session-scoped autopsy.",
        "VALIDATION_FAILED",
      );
    }
    const duplicate = this.deps.lessons.findSimilar({
      scope: input.targetScope,
      sessionId: input.targetSessionId ?? null,
      lesson: source.lesson,
      sources: ["period", "manual"],
    });
    if (duplicate) {
      throw new AppError(
        `A similar lesson already exists in the ${input.targetScope} ledger.`,
        "VALIDATION_FAILED",
      );
    }

    const now = new Date().toISOString();
    return this.deps.lessons.insert({
      autopsyId: null,
      tradeId: null,
      sessionId:
        input.targetScope === "session"
          ? (input.targetSessionId ?? null)
          : null,
      lesson: source.lesson,
      severity: source.severity,
      category: source.category,
      proposedFix: source.proposedFix,
      status: "pending",
      recurrenceCount: 0,
      source: "period",
      scope: input.targetScope,
      createdAt: now,
      updatedAt: now,
      validatedAt: null,
    });
  }

  private async runInternal(
    input: PeriodAutopsyRunInput,
  ): Promise<PeriodAutopsyRecord> {
    const sessions = this.resolveScopeSessions(input.scope, input.sessionId);
    const filters = normalizeFilters(input.filters);
    const trades = this.deps.trades.listClosedInWindow({
      sessionId: input.scope === "session" ? input.sessionId : undefined,
      sessionIds:
        input.scope === "global"
          ? sessions.map((session) => session.id)
          : undefined,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      instrumentClasses: filters.instrumentClasses,
      brokerAccountIds: filters.brokerAccountIds,
      outcome: filters.outcome,
      minPositionSizeUsd: filters.minPositionSizeUsd,
    });

    if (trades.length === 0) {
      throw new AppError(
        "No closed trades match the specified window and filters.",
        "VALIDATION_FAILED",
      );
    }

    const model = this.resolveModel(input);
    const aggregate = computeAggregateStats(trades);
    const priorLessons = this.deps.lessons.listByScope({
      scope: input.scope,
      sessionId: input.sessionId ?? null,
      statuses: ["pending", "implemented", "recurring"],
      sources: ["period", "manual"],
    });
    const messages = this.deps.agentMessages.listByTrades(
      trades.map((trade) => trade.id),
    );
    const tradeContexts = buildTradePromptContexts(
      trades,
      messages,
      this.deps.autopsies,
      filters.includeAgentPhases,
    );
    const promptPlan = buildPromptPlan({
      modelId: model.modelId,
      aggregate,
      filters,
      tradeContexts,
      priorLessons,
      maxPromptTokens: HARD_PROMPT_TOKEN_CAP,
    });

    if (promptPlan.estimatedPromptTokens > HARD_PROMPT_TOKEN_CAP) {
      throw new AppError(
        "This window exceeds the autopsy prompt budget. Reduce the date range or add filters.",
        "VALIDATION_FAILED",
      );
    }
    if (
      promptPlan.estimatedCostUsd > HIGH_COST_CONFIRM_USD &&
      !input.confirmHighCost
    ) {
      throw new AppError(
        `Estimated cost: $${promptPlan.estimatedCostUsd.toFixed(2)}. Proceed?`,
        "VALIDATION_FAILED",
      );
    }

    const traces: PhaseTrace[] = [];
    const patternTrace = await this.runPhase(
      promptPlan.secondPatternPrompt
        ? "pattern_analysis_pass1"
        : "pattern_analysis",
      PATTERN_ANALYSIS_SYSTEM,
      promptPlan.patternPrompt,
      model,
      promptPlan.secondPatternPrompt ? 500 : 800,
    );
    traces.push(patternTrace);
    let pattern = parsePhaseJson(
      patternTrace.responseText,
      patternAnalysisSchema,
    );
    if (!pattern) {
      pattern = emptyPatternAnalysis();
    }

    if (promptPlan.secondPatternPrompt) {
      const selectedOutlierIds =
        pattern.outlierTradeIds.length > 0
          ? pattern.outlierTradeIds
          : pickWorstTrades(trades, 5).map((trade) => trade.id);
      const secondPatternPrompt = buildSecondPatternPrompt(
        aggregate,
        tradeContexts,
        selectedOutlierIds,
      );
      const secondTrace = await this.runPhase(
        "pattern_analysis_pass2",
        PATTERN_ANALYSIS_SYSTEM,
        secondPatternPrompt,
        model,
        800,
      );
      traces.push(secondTrace);
      pattern =
        parsePhaseJson(secondTrace.responseText, patternAnalysisSchema) ??
        pattern;
    }

    const lessonValidationTrace = await this.runPhase(
      "lesson_validation",
      LESSON_VALIDATION_SYSTEM,
      buildLessonValidationPrompt(priorLessons, pattern),
      model,
      600,
    );
    traces.push(lessonValidationTrace);
    const lessonValidation =
      parsePhaseJson(
        lessonValidationTrace.responseText,
        lessonValidationSchema,
      ) ?? ({ evaluations: [] } satisfies LessonValidationOutput);

    const lessonOutcomes = applyLessonValidation(
      priorLessons,
      lessonValidation,
    );
    const andonReasons = computeAndonReasons({
      priorAutopsyExists:
        this.deps.autopsies.findLatestByScope(
          input.scope,
          input.sessionId ?? null,
        ) !== null,
      priorLessons,
      lessonOutcomes,
    });

    const synthesisTrace = await this.runPhase(
      "synthesis",
      SYNTHESIS_SYSTEM,
      buildSynthesisPrompt(aggregate, pattern, lessonValidation, andonReasons),
      model,
      1400,
    );
    traces.push(synthesisTrace);
    const synthesis = parsePhaseJson(
      synthesisTrace.responseText,
      synthesisSchema,
    );

    const totalCostUsd = traces.reduce((sum, trace) => sum + trace.costUsd, 0);
    const now = new Date().toISOString();
    const isFallback = synthesis == null;
    const structured = isFallback
      ? buildFallbackStructured(aggregate)
      : buildStructuredResult({
          aggregate,
          pattern,
          lessonOutcomes,
          synthesis,
          andonReasons,
        });

    const record = this.deps.autopsies.insertPeriod({
      scope: input.scope,
      sessionId: input.scope === "session" ? (input.sessionId ?? null) : null,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      modelId: model.modelId,
      filtersJson: JSON.stringify(filters),
      tradeCount: trades.length,
      tradeIdsJson: JSON.stringify(trades.map((trade) => trade.id)),
      summaryStructuredJson: JSON.stringify(structured),
      phaseTracesJson: JSON.stringify(traces),
      qualityGrade: synthesis?.qualityGrade ?? null,
      qualityScore: synthesis?.qualityScore ?? null,
      isFallback,
      totalCostUsd,
      createdAt: now,
      createdBy: "user",
    });

    for (const outcome of lessonOutcomes) {
      this.deps.lessons.update(outcome.lessonId, outcome.patch);
    }

    if (synthesis) {
      for (const lesson of synthesis.lessonsNew) {
        this.deps.lessons.insert({
          autopsyId: record.id,
          tradeId: null,
          sessionId:
            input.scope === "session" ? (input.sessionId ?? null) : null,
          lesson: lesson.lesson,
          severity: lesson.severity,
          category: lesson.category,
          proposedFix: lesson.proposedFix,
          status: "pending",
          recurrenceCount: 0,
          source: "period",
          scope: input.scope,
          createdAt: now,
          updatedAt: now,
          validatedAt: null,
        });
      }
    }

    for (const reason of andonReasons) {
      const sourceLesson = priorLessons.find(
        (lesson) => lesson.id === reason.lessonId,
      );
      const cord: AndonCordPayload = {
        lessonId: reason.lessonId,
        lessonText: reason.lessonText,
        recurrenceCount: reason.recurrenceCount,
        sessionId: input.scope === "session" ? (input.sessionId ?? null) : null,
        scope: input.scope,
        periodAutopsyId: record.id,
        severity: sourceLesson?.severity ?? "high",
      };
      this.deps.eventBus.emit("andon_cord_fired", cord);
      this.deps.events.insert({
        session_id: cord.sessionId,
        trade_id: null,
        cycle_id: null,
        level: "CRITICAL",
        agent_type: "period_autopsy",
        message: `Andon Cord: ${cord.lessonText} (recurred ${cord.recurrenceCount} times in ${cord.scope} scope)`,
      });
    }

    return record;
  }

  private resolveScopeSessions(
    scope: AutopsyScope,
    sessionId?: string,
  ): WorkspaceSession[] {
    if (scope === "session") {
      if (!sessionId) {
        throw new AppError(
          "sessionId is required for session-scoped autopsy.",
          "VALIDATION_FAILED",
        );
      }
      return [this.deps.sessions.requireById(sessionId)];
    }

    const prefs = this.deps.workspacePrefs.get();
    return this.deps.sessions.list({
      includeArchived: false,
      executionMode:
        prefs.globalEnvironmentMode === "live" ? "live_allowed" : "paper_only",
    });
  }

  private resolveModel(input: PeriodAutopsyRunInput): ResolvedModel {
    const prefs = this.deps.workspacePrefs.get();
    return {
      providerKey:
        input.providerKey ?? prefs.defaultModelProviderKey ?? "openrouter",
      modelId:
        input.modelId ?? prefs.defaultModelModelId ?? "google/gemma-4-31b-it",
    };
  }

  private async runPhase(
    name: PhaseKind,
    systemPrompt: string,
    userPrompt: string,
    model: ResolvedModel,
    maxTokens: number,
  ): Promise<PhaseTrace> {
    const started = Date.now();
    try {
      const adapter = await this.deps.providerRegistry.get(model.providerKey);
      const result = await adapter.generateText({
        model: model.modelId,
        systemPrompt,
        userPrompt,
        maxTokens,
        temperature: 0.2,
      });
      return {
        phase: name,
        modelId: model.modelId,
        providerKey: model.providerKey,
        systemPrompt,
        userPrompt,
        toolCallsJson: null,
        responseText: result.text,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: estimateCostUsd(
          model.modelId,
          result.inputTokens,
          result.outputTokens,
        ),
        durationMs: result.durationMs,
        error: null,
      };
    } catch (error) {
      return {
        phase: name,
        modelId: model.modelId,
        providerKey: model.providerKey,
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

const PATTERN_ANALYSIS_SYSTEM =
  "You are a systematic trading coach reviewing a batch of closed trades. Identify recurring failure modes (appeared in at least two trades), behavioral drift patterns, and execution inconsistencies. Do not moralize. Answer with JSON matching PatternAnalysisOutput.";

const LESSON_VALIDATION_SYSTEM =
  "You are reviewing whether prior trading lessons have been resolved or continue to recur. You are given the prior open lessons and the new period's pattern analysis. For each prior lesson, determine resolved, recurring, or inconclusive. Answer with JSON matching LessonValidationOutput.";

const SYNTHESIS_SYSTEM =
  "You are a senior prop-firm mentor writing a period review. You have aggregate performance stats, pattern analysis, and lesson validation results. Write a concise executive summary, extract 0-5 new lessons, assess whether the Andon Cord should fire, and provide 1-3 concrete process improvements. Answer with JSON matching PeriodSynthesisOutput.";

function normalizeFilters(filters: PeriodAutopsyFilters): PeriodAutopsyFilters {
  return {
    instrumentClasses: [...new Set(filters.instrumentClasses)].filter(Boolean),
    brokerAccountIds: [...new Set(filters.brokerAccountIds)].filter(Boolean),
    outcome: filters.outcome ?? "all",
    minPositionSizeUsd: Math.max(0, filters.minPositionSizeUsd ?? 0),
    includeAgentPhases: [...new Set(filters.includeAgentPhases)].filter(
      Boolean,
    ),
  };
}

function buildTradePromptContexts(
  trades: Trade[],
  messages: AgentMessage[],
  autopsiesRepo: AutopsiesRepo,
  includeAgentPhases: string[],
): TradePromptContext[] {
  const byTrade = new Map<string, AgentMessage[]>();
  for (const message of messages) {
    if (!message.trade_id) continue;
    const next = byTrade.get(message.trade_id) ?? [];
    next.push(message);
    byTrade.set(message.trade_id, next);
  }

  return trades.map((trade) => {
    const tradeMessages = byTrade.get(trade.id) ?? [];
    const filteredMessages =
      includeAgentPhases.length > 0
        ? tradeMessages.filter((message) =>
            includeAgentPhases.includes(message.role),
          )
        : tradeMessages;
    const latestAutopsy = autopsiesRepo.findLatestByTrade(trade.id);
    const structured = latestAutopsy
      ? parseAutopsyStructuredJson(latestAutopsy.summaryStructuredJson)
      : null;
    return {
      trade,
      behavioralFlags:
        structured?.behavioralFlags.map((flag) => flag.flag) ?? [],
      decisionExcerpt: clipText(decisionExcerpt(filteredMessages), 200),
    };
  });
}

function decisionExcerpt(messages: AgentMessage[]): string {
  const decision =
    messages.find(
      (message) => message.role === "decision" && message.output_json,
    ) ??
    messages.find((message) => message.output_json) ??
    messages[messages.length - 1] ??
    null;
  if (!decision) return "none";
  return decision.output_json ?? decision.messages_json;
}

function buildPromptPlan(input: {
  modelId: string;
  aggregate: AggregateStats;
  filters: PeriodAutopsyFilters;
  tradeContexts: TradePromptContext[];
  priorLessons: AutopsyLesson[];
  maxPromptTokens: number;
}): PromptPlan {
  const aggregateBlock = buildAggregateBlock(input.aggregate, input.filters);
  const contexts = [...input.tradeContexts].sort(
    (a, b) => (a.trade.final_pnl_usd ?? 0) - (b.trade.final_pnl_usd ?? 0),
  );
  const tradeCount = contexts.length;

  if (tradeCount > 500) {
    const pass1 = [
      aggregateBlock,
      "",
      `Window contains ${tradeCount} trades. First pass: identify likely outlier trade IDs to drill into.`,
    ].join("\n");
    const pass2 = buildSecondPatternPrompt(
      input.aggregate,
      contexts,
      contexts.slice(0, 5).map((context) => context.trade.id),
    );
    const lessonValidationPrompt = buildLessonValidationPrompt(
      input.priorLessons,
      emptyPatternAnalysis(),
    );
    const synthesisPrompt = buildSynthesisPrompt(
      input.aggregate,
      emptyPatternAnalysis(),
      { evaluations: [] },
      [],
    );
    const estimatedPromptTokens =
      estimateTokens(pass1) +
      estimateTokens(pass2) +
      estimateTokens(lessonValidationPrompt) +
      estimateTokens(synthesisPrompt);
    return {
      patternPrompt: pass1,
      secondPatternPrompt: pass2,
      lessonValidationPrompt,
      synthesisPrompt,
      estimatedPromptTokens,
      estimatedCostUsd: estimateCostUsd(
        input.modelId,
        estimatedPromptTokens,
        500 + 800 + 600 + 1400,
      ),
    };
  }

  const baselineCount =
    tradeCount <= 20 ? tradeCount : tradeCount <= 100 ? 10 : 5;
  const candidateCounts =
    tradeCount <= 20 ? [baselineCount, 10, 5, 0] : [baselineCount, 5, 3, 0];
  let selectedPatternPrompt = aggregateBlock;

  for (const detailCount of candidateCounts) {
    const detailTrades = detailCount > 0 ? contexts.slice(0, detailCount) : [];
    const bucketSummary = buildBucketSummary(
      contexts,
      detailTrades.map((context) => context.trade.id),
    );
    const tradeBlock =
      detailTrades.length > 0
        ? buildTradeDetailBlock(detailTrades)
        : "No per-trade detail included.";
    const nextPrompt = [aggregateBlock, "", bucketSummary, "", tradeBlock].join(
      "\n",
    );
    const nextTokens = estimateTokens(nextPrompt);
    if (nextTokens <= input.maxPromptTokens || detailCount === 0) {
      selectedPatternPrompt = nextPrompt;
      break;
    }
  }

  const lessonValidationPrompt = buildLessonValidationPrompt(
    input.priorLessons,
    emptyPatternAnalysis(),
  );
  const synthesisPrompt = buildSynthesisPrompt(
    input.aggregate,
    emptyPatternAnalysis(),
    { evaluations: [] },
    [],
  );
  const totalPromptTokens =
    estimateTokens(selectedPatternPrompt) +
    estimateTokens(lessonValidationPrompt) +
    estimateTokens(synthesisPrompt);

  return {
    patternPrompt: selectedPatternPrompt,
    secondPatternPrompt: null,
    lessonValidationPrompt,
    synthesisPrompt,
    estimatedPromptTokens: totalPromptTokens,
    estimatedCostUsd: estimateCostUsd(
      input.modelId,
      totalPromptTokens,
      800 + 600 + 1400,
    ),
  };
}

function buildAggregateBlock(
  aggregate: AggregateStats,
  filters: PeriodAutopsyFilters,
): string {
  return [
    "Aggregate performance stats:",
    `- Total trades: ${aggregate.totalTrades}`,
    `- Winners: ${aggregate.winners}`,
    `- Losers: ${aggregate.losers}`,
    `- Win rate: ${(aggregate.winRate * 100).toFixed(1)}%`,
    `- Avg PnL USD: ${aggregate.avgPnlUsd.toFixed(2)}`,
    `- Best PnL USD: ${aggregate.bestPnlUsd.toFixed(2)}`,
    `- Worst PnL USD: ${aggregate.worstPnlUsd.toFixed(2)}`,
    `- Avg hold duration ms: ${aggregate.avgHoldDurationMs}`,
    `- Instrument classes filter: ${filters.instrumentClasses.join(", ") || "all"}`,
    `- Broker accounts filter: ${filters.brokerAccountIds.join(", ") || "all"}`,
    `- Outcome filter: ${filters.outcome}`,
    `- Min size USD: ${filters.minPositionSizeUsd}`,
    `- Included agent phases: ${filters.includeAgentPhases.join(", ") || "all"}`,
  ].join("\n");
}

function buildTradeDetailBlock(contexts: TradePromptContext[]): string {
  const lines = ["Trade detail:"];
  for (const [index, context] of contexts.entries()) {
    lines.push(
      renderTradePromptLine(index + 1, context),
      `  Behavioral flags: ${context.behavioralFlags.join(", ") || "none"}`,
      `  Agent decision excerpt: ${context.decisionExcerpt || "none"}`,
    );
  }
  return lines.join("\n");
}

function renderTradePromptLine(
  index: number,
  context: TradePromptContext,
): string {
  const trade = context.trade;
  return [
    `Trade ${index}: ${trade.instrumentSymbol} ${trade.side} | P&L: ${formatSignedUsd(trade.final_pnl_usd ?? 0)} | Held: ${formatHoldDurationMs(trade)}`,
    `  Entry: ${trade.entry_price ?? "unknown"} | Stop: ${trade.stop_loss_price ?? "unknown"} | TP: ${trade.take_profit_price ?? "unknown"}`,
    `  Exit reason: ${trade.exit_reason ?? "unknown"}`,
  ].join("\n");
}

function buildBucketSummary(
  contexts: TradePromptContext[],
  excludedTradeIds: string[],
): string {
  const remaining = contexts.filter(
    (context) => !excludedTradeIds.includes(context.trade.id),
  );
  if (remaining.length === 0) {
    return "No remaining trade bucket summary.";
  }
  const winners = remaining.filter(
    (context) => (context.trade.final_pnl_usd ?? 0) > 0,
  ).length;
  const losers = remaining.filter(
    (context) => (context.trade.final_pnl_usd ?? 0) < 0,
  ).length;
  return [
    "Remaining trade bucket summary:",
    `- Remaining trades: ${remaining.length}`,
    `- Winners: ${winners}`,
    `- Losers: ${losers}`,
    `- Symbols sampled: ${remaining
      .slice(0, 10)
      .map((context) => context.trade.instrumentSymbol)
      .join(", ")}`,
  ].join("\n");
}

function buildSecondPatternPrompt(
  aggregate: AggregateStats,
  tradeContexts: TradePromptContext[],
  tradeIds: string[],
): string {
  const selected = tradeContexts.filter((context) =>
    tradeIds.includes(context.trade.id),
  );
  return [
    buildAggregateBlock(aggregate, normalizeFilters(defaultPeriodFilters())),
    "",
    buildTradeDetailBlock(selected),
  ].join("\n");
}

function buildPriorLessonsBlock(lessons: AutopsyLesson[]): string {
  if (lessons.length === 0) {
    return "Prior open lessons: none.";
  }
  return [
    "Prior open lessons:",
    ...lessons.map(
      (lesson) =>
        `- ${lesson.id} | ${lesson.severity} | ${lesson.status} | recurrence=${lesson.recurrenceCount} | ${lesson.lesson}`,
    ),
  ].join("\n");
}

function buildLessonValidationPrompt(
  priorLessons: AutopsyLesson[],
  pattern: PatternAnalysisOutput,
): string {
  return [
    buildPriorLessonsBlock(priorLessons),
    "",
    "Pattern analysis output:",
    JSON.stringify(pattern, null, 2),
  ].join("\n");
}

function buildSynthesisPrompt(
  aggregate: AggregateStats,
  pattern: PatternAnalysisOutput,
  lessonValidation: LessonValidationOutput,
  andonReasons: PeriodAutopsyStructured["andonAssessment"]["reasons"],
): string {
  return [
    "Aggregate stats:",
    JSON.stringify(aggregate, null, 2),
    "",
    "Pattern analysis:",
    JSON.stringify(pattern, null, 2),
    "",
    "Lesson validation:",
    JSON.stringify(lessonValidation, null, 2),
    "",
    "Deterministic Andon candidates:",
    JSON.stringify(andonReasons, null, 2),
  ].join("\n");
}

function computeConfidenceCalibration(trades: Trade[]) {
  const labeled = trades
    .filter(
      (trade): trade is Trade & { confidence_score: number } =>
        trade.confidence_score != null && trade.final_pnl_usd != null,
    )
    .map((trade) => ({
      confidence: trade.confidence_score,
      hit5d: (trade.final_pnl_usd ?? 0) > 0,
    }));
  if (labeled.length === 0) return undefined;
  const buckets = computeConfidenceCalibrationBuckets(labeled);
  const brierScore =
    labeled.reduce(
      (sum, row) => sum + (row.confidence - (row.hit5d ? 1 : 0)) ** 2,
      0,
    ) / labeled.length;
  return { brierScore, sampleCount: labeled.length, buckets };
}

function computeConfidenceCalibrationBuckets(
  labeled: Array<{ confidence: number; hit5d: boolean }>,
  bucketSize = 0.1,
) {
  const buckets = new Map<string, typeof labeled>();
  for (const row of labeled) {
    const bucketKey = `${Math.floor(row.confidence / bucketSize) * bucketSize}`;
    const list = buckets.get(bucketKey) ?? [];
    list.push(row);
    buckets.set(bucketKey, list);
  }
  return [...buckets.entries()].map(([bucket, rows]) => {
    const count = rows.length;
    const avgConfidence =
      rows.reduce((s, r) => s + r.confidence, 0) / Math.max(count, 1);
    const hitRate = rows.filter((r) => r.hit5d).length / Math.max(count, 1);
    const brierScore =
      rows.reduce((s, r) => s + (r.confidence - (r.hit5d ? 1 : 0)) ** 2, 0) /
      Math.max(count, 1);
    return { bucket, count, avgConfidence, hitRate, brierScore };
  });
}

function computeAggregateStats(trades: Trade[]): AggregateStats {
  const totalTrades = trades.length;
  const winners = trades.filter(
    (trade) => (trade.final_pnl_usd ?? 0) > 0,
  ).length;
  const losers = trades.filter(
    (trade) => (trade.final_pnl_usd ?? 0) < 0,
  ).length;
  const pnls = trades.map((trade) => trade.final_pnl_usd ?? 0);
  const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
  const holdDurations = trades
    .map((trade) => tradeHoldDurationMs(trade))
    .filter((value): value is number => value != null);
  return {
    winRate: totalTrades === 0 ? 0 : winners / totalTrades,
    totalTrades,
    winners,
    losers,
    avgPnlUsd: totalTrades === 0 ? 0 : totalPnl / totalTrades,
    bestPnlUsd: pnls.length === 0 ? 0 : Math.max(...pnls),
    worstPnlUsd: pnls.length === 0 ? 0 : Math.min(...pnls),
    avgHoldDurationMs:
      holdDurations.length === 0
        ? 0
        : Math.round(
            holdDurations.reduce((sum, value) => sum + value, 0) /
              holdDurations.length,
          ),
    sizingConsistency: describeSizingConsistency(trades),
    entryTimingPattern: "LLM analysis unavailable.",
    regimeNotes: "LLM analysis unavailable.",
    confidenceCalibration: computeConfidenceCalibration(trades),
  };
}

function describeSizingConsistency(trades: Trade[]): string {
  if (trades.length <= 1)
    return "Not enough trades to assess sizing consistency.";
  const sizes = trades.map((trade) => trade.position_size_usd);
  const avg = sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  const variance =
    sizes.reduce((sum, value) => sum + (value - avg) ** 2, 0) / sizes.length;
  const coeff = avg === 0 ? 0 : Math.sqrt(variance) / avg;
  if (coeff < 0.15)
    return "Position sizing was highly consistent across the window.";
  if (coeff < 0.35)
    return "Position sizing varied moderately but stayed within a controlled band.";
  return "Position sizing was inconsistent and swung materially across trades.";
}

function buildFallbackStructured(
  aggregate: AggregateStats,
): PeriodAutopsyStructured {
  return {
    executiveSummary: "LLM unavailable — showing computed statistics only.",
    performancePatterns: aggregate,
    recurringFailureModes: [],
    lessonsNew: [],
    lessonsValidated: [],
    lessonsRecurring: [],
    andonAssessment: { shouldFire: false, reasons: [] },
    processImprovements: [],
  };
}

function buildStructuredResult(input: {
  aggregate: AggregateStats;
  pattern: PatternAnalysisOutput;
  lessonOutcomes: Array<{
    lessonId: string;
    status: "resolved" | "recurring" | "inconclusive";
    patch: Parameters<AutopsyLessonsRepo["update"]>[1];
  }>;
  synthesis: SynthesisOutput;
  andonReasons: PeriodAutopsyStructured["andonAssessment"]["reasons"];
}): PeriodAutopsyStructured {
  return {
    executiveSummary: input.synthesis.executiveSummary,
    performancePatterns: {
      ...input.aggregate,
      sizingConsistency: input.pattern.sizingConsistency,
      entryTimingPattern: input.pattern.entryTimingPattern,
      regimeNotes: input.pattern.regimeNotes,
    },
    recurringFailureModes: input.pattern.recurringFailureModes,
    lessonsNew: input.synthesis.lessonsNew,
    lessonsValidated: input.lessonOutcomes
      .filter((outcome) => outcome.status === "resolved")
      .map((outcome) => outcome.lessonId),
    lessonsRecurring: input.lessonOutcomes
      .filter((outcome) => outcome.status === "recurring")
      .map((outcome) => outcome.lessonId),
    andonAssessment: {
      shouldFire: input.andonReasons.length > 0,
      reasons: input.andonReasons,
    },
    processImprovements: input.synthesis.processImprovements,
  };
}

function applyLessonValidation(
  priorLessons: AutopsyLesson[],
  validation: LessonValidationOutput,
): Array<{
  lessonId: string;
  status: "resolved" | "recurring" | "inconclusive";
  patch: Parameters<AutopsyLessonsRepo["update"]>[1];
}> {
  const now = new Date().toISOString();
  const outcomes: Array<{
    lessonId: string;
    status: "resolved" | "recurring" | "inconclusive";
    patch: Parameters<AutopsyLessonsRepo["update"]>[1];
  }> = [];
  for (const evaluation of validation.evaluations) {
    const lesson = priorLessons.find((item) => item.id === evaluation.lessonId);
    if (!lesson) continue;
    if (evaluation.status === "resolved") {
      outcomes.push({
        lessonId: lesson.id,
        status: evaluation.status,
        patch: {
          status: "validated",
          recurrenceCount: 0,
          validatedAt: now,
          updatedAt: now,
        },
      });
      continue;
    }
    if (evaluation.status === "recurring") {
      outcomes.push({
        lessonId: lesson.id,
        status: evaluation.status,
        patch: {
          status: "recurring",
          recurrenceCount: lesson.recurrenceCount + 1,
          validatedAt: null,
          updatedAt: now,
        },
      });
      continue;
    }
    outcomes.push({
      lessonId: lesson.id,
      status: evaluation.status,
      patch: { updatedAt: now },
    });
  }
  return outcomes;
}

function computeAndonReasons(input: {
  priorAutopsyExists: boolean;
  priorLessons: AutopsyLesson[];
  lessonOutcomes: Array<{
    lessonId: string;
    status: "resolved" | "recurring" | "inconclusive";
    patch: Parameters<AutopsyLessonsRepo["update"]>[1];
  }>;
}): PeriodAutopsyStructured["andonAssessment"]["reasons"] {
  if (!input.priorAutopsyExists) return [];
  return input.lessonOutcomes
    .map((outcome) => {
      if (outcome.status !== "recurring") return null;
      const lesson = input.priorLessons.find(
        (item) => item.id === outcome.lessonId,
      );
      if (!lesson) return null;
      if (lesson.status !== "pending" && lesson.status !== "recurring")
        return null;
      if (lesson.severity !== "high" && lesson.severity !== "critical")
        return null;
      const recurrenceCount =
        outcome.patch.recurrenceCount ?? lesson.recurrenceCount;
      if (recurrenceCount < 3) return null;
      return {
        lessonId: lesson.id,
        lessonText: lesson.lesson,
        recurrenceCount,
      };
    })
    .filter(
      (
        reason,
      ): reason is {
        lessonId: string;
        lessonText: string;
        recurrenceCount: number;
      } => reason != null,
    );
}

function parsePhaseJson<T extends z.ZodTypeAny>(
  text: string,
  schema: T,
): z.infer<T> | null {
  const json = extractJson(text);
  if (!json) return null;
  try {
    return schema.parse(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

function emptyPatternAnalysis(): PatternAnalysisOutput {
  return {
    recurringFailureModes: [],
    sizingConsistency: "Pattern analysis unavailable.",
    entryTimingPattern: "Pattern analysis unavailable.",
    regimeNotes: "Pattern analysis unavailable.",
    behavioralDrift: "Pattern analysis unavailable.",
    outlierTradeIds: [],
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function pickWorstTrades(trades: Trade[], count: number): Trade[] {
  return [...trades]
    .sort((a, b) => (a.final_pnl_usd ?? 0) - (b.final_pnl_usd ?? 0))
    .slice(0, count);
}

function tradeHoldDurationMs(trade: Trade): number | null {
  if (!trade.opened_at || !trade.closed_at) return null;
  const start = new Date(trade.opened_at).getTime();
  const end = new Date(trade.closed_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return end - start;
}

function formatHoldDurationMs(trade: Trade): string {
  const ms = tradeHoldDurationMs(trade);
  if (ms == null) return "unknown";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

function formatSignedUsd(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} USD`;
}

function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function defaultPeriodFilters(): PeriodAutopsyFilters {
  return {
    instrumentClasses: [],
    brokerAccountIds: [],
    outcome: "all",
    minPositionSizeUsd: 0,
    includeAgentPhases: [],
  };
}
