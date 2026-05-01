import type { DbClient } from "../client";
import type { WorkspacePreferences } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toWorkspacePreferences } from "./mappers";

export class WorkspacePreferencesRepo {
  constructor(private readonly client: DbClient) {}

  get(): WorkspacePreferences {
    const row = this.client.sqlite.prepare("SELECT * FROM workspace_preferences WHERE id = 1").get() as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError("Workspace preferences were not found", "NOT_FOUND");
    }
    return toWorkspacePreferences(row);
  }

  update(patch: Partial<Omit<WorkspacePreferences, "id">>): WorkspacePreferences {
    const current = this.get();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };

    this.client.sqlite
      .prepare(
        `
        UPDATE workspace_preferences SET
          global_include_archived = @global_include_archived,
          default_search_provider_id = @default_search_provider_id,
          capital_allocation_mode = @capital_allocation_mode,
          global_capital_pool_usd = @global_capital_pool_usd,
          updated_at = @updated_at
        WHERE id = 1
        `,
      )
      .run({
        global_include_archived: next.globalIncludeArchived ? 1 : 0,
        default_search_provider_id: next.defaultSearchProviderId,
        capital_allocation_mode: next.capitalAllocationMode,
        global_capital_pool_usd: next.globalCapitalPoolUsd,
        updated_at: next.updatedAt,
      });

    return this.get();
  }
}
