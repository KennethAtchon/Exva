import { eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { timeframePresets } from "../../schema";
import type { TimeframePreset } from "@electron/shared/domain";

export class TimeframePresetsRepo {
  constructor(private readonly client: DbClient) {}

  list(): TimeframePreset[] {
    return this.client.db
      .select()
      .from(timeframePresets)
      .all()
      .map((row) => JSON.parse(row.presetJson) as TimeframePreset);
  }

  findById(id: string): TimeframePreset | undefined {
    const row = this.client.db.select().from(timeframePresets).where(eq(timeframePresets.id, id)).get();
    return row ? (JSON.parse(row.presetJson) as TimeframePreset) : undefined;
  }
}
