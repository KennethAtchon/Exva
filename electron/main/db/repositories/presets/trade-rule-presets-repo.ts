import { eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { tradeRulePresets } from "../../schema";
import type { TradeRulesPreset } from "@electron/shared/domain";

export class TradeRulePresetsRepo {
  constructor(private readonly client: DbClient) {}

  list(): TradeRulesPreset[] {
    return this.client.db
      .select()
      .from(tradeRulePresets)
      .all()
      .map((row) => JSON.parse(row.presetJson) as TradeRulesPreset);
  }

  findById(id: string): TradeRulesPreset | undefined {
    const row = this.client.db.select().from(tradeRulePresets).where(eq(tradeRulePresets.id, id)).get();
    return row ? (JSON.parse(row.presetJson) as TradeRulesPreset) : undefined;
  }
}
