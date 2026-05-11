import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbClient } from "../client";
import { globalPresets } from "../schema";
import type { GlobalStrategyPreset } from "@electron/shared/presets";

export interface UserGlobalPresetRow {
  id: string;
  name: string;
  createdAt: number;
  presetJson: string;
}

export class GlobalPresetsRepo {
  constructor(private readonly client: DbClient) {}

  list(): UserGlobalPresetRow[] {
    return this.client.db
      .select()
      .from(globalPresets)
      .orderBy(globalPresets.createdAt)
      .all()
      .map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt, presetJson: row.presetJson }));
  }

  insert(input: { name: string; preset: Omit<GlobalStrategyPreset, "id" | "label"> }): UserGlobalPresetRow {
    const id = randomUUID();
    const now = Date.now();
    this.client.db
      .insert(globalPresets)
      .values({ id, name: input.name, createdAt: now, presetJson: JSON.stringify(input.preset) })
      .run();
    return { id, name: input.name, createdAt: now, presetJson: JSON.stringify(input.preset) };
  }

  update(id: string, input: { name: string; preset: Omit<GlobalStrategyPreset, "id" | "label"> }): void {
    this.client.db
      .update(globalPresets)
      .set({ name: input.name, presetJson: JSON.stringify(input.preset) })
      .where(eq(globalPresets.id, id))
      .run();
  }

  delete(id: string): void {
    this.client.db.delete(globalPresets).where(eq(globalPresets.id, id)).run();
  }
}
