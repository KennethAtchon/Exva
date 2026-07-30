import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { sessions } from "../../../db/schema";
import { OpportunityRateService } from "../opportunity-rate-service";
import { SessionUptimeService } from "../../session/session-uptime-service";
import { ScanFunnelService } from "../../scheduling/scan-funnel-service";
import {
  OneDayAcceptanceReportService,
  formatOneDayAcceptanceReport,
} from "../one-day-acceptance-report-service";

describe("OneDayAcceptanceReportService", () => {
  it("refuses setup rate when uptime coverage is below 90%", () => {
    const db = createTestDb();
    db.db
      .insert(sessions)
      .values({
        id: "s1",
        name: "Test",
        objective: "test",
        status: "active",
        executionMode: "paper_only",
        experienceId: "rules-mean-reversion",
        instrumentClasses: JSON.stringify(["stock"]),
        instrumentScope: "SPY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const uptime = new SessionUptimeService(db, () => new Date("2026-07-29T20:00:00.000Z"));
    uptime.heartbeat("s1", 10);

    const reportSvc = new OneDayAcceptanceReportService({
      db,
      sessionUptime: uptime,
      opportunityRate: new OpportunityRateService(db),
      scanFunnel: {
        forSession: () => ({
          sessionId: "s1",
          groupKey: "g",
          lastScanAt: null,
          signalCount: 0,
          instrumentCount: 0,
          counts: {},
          instruments: [],
          scheduleHealth: "unknown",
        }),
      } as unknown as ScanFunnelService,
      listAssignedBrokerAccountIds: () => [],
      isSentinelSession: () => false,
      getSessionName: () => "Test",
      getExperienceSupportState: () => "available",
      getExperienceBlocker: () => null,
    });

    const report = reportSvc.generate("s1", "2026-07-29");
    expect(report.setupRate.included).toBe(false);
    expect(report.setupRate.refusalReason).toMatch(/below 90%/);
    const text = formatOneDayAcceptanceReport(report);
    expect(text).toContain("Uptime (first)");
    expect(text).toContain("REFUSED");
  });
});
