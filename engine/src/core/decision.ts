import type { ReasonCode } from "@shared/reasons.ts";
import { reasonText } from "@shared/reasons.ts";
import type { Bot, Decision, DecisionKind } from "@shared/types.ts";
import { z } from "zod";
import {
  AiBudgetError,
  AiError,
  BrokerRejected,
  BrokerUnavailable,
  DataError,
  InputError,
} from "../errors.ts";
import { errorMessage, newId } from "../util.ts";

/** Builds the one Decision a check produces. */
export class DecisionBuilder {
  readonly id = newId("dec");

  constructor(
    private readonly bot: Bot,
    private readonly symbol: string,
    private readonly barTs: number,
    private readonly now: number,
  ) {}

  make(
    kind: DecisionKind,
    code: ReasonCode,
    message?: string,
    values: Record<string, number> = {},
    orderId: string | null = null,
    aiCallId: string | null = null,
  ): Decision {
    return {
      id: this.id,
      botId: this.bot.id,
      symbol: this.symbol,
      barTs: this.barTs,
      kind,
      code,
      message: message ?? reasonText(code),
      values: Object.fromEntries(Object.entries(values).filter(([, v]) => Number.isFinite(v))),
      orderId,
      aiCallId,
      createdAt: this.now,
    };
  }

  /** Turn an exception into a readable decision instead of crashing the bot. */
  fromError(err: unknown): Decision {
    const msg = errorMessage(err);
    if (err instanceof AiBudgetError) return this.make("skip", "ai_budget_exhausted", msg);
    if (err instanceof AiError) return this.make("error", "ai_failed", `AI call failed: ${msg}`);
    if (err instanceof DataError) return this.make("error", "data_fetch_failed", msg);
    if (err instanceof BrokerRejected) return this.make("error", "broker_rejected", msg);
    if (err instanceof BrokerUnavailable) return this.make("error", "broker_unavailable", msg);
    if (err instanceof InputError || err instanceof z.ZodError)
      return this.make("error", "strategy_error", msg);
    return this.make("error", "strategy_error", `Strategy crashed: ${msg}`);
  }
}
