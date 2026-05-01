import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText } from "ai";
import type { z } from "zod";
import type { AgentRole, AgentRun } from "@/lib/types";
import { tradeDecisionSchema } from "@/lib/schemas";
import { AppError } from "@electron/shared/errors";
import { secretKeys, type SecretsService } from "./secrets-service";

export interface AgentResult<T> {
  run: AgentRun;
  output: T;
}

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

const modelByAgent: Record<AgentRole, string> = {
  researcher_bull: "claude-sonnet-4-5-20250929",
  researcher_bear: "claude-sonnet-4-5-20250929",
  reviewer: "claude-sonnet-4-5-20250929",
  decision_maker: "claude-sonnet-4-5-20250929",
  instrument_selector: "claude-sonnet-4-5-20250929",
};

export class AiSdkService {
  constructor(private readonly secrets: SecretsService) {}

  async hasProviderKey(): Promise<boolean> {
    return this.secrets.has(secretKeys.anthropic);
  }

  async runResearcher(input: ResearcherInput, stance: "bull" | "bear"): Promise<AgentResult<string>> {
    const agentType: AgentRole = stance === "bull" ? "researcher_bull" : "researcher_bear";
    const system =
      stance === "bull"
        ? "You are the bull researcher. Build the strongest evidence-backed long thesis."
        : "You are the bear researcher. Build the strongest evidence-backed risk case.";
    return this.runText(agentType, system, `Instrument: ${input.instrumentSymbol}\nContext: ${input.context ?? "None"}`);
  }

  async runReviewer(input: ReviewerInput): Promise<AgentResult<string>> {
    return this.runText(
      "reviewer",
      "You are a trading research reviewer. Identify weak claims, missing risks, and decision-useful facts.",
      `Instrument: ${input.instrumentSymbol}\n\nBull case:\n${input.bullCase}\n\nBear case:\n${input.bearCase}`,
    );
  }

  async runDecisionMaker(input: DecisionInput): Promise<AgentResult<TradeDecision>> {
    const started = Date.now();
    const model = modelByAgent.decision_maker;
    const anthropic = createAnthropic({ apiKey: await this.requireAnthropicKey() });
    const result = await generateObject({
      model: anthropic(model),
      schema: tradeDecisionSchema,
      system:
        "You decide whether a trade is justified. Return no_trade unless evidence, sizing, confidence, stop, and target are all coherent.",
      prompt: `Instrument: ${input.instrumentSymbol}
Max position USD: ${input.maxPositionUsd}

Bull case:
${input.bullCase}

Bear case:
${input.bearCase}

Review:
${input.review}`,
    });

    const run = this.toRun("decision_maker", model, JSON.stringify(result.object), started, result.usage);
    return { run, output: result.object };
  }

  private async runText(agentType: AgentRole, system: string, prompt: string): Promise<AgentResult<string>> {
    const started = Date.now();
    const model = modelByAgent[agentType];
    const anthropic = createAnthropic({ apiKey: await this.requireAnthropicKey() });
    const result = await generateText({
      model: anthropic(model),
      system,
      prompt,
    });
    const run = this.toRun(agentType, model, result.text, started, result.usage);
    return { run, output: result.text };
  }

  private async requireAnthropicKey(): Promise<string> {
    const key = await this.secrets.get(secretKeys.anthropic);
    if (!key) throw new AppError("Anthropic API key is not configured", "MISSING_SECRET");
    return key;
  }

  private toRun(
    agentType: AgentRole,
    model: string,
    outputText: string,
    started: number,
    usage?: { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number },
  ): AgentRun {
    const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0;
    return {
      id: crypto.randomUUID(),
      trade_id: "",
      agent_type: agentType,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: this.estimateCostUsd(model, inputTokens, outputTokens),
      output_text: outputText,
      duration_ms: Date.now() - started,
      created_at: new Date().toISOString(),
    };
  }

  private estimateCostUsd(_model: string, inputTokens: number, outputTokens: number): number {
    return Number(((inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15).toFixed(6));
  }
}
