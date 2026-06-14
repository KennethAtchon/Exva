import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { SignalEventsRepo } from "../signal-events-repo";
import { SignalSourcesRepo } from "../signal-sources-repo";

describe("SignalEventsRepo", () => {
  it("inserts, deduplicates, and updates signal events", () => {
    const db = createTestDb();
    const repo = new SignalEventsRepo(db);
    const sourcesRepo = new SignalSourcesRepo(db);
    const now = new Date().toISOString();

    sourcesRepo.create({
      id: "source-edgar",
      type: "edgar_8k",
      name: "EDGAR",
      description: null,
      enabled: true,
      configJson: "{}",
    });

    repo.insert({
      id: "event-1",
      sourceId: "source-edgar",
      sourceType: "edgar_8k",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      documentUrl: "https://sec.gov/filing",
      accessionNumber: "0001234567-25-000001",
      payloadJson: { form: "8-K" },
      filedAt: now,
      detectedAt: now,
    });

    expect(
      repo.existsBySourceAndAccession("source-edgar", "0001234567-25-000001"),
    ).toBe(true);
    expect(repo.getById("event-1")).toMatchObject({
      ticker: "AAPL",
      payloadJson: { form: "8-K" },
    });
    expect(repo.listByDispatchStatus("new")).toHaveLength(1);

    repo.markDispatchStatus("event-1", "fanned_out");
    expect(repo.listByDispatchStatus("fanned_out")).toHaveLength(1);

    db.sqlite.close();
  });
});
