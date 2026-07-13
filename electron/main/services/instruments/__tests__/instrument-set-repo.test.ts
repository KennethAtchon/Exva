import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import { InstrumentSetRepo } from "../instrument-set-repo";
import { seedInstrumentSets, INSTRUMENT_SET_IDS } from "../instrument-set-seeds";

describe("InstrumentSetRepo", () => {
  let db: DbClient;
  let repo: InstrumentSetRepo;

  beforeEach(() => {
    db = createTestDb();
    repo = new InstrumentSetRepo(db);
  });

  it("creates a revision and retrieves it", () => {
    repo.ensureSet("test-set");
    const rev = repo.createRevision({
      setId: "test-set",
      revision: 1,
      status: "active",
      name: "Test Set",
      instrumentClass: "stock",
      mode: "static",
      members: [
        { canonicalId: "AAPL", displaySymbol: "AAPL", venue: null },
        { canonicalId: "MSFT", displaySymbol: "MSFT", venue: "NASDAQ" },
      ],
    });

    expect(rev.setId).toBe("test-set");
    expect(rev.revision).toBe(1);
    expect(rev.status).toBe("active");
    expect(rev.members).toHaveLength(2);
    expect(rev.members[0].canonicalId).toBe("AAPL");
  });

  it("getActiveRevision returns the active revision", () => {
    repo.ensureSet("test-set");
    repo.createRevision({
      setId: "test-set",
      revision: 1,
      status: "active",
      name: "Test",
      instrumentClass: "crypto",
      mode: "static",
      members: [{ canonicalId: "ETH-USD", displaySymbol: "ETH-USD", venue: null }],
    });

    const active = repo.getActiveRevision("test-set");
    expect(active).not.toBeNull();
    expect(active!.instrumentClass).toBe("crypto");
  });

  it("createRevisionIfAbsent is idempotent", () => {
    seedInstrumentSets(repo);
    seedInstrumentSets(repo); // second call should not throw or duplicate

    const etfs = repo.getActiveRevision(INSTRUMENT_SET_IDS.LIQUID_US_ETFS)!;
    expect(etfs.members).toHaveLength(2);
    expect(repo.getRevision(INSTRUMENT_SET_IDS.LIQUID_US_ETFS, 1)).not.toBeNull();
    expect(repo.getRevision(INSTRUMENT_SET_IDS.LIQUID_US_ETFS, 2)).toBeNull();
  });

  it("list() returns all active revisions after seeding", () => {
    seedInstrumentSets(repo);
    const sets = repo.list();
    const ids = sets.map((s) => s.setId);
    expect(ids).toContain(INSTRUMENT_SET_IDS.LIQUID_US_ETFS);
    expect(ids).toContain(INSTRUMENT_SET_IDS.MAJOR_CRYPTO);
    expect(ids).toContain(INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH);
    expect(ids).toContain(INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS);
  });
});
