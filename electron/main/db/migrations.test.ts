import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import { createTestDb } from "./test-helpers";
import { createMinimalSession } from "./test-fixtures";
import { runMigrations } from "./migrations";
import {
  providerAccounts,
  trades,
  workspacePreferences,
  sessions,
} from "./schema";
import { toWorkspaceSession } from "./repositories/system/mappers";

describe("runMigrations", () => {
  it("applies schema, seed SQL, and runtime seed defaults", () => {
    const testDb = createTestDb();
    const { db } = testDb;

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

    testDb.sqlite.close();
  });

  it("is idempotent when run twice on the same database", () => {
    const sqlite = new BetterSqlite3(":memory:");
    sqlite.pragma("journal_mode = WAL");
    runMigrations(sqlite, { rebuildFromScratch: false });

    const db = drizzle(sqlite);
    const presetCountFirst = db.select().from(providerAccounts).all().length;

    runMigrations(sqlite, { rebuildFromScratch: false });
    const presetCountSecond = db.select().from(providerAccounts).all().length;

    expect(presetCountSecond).toBe(presetCountFirst);
    sqlite.close();
  });

  it("enforces foreign keys for trades referencing sessions", () => {
    const db = createTestDb();
    db.sqlite.pragma("foreign_keys = ON");

    expect(() => {
      db.db
        .insert(trades)
        .values({
          id: "orphan-trade",
          sessionId: "missing-session",
          brokerAccountId: null,
          instrumentSymbol: "AAPL",
          instrumentDisplayName: null,
          predictionOutcome: null,
          instrumentMetadataJson: null,
          instrumentType: "stock",
          side: "BUY",
          entryPrice: null,
          positionSizeUsd: 500,
          stopLossPrice: null,
          takeProfitPrice: null,
          strategy: "passive_income",
          status: "pending",
          openedAt: null,
          closedAt: null,
          finalPnlUsd: null,
          aiCostUsd: 0,
          confidenceScore: 0.7,
          brokerOrderId: null,
          highWaterMarkPrice: null,
          exitReason: null,
          clientOrderId: null,
          closeMarketSnapshotJson: null,
          createdAt: new Date().toISOString(),
        })
        .run();
    }).toThrow();

    db.sqlite.close();
  });

  it("maps workspace session rows through toWorkspaceSession", () => {
    const db = createTestDb();
    const session = createMinimalSession(db);
    const row = db.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id))
      .get();
    expect(row).toBeDefined();
    if (!row) throw new Error("expected session row");

    const mapped = toWorkspaceSession(row);
    expect(mapped).toMatchObject({
      id: session.id,
      name: session.name,
      status: session.status,
      instrumentClasses: session.instrumentClasses,
    });

    db.sqlite.close();
  });
});
