import { eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { researchPosturePresets } from "../../schema";
import type { ResearchPosturePreset } from "@electron/shared/domain";

export class ResearchPosturePresetsRepo {
  constructor(private readonly client: DbClient) {}

  list(): ResearchPosturePreset[] {
    return this.client.db
      .select()
      .from(researchPosturePresets)
      .all()
      .map((row) => JSON.parse(row.presetJson) as ResearchPosturePreset);
  }

  findById(id: string): ResearchPosturePreset | undefined {
    const row = this.client.db
      .select()
      .from(researchPosturePresets)
      .where(eq(researchPosturePresets.id, id))
      .get();
    return row
      ? (JSON.parse(row.presetJson) as ResearchPosturePreset)
      : undefined;
  }
}
