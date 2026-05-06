import { tool } from "ai";
import { z } from "zod";
import type { AgentMessage, AgentRole, AgentRun } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { GenerateObjectResult, GenerateResult } from "./adapters/provider-adapter";
import { instrumentSelectionSchema, tradeDecisionSchema } from "./ai-runtime-schemas";
import type { InstrumentSelection } from "./ai-runtime-schemas";
import type { AgentResult } from "./ai-runtime-types";
import type { PromptAssetLoader } from "./prompt-asset-loader";
import type { ProviderRegistry } from "./provider-registry";
import type { SearchRegistry } from "./search";
import type { SessionStrategyContextService } from "../session/session-strategy-context-service";
import { prependStrategyContextToUserPrompt } from "./strategy-prompt-context";

export interface ResearcherInput {
  instrumentSymbol: string;
  context?: string;
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
    const userPrompt = `Instrument: ${input.instrumentSymbol}\nContext: ${input.context ?? "None"}`;
    return this.runRole(sessionId, agentRole, userPrompt);
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

  /** AI-selected universe (Phase 9): structured instruments via `generateObject`. */
  async runInstrumentSelector(sessionId: string, selectionInstructions: string): Promise<AgentResult<InstrumentSelection>> {
    const role = "instrument_selector" as const;
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { web_search: await this.resolveSearchTool(sessionId) } : undefined;
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, selectionInstructions);

    const result = await this.withRetry(() =>
      adapter.generateObject({
        model: config.modelId,
        systemPrompt,
        userPrompt: promptContext.prompt,
        schema: instrumentSelectionSchema,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools,
      }),
    );

    const run = this.toRun(role, config.modelId, result);
    return {
      run,
      message: this.buildMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        systemPrompt,
        userPrompt: promptContext.prompt,
        result,
        outputJson: JSON.stringify(result.object),
        outputSchemaName: "instrumentSelection",
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
      }),
      output: result.object,
    };
  }

  async runRole(sessionId: string, role: AgentRole, userPrompt: string): Promise<AgentResult<string>> {
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { web_search: await this.resolveSearchTool(sessionId) } : undefined;
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, userPrompt);
    const result = await this.withRetry(() =>
      adapter.generateText({
        model: config.modelId,
        systemPrompt,
        userPrompt: promptContext.prompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools,
      }),
    );
    const run = this.toRun(role, config.modelId, result);
    return {
      run,
      message: this.buildMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        systemPrompt,
        userPrompt: promptContext.prompt,
        result,
        outputJson: JSON.stringify({ text: result.text }),
        outputSchemaName: null,
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
      }),
      output: result.text,
    };
  }

  async runDecisionRole(sessionId: string, userPrompt: string): Promise<AgentResult<TradeDecision>> {
    const role: AgentRole = "decision_maker";
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(sessionId, role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { web_search: await this.resolveSearchTool(sessionId) } : undefined;
    const promptContext = this.withSessionStrategyUserPrompt(sessionId, userPrompt);

    const result = await this.withRetry(() =>
      adapter.generateObject({
        model: config.modelId,
        systemPrompt,
        userPrompt: promptContext.prompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        schema: tradeDecisionSchema,
        tools,
      }),
    );

    const run = this.toRun(role, config.modelId, result);
    return {
      run,
      message: this.buildMessage({
        run,
        role,
        config,
        sessionId,
        tradeId: null,
        systemPrompt,
        userPrompt: promptContext.prompt,
        result,
        outputJson: JSON.stringify(result.object),
        outputSchemaName: "tradeDecision",
        strategySnapshotJson: JSON.stringify(promptContext.snapshot),
      }),
      output: result.object,
    };
  }

  private async withRetry<T extends GenerateResult | GenerateObjectResult<unknown>>(action: () => Promise<T>): Promise<T> {
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

  private async resolveSearchTool(sessionId: string) {
    const session = this.sessionRepo.requireById(sessionId);
    const prefs = this.workspacePrefsRepo.get();
    const searchProviderId = session.defaultSearchProviderId ?? prefs.defaultSearchProviderId;
    if (!searchProviderId) {
      throw new AppError(
        "Session cannot enable web search because no search provider is configured.",
        "SEARCH_PROVIDER_REQUIRED",
      );
    }

    const adapter = await this.searchRegistry.get(searchProviderId);
    return tool({
      description: "Search the web for current information.",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async (input: { query: string }) => adapter.search(input.query),
    });
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

  private toRun(agentType: AgentRole, model: string, result: GenerateResult): AgentRun {
    return {
      id: crypto.randomUUID(),
      trade_id: null,
      agent_type: agentType,
      model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: this.estimateCostUsd(model, result.inputTokens, result.outputTokens),
      output_text: result.text,
      duration_ms: result.durationMs,
      created_at: new Date().toISOString(),
    };
  }

  private estimateCostUsd(_model: string, inputTokens: number, outputTokens: number): number {
    return Number(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15).toFixed(6));
  }

  private buildMessage(input: {
    run: AgentRun;
    role: AgentRole;
    config: { providerKey: string; modelId: string };
    sessionId: string;
    tradeId: string | null;
    systemPrompt: string;
    userPrompt: string;
    result: GenerateResult;
    outputJson: string | null;
    outputSchemaName: string | null;
    strategySnapshotJson: string;
  }): AgentMessage {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      agent_run_id: input.run.id,
      session_id: input.sessionId,
      trade_id: input.tradeId,
      role: input.role,
      provider_key: input.config.providerKey,
      model_id: input.config.modelId,
      messages_json: JSON.stringify([
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
        { role: "assistant", content: input.result.text },
      ]),
      thinking_json: null,
      tool_calls_json: null,
      output_json: input.outputJson,
      output_schema_name: input.outputSchemaName,
      parse_fallback: false,
      strategy_snapshot_json: input.strategySnapshotJson,
      market_snapshot_json: null,
      created_at: input.run.created_at,
    };
    return message;
  }

  private requireStrategyContextService(): SessionStrategyContextService {
    if (!this.strategyContextService) {
      throw new AppError("Strategy context service is not configured.", "UNKNOWN");
    }
    return this.strategyContextService;
  }
}
