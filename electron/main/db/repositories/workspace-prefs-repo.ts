import type { DbClient } from "../client";
import type { WorkspacePreferences } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { workspacePreferences } from "../schema";

export class WorkspacePreferencesRepo {
  constructor(private readonly client: DbClient) {}

  get(): WorkspacePreferences {
    const row = this.client.db.select().from(workspacePreferences).where(eq(workspacePreferences.id, 1)).get();
    if (!row) {
      throw new AppError("Workspace preferences were not found", "NOT_FOUND");
    }
    return {
      id: 1,
      globalIncludeArchived: row.globalIncludeArchived,
      defaultSearchProviderId: row.defaultSearchProviderId,
      capitalAllocationMode: row.capitalAllocationMode as WorkspacePreferences["capitalAllocationMode"],
      globalCapitalPoolUsd: row.globalCapitalPoolUsd,
      updatedAt: row.updatedAt,
    };
  }

  update(patch: Partial<Omit<WorkspacePreferences, "id">>): WorkspacePreferences {
    const current = this.get();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };

    this.client.db
      .update(workspacePreferences)
      .set({
        globalIncludeArchived: next.globalIncludeArchived,
        defaultSearchProviderId: next.defaultSearchProviderId,
        capitalAllocationMode: next.capitalAllocationMode,
        globalCapitalPoolUsd: next.globalCapitalPoolUsd,
        updatedAt: next.updatedAt,
      })
      .where(eq(workspacePreferences.id, 1))
      .run();

    return this.get();
  }
}
