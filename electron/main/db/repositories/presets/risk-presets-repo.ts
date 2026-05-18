import { eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { riskPresets } from "../../schema";
import type { RiskPreset } from "@electron/shared/domain";

export class RiskPresetsRepo {
  constructor(private readonly client: DbClient) {}

  list(): RiskPreset[] {
    return this.client.db
      .select()
      .from(riskPresets)
      .all()
      .map((row) => JSON.parse(row.presetJson) as RiskPreset);
  }

  findById(id: string): RiskPreset | undefined {
    const row = this.client.db.select().from(riskPresets).where(eq(riskPresets.id, id)).get();
    return row ? (JSON.parse(row.presetJson) as RiskPreset) : undefined;
  }
}
