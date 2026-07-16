import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { channels } from "@electron/shared/ipc/channels";
import * as schema from "../../db/schema";
import { runMigrations } from "../../db/migrations";
import { insertTrade } from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import type { DbClient } from "../../db/client";
import {
  backupSqliteDb,
  restoreSqliteDb,
} from "../../services/infra/db-backup";
import {
  createIpcTestServices,
  invokeIpc,
  registerPhase4IpcHandlers,
  resetIpcHandlers,
} from "./ipc-test-harness";

function createFileTestDb(filePath: string): DbClient {
  const sqlite = new BetterSqlite3(filePath);
  sqlite.pragma("journal_mode = WAL");
  runMigrations(sqlite, { rebuildFromScratch: false });
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    dbPath: filePath,
  };
}

/**
 * Finish-line 09 T6 — journey-level IPC tests:
 * session create → configure → start → trade → close (mock);
 * config edit → reload → persist;
 * backup → restore.
 */
describe("operator journeys (IPC)", () => {
  let db: ReturnType<typeof createTestDb>;
  let harness: ReturnType<typeof createIpcTestServices>;

  beforeEach(() => {
    db = createTestDb();
    harness = createIpcTestServices(db);
    resetIpcHandlers();
    registerPhase4IpcHandlers(harness.services);
    harness.insertBroker({
      id: "broker-mock",
      brokerType: "mock",
      name: "Mock Paper",
    });
    harness.configureAiProvider();
  });

  afterEach(() => {
    harness.cleanup();
    resetIpcHandlers();
  });

  it("session create → configure → start → trade → close via mock broker path", async () => {
    const created = await invokeIpc<{ id: string; status: string }>(
      channels.session.create,
      harness.validSessionCreatePayload("broker-mock", {
        name: "Journey Mock Session",
      }),
    );
    expect(created.status).toBe("draft");

    await invokeIpc(channels.session.focus, { id: created.id });

    const before = await invokeIpc<{
      version: number;
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.get, { sessionId: created.id });

    const configured = await invokeIpc<{
      version: number;
      doc: { risk: { maxPositionUsd: number } };
    }>(channels.strategyConfig.update, {
      sessionId: created.id,
      expectedVersion: before.version,
      patch: { risk: { maxPositionUsd: 1250 } },
    });
    expect(configured.doc.risk.maxPositionUsd).toBe(1250);

    const status = await invokeIpc<string>(channels.session.start, {});
    expect(status).toBe("active");
    expect(harness.startedSessions).toContain(created.id);

    insertTrade(db, {
      id: "journey-trade-1",
      sessionId: created.id,
      brokerAccountId: "broker-mock",
      status: "open",
      instrumentSymbol: "AAPL",
      side: "BUY",
      entry_price: 100,
      position_size_usd: 500,
      opened_at: new Date().toISOString(),
    });

    const listed = await invokeIpc<
      Array<{ id: string; status: string; sessionId: string }>
    >(channels.trades.listActive, { sessionId: created.id });
    expect(listed.some((t) => t.id === "journey-trade-1")).toBe(true);

    await invokeIpc(channels.trades.forceClose, { tradeId: "journey-trade-1" });
    const closed = harness.services.repos.trades.require("journey-trade-1");
    expect(closed.status).toBe("closed");
  });

  it("config edit → restart (reload services) → persist", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-config-persist-"));
    const dbPath = path.join(dir, "exva.db");
    const fileDb = createFileTestDb(dbPath);
    const fileHarness = createIpcTestServices(fileDb);
    resetIpcHandlers();
    registerPhase4IpcHandlers(fileHarness.services);
    fileHarness.insertBroker({
      id: "broker-mock",
      brokerType: "mock",
      name: "Mock Paper",
    });
    fileHarness.configureAiProvider();

    try {
      const created = await invokeIpc<{ id: string }>(
        channels.session.create,
        fileHarness.validSessionCreatePayload("broker-mock", {
          name: "Persist Config Session",
        }),
      );

      const before = await invokeIpc<{ version: number }>(
        channels.strategyConfig.get,
        { sessionId: created.id },
      );
      await invokeIpc(channels.strategyConfig.update, {
        sessionId: created.id,
        expectedVersion: before.version,
        patch: { risk: { maxPositionUsd: 3333 } },
      });

      fileHarness.cleanup();
      resetIpcHandlers();

      const reopened = createFileTestDb(dbPath);
      const restarted = createIpcTestServices(reopened);
      registerPhase4IpcHandlers(restarted.services);
      try {
        const reloaded = await invokeIpc<{
          doc: { risk: { maxPositionUsd: number } };
        }>(channels.strategyConfig.get, { sessionId: created.id });
        expect(reloaded.doc.risk.maxPositionUsd).toBe(3333);
      } finally {
        restarted.cleanup();
        resetIpcHandlers();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("backup → restore journey", () => {
  it("backs up a real migrated sqlite db and restores queryable rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-journey-backup-"));
    const source = path.join(dir, "exva.db");
    const restored = path.join(dir, "restored.db");
    const marker = `journey-marker-${Date.now()}`;

    // Build a real, migrated SQLite database and persist a row we can later
    // query back — proving the backup preserves actual database content, not
    // merely opaque bytes. A fake header would fail the quick_check gate.
    const src = createFileTestDb(source);
    const now = new Date().toISOString();
    src.db
      .insert(schema.ohlcvBars)
      .values({
        id: marker,
        symbol: "AAPL",
        instrumentClass: "stock",
        timeframe: "1h",
        ts: now,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
        provider: "test",
        ingestedAt: now,
      })
      .run();
    // Flush WAL into the main file so a plain file copy is self-contained.
    src.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    src.sqlite.close();

    const backup = backupSqliteDb({ sourcePath: source, trigger: "manual" });
    expect(backup.ok).toBe(true);
    expect(backup.backupPath).toBeTruthy();
    if (!backup.backupPath) throw new Error("expected backupPath");

    const restore = restoreSqliteDb({
      backupPath: backup.backupPath,
      targetPath: restored,
    });
    expect(restore.ok).toBe(true);

    // Reopen the restored database and prove the row round-tripped.
    const reopened = new BetterSqlite3(restored, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const row = reopened
        .prepare("SELECT id FROM ohlcv_bars WHERE id = ?")
        .get(marker) as { id: string } | undefined;
      expect(row?.id).toBe(marker);
    } finally {
      reopened.close();
    }

    fs.rmSync(dir, { recursive: true, force: true });
    try {
      fs.rmSync(backup.backupPath, { force: true });
    } catch {
      // shared backup dir cleanup is best-effort
    }
  });
});
