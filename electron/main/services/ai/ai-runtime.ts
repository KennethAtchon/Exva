import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentMessage, AgentRole, AgentRun } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { ApiCallLogRepo } from "../../db/repositories/api-call-log-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import {
  instrumentSelectionSchema,
  tradeDecisionSchema,
  type InstrumentSelection,
} from "./ai-runtime-schemas";
import type { AgentResult, AnalystInjectionBlocks, RuntimeAgentMessage, RunTrace } from "./ai-runtime-types";
import { ROLE_HARNESS_CAPS } from "./ai-runtime-types";
import { estimateCostUsd } from "./model-pricing";
import type { PromptAssetLoader } from "./prompt-asset-loader";
import type { ProviderRegistry } from "./provider-registry";
import type { SearchRegistry } from "./search";
import type { SessionStrategyContextService } from "../session/session-strategy-context-service";
import { prependStrategyContextToUserPrompt } from "./strategy-prompt-context";
import { createSearchTool } from "./tools/search-tool";
import { createMarketTools } from "./tools/market-tools";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type { BrokerRegistry } from "../broker/broker-registry";

export interface ResearcherInput {
  instrumentSymbol: string;
  context?: string;
  injection?: AnalystInjectionBlocks;
}

export interface ReviewerInput {
  instrumentSymbol: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
}

export interface DecisionInput extends ReviewerInput {
  review: string;
  maxPositionUsd: number;
}

export type TradeDecision = z.infer<typeof tradeDecisionSchema>;

type RetryConfig = {
  timeoutMs: number;
  backoffMs: number;
};

const RETRY_CONFIG: RetryConfig = {
  timeoutMs: 60_000,
  backoffMs: 1_000,
};

