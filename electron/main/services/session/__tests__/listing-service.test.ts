import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../../db/test-fixtures";
import { createTestDb } from "../../../db/test-helpers";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { SessionListingService } from "../listing-service";

function createListing(deps: {
  db: ReturnType<typeof createTestDb>;
  sessions: SessionRepo;
  assignments: SessionBrokerAssignmentsRepo;
  trades?: { listOpenAndPending: (sessionId: string) => unknown[] };
  runtimeManager?: { get: (sessionId: string) => { startedAt: string } | null };
}) {
  return new SessionListingService({
    sessionRepo: deps.sessions,
    assignments: deps.assignments,
    signalSources: new SignalSourcesRepo(deps.db),
    brokerAccounts: new BrokerAccountsRepo(deps.db),
    trades: (deps.trades ?? { listOpenAndPending: () => [] }) as never,
    runtimeManager: (deps.runtimeManager ?? { get: () => null }) as never,
  });
}

describe("SessionListingService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("aggregates session summaries with allocations, trades, and uptime", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const session = createMinimalSession(db, {
      name: "Alpha Session",
      objective: "Trade NVDA",
      instrumentClasses: ["stock"],
      instrumentScope: "NVDA",
      experienceId: "edgar-catalyst",
    });
    sessions.setFocus(session.id);
    insertBrokerAccount(db, { id: "broker-a" });
    insertBrokerAccount(db, { id: "broker-b" });
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-a", allocatedUsd: 3000 },
      { brokerAccountId: "broker-b", allocatedUsd: 2000 },
    ]);
    insertTrade(db, {
      id: "trade-open",
      sessionId: session.id,
      status: "open",
    });
    insertTrade(db, {
      id: "trade-pending",
      sessionId: session.id,
      status: "pending",
    });

    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const listing = createListing({
      db,
      sessions,
      assignments,
      trades: {
        listOpenAndPending: (sessionId: string) =>
          sessionId === session.id
            ? [
                { id: "trade-open", status: "open" },
                { id: "trade-pending", status: "pending" },
              ]
            : [],
      },
      runtimeManager: {
        get: (sessionId: string) =>
          sessionId === session.id ? { startedAt } : null,
      },
    });

    const result = listing.list();

    expect(result.workspaceViewMode).toBe("session");
    expect(result.focusedSessionId).toBe(session.id);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      id: session.id,
      name: "Alpha Session",
      objective: "Trade NVDA",
      status: "draft",
      isFocused: true,
      totalAllocatedUsd: 5000,
      brokerCount: 2,
      openTradeCount: 1,
      experienceId: "edgar-catalyst",
    });
    expect(result.sessions[0]?.uptimeMin).toBeGreaterThanOrEqual(2);
  });

  it("filters by search, instrument class, status, and excludes archived by default", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const stockSession = createMinimalSession(db, {
      name: "Stock Runner",
      objective: "Trade equities",
      instrumentClasses: ["stock"],
      instrumentScope: "SPY",
    });
    const cryptoSession = createMinimalSession(db, {
      name: "Crypto Runner",
      objective: "Trade bitcoin",
      instrumentClasses: ["crypto"],
      instrumentScope: "BTC-USD",
    });
    sessions.setStatus("idle", stockSession.id);
    sessions.setStatus("archived", cryptoSession.id);
    sessions.clearFocus();
    sessions.setFocus(stockSession.id);

    const listing = createListing({ db, sessions, assignments });

    expect(listing.list().sessions.map((row) => row.id)).toEqual([
      stockSession.id,
    ]);
    expect(
      listing.list({ search: "bitcoin" }).sessions.map((row) => row.id),
    ).toEqual([]);
    expect(
      listing
        .list({
          instrumentClass: "crypto",
          includeArchived: true,
        })
        .sessions.map((row) => row.id),
    ).toEqual([cryptoSession.id]);
    expect(
      listing.list({ status: "idle" }).sessions.map((row) => row.id),
    ).toEqual([stockSession.id]);
    expect(listing.list().workspaceViewMode).toBe("session");
    expect(listing.list().focusedSessionId).toBe(stockSession.id);

    sessions.clearFocus();
    expect(listing.list().workspaceViewMode).toBe("global");
    expect(listing.list().focusedSessionId).toBeNull();
  });

  it("returns zero uptime when no runtime is active", () => {
    const session = createMinimalSession(db);
    const listing = createListing({
      db,
      sessions: new SessionRepo(db),
      assignments: new SessionBrokerAssignmentsRepo(db),
    });

    expect(listing.computeUptimeMin(session.id)).toBe(0);
  });

  it("returns zero uptime for invalid runtime timestamps", () => {
    const session = createMinimalSession(db);
    const listing = createListing({
      db,
      sessions: new SessionRepo(db),
      assignments: new SessionBrokerAssignmentsRepo(db),
      runtimeManager: {
        get: () => ({ startedAt: "not-a-date" }),
      },
    });

    expect(listing.computeUptimeMin(session.id)).toBe(0);
  });

  it("rehearsalMode is false when no V2 mock rehearsal source is active", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);

    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
      instrumentClasses: ["stock"],
    });
    insertBrokerAccount(db, { id: "mock-broker", brokerType: "mock" });
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "mock-broker", allocatedUsd: 1000 },
    ]);
    sessions.setStatus("active", session.id);

    const listing = createListing({ db, sessions, assignments });
    const summary = listing
      .list()
      .sessions.find((row) => row.id === session.id);

    expect(summary).toMatchObject({
      rehearsalMode: false,
      status: "active",
    });
  });
});
