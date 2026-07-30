import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import {
  brokerAdapterCertRuns,
  brokerAdapterCertStates,
} from "../../schema";
import type {
  AdapterCertReport,
  BrokerAdapterCertState,
  CertCheckResult,
} from "@electron/shared/domain/adapter-certification";
import { safeJsonParse } from "../../../services/infra/safe-json-parse";

function parseChecks(json: string): CertCheckResult[] {
  const parsed = safeJsonParse<CertCheckResult[]>(
    json,
    undefined,
    "adapter-cert.checks",
  );
  return Array.isArray(parsed) ? parsed : [];
}

function toState(row: typeof brokerAdapterCertStates.$inferSelect): BrokerAdapterCertState {
  return {
    brokerAccountId: row.brokerAccountId,
    certRunId: row.certRunId,
    brokerType: row.brokerType,
    mode: row.mode as BrokerAdapterCertState["mode"],
    passed: row.passed,
    checks: parseChecks(row.checksJson),
    certifiedAt: row.certifiedAt,
    updatedAt: row.updatedAt,
  };
}

export class AdapterCertRepo {
  constructor(private readonly db: DbClient) {}

  getLatest(brokerAccountId: string): BrokerAdapterCertState | null {
    const row = this.db.db
      .select()
      .from(brokerAdapterCertStates)
      .where(eq(brokerAdapterCertStates.brokerAccountId, brokerAccountId))
      .get();
    return row ? toState(row) : null;
  }

  listRuns(brokerAccountId: string, limit = 20): BrokerAdapterCertState[] {
    return this.db.db
      .select()
      .from(brokerAdapterCertRuns)
      .where(eq(brokerAdapterCertRuns.brokerAccountId, brokerAccountId))
      .orderBy(desc(brokerAdapterCertRuns.certifiedAt))
      .limit(limit)
      .all()
      .map((row) => ({
        brokerAccountId: row.brokerAccountId,
        certRunId: row.id,
        brokerType: row.brokerType,
        mode: row.mode as BrokerAdapterCertState["mode"],
        passed: row.passed,
        checks: parseChecks(row.checksJson),
        certifiedAt: row.certifiedAt,
        updatedAt: row.certifiedAt,
      }));
  }

  /** Upsert latest state and append immutable history row. */
  saveResult(
    brokerAccountId: string,
    report: AdapterCertReport,
    certifiedAt = new Date().toISOString(),
  ): BrokerAdapterCertState {
    const certRunId = crypto.randomUUID();
    const checksJson = JSON.stringify(report.checks);
    const stateRow = {
      brokerAccountId,
      certRunId,
      brokerType: report.brokerType,
      mode: report.mode,
      passed: report.passed,
      checksJson,
      certifiedAt,
      updatedAt: certifiedAt,
    };

    this.db.db
      .insert(brokerAdapterCertStates)
      .values(stateRow)
      .onConflictDoUpdate({
        target: brokerAdapterCertStates.brokerAccountId,
        set: stateRow,
      })
      .run();

    this.db.db
      .insert(brokerAdapterCertRuns)
      .values({
        id: certRunId,
        brokerAccountId,
        brokerType: report.brokerType,
        mode: report.mode,
        passed: report.passed,
        checksJson,
        certifiedAt,
      })
      .run();

    return toState(stateRow);
  }
}
