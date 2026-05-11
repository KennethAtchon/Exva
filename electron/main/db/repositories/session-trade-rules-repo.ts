import type { DbClient } from "../client";
import type { SessionTradeRules } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionTradeRules } from "../schema";
import { toSessionTradeRules } from "./mappers";

export class SessionTradeRulesRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionTradeRules {
    const row = this.client.db.select().from(sessionTradeRules).where(eq(sessionTradeRules.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Trade rules for session ${sessionId} were not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionTradeRules(row);
  }

  upsert(sessionId: string, patch: Partial<SessionTradeRules>): SessionTradeRules {
    const current = this.get(sessionId);
    const next: SessionTradeRules = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionTradeRules)
      .set({
        rulesPresetId: next.rulesPresetId,
        setupType: next.setupType,
        sideBias: next.sideBias,
        entryStyle: next.entryStyle,
        exitStyle: next.exitStyle,
        scalingMode: next.scalingMode,
        tradeRulesMarkdown: next.tradeRulesMarkdown,
        ruleNotes: next.ruleNotes,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionTradeRules.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
