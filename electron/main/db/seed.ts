import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
  buildBuiltInDuckDuckGoProviderAccount,
} from "@electron/shared/catalog/search-providers";
import * as schema from "./schema";

/** Idempotent defaults applied after Drizzle SQL migrations (workspace row, built-in search provider). */
export function runSeed(db: BetterSQLite3Database<typeof schema>): void {
  const builtIn = buildBuiltInDuckDuckGoProviderAccount();
  db.insert(schema.providerAccounts)
    .values({
      id: builtIn.id,
      name: builtIn.name,
      category: builtIn.category,
      providerType: builtIn.providerType,
      secretRef: builtIn.secretRef,
      metadataJson: builtIn.metadataJson,
      isConfigured: builtIn.isConfigured,
      lastTestStatus: builtIn.lastTestStatus,
      updatedAt: builtIn.updatedAt,
    })
    .onConflictDoNothing()
    .run();

  db.insert(schema.workspacePreferences)
    .values({
      id: 1,
      globalIncludeArchived: false,
      capitalAllocationMode: "per_session_only",
      defaultModelProviderKey: "",
      defaultModelModelId: "",
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  const prefs = db.select().from(schema.workspacePreferences).where(eq(schema.workspacePreferences.id, 1)).get();
  if (prefs && prefs.defaultSearchProviderId == null) {
    db.update(schema.workspacePreferences)
      .set({
        defaultSearchProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.workspacePreferences.id, 1))
      .run();
  }

}
