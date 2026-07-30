/**
 * One-day acceptance report CLI (Solution 05).
 *
 * Usage:
 *   bun run acceptance:report -- <sessionIdOrName> [--day=YYYY-MM-DD]
 */

import { createTestDb } from "../../electron/main/db/test-helpers";
import { SessionRepo } from "../../electron/main/db/repositories/sessions/session-repo";
import { SessionBrokerAssignmentsRepo } from "../../electron/main/db/repositories/sessions/session-broker-assignments-repo";
import { OpportunityRateService } from "../../electron/main/services/analytics/opportunity-rate-service";
import { SessionUptimeService } from "../../electron/main/services/session/session-uptime-service";
import { ScanFunnelService } from "../../electron/main/services/scheduling/scan-funnel-service";
import {
  OneDayAcceptanceReportService,
  formatOneDayAcceptanceReport,
} from "../../electron/main/services/analytics/one-day-acceptance-report-service";
import { isSentinelSessionName } from "../../electron/main/services/session/session-config-validation-builder";
import { requireExperience } from "../../electron/main/experiences/index";
import { createDbClient } from "../../electron/main/db/client";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const sessionRef = args.find((a) => !a.startsWith("--")) ?? "";
const dayArg = args.find((a) => a.startsWith("--day="))?.slice("--day=".length);

if (!sessionRef) {
  console.error("Usage: bun run acceptance:report -- <sessionIdOrName> [--day=YYYY-MM-DD]");
  process.exit(1);
}

const dbPath =
  process.env.EXVA_DB_PATH ??
  path.join(os.homedir(), "Library", "Application Support", "Exva", "exva.db");
const db = process.env.EXVA_DB_PATH ? createDbClient(dbPath) : createTestDb();
const sessionRepo = new SessionRepo(db);
const assignments = new SessionBrokerAssignmentsRepo(db);

const session =
  sessionRepo.findById(sessionRef) ??
  sessionRepo.list().find((s) => s.name.toLowerCase().includes(sessionRef.toLowerCase()));

if (!session) {
  console.error(`Session not found: ${sessionRef}`);
  process.exit(1);
}

const uptime = new SessionUptimeService(db);
const opportunityRate = new OpportunityRateService(db);
const reportSvc = new OneDayAcceptanceReportService({
  db,
  sessionUptime: uptime,
  opportunityRate,
  scanFunnel: {
    forSession: () => ({
      sessionId: session.id,
      groupKey: "cli",
      lastScanAt: null,
      signalCount: 0,
      instrumentCount: 0,
      counts: {},
      instruments: [],
      scheduleHealth: "unknown",
    }),
  } as ScanFunnelService,
  listAssignedBrokerAccountIds: (sessionId) =>
    assignments.listBrokerAccountIds(sessionId),
  isSentinelSession: (_id, name) => isSentinelSessionName(name),
  getSessionName: (sessionId) => sessionRepo.requireById(sessionId).name,
  getExperienceSupportState: (experienceId) =>
    requireExperience(experienceId).supportState ?? "available",
  getExperienceBlocker: (experienceId) =>
    requireExperience(experienceId).blockerMessage ?? null,
});

const report = reportSvc.generate(session.id, dayArg);
console.log(formatOneDayAcceptanceReport(report));
