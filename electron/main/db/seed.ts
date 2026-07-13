import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import {
  BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
  buildBuiltInDuckDuckGoProviderAccount,
} from "@electron/shared/instruments/search-providers";
import * as schema from "./schema";
import type { DbClient } from "./client";
import { seedExperienceCatalog } from "../services/experience-catalog/seed-experience-catalog";
import { seedBuiltinConfigPresets } from "./builtin-config-presets";

export const SEEDED_OPENROUTER_PROVIDER_ID = "seed-openrouter";
export const SEEDED_OPENROUTER_SECRET_REF = "provider:seed-openrouter";
export const SEEDED_ALPACA_BROKER_ID = "seed-alpaca-paper";
export const SEEDED_ALPACA_SECRET_REF = "broker:seed-alpaca-paper";

/** Idempotent defaults applied after Drizzle SQL migrations (workspace row, built-in search provider). */
export function runSeed(
  db: BetterSQLite3Database<typeof schema>,
  dbClient?: DbClient,
): void {
  const builtIn = buildBuiltInDuckDuckGoProviderAccount();
  const openRouterKey = env.openRouterKey;
  const openRouterModel = env.openRouterModel;
  const hasOpenRouterSeed = Boolean(openRouterKey && openRouterModel);
  const alpacaApiKey = env.alpacaApiKey;
  const alpacaSecretKey = env.alpacaSecretKey;
  const hasAlpacaSeed = Boolean(alpacaApiKey && alpacaSecretKey);

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

  if (hasOpenRouterSeed) {
    db.insert(schema.providerAccounts)
      .values({
        id: SEEDED_OPENROUTER_PROVIDER_ID,
        name: "OpenRouter (Seeded)",
        category: "ai",
        providerType: "openrouter",
        secretRef: SEEDED_OPENROUTER_SECRET_REF,
        metadataJson: null,
        isConfigured: true,
        lastTestStatus: "unknown",
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  db.insert(schema.workspacePreferences)
    .values({
      id: 1,
      globalIncludeArchived: false,
      allocationEnforcementOverride: null,
      defaultModelProviderKey: "",
      defaultModelModelId: "",
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();

  const prefs = db
    .select()
    .from(schema.workspacePreferences)
    .where(eq(schema.workspacePreferences.id, 1))
    .get();
  if (prefs && prefs.defaultSearchProviderId == null) {
    db.update(schema.workspacePreferences)
      .set({
        defaultSearchProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.workspacePreferences.id, 1))
      .run();
  }

  if (
    prefs &&
    hasOpenRouterSeed &&
    (!prefs.defaultModelProviderKey || !prefs.defaultModelModelId)
  ) {
    const modelId = openRouterModel ?? "";
    db.update(schema.workspacePreferences)
      .set({
        defaultModelProviderKey: SEEDED_OPENROUTER_PROVIDER_ID,
        defaultModelModelId: modelId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.workspacePreferences.id, 1))
      .run();
  }

  if (hasAlpacaSeed) {
    db.insert(schema.brokerAccounts)
      .values({
        id: SEEDED_ALPACA_BROKER_ID,
        name: "Alpaca (Seeded)",
        brokerType: "alpaca",
        supportedInstrumentClasses: JSON.stringify([
          "stock",
          "crypto",
          "options",
        ]),
        mode: "paper",
        maxSessions: 10,
        allocationEnforcement: "hard",
        balanceRefreshIntervalMin: 5,
        balanceCacheUsd: null,
        balanceCachedAt: null,
        mockScenarioKind: null,
        mockExecutionTier: null,
        secretRef: SEEDED_ALPACA_SECRET_REF,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .run();
  }

  seedBuiltinConfigPresets(db);

  if (dbClient) {
    seedExperienceCatalog(dbClient);
  }
}
