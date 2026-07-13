import type { ScheduledRuntimePlan } from "./session-input-runtime-planner";
import type { ScheduledScan } from "../signals/scheduler/session-scheduler";

// ---------------------------------------------------------------------------
// Shadow-mode diagnostics: compare legacy SessionScheduler scans to V2 plans
// ---------------------------------------------------------------------------

export interface PlanDiff {
  kind: "only_in_legacy" | "only_in_v2" | "matched" | "parameter_mismatch";
  groupKey: string | null;
  legacyScanId: string | null;
  v2SubscriptionIds: string[];
  details: string[];
}

/**
 * Compare a set of legacy `ScheduledScan`s (from `SessionScheduler`) to a set
 * of V2 `ScheduledRuntimePlan`s and return a diff report.
 *
 * Matching heuristic: scans and plans are compared on `analysisTimeframe` and
 * `cadence`. This is approximate — the V2 plans carry richer keys — but is
 * sufficient for diagnosing migration discrepancies.
 *
 * This function is intentionally read-only and side-effect-free. Call it
 * during startup (after reconcile) to surface mismatches in logs.
 */
export function compareLegacyVsV2Plans(
  legacyScans: ScheduledScan[],
  v2Plans: ScheduledRuntimePlan[],
): PlanDiff[] {
  const diffs: PlanDiff[] = [];

  // Build a lookup of V2 plans by (analysisTimeframe, cadence label).
  const v2ByKey = new Map<string, ScheduledRuntimePlan[]>();
  for (const plan of v2Plans) {
    const cadenceStr =
      plan.cadence.kind === "interval"
        ? `${plan.cadence.every}${unitAbbrev(plan.cadence.unit)}`
        : plan.cadence.expression;
    const key = `${plan.analysisTimeframe}__${cadenceStr}`;
    const bucket = v2ByKey.get(key) ?? [];
    bucket.push(plan);
    v2ByKey.set(key, bucket);
  }

  const matchedGroupKeys = new Set<string>();

  for (const scan of legacyScans) {
    const key = `${scan.analysisTimeframe}__${scan.schedule.cadence}`;
    const matches = v2ByKey.get(key) ?? [];
    if (matches.length === 0) {
      diffs.push({
        kind: "only_in_legacy",
        groupKey: null,
        legacyScanId: scan.id,
        v2SubscriptionIds: [],
        details: [
          `Legacy scan "${scan.id}" (${scan.analysisTimeframe} / ${scan.schedule.cadence}) has no V2 counterpart.`,
        ],
      });
    } else {
      for (const plan of matches) {
        matchedGroupKeys.add(plan.groupKey);
        const details: string[] = [];

        if (scan.analysisTimeframe !== plan.analysisTimeframe) {
          details.push(
            `analysisTimeframe: legacy="${scan.analysisTimeframe}" vs v2="${plan.analysisTimeframe}"`,
          );
        }

        diffs.push({
          kind: details.length === 0 ? "matched" : "parameter_mismatch",
          groupKey: plan.groupKey,
          legacyScanId: scan.id,
          v2SubscriptionIds: plan.subscriptionIds,
          details,
        });
      }
    }
  }

  // V2 plans with no legacy counterpart.
  for (const plan of v2Plans) {
    if (!matchedGroupKeys.has(plan.groupKey)) {
      diffs.push({
        kind: "only_in_v2",
        groupKey: plan.groupKey,
        legacyScanId: null,
        v2SubscriptionIds: plan.subscriptionIds,
        details: [
          `V2 plan groupKey=${plan.groupKey.slice(0, 12)} (${plan.analysisTimeframe} / ${plan.strategyId}) has no legacy counterpart.`,
        ],
      });
    }
  }

  return diffs;
}

/**
 * Log the diff report to the console at the appropriate severity level.
 * Mismatches and orphans are printed at WARN; matched groups at DEBUG.
 */
export function logPlanDiffs(diffs: PlanDiff[]): void {
  for (const diff of diffs) {
    if (diff.kind === "matched") {
      // Debug-level; intentionally omitted to avoid log noise in production.
      continue;
    }
    const prefix = `[ShadowMode] ${diff.kind.toUpperCase()}`;
    const id = diff.groupKey
      ? `groupKey=${diff.groupKey.slice(0, 12)}`
      : `scanId=${diff.legacyScanId}`;
    if (diff.details.length > 0) {
      console.warn(`${prefix} ${id}:`);
      for (const detail of diff.details) {
        console.warn(`  ${detail}`);
      }
    } else {
      console.warn(`${prefix} ${id}`);
    }
  }
}

function unitAbbrev(unit: "minute" | "hour" | "day"): string {
  return unit === "minute" ? "m" : unit === "hour" ? "h" : "d";
}
