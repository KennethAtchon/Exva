/**
 * Aggregates over `session_activity_transitions` for the Activity analytics view.
 * See docs/feature-requests/session-activity-indicator.md (v2 history dashboards).
 */

import type {
  SessionActivityConditionKind,
  SessionActivitySeverity,
  SessionActivitySnapshot,
} from "./session-activity";

export interface SessionActivityAnalytics {
  transitionCount: number;
  /** How many transitions included each condition kind. */
  conditionFrequency: Partial<Record<SessionActivityConditionKind, number>>;
  /** Approximate ms spent with each condition active (from consecutive snapshots). */
  timeInConditionMs: Partial<Record<SessionActivityConditionKind, number>>;
  severityCounts: Record<SessionActivitySeverity, number>;
  /** Times an error-severity condition disappeared between consecutive snapshots. */
  errorClears: number;
  /** Mean duration of error conditions that cleared; null if none. */
  avgErrorDurationMs: number | null;
  /** Window covered by the transition sample. */
  window: { from: string | null; to: string | null };
}

function emptySeverityCounts(): Record<SessionActivitySeverity, number> {
  return { info: 0, attention: 0, warn: 0, error: 0 };
}

/** Elapsed ms between two ISO timestamps; null if either parse fails. */
function elapsedMs(from: string, to: string | number): number | null {
  const fromMs = Date.parse(from);
  const toMs = typeof to === "number" ? to : Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.max(0, toMs - fromMs);
}

/**
 * `transitions` should be newest-first (repo order). Analytics walks oldest→newest.
 */
export function computeSessionActivityAnalytics(
  transitions: SessionActivitySnapshot[],
): SessionActivityAnalytics {
  const chronological = [...transitions].reverse();
  const conditionFrequency: Partial<
    Record<SessionActivityConditionKind, number>
  > = {};
  const timeInConditionMs: Partial<
    Record<SessionActivityConditionKind, number>
  > = {};
  const severityCounts = emptySeverityCounts();
  let errorClears = 0;
  let errorDurationSumMs = 0;
  let errorDurationSamples = 0;

  for (let i = 0; i < chronological.length; i++) {
    const row = chronological[i]!;
    const next = chronological[i + 1];
    const deltaMs =
      elapsedMs(row.updatedAt, next ? next.updatedAt : Date.now()) ?? 0;
    const nextKinds = next
      ? new Set(next.conditions.map((c) => c.kind))
      : null;

    for (const condition of row.conditions) {
      conditionFrequency[condition.kind] =
        (conditionFrequency[condition.kind] ?? 0) + 1;
      severityCounts[condition.severity] += 1;
      timeInConditionMs[condition.kind] =
        (timeInConditionMs[condition.kind] ?? 0) + deltaMs;

      if (
        nextKinds &&
        condition.severity === "error" &&
        !nextKinds.has(condition.kind)
      ) {
        errorClears += 1;
        const clearedMs = elapsedMs(condition.since, next!.updatedAt);
        if (clearedMs != null) {
          errorDurationSumMs += clearedMs;
          errorDurationSamples += 1;
        }
      }
    }
  }

  return {
    transitionCount: transitions.length,
    conditionFrequency,
    timeInConditionMs,
    severityCounts,
    errorClears,
    avgErrorDurationMs:
      errorDurationSamples > 0
        ? errorDurationSumMs / errorDurationSamples
        : null,
    window: {
      from: chronological[0]?.updatedAt ?? null,
      to: chronological[chronological.length - 1]?.updatedAt ?? null,
    },
  };
}
