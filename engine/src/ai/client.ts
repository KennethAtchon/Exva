// OpenAI-compatible chat client (DeepSeek by default). Every call is logged with tokens and cost;
// every structured answer is schema-validated with one repair attempt; failures are AiError.
import type { Settings } from "@shared/types.ts";
import type { z } from "zod";
import type { Clock } from "../core/clock.ts";
import { AiBudgetError, AiError } from "../errors.ts";
import type { Store } from "../store/store.ts";
import { errorMessage, localDayStart, newId, round, sha256, usd } from "../util.ts";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface CallOptions {
  purpose: "analyst" | "journal" | "explain" | "assistant" | "backtest";
  botId?: string | null;
  messages: ChatMessage[];
  tools?: ToolDef[];
  json?: boolean;
  maxTokens?: number;
  promptVersion: string;
  /** Replay key: identical model + prompt version + context hash may reuse a stored answer. */
  contextHash?: string;
  /** Backtest calls are capped per run instead of counting against the daily budget. */
  budgetExempt?: boolean;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  cost?: number;
}

export const promptVersion = (text: string) => sha256(text).slice(0, 12);

export class AiClient {
  constructor(
    private readonly d: {
      store: Store;
      settings: () => Settings["ai"];
      apiKey: () => string | null;
      clock: Clock;
      fetch?: typeof fetch;
    },
  ) {}

  configured(): boolean {
    return Boolean(this.d.apiKey());
  }

  spentToday(): number {
    return this.d.store.aiSpendSince(localDayStart(this.d.clock.now()));
  }

  model(): string {
    return this.d.settings().model;
  }

  /** One chat completion. Logged in ai_calls whether it succeeds or not. */
  async complete(
    o: CallOptions,
  ): Promise<{ message: ChatMessage; callId: string; costUsd: number }> {
    const cfg = this.d.settings();
    const key = this.d.apiKey();
    if (!key) throw new AiError("No AI API key. Add one in Settings.");
    if (!o.budgetExempt && this.spentToday() >= cfg.dailyBudgetUsd) {
      throw new AiBudgetError(`Daily AI budget of ${usd(cfg.dailyBudgetUsd)} is used up`);
    }
    const started = Date.now();
    const callId = newId("ai");
    const log = (ok: boolean, usage: Usage, response: string | null, error: string | null) => {
      const cost = this.cost(usage, cfg);
      this.d.store.insertAiCall({
        id: callId,
        ts: this.d.clock.now(),
        botId: o.botId ?? null,
        purpose: o.purpose,
        model: cfg.model,
        promptVersion: o.promptVersion,
        contextHash: o.contextHash ?? "",
        inputTokens: usage.prompt_tokens ?? 0,
        cachedTokens:
          usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        costUsd: cost,
        latencyMs: Date.now() - started,
        ok,
        error,
        response,
      });
      return cost;
    };
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: o.messages,
      max_tokens: o.maxTokens ?? 800,
      temperature: 0.2,
      stream: false,
    };
    if (o.json) body.response_format = { type: "json_object" };
    if (o.tools?.length) body.tools = o.tools;
    let res: Response;
    try {
      res = await (this.d.fetch ?? fetch)(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      const msg = `Could not reach ${cfg.baseUrl}: ${errorMessage(err)}`;
      log(false, {}, null, msg);
      throw new AiError(msg);
    }
    const text = await res.text();
    if (!res.ok) {
      const msg = `AI provider returned ${res.status}: ${text.slice(0, 200)}`;
      log(false, {}, null, msg);
      throw new AiError(msg);
    }
    let parsed: { choices?: { message?: ChatMessage; finish_reason?: string }[]; usage?: Usage };
    try {
      parsed = JSON.parse(text);
    } catch {
      log(false, {}, text.slice(0, 2000), "Unreadable response");
      throw new AiError("AI provider sent an unreadable response");
    }
    const choice = parsed.choices?.[0];
    const usage = parsed.usage ?? {};
    if (!choice?.message) {
      log(false, usage, text.slice(0, 2000), "No message in response");
      throw new AiError("AI provider sent no answer");
    }
    if (choice.finish_reason === "length") {
      log(false, usage, choice.message.content, "Answer was cut off");
      throw new AiError("The AI answer was cut off (max tokens)");
    }
    const costUsd = log(
      true,
      usage,
      choice.message.content ?? JSON.stringify(choice.message.tool_calls ?? []),
      null,
    );
    return { message: choice.message, callId, costUsd };
  }

  /** A stored, still-valid answer for exactly this model + prompt version + context, if any. */
  cached<T>(
    o: Pick<CallOptions, "purpose" | "promptVersion" | "contextHash"> & { schema: z.ZodType<T> },
  ): { data: T; callId: string } | null {
    if (!o.contextHash) return null;
    const hit = this.d.store.cachedAiCall(
      o.purpose,
      this.d.settings().model,
      o.promptVersion,
      o.contextHash,
    );
    const data = hit?.response ? o.schema.safeParse(parseJson(hit.response)) : null;
    return hit && data?.success ? { data: data.data, callId: hit.id } : null;
  }

  /** A JSON answer validated against `schema`, with one repair attempt. Optionally served from the replay cache. */
  async json<T>(
    o: CallOptions & { schema: z.ZodType<T>; cache?: boolean },
  ): Promise<{ data: T; callId: string; costUsd: number; cached: boolean }> {
    const hit = o.cache ? this.cached(o) : null;
    if (hit) return { ...hit, costUsd: 0, cached: true };
    let messages = o.messages;
    let spent = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { message, callId, costUsd } = await this.complete({ ...o, messages, json: true });
      spent += costUsd;
      const raw = message.content ?? "";
      const result = o.schema.safeParse(parseJson(raw));
      if (result.success) return { data: result.data, callId, costUsd: spent, cached: false };
      const issues = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      if (attempt === 1) throw new AiError(`AI returned invalid output twice (${issues})`);
      messages = [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `That JSON did not match the required format: ${issues}. Reply with only the corrected JSON object.`,
        },
      ];
    }
    throw new AiError("unreachable");
  }

  private cost(u: Usage, cfg: Settings["ai"]): number {
    if (typeof u.cost === "number") return u.cost;
    const prompt = u.prompt_tokens ?? 0;
    const hit = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
    const miss = u.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
    const out = u.completion_tokens ?? 0;
    return round(
      (miss * cfg.inputPricePerM + hit * cfg.cachedInputPricePerM + out * cfg.outputPricePerM) /
        1e6,
      8,
    );
  }
}

/** Parse a JSON object even if the model wrapped it in a code fence. */
export function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
    return null;
  }
}
