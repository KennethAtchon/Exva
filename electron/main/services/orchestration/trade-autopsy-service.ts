import type { AgentMessage, TradeAutopsy } from "@/lib/types";
import type { AgentMessagesRepo } from "../../db/repositories/agent-messages-repo";
import type { TradeAutopsiesRepo } from "../../db/repositories/trade-autopsies-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { ProviderRegistry } from "../ai/provider-registry";

const AUTOPSY_MODEL_ID = "claude-haiku-4-5-20251001";

export class TradeAutopsyService {
  constructor(
    private readonly tradesRepo: TradesRepo,
    private readonly agentMessagesRepo: AgentMessagesRepo,
    private readonly tradeAutopsiesRepo: TradeAutopsiesRepo,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  list(tradeId: string): TradeAutopsy[] {
    return this.tradeAutopsiesRepo.listByTrade(tradeId);
  }

  async summarize(tradeId: string): Promise<TradeAutopsy> {
    const trade = this.tradesRepo.require(tradeId);
    const messages = this.agentMessagesRepo.listByTrade(tradeId);
    const summary = await this.generateSummary(tradeId, messages, trade.final_pnl_usd ?? null);
    const autopsy: TradeAutopsy = {
      id: crypto.randomUUID(),
      trade_id: tradeId,
      session_id: trade.sessionId ?? "unknown-session",
      model_id: AUTOPSY_MODEL_ID,
      summary,
      created_at: new Date().toISOString(),
      created_by: "user",
    };
    this.tradeAutopsiesRepo.insert(autopsy);
    return autopsy;
  }

  private async generateSummary(tradeId: string, messages: AgentMessage[], pnlUsd: number | null): Promise<string> {
    const prompt = buildAutopsyPrompt(tradeId, messages, pnlUsd);
    try {
      const adapter = await this.providerRegistry.get("provider-anthropic");
      const result = await adapter.generateText({
        model: AUTOPSY_MODEL_ID,
        systemPrompt: "You are a trading post-mortem analyst. Keep output concise and actionable.",
        userPrompt: prompt,
        maxTokens: 1024,
        temperature: 0.2,
      });
      return result.text.trim() || "Autopsy model returned empty output.";
    } catch {
      return fallbackSummary(messages, pnlUsd);
    }
  }
}

function fallbackSummary(messages: AgentMessage[], pnlUsd: number | null): string {
  const recent = messages.slice(-3).map((m) => `${m.role}: ${safeText(m.output_json ?? m.messages_json)}`);
  return [
    "Autopsy fallback summary (LLM unavailable).",
    `Final PnL: ${pnlUsd == null ? "unknown" : pnlUsd.toFixed(2)} USD`,
    "Recent agent outputs:",
    ...recent.map((line) => `- ${line}`),
  ].join("\n");
}

function buildAutopsyPrompt(tradeId: string, messages: AgentMessage[], pnlUsd: number | null): string {
  const lines = messages.map((m) => {
    const body = safeText(m.output_json ?? m.messages_json);
    return `${m.role} (${m.model_id}): ${body}`;
  });
  return [
    `Trade ID: ${tradeId}`,
    `Final PnL USD: ${pnlUsd == null ? "unknown" : pnlUsd.toFixed(2)}`,
    "Agent transcript:",
    ...lines,
    "",
    "Write a concise autopsy with:",
    "1) what worked,",
    "2) what failed,",
    "3) one process improvement for future cycles.",
  ].join("\n");
}

function safeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 400);
}