export class AiRuntime {
  private strategyContextService: SessionStrategyContextService | null;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly searchRegistry: SearchRegistry,
    private readonly promptLoader: PromptAssetLoader,
    private readonly aiRolesRepo: SessionAiRolesRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
    private readonly apiCallLogRepo: ApiCallLogRepo,
    private readonly brokerRouting?: BrokerRoutingService,
    private readonly brokerRegistry?: BrokerRegistry,
    strategyContextService?: SessionStrategyContextService,
  ) {
    this.strategyContextService = strategyContextService ?? null;
  }

  setStrategyContextService(strategyContextService: SessionStrategyContextService): void {
    this.strategyContextService = strategyContextService;
  }

  async runAnalyst(
    input: ResearcherInput,
    role: "technical" | "fundamental",
    sessionId?: string,
  ): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const agentRole: AgentRole = role === "technical" ? "analyst_technical" : "analyst_fundamental";
    const blocks = input.injection;
    const tail = `Instrument: ${input.instrumentSymbol}\nContext: ${input.context ?? "None"}`;
    const userPrompt = blocks ? `${blocks.marketMarkdown}\n\n${blocks.fundamentalsMarkdown}\n\n${blocks.newsMarkdown}\n\n${tail}` : tail;
    return this.runRole(sessionId, agentRole, userPrompt, {
      marketSnapshotJson: blocks?.snapshotJson ?? null,
    });
  }

  async runReviewer(input: ReviewerInput, sessionId?: string): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const labels = this.analysisLabels(sessionId);
    const prompt = `Instrument: ${input.instrumentSymbol}\n\n${labels.first}:\n${input.technicalAnalysis}\n\n${labels.second}:\n${input.fundamentalAnalysis}`;
    return this.runRole(sessionId, "reviewer", prompt);
  }

  async runDecisionMaker(input: DecisionInput, sessionId?: string): Promise<AgentResult<TradeDecision>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const labels = this.analysisLabels(sessionId);
    const prompt = `Instrument: ${input.instrumentSymbol}
Max position USD: ${input.maxPositionUsd}

${labels.first}:
${input.technicalAnalysis}

${labels.second}:
${input.fundamentalAnalysis}

Review:
${input.review}`;
    return this.runDecisionRole(sessionId, prompt);
  }

  async runInstrumentSelector(
    sessionId: string,
    selectionInstructions: string,
    cycleId?: string | null,
  ): Promise<AgentResult<InstrumentSelection>> {
    const role = "instrument_selector" as const;
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, selectionInstructions);

    const submitCandidates = tool({
      description: "Submit the final shortlist when research is complete.",
      inputSchema: instrumentSelectionSchema,
      execute: async (candidates: InstrumentSelection) => candidates,
    });

    const tools: ToolSet = {
      submit_candidates: submitCandidates,
    };
    if (config.webSearchEnabled) {
      tools.search_web = await this.resolveSearchTool(sessionId, { cycleId: cycleId ?? null });
    }
    if (this.brokerRouting && this.brokerRegistry) {
      const marketTools = createMarketTools({
        sessionId,
        brokerRegistry: this.brokerRegistry,
        brokerAccountIdByClass: (instrumentClass) => {
          try {
            return this.brokerRouting?.resolveBrokerAccountId(sessionId, instrumentClass) ?? null;
          } catch {
            return null;
          }
        },
        searchRegistry: this.searchRegistry,
        searchProviderId: this.resolveSearchProviderId(sessionId),
      });
      tools.get_quote = marketTools.get_quote;
      tools.get_ohlcv = marketTools.get_ohlcv;
      tools.get_news = marketTools.get_news;
    }

    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptContext.prompt },
    ];

    const trace = await this.withRetry(() =>
      adapter.runAgent({
        model: config.modelId,
        messages,
        tools,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    );

    const selection = this.parseInstrumentSelection(trace);
    const run = this.toRunFromTrace(role, config.modelId, config.providerKey, trace);
    return {
      run,
      message: this.buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: cycleId ?? null,
        trace,
        outputJson: JSON.stringify(selection),
        outputSchemaName: "instrumentSelection",
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
        marketSnapshotJson: null,
      }),
      output: selection,
    };
  }

  async runRole(
    sessionId: string,
    role: AgentRole,
    userPrompt: string,
    opts?: { marketSnapshotJson?: string | null; cycleId?: string | null },
  ): Promise<AgentResult<string>> {
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { search_web: await this.resolveSearchTool(sessionId, { cycleId: opts?.cycleId ?? null }) } : undefined;
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, userPrompt);
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptContext.prompt },
    ];

    const trace = await this.withRetry(() =>
      adapter.runAgent({
        model: config.modelId,
        messages,
        tools,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      }),
    );

    const run = this.toRunFromTrace(role, config.modelId, config.providerKey, trace);
    return {
      run,
      message: this.buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: opts?.cycleId ?? null,
        trace,
        outputJson: JSON.stringify({ text: trace.assistantText }),
        outputSchemaName: null,
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
        marketSnapshotJson: opts?.marketSnapshotJson ?? null,
      }),
      output: trace.assistantText,
    };
  }

  async runDecisionRole(sessionId: string, userPrompt: string, cycleId?: string | null): Promise<AgentResult<TradeDecision>> {
    const role: AgentRole = "decision_maker";
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, userPrompt);
    const caps = ROLE_HARNESS_CAPS[role];

    const messages: RuntimeAgentMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: promptContext.prompt },
    ];

    const trace = await this.withRetry(() =>
      adapter.runAgent({
        model: config.modelId,
        messages,
        maxSteps: caps.maxSteps,
        spendLimitUsd: caps.spendUsd,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        schema: tradeDecisionSchema,
      }),
    );

    const obj = trace.structuredOutput;
    if (!obj) {
      throw new AppError("Decision maker returned no structured trade decision.", "VALIDATION_FAILED");
    }

    const run = this.toRunFromTrace(role, config.modelId, config.providerKey, trace);
    return {
      run,
      message: this.buildTraceMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        cycleId: cycleId ?? null,
        trace,
        outputJson: JSON.stringify(obj),
        outputSchemaName: "tradeDecision",
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
        marketSnapshotJson: null,
        parseFallback: trace.parseFallback,
      }),
      output: obj,
    };
  }

  private parseInstrumentSelection(trace: RunTrace<undefined>): InstrumentSelection {
    for (let i = trace.steps.length - 1; i >= 0; i--) {
      const step = trace.steps[i];
      if (!step) continue;
      for (const tc of step.toolCalls) {
        if (tc.tool !== "submit_candidates") continue;
        const parsed = instrumentSelectionSchema.safeParse(JSON.parse(tc.resultJson));
        if (parsed.success) return parsed.data;
      }
    }
    try {
      const fromText = instrumentSelectionSchema.safeParse(JSON.parse(trace.assistantText));
      if (fromText.success) return fromText.data;
    } catch {
      /* ignore malformed assistant JSON */
    }
    throw new AppError(
      "Instrument selector must call submit_candidates with a valid instrument list.",
      "VALIDATION_FAILED",
    );
  }

  private async withRetry<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await this.withTimeout(action);
    } catch (error) {
      if (!this.shouldRetry(error)) throw this.wrapProviderError(error);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_CONFIG.backoffMs));

    try {
      return await this.withTimeout(action);
    } catch (error) {
      throw this.wrapProviderError(error);
    }
  }

  private async withTimeout<T>(action: () => Promise<T>): Promise<T> {
    const timeoutPromise = new Promise<T>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error("AI request timed out"));
      }, RETRY_CONFIG.timeoutMs);
    });
    return Promise.race([action(), timeoutPromise]);
  }

  private shouldRetry(error: unknown): boolean {
    if (
      error instanceof AppError &&
      (error.code === "MISSING_SECRET" ||
        error.code === "PROVIDER_NOT_CONFIGURED" ||
        error.code === "SEARCH_PROVIDER_REQUIRED")
    ) {
      return false;
    }
    const raw = error instanceof Error ? error.message : String(error);
    const lower = raw.toLowerCase();
    if (lower.includes("validation") || lower.includes("schema")) return false;
    if (/\b4\d\d\b/.test(raw) && !/\b429\b/.test(raw)) return false;
    if (/\b429\b/.test(raw)) return true;
    if (/\b5\d{2}\b/.test(raw)) return true;
    if (
      lower.includes("timeout") ||
      lower.includes("econnreset") ||
      lower.includes("econnrefused") ||
      lower.includes("etimedout") ||
      lower.includes("network") ||
      lower.includes("fetch failed")
    ) {
      return true;
    }
    return false;
  }

  private wrapProviderError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(`Provider unreachable: ${message}`, "PROVIDER_UNREACHABLE");
  }

  private withSessionStrategyUserPrompt(sessionId: string, userPrompt: string) {
    return prependStrategyContextToUserPrompt(this.requireStrategyContextService().get(sessionId), userPrompt);
  }

  private async resolveSearchTool(sessionId: string, context?: { cycleId?: string | null; tradeId?: string | null }) {
    const searchProviderId = this.resolveSearchProviderId(sessionId);
    if (!searchProviderId) {
      throw new AppError(
        "Session cannot enable web search because no search provider is configured.",
        "SEARCH_PROVIDER_REQUIRED",
      );
    }

    return createSearchTool({
      sessionId,
      searchProviderId,
      searchRegistry: this.searchRegistry,
      apiCallLogRepo: this.apiCallLogRepo,
      cycleId: context?.cycleId ?? null,
      tradeId: context?.tradeId ?? null,
    });
  }

  private resolveSearchProviderId(sessionId: string): string | null {
    const session = this.sessionRepo.requireById(sessionId);
    const prefs = this.workspacePrefsRepo.get();
    return session.defaultSearchProviderId ?? prefs.defaultSearchProviderId;
  }

  private resolvePrompt(sessionId: string, role: AgentRole, promptSource: "default" | "session_override", promptMarkdown: string): string {
    if (promptSource === "session_override" && promptMarkdown.trim()) {
      return promptMarkdown.trim();
    }
    const strategyType = this.strategyContextService?.get(sessionId).profile.strategyType;
    if (strategyType === "prediction_market") {
      if (role === "analyst_technical") return this.promptLoader.loadNamedAsset("analyst_statistical");
      if (role === "analyst_fundamental") return this.promptLoader.loadNamedAsset("analyst_contextual");
    }
    return this.promptLoader.load(role);
  }

  private analysisLabels(sessionId: string): { first: string; second: string } {
    const strategyType = this.requireStrategyContextService().get(sessionId).profile.strategyType;
    return strategyType === "prediction_market"
      ? { first: "Statistical analysis", second: "Contextual analysis" }
      : { first: "Technical analysis", second: "Fundamental analysis" };
  }

  private toRunFromTrace(agentType: AgentRole, model: string, providerKey: string, trace: RunTrace<unknown>): AgentRun {
    return {
      id: crypto.randomUUID(),
      trade_id: null,
      agent_type: agentType,
      model,
      provider_key: providerKey,
      finish_reason: trace.finishReason,
      input_tokens: trace.inputTokens,
      output_tokens: trace.outputTokens,
      cost_usd: estimateCostUsd(model, trace.inputTokens, trace.outputTokens),
      output_text: trace.assistantText,
      duration_ms: trace.durationMs,
      created_at: new Date().toISOString(),
    };
  }

  private buildTraceMessage(input: {
    run: AgentRun;
    role: AgentRole;
    config: { providerKey: string; modelId: string };
    sessionId: string;
    tradeId: string | null;
    cycleId?: string | null;
    trace: RunTrace<unknown>;
    outputJson: string | null;
    outputSchemaName: string | null;
    strategySnapshotJson: string;
    marketSnapshotJson?: string | null;
    parseFallback?: boolean;
  }): AgentMessage {
    const thinking =
      input.trace.thinkingText != null && input.trace.thinkingText !== ""
        ? JSON.stringify({ text: input.trace.thinkingText })
        : null;
    return {
      id: crypto.randomUUID(),
      agent_run_id: input.run.id,
      session_id: input.sessionId,
      trade_id: input.tradeId,
      cycle_id: input.cycleId ?? null,
      role: input.role,
      provider_key: input.config.providerKey,
      model_id: input.config.modelId,
      messages_json: input.trace.auditMessagesJson,
      thinking_json: thinking,
      tool_calls_json: JSON.stringify(input.trace.steps),
      output_json: input.outputJson,
      output_schema_name: input.outputSchemaName,
      parse_fallback: input.parseFallback ?? input.trace.parseFallback,
      strategy_snapshot_json: input.strategySnapshotJson,
      market_snapshot_json: input.marketSnapshotJson ?? null,
      created_at: input.run.created_at,
    };
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.strategyContextService;
  }
}
