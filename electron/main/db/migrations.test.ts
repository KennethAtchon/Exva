import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { createTestDb } from "./test-helpers";
import { providerAccounts, workspacePreferences } from "./schema";

describe("runMigrations", () => {
  it("applies schema, seed SQL, and runtime seed defaults", () => {
    const { db } = createTestDb();

    const prefs = db
      .select()
      .from(workspacePreferences)
      .where(eq(workspacePreferences.id, 1))
      .get();
    expect(prefs).toBeDefined();
    expect(prefs?.allocationEnforcementOverride).toBeNull();
    expect(prefs?.defaultSearchProviderId).toBe(
      BUILT_IN_DUCKDUCKGO_PROVIDER_ID,
    );

    const builtIn = db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, BUILT_IN_DUCKDUCKGO_PROVIDER_ID))
      .get();
    expect(builtIn?.providerType).toBe("duckduckgo");
  });
});
