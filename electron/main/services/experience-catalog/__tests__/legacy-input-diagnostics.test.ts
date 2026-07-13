import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import {
  buildLegacyInputReport,
  classifySignalSourceRow,
} from "../legacy-input-diagnostics";
import { signalSources } from "../../../db/schema";

describe("classifySignalSourceRow", () => {
  it.each([
    ["edgar_8k", "event"],
    ["prediction_event", "event"],
    ["web_search", "event"],
    ["timer", "timer"],
    ["mock", "mock"],
    ["manual", "manual"],
    ["custom_unknown", "unknown"],
  ] as const)("type=%s → category=%s", (type, expected) => {
    const result = classifySignalSourceRow({
      id: "test",
      type,
      name: "Test",
      enabled: true,
      experienceId: null,
    });
    expect(result.category).toBe(expected);
  });
});

describe("buildLegacyInputReport", () => {
  let db: DbClient;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns empty report when no signal_sources exist", () => {
    const report = buildLegacyInputReport(db);
    expect(report.total).toBe(0);
    expect(report.summary.event).toBe(0);
    expect(report.summary.timer).toBe(0);
  });

  it("categorizes inserted rows correctly", () => {
    const now = new Date().toISOString();
    db.db
      .insert(signalSources)
      .values([
        {
          id: "src-edgar",
          type: "edgar_8k",
          name: "Edgar",
          enabled: true,
          configJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "src-timer",
          type: "timer",
          name: "Timer",
          enabled: true,
          configJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "src-mock",
          type: "mock",
          name: "Mock",
          enabled: true,
          configJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "src-manual",
          type: "manual",
          name: "Manual",
          enabled: true,
          configJson: "{}",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const report = buildLegacyInputReport(db);
    expect(report.total).toBe(4);
    expect(report.summary.event).toBe(1);
    expect(report.summary.timer).toBe(1);
    expect(report.summary.mock).toBe(1);
    expect(report.summary.manual).toBe(1);
    expect(report.summary.unknown).toBe(0);
    expect(report.byCategory.event[0].id).toBe("src-edgar");
  });
});
