import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { SignalSourcesRepo } from "../signal-sources-repo";

describe("SignalSourcesRepo", () => {
  it("creates, updates, lists, and deletes signal sources", () => {
    const db = createTestDb();
    const repo = new SignalSourcesRepo(db);

    const source = repo.create({
      id: "source-edgar",
      type: "edgar_8k",
      name: "EDGAR 8-K",
      description: "SEC filings",
      enabled: true,
      configJson: "{}",
    });

    expect(repo.list()).toMatchObject([{ id: source.id, enabled: true }]);
    expect(repo.get(source.id)?.name).toBe("EDGAR 8-K");

    repo.update(source.id, { name: "EDGAR 8-K Updated", enabled: false });
    expect(repo.get(source.id)).toMatchObject({
      name: "EDGAR 8-K Updated",
      enabled: false,
    });

    repo.delete(source.id);
    expect(repo.get(source.id)).toBeNull();

    db.sqlite.close();
  });
});
