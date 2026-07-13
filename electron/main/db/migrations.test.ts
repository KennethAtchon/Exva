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

  it("0005 backfills null signal_events envelope fields", () => {
    const testDb = createTestDb();
    const now = new Date().toISOString();

    // Simulate a pre-backfill row (null envelope fields) via raw SQL.
    testDb.sqlite
      .prepare(
        `INSERT INTO signal_events (
          id, source_id, source_type, ticker, company_name, document_url,
          accession_number, payload_json, filed_at, detected_at, dispatch_status,
          kind, payload_v2, dedupe_key, ttl, occurred_at
        ) VALUES (
          ?, ?, ?, ?, NULL, NULL, ?, '{}', ?, ?, 'new',
          NULL, NULL, NULL, NULL, NULL
        )`,
      )
      .run(
        "legacy-evt-1",
        "src-1",
        "edgar_8k",
        "AAPL",
        "0000320193-26-000001",
        now,
        now,
      );

    const before = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_events
         WHERE id = 'legacy-evt-1' AND dedupe_key IS NULL`,
      )
      .get() as { n: number };
    expect(before.n).toBe(1);

    // Apply the same UPDATE as 0005 (migration already ran on createTestDb).
    testDb.sqlite.exec(`
      UPDATE signal_events SET
        dedupe_key = COALESCE(
          dedupe_key,
          accession_number,
          COALESCE(source_id, 'unknown') || ':' || ticker || ':' || detected_at
        ),
        kind = COALESCE(
          kind,
          CASE
            WHEN source_type = 'edgar_8k' THEN 'filing'
            WHEN source_type = 'prediction_event' THEN 'market_dislocation'
            WHEN source_type = 'timer' THEN 'scan_hit'
            WHEN source_type = 'web_search' THEN 'news'
            ELSE 'manual'
          END
        ),
        ttl = COALESCE(ttl, 'PT4H'),
        occurred_at = COALESCE(occurred_at, filed_at, detected_at)
      WHERE dedupe_key IS NULL
         OR kind IS NULL
         OR ttl IS NULL
         OR occurred_at IS NULL;
    `);

    const after = testDb.sqlite
      .prepare(
        `SELECT kind, dedupe_key, ttl, occurred_at FROM signal_events WHERE id = 'legacy-evt-1'`,
      )
      .get() as {
      kind: string;
      dedupe_key: string;
      ttl: string;
      occurred_at: string;
    };
    expect(after.kind).toBe("filing");
    expect(after.dedupe_key).toBe("0000320193-26-000001");
    expect(after.ttl).toBe("PT4H");
    expect(after.occurred_at).toBe(now);

    const remainingNulls = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_events
         WHERE dedupe_key IS NULL OR kind IS NULL OR ttl IS NULL OR occurred_at IS NULL`,
      )
      .get() as { n: number };
    expect(remainingNulls.n).toBe(0);

    testDb.sqlite.close();
  });

  it("0006 leaves zero timer/web_search signal_sources after migrate", () => {
    const testDb = createTestDb();
    const leftover = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_sources WHERE type IN ('timer', 'web_search')`,
      )
      .get() as { n: number };
    expect(leftover.n).toBe(0);
    testDb.sqlite.close();
  });

  it("0006 deletes leftover timer/web_search rows when unreferenced", () => {
    const testDb = createTestDb();
    const now = new Date().toISOString();
    testDb.sqlite
      .prepare(
        `INSERT INTO signal_sources (id, type, name, description, enabled, config_json, created_at, updated_at)
         VALUES (?, 'timer', 'Legacy timer', NULL, 1, '{}', ?, ?),
                (?, 'web_search', 'Legacy web', NULL, 1, '{}', ?, ?)`,
      )
      .run("legacy-timer", now, now, "legacy-web", now, now);

    const before = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_sources WHERE type IN ('timer', 'web_search')`,
      )
      .get() as { n: number };
    expect(before.n).toBe(2);

    // Same abort-then-delete sequence as 0006 (migration already applied).
    testDb.sqlite.exec(`
      CREATE TEMP TABLE _assert_no_deprecated_source_refs (x INTEGER);
      CREATE TEMP TRIGGER _assert_no_deprecated_source_refs_trg
      BEFORE INSERT ON _assert_no_deprecated_source_refs
      BEGIN
        SELECT RAISE(ABORT,
          '0006: session_input_subscriptions still reference timer/web_search signal_sources — refuse delete.'
        )
        WHERE EXISTS (
          SELECT 1
          FROM session_input_subscriptions AS sis
          INNER JOIN signal_sources AS ss ON ss.id = sis.source_definition_id
          WHERE ss.type IN ('timer', 'web_search')
        );
      END;
      INSERT INTO _assert_no_deprecated_source_refs (x) VALUES (1);
      DROP TRIGGER _assert_no_deprecated_source_refs_trg;
      DROP TABLE _assert_no_deprecated_source_refs;
      DELETE FROM signal_sources WHERE type IN ('timer', 'web_search');
    `);

    const after = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_sources WHERE type IN ('timer', 'web_search')`,
      )
      .get() as { n: number };
    expect(after.n).toBe(0);
    testDb.sqlite.close();
  });

  it("0006 aborts when a V2 subscription still references a deprecated source id", () => {
    const testDb = createTestDb();
    const session = createMinimalSession(testDb);
    const now = new Date().toISOString();

    testDb.sqlite
      .prepare(
        `INSERT INTO signal_sources (id, type, name, description, enabled, config_json, created_at, updated_at)
         VALUES (?, 'web_search', 'Legacy web', NULL, 1, '{}', ?, ?)`,
      )
      .run("legacy-web-ref", now, now);

    testDb.sqlite
      .prepare(
        `INSERT INTO session_input_subscriptions (
          id, session_id, template_id, template_version, mode, enabled,
          revision, source_definition_id, analysis_timeframe,
          uses_unvalidated_universe, created_at, updated_at
        ) VALUES (?, ?, 'tmpl', 1, 'event_source', 1, 1, ?, '1h', 0, ?, ?)`,
      )
      .run("sub-bad", session.id, "legacy-web-ref", now, now);

    expect(() => {
      testDb.sqlite.exec(`
        CREATE TEMP TABLE _assert_no_deprecated_source_refs (x INTEGER);
        CREATE TEMP TRIGGER _assert_no_deprecated_source_refs_trg
        BEFORE INSERT ON _assert_no_deprecated_source_refs
        BEGIN
          SELECT RAISE(ABORT,
            '0006: session_input_subscriptions still reference timer/web_search signal_sources — refuse delete. Diagnose: SELECT sis.id, sis.session_id, sis.source_definition_id, ss.type FROM session_input_subscriptions sis JOIN signal_sources ss ON ss.id = sis.source_definition_id WHERE ss.type IN (''timer'',''web_search'');'
          )
          WHERE EXISTS (
            SELECT 1
            FROM session_input_subscriptions AS sis
            INNER JOIN signal_sources AS ss ON ss.id = sis.source_definition_id
            WHERE ss.type IN ('timer', 'web_search')
          );
        END;
        INSERT INTO _assert_no_deprecated_source_refs (x) VALUES (1);
      `);
    }).toThrow(/0006: session_input_subscriptions still reference/);

    const stillThere = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM signal_sources WHERE id = 'legacy-web-ref'`,
      )
      .get() as { n: number };
    expect(stillThere.n).toBe(1);

    testDb.sqlite.close();
  });

  it("0007 leaves merged autopsies table and drops legacy parents", () => {
    const testDb = createTestDb();
    const tables = testDb.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
          'autopsies', 'trade_autopsies', 'period_autopsies', 'autopsy_lessons'
        )`,
      )
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((row) => row.name));
    expect(names.has("autopsies")).toBe(true);
    expect(names.has("autopsy_lessons")).toBe(true);
    expect(names.has("trade_autopsies")).toBe(false);
    expect(names.has("period_autopsies")).toBe(false);

    const lessonCols = testDb.sqlite
      .prepare(`PRAGMA table_info(autopsy_lessons)`)
      .all() as Array<{ name: string }>;
    expect(lessonCols.some((col) => col.name === "period_autopsy_id")).toBe(
      false,
    );
    expect(lessonCols.some((col) => col.name === "autopsy_id")).toBe(true);

    const autopsyCols = testDb.sqlite
      .prepare(`PRAGMA table_info(autopsies)`)
      .all() as Array<{ name: string }>;
    const autopsyColNames = new Set(autopsyCols.map((col) => col.name));
    expect(autopsyColNames.has("scope")).toBe(true);
    expect(autopsyColNames.has("period_scope")).toBe(true);
    expect(autopsyColNames.has("trade_id")).toBe(true);

    testDb.sqlite.close();
  });

  it("0007 preserves trade/period/lesson rows when merging", () => {
    const testDb = createTestDb();
    const session = createMinimalSession(testDb);
    const now = new Date().toISOString();

    testDb.db
      .insert(trades)
      .values({
        id: "merge-trade-1",
        sessionId: session.id,
        brokerAccountId: null,
        instrumentSymbol: "AAPL",
        instrumentDisplayName: null,
        predictionOutcome: null,
        instrumentMetadataJson: null,
        instrumentType: "stock",
        side: "BUY",
        entryPrice: 100,
        positionSizeUsd: 500,
        stopLossPrice: null,
        takeProfitPrice: null,
        strategy: "passive_income",
        status: "closed",
        openedAt: now,
        closedAt: now,
        finalPnlUsd: 10,
        aiCostUsd: 0,
        confidenceScore: 0.7,
        brokerOrderId: null,
        highWaterMarkPrice: null,
        exitReason: null,
        clientOrderId: null,
        closeMarketSnapshotJson: null,
        createdAt: now,
      })
      .run();

    testDb.sqlite
      .prepare(
        `INSERT INTO autopsies (
          id, scope, trade_id, summary, period_scope, window_start, window_end,
          filters_json, trade_count, trade_ids_json, total_cost_usd,
          session_id, model_id, summary_structured_json, phase_traces_json,
          quality_grade, quality_score, is_fallback, created_at, created_by
        ) VALUES
          ('ta-1', 'trade', 'merge-trade-1', 'ok', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
           ?, 'model', '{}', '[]', NULL, NULL, 0, ?, 'user'),
          ('pa-1', 'period', NULL, NULL, 'session', ?, ?, '{}', 1, '[]', 0.1,
           ?, 'model', '{}', '[]', NULL, NULL, 0, ?, 'user')`,
      )
      .run(session.id, now, now, now, session.id, now);

    testDb.sqlite
      .prepare(
        `INSERT INTO autopsy_lessons (
          id, autopsy_id, trade_id, session_id, lesson, severity, category,
          proposed_fix, status, recurrence_count, source, scope,
          created_at, updated_at, validated_at
        ) VALUES
          ('l-trade', 'ta-1', 'merge-trade-1', ?, 'trade lesson', 'medium', 'strategy',
           '', 'pending', 0, 'trade', 'session', ?, ?, NULL),
          ('l-period', 'pa-1', NULL, ?, 'period lesson', 'high', 'risk',
           '', 'pending', 0, 'period', 'session', ?, ?, NULL),
          ('l-manual', NULL, NULL, ?, 'manual lesson', 'low', 'system',
           '', 'pending', 0, 'manual', 'session', ?, ?, NULL)`,
      )
      .run(session.id, now, now, session.id, now, now, session.id, now, now);

    const tradeCount = testDb.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM autopsies WHERE scope = 'trade'`)
      .get() as { n: number };
    const periodCount = testDb.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM autopsies WHERE scope = 'period'`)
      .get() as { n: number };
    expect(tradeCount.n).toBe(1);
    expect(periodCount.n).toBe(1);

    const unresolved = testDb.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM autopsy_lessons AS l
         WHERE l.autopsy_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM autopsies AS a WHERE a.id = l.autopsy_id)`,
      )
      .get() as { n: number };
    expect(unresolved.n).toBe(0);

    const lessons = testDb.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM autopsy_lessons`)
      .get() as { n: number };
    expect(lessons.n).toBe(3);

    testDb.sqlite.close();
  });

  it("0011 creates paper_balances with FK to broker_accounts", () => {
    const testDb = createTestDb();
    const tables = testDb.sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='paper_balances'`,
      )
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);

    const cols = testDb.sqlite
      .prepare(`PRAGMA table_info(paper_balances)`)
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "account_id",
        "currency",
        "balance",
        "starting_balance",
        "updated_at",
      ]),
    );
    testDb.sqlite.close();
  });
});
