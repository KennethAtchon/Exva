import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { AdapterCertRepo } from "../../../db/repositories/brokers/adapter-cert-repo";
import { brokerAccounts } from "../../../db/schema";
import { MockBrokerAdapter } from "../adapters/mock-adapter";
import { runAdapterCertification } from "./adapter-certification";

describe("AdapterCertificationService", () => {
  it("persists cert results per broker account", async () => {
    const db = createTestDb();
    db.db
      .insert(brokerAccounts)
      .values({
        id: "broker-test",
        name: "Test",
        brokerType: "mock",
        supportedInstrumentClasses: JSON.stringify(["stock"]),
        mode: "paper",
        secretRef: "secret://test",
        updatedAt: new Date().toISOString(),
      })
      .run();
    const repo = new AdapterCertRepo(db);
    const report = await runAdapterCertification({
      adapter: new MockBrokerAdapter({ bias: "bullish", autoCloseAfterMs: 20 }),
      symbol: "AAPL",
      instrumentClass: "stock",
      trade: true,
      fillTimeoutMs: 5_000,
    });
    const saved = repo.saveResult("broker-test", report);
    expect(saved.passed).toBe(report.passed);
    expect(saved.certRunId).toBeTruthy();
    expect(repo.getLatest("broker-test")?.brokerAccountId).toBe("broker-test");
  });
});

describe("runAdapterCertification extended checks", () => {
  it("includes close and restart checks on mock", async () => {
    const report = await runAdapterCertification({
      adapter: new MockBrokerAdapter({ bias: "bullish", autoCloseAfterMs: 20 }),
      symbol: "AAPL",
      instrumentClass: "stock",
      trade: true,
      fillTimeoutMs: 5_000,
    });
    expect(report.checks.some((c) => c.name === "closeFlatten")).toBe(true);
    expect(report.checks.some((c) => c.name === "restartResilience")).toBe(true);
    expect(report.checks.some((c) => c.name === "getBuyingPower")).toBe(true);
  });
});
