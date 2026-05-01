import { tool } from "ai";
import { z } from "zod";
import type { AgentRole, AgentRun } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { GenerateObjectResult, GenerateResult } from "./adapters/provider-adapter";
import { tradeDecisionSchema } from "./ai-runtime-schemas";
import type { AgentResult } from "./ai-runtime-types";
import type { PromptAssetLoader } from "./prompt-asset-loader";
import type { ProviderRegistry } from "./provider-registry";
import type { SearchRegistry } from "./search";

export interface ResearcherInput {
  instrumentSymbol: string;
  context?: string;
}

export interface ReviewerInput {
  instrumentSymbol: string;
  bullCase: string;
  bearCase: string;
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
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly searchRegistry: SearchRegistry,
    private readonly promptLoader: PromptAssetLoader,
    private readonly aiRolesRepo: SessionAiRolesRepo,
    private readonly sessionRepo: SessionRepo,
    private readonly workspacePrefsRepo: WorkspacePreferencesRepo,
  ) {}

  async runResearcher(input: ResearcherInput, stance: "bull" | "bear", sessionId?: string): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const role: AgentRole = stance === "bull" ? "researcher_bull" : "researcher_bear";
    const userPrompt = `Instrument: ${input.instrumentSymbol}\nContext: ${input.context ?? "None"}`;
    return this.runRole(sessionId, role, userPrompt);
  }

  async runReviewer(input: ReviewerInput, sessionId?: string): Promise<AgentResult<string>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const prompt = `Instrument: ${input.instrumentSymbol}\n\nBull case:\n${input.bullCase}\n\nBear case:\n${input.bearCase}`;
    return this.runRole(sessionId, "reviewer", prompt);
  }

  async runDecisionMaker(input: DecisionInput, sessionId?: string): Promise<AgentResult<TradeDecision>> {
    if (!sessionId) throw new AppError("Session id is required for AI role execution", "VALIDATION_FAILED");
    const prompt = `Instrument: ${input.instrumentSymbol}
Max position USD: ${input.maxPositionUsd}

Bull case:
${input.bullCase}

Bear case:
${input.bearCase}

Review:
${input.review}`;
    return this.runDecisionRole(sessionId, prompt);
  }

  async runRole(sessionId: string, role: AgentRole, userPrompt: string): Promise<AgentResult<string>> {
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { web_search: await this.resolveSearchTool(sessionId) } : undefined;
    const result = await this.withRetry(() =>
      adapter.generateText({
        model: config.modelId,
        systemPrompt,
        userPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        tools,
      }),
    );
    return {
      run: this.toRun(role, config.modelId, result),
      output: result.text,
    };
  }

  async runDecisionRole(sessionId: string, userPrompt: string): Promise<AgentResult<TradeDecision>> {
    const role: AgentRole = "decision_maker";
    const config = this.aiRolesRepo.requireByRole(sessionId, role);
    const adapter = await this.registry.get(config.providerKey);
    const systemPrompt = this.resolvePrompt(role, config.promptSource, config.promptMarkdown);
    const tools = config.webSearchEnabled ? { web_search: await this.resolveSearchTool(sessionId) } : undefined;

    const result = await this.withRetry(() =>
      adapter.generateObject({
        model: config.modelId,
        systemPrompt,
        userPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        schema: tradeDecisionSchema,
        tools,
      }),
    );

    return {
      run: this.toRun(role, config.modelId, result),
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
    if (error instanceof AppError && (error.code === "MISSING_SECRET" || error.code === "PROVIDER_NOT_CONFIGURED")) {
      return false;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("429")) return true;
    if (message.includes("5")) return true;
    if (message.includes("timeout") || message.includes("econnreset") || message.includes("network")) return true;
    if (message.includes("validation") || message.includes("schema")) return false;
    return false;
  }

  private wrapProviderError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new AppError(`Provider request failed: ${message}`, "UNKNOWN");
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

  private resolvePrompt(role: AgentRole, promptSource: "default" | "session_override", promptMarkdown: string): string {
    if (promptSource === "session_override" && promptMarkdown.trim()) {
      return promptMarkdown.trim();
    }
    return this.promptLoader.load(role);
  }

  private toRun(agentType: AgentRole, model: string, result: GenerateResult): AgentRun {
    return {
      id: crypto.randomUUID(),
      trade_id: "",
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
}
