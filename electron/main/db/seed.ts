import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
  buildBuiltInDuckDuckGoProviderAccount,
} from "@electron/shared/catalog/search-providers";
import {
  builtInGlobalStrategyPresets,
  builtInRiskPresets,
  builtInTimeframePresets,
  builtInResearchPosturePresets,
  builtInTradeRulePresets,
} from "@electron/shared/presets";
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

  const now = Date.now();

  for (const preset of builtInGlobalStrategyPresets()) {
    db.insert(schema.globalPresets)
      .values({
        id: preset.id,
        name: preset.label,
        isBuiltIn: true,
        createdAt: now,
        presetJson: JSON.stringify(preset),
      })
      .onConflictDoNothing()
      .run();
  }

  for (const preset of builtInRiskPresets()) {
    db.insert(schema.riskPresets)
      .values({
        id: preset.id,
        label: preset.label,
        isBuiltIn: true,
        presetJson: JSON.stringify(preset),
      })
      .onConflictDoNothing()
      .run();
  }

  for (const preset of builtInTimeframePresets()) {
    db.insert(schema.timeframePresets)
      .values({
        id: preset.id,
        label: preset.label,
        isBuiltIn: true,
        presetJson: JSON.stringify(preset),
      })
      .onConflictDoNothing()
      .run();
  }

  for (const preset of builtInResearchPosturePresets()) {
    db.insert(schema.researchPosturePresets)
      .values({
        id: preset.id,
        label: preset.label,
        isBuiltIn: true,
        presetJson: JSON.stringify(preset),
      })
      .onConflictDoNothing()
      .run();
  }

  for (const preset of builtInTradeRulePresets()) {
    db.insert(schema.tradeRulePresets)
      .values({
        id: preset.id,
        label: preset.label,
        isBuiltIn: true,
        presetJson: JSON.stringify(preset),
      })
      .onConflictDoNothing()
      .run();
  }
}
