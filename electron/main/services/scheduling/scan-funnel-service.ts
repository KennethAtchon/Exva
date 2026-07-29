/**
 * Scan funnel reads (Solution 05 / 06 WS4).
 *
 * The scheduler already records why each instrument in a scan failed to reach
 * a decision, but the summary only lived in `schedule_runtime_states` and the
 * log line. This service turns it into a per-session read so "no trades" can
 * be answered without a sqlite prompt.
 *
 * Only `signal` and `no_setup` mean the strategy actually evaluated. The other
 * kinds mean the lane never got to decide — a data or configuration defect,
 * not a market opinion.
 */

import type {
  ScanFunnelGroup,
  ScanFunnelReport,
  ScanInstrumentOutcome,
} from "@electron/shared/domain/scan-funnel";
import type { DbClient } from "../../db/client";
import { scheduleRuntimeStates } from "../../db/schema";
import type { ScheduleCoordinator } from "./schedule-coordinator";
import { UNEVALUABLE_KINDS } from "./scheduled-strategy-executor";
import { createLogger } from "../infra/log";

const logger = createLogger("scan-funnel");

interface ParsedSummary {
  signalCount: number;
  instrumentCount: number;
  counts: Record<string, number>;
  instruments: ScanInstrumentOutcome[];
}

const EMPTY_SUMMARY: ParsedSummary = {
  signalCount: 0,
  instrumentCount: 0,
  counts: {},
  instruments: [],
};

function parseSummary(json: string | null): ParsedSummary {
  if (!json) return EMPTY_SUMMARY;
  try {
    const raw = JSON.parse(json) as Partial<ParsedSummary>;
    return {
      signalCount: raw.signalCount ?? 0,
      instrumentCount: raw.instrumentCount ?? 0,
      counts: raw.counts ?? {},
      instruments: Array.isArray(raw.instruments) ? raw.instruments : [],
    };
  } catch (err) {
    logger.warn({ err }, "unparseable scan summary json");
    return EMPTY_SUMMARY;
  }
}

function parseSubscriptionIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export interface ScanFunnelServiceDeps {
  db: DbClient;
  coordinator: ScheduleCoordinator;
  /** Same resolver the coordinator uses to fan a group out to sessions. */
  resolveScheduledFanout: (
    subscriptionIds: string[],
  ) => Array<{ sessionId: string; subscriptionId: string }>;
}

export class ScanFunnelService {
  constructor(private readonly deps: ScanFunnelServiceDeps) {}

  /**
   * Persisted state is the source of truth so a restarted app still explains
   * yesterday's silence; live coordinator telemetry supplies armed/running.
   */
  forSession(sessionId: string): ScanFunnelReport {
    const { db, coordinator, resolveScheduledFanout } = this.deps;
    const armedGroups = new Map(
      coordinator.snapshot().map((entry) => [entry.groupKey, entry]),
    );

    const rows = db.db.select().from(scheduleRuntimeStates).all();
    const groups: ScanFunnelGroup[] = [];

    for (const row of rows) {
      const subscriptionIds = parseSubscriptionIds(row.subscriptionIdsJson);
      const servesSession = resolveScheduledFanout(subscriptionIds).some(
        (f) => f.sessionId === sessionId,
      );
      if (!servesSession) continue;

      const summary = parseSummary(row.lastScanSummaryJson);
      const live = armedGroups.get(row.groupKey);
      const firstBlocked =
        summary.instruments.find((i) => UNEVALUABLE_KINDS.has(i.kind)) ?? null;

      groups.push({
        groupKey: row.groupKey,
        armed: live !== undefined,
        running: live?.running ?? false,
        nextRunAt: live?.nextRunAt ?? row.nextRunAt,
        lastStartedAt: row.lastStartedAt,
        lastFinishedAt: row.lastFinishedAt,
        lastSuccessAt: row.lastSuccessAt,
        lastDurationMs: row.lastDurationMs,
        consecutiveFailures: row.consecutiveFailures,
        lastError: row.lastError,
        signalCount: summary.signalCount,
        instrumentCount: summary.instrumentCount,
        counts: summary.counts,
        instruments: summary.instruments,
        firstBlocked,
        allUnevaluable:
          summary.instruments.length > 0 &&
          summary.instruments.every((i) => UNEVALUABLE_KINDS.has(i.kind)),
      });
    }

    const counts: Record<string, number> = {};
    for (const group of groups) {
      for (const [kind, n] of Object.entries(group.counts)) {
        counts[kind] = (counts[kind] ?? 0) + n;
      }
    }

    const blockedGroup = groups.find((g) => g.firstBlocked);
    return {
      sessionId,
      groups,
      counts,
      firstBlocked: blockedGroup?.firstBlocked
        ? { ...blockedGroup.firstBlocked, groupKey: blockedGroup.groupKey }
        : null,
      noScheduledInputs: groups.length === 0,
    };
  }
}
