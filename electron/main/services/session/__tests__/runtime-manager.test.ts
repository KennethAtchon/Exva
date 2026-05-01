import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { AgentRunsRepo } from "../../../db/repositories/agent-runs-repo";
import { EventsRepo } from "../../../db/repositories/events-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { StatsRepo } from "../../../db/repositories/stats-repo";
import { TradesRepo } from "../../../db/repositories/trades-repo";
import { EventBus } from "../../event-bus";
import { createLogger } from "../../log";
import { SessionRuntimeManager } from "../session-runtime-manager";

describe("SessionRuntimeManager", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
    db.sqlite.prepare("UPDATE sessions SET status = 'active' WHERE id = 'default-session'").run();
    db.sqlite
      .prepare(
        `
        INSERT INTO sessions (
          id, name, objective, status, is_focused, selection_mode,
          instrument_classes, instrument_scope, capital_limit_usd,
          execution_mode, started_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "session-b",
        "Session B",
        "Second runtime",
        "active",
        0,
        "manual_shortlist",
        '["stock"]',
        "AAPL",
        5000,
        "paper_only",
        null,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    db.sqlite.prepare("INSERT INTO session_strategies (session_id) VALUES (?)").run("session-b");
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("rehydrates one runtime per active session", async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const manager = createManager(db, {
      onStart: (sessionId) => started.push(sessionId),
      onStop: (sessionId) => stopped.push(sessionId),
    });

    await manager.rehydrateFromDb();

    expect(manager.listActive()).toHaveLength(2);
    expect(started).toEqual(["default-session", "session-b"]);
    expect(stopped).toEqual([]);
  });

  it("stopping one session tears down only that runtime", async () => {
    const stopped: string[] = [];
    const manager = createManager(db, {
      onStop: (sessionId) => stopped.push(sessionId),
    });

    await manager.rehydrateFromDb();
    await manager.stopSession("default-session");

    expect(manager.get("default-session")).toBeNull();
    expect(manager.get("session-b")).not.toBeNull();
    expect(stopped).toEqual(["default-session"]);
  });
});

function createManager(
  db: ReturnType<typeof createTestDb>,
  hooks: { onStart?: (sessionId: string) => void; onStop?: (sessionId: string) => void },
) {
  const sessionRepo = new SessionRepo(db);
  const tradesRepo = new TradesRepo(db);
  const agentRunsRepo = new AgentRunsRepo(db);
  const eventsRepo = new EventsRepo(db);
  const statsRepo = new StatsRepo(db);
  const eventBus = new EventBus();

  return new SessionRuntimeManager({
    sessionRepo,
    tradesRepo,
    agentRunsRepo,
    eventsRepo,
    statsRepo,
    ai: {} as never,
    broker: {} as never,
    riskEngine: {} as never,
    bus: eventBus,
    logger: createLogger("runtime-manager-test"),
    createOrchestrator: (sessionId) => ({
      start: async () => hooks.onStart?.(sessionId),
      pause: async () => undefined,
      resume: async () => undefined,
      stop: async () => hooks.onStop?.(sessionId),
      runApprovalRecheck: async () => undefined,
      resolveApproval: () => undefined,
    }),
    createTradeMonitor: () => ({
      start: () => undefined,
      stop: () => undefined,
    }),
  });
}
