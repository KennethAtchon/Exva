import type { DbClient } from "../../client";
import type { WorkspacePreferences } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import { workspacePreferences } from "../../schema";

export class WorkspacePreferencesRepo {
  constructor(private readonly client: DbClient) {}

  get(): WorkspacePreferences {
    const row = this.client.db
      .select()
      .from(workspacePreferences)
      .where(eq(workspacePreferences.id, 1))
      .get();
    if (!row) {
      throw new AppError("Workspace preferences were not found", "NOT_FOUND");
    }
    return {
      id: 1,
      globalIncludeArchived: row.globalIncludeArchived,
      globalEnvironmentMode:
        row.globalEnvironmentMode === "live" ? "live" : "paper",
      defaultSearchProviderId: row.defaultSearchProviderId,
      allocationEnforcementOverride:
        (row.allocationEnforcementOverride as WorkspacePreferences["allocationEnforcementOverride"]) ??
        null,
      defaultModelProviderKey: row.defaultModelProviderKey ?? "",
      defaultModelModelId: row.defaultModelModelId ?? "",
      updatedAt: row.updatedAt,
    };
  }

  update(
    patch: Partial<Omit<WorkspacePreferences, "id">>,
  ): WorkspacePreferences {
    const current = this.get();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };

    this.client.db
      .update(workspacePreferences)
      .set({
        globalIncludeArchived: next.globalIncludeArchived,
        globalEnvironmentMode: next.globalEnvironmentMode,
        defaultSearchProviderId: next.defaultSearchProviderId,
        allocationEnforcementOverride: next.allocationEnforcementOverride,
        defaultModelProviderKey: next.defaultModelProviderKey,
        defaultModelModelId: next.defaultModelModelId,
        updatedAt: next.updatedAt,
      })
      .where(eq(workspacePreferences.id, 1))
      .run();

    return this.get();
  }
}
