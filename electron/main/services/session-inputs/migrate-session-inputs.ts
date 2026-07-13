import { eq, inArray } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  sessions,
  sessionSignalSources,
  signalSources,
  sessionInputSubscriptions,
  migrationQuarantine,
} from "../../db/schema";
import { INPUT_PROFILE_IDS } from "../experience-catalog/input-profile-seeds";
import { SOURCE_DEFINITION_IDS } from "../signals/source-definition-seeds";
import { TEMPLATE_IDS } from "../experience-catalog/experience-template-seeds";
import { INSTRUMENT_SET_IDS } from "../instruments/instrument-set-seeds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMigrationOutcome {
  sessionId: string;
  status: "migrated" | "quarantined" | "skipped" | "empty";
  subscriptionsCreated: number;
  quarantinedSourceIds: string[];
  notes: string[];
}

export interface MigrationReport {
  total: number;
  migrated: number;
  quarantined: number;
  skipped: number;
  empty: number;
  outcomes: SessionMigrationOutcome[];
}

// ---------------------------------------------------------------------------
// Legacy source ID → profile mapping
// ---------------------------------------------------------------------------

/**
 * Groups of legacy timer source IDs that map to a single V2 scheduled_scan
 * profile. When a session has ANY of the IDs in a group, one subscription
 * (for the shared profile) is created regardless of how many group members
 * the session is subscribed to.
 */
const TIMER_PROFILE_GROUPS: Array<{
  sourceIds: string[];
  profileId: string;
  templateId: string;
  templateVersion: number;
  instrumentSetId: string;
  instrumentSetRevision: number;
  analysisTimeframe: string;
  marketCalendarId: string;
  cadenceJson: string;
  strategyParametersJson: string;
}> = [
  {
    sourceIds: [
      "rules-mean-reversion/spy-15m-meanrev",
      "rules-mean-reversion/qqq-15m-meanrev",
    ],
    profileId: INPUT_PROFILE_IDS.MEAN_REVERSION_DEFAULT,
    templateId: TEMPLATE_IDS.MEAN_REVERSION,
    templateVersion: 1,
    instrumentSetId: INSTRUMENT_SET_IDS.LIQUID_US_ETFS,
    instrumentSetRevision: 1,
    analysisTimeframe: "1h",
    marketCalendarId: "nyse-regular",
    cadenceJson: JSON.stringify({
      kind: "interval",
      every: 15,
      unit: "minute",
      jitterPct: 0.05,
    }),
    strategyParametersJson: JSON.stringify({ zScoreEntry: -2 }),
  },
  {
    sourceIds: ["rules-breakout/btc-1h-breakout"],
    profileId: INPUT_PROFILE_IDS.BREAKOUT_DEFAULT,
    templateId: TEMPLATE_IDS.BREAKOUT,
    templateVersion: 1,
    instrumentSetId: INSTRUMENT_SET_IDS.MAJOR_CRYPTO,
    instrumentSetRevision: 1,
    analysisTimeframe: "4h",
    marketCalendarId: "always-open",
    cadenceJson: JSON.stringify({
      kind: "interval",
      every: 1,
      unit: "hour",
      jitterPct: 0.05,
    }),
    strategyParametersJson: JSON.stringify({}),
  },
  {
    sourceIds: [
      "rules-trend-following/gc-4h-trend",
      "rules-trend-following/cl-4h-trend",
    ],
    profileId: INPUT_PROFILE_IDS.TREND_DEFAULT,
    templateId: TEMPLATE_IDS.TREND_FOLLOWING,
    templateVersion: 1,
    instrumentSetId: INSTRUMENT_SET_IDS.COMMODITIES_FRONT_MONTH,
    instrumentSetRevision: 1,
    analysisTimeframe: "4h",
    marketCalendarId: "always-open",
    cadenceJson: JSON.stringify({
      kind: "interval",
      every: 4,
      unit: "hour",
      jitterPct: 0.05,
    }),
    strategyParametersJson: JSON.stringify({}),
  },
  {
    sourceIds: [
      "options-flow-edge/aapl-options-flow",
      "options-flow-edge/nvda-options-flow",
    ],
    profileId: INPUT_PROFILE_IDS.OPTIONS_FLOW_DEFAULT,
    templateId: TEMPLATE_IDS.OPTIONS_FLOW,
    templateVersion: 1,
    instrumentSetId: INSTRUMENT_SET_IDS.OPTIONS_FLOW_STOCKS,
    instrumentSetRevision: 1,
    analysisTimeframe: "1d",
    marketCalendarId: "nyse-regular",
    cadenceJson: JSON.stringify({
      kind: "interval",
      every: 15,
      unit: "minute",
      jitterPct: 0.05,
    }),
    strategyParametersJson: JSON.stringify({}),
  },
];

/**
 * Legacy event-source type → V2 source definition mapping.
 */
const EVENT_SOURCE_MAP: Record<
  string,
  {
    sourceDefinitionId: string;
    sourceRevision: number;
    templateId: string;
    templateVersion: number;
    analysisTimeframe: string;
    profileId: string;
  }
> = {
  edgar_8k: {
    sourceDefinitionId: SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
    sourceRevision: 1,
    templateId: TEMPLATE_IDS.EDGAR_CATALYST,
    templateVersion: 1,
    analysisTimeframe: "1d",
    profileId: INPUT_PROFILE_IDS.EDGAR_DEFAULT,
  },
  prediction_event: {
    sourceDefinitionId: SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE,
    sourceRevision: 1,
    templateId: TEMPLATE_IDS.PREDICTION_EVENT,
    templateVersion: 1,
    analysisTimeframe: "1d",
    profileId: INPUT_PROFILE_IDS.PREDICTION_DEFAULT,
  },
  mock: {
    sourceDefinitionId: SOURCE_DEFINITION_IDS.MOCK_REHEARSAL,
    sourceRevision: 1,
    templateId: TEMPLATE_IDS.EDGAR_CATALYST,
    templateVersion: 1,
    analysisTimeframe: "1d",
    profileId: INPUT_PROFILE_IDS.EDGAR_DEFAULT,
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Idempotent, resumable migration from V1 signal sources to V2
 * `session_input_subscriptions`.
 *
 * For each session with `inputMigrationState === 'v1'`:
 * 1. Read the session's joined signal sources.
 * 2. Map timer sources to scheduled_scan subscriptions via the legacy ID table.
 * 3. Map event sources (edgar_8k, prediction_event, mock) to event_source subscriptions.
 * 4. Quarantine unknown / unmappable sources.
 * 5. Mark session as `v2` when all sources are resolved; `quarantined` otherwise.
 *
 * Sessions already at `v2` are skipped.
 */
export function migrateAllSessionInputs(db: DbClient): MigrationReport {
  const report: MigrationReport = {
    total: 0,
    migrated: 0,
    quarantined: 0,
    skipped: 0,
    empty: 0,
    outcomes: [],
  };

  const v1Sessions = db.db
    .select({
      id: sessions.id,
      experienceId: sessions.experienceId,
      sessionInputRevision: sessions.sessionInputRevision,
    })
    .from(sessions)
    .where(eq(sessions.inputMigrationState, "v1"))
    .all();

  report.total = v1Sessions.length;

  for (const session of v1Sessions) {
    const outcome = migrateSession(db, session.id, session.sessionInputRevision);
    report.outcomes.push(outcome);
    if (outcome.status === "migrated") report.migrated++;
    else if (outcome.status === "quarantined") report.quarantined++;
    else if (outcome.status === "skipped") report.skipped++;
    else report.empty++;
  }

  return report;
}

// ---------------------------------------------------------------------------
// Per-session migration
// ---------------------------------------------------------------------------

function migrateSession(
  db: DbClient,
  sessionId: string,
  currentRevision: number,
): SessionMigrationOutcome {
  const outcome: SessionMigrationOutcome = {
    sessionId,
    status: "migrated",
    subscriptionsCreated: 0,
    quarantinedSourceIds: [],
    notes: [],
  };

  // Fetch all signal sources for this session.
  const sourceRows = db.db
    .select({
      sourceId: sessionSignalSources.sourceId,
      type: signalSources.type,
      configJson: signalSources.configJson,
    })
    .from(sessionSignalSources)
    .innerJoin(
      signalSources,
      eq(sessionSignalSources.sourceId, signalSources.id),
    )
    .where(eq(sessionSignalSources.sessionId, sessionId))
    .all();

  if (sourceRows.length === 0) {
    markSessionMigrated(db, sessionId, currentRevision);
    outcome.status = "empty";
    outcome.notes.push("No legacy signal sources — marked v2 with no subscriptions.");
    return outcome;
  }

  // Check which subscriptions already exist (idempotency — skip if already migrated).
  const existingSubscriptions = db.db
    .select({ id: sessionInputSubscriptions.id })
    .from(sessionInputSubscriptions)
    .where(eq(sessionInputSubscriptions.sessionId, sessionId))
    .all();

  if (existingSubscriptions.length > 0) {
    // Already has V2 subscriptions — just flip the state flag if needed.
    markSessionMigrated(db, sessionId, currentRevision);
    outcome.notes.push(
      `Found ${existingSubscriptions.length} existing subscriptions — idempotent re-run.`,
    );
    return outcome;
  }

  const now = new Date().toISOString();
  let anyQuarantined = false;

  // Track which timer groups were already applied for this session.
  const appliedTimerGroups = new Set<string>();

  for (const src of sourceRows) {
    if (src.type === "timer") {
      const group = TIMER_PROFILE_GROUPS.find((g) =>
        g.sourceIds.includes(src.sourceId),
      );

      if (!group) {
        quarantineSource(db, sessionId, src.sourceId, "unknown_timer_source_id", {
          sourceId: src.sourceId,
          type: src.type,
        });
        outcome.quarantinedSourceIds.push(src.sourceId);
        anyQuarantined = true;
        outcome.notes.push(`Unknown timer source "${src.sourceId}" — quarantined.`);
        continue;
      }

      // Each group produces exactly ONE subscription per session.
      if (appliedTimerGroups.has(group.profileId)) {
        outcome.notes.push(
          `Skipped duplicate timer source "${src.sourceId}" — group already applied.`,
        );
        continue;
      }
      appliedTimerGroups.add(group.profileId);

      const subId = crypto.randomUUID();
      db.db
        .insert(sessionInputSubscriptions)
        .values({
          id: subId,
          sessionId,
          templateId: group.templateId,
          templateVersion: group.templateVersion,
          mode: "scheduled_scan",
          enabled: true,
          createdFromProfileId: group.profileId,
          revision: 1,
          instrumentSetId: group.instrumentSetId,
          instrumentSetRevision: group.instrumentSetRevision,
          cadenceJson: group.cadenceJson,
          analysisTimeframe: group.analysisTimeframe,
          marketCalendarId: group.marketCalendarId,
          strategyParametersJson: group.strategyParametersJson,
          usesUnvalidatedUniverse: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      outcome.subscriptionsCreated++;
      outcome.notes.push(
        `Mapped timer "${src.sourceId}" → scheduled_scan subscription (profile: ${group.profileId}).`,
      );
    } else if (src.type === "manual") {
      // Manual mode: no subscription needed — the session uses manual tickers.
      outcome.notes.push(
        `Skipped manual source "${src.sourceId}" — manual mode has no V2 subscription.`,
      );
    } else if (src.type === "web_search") {
      // Deprecated web_search — quarantine.
      quarantineSource(db, sessionId, src.sourceId, "deprecated_web_search", {
        sourceId: src.sourceId,
        type: src.type,
      });
      outcome.quarantinedSourceIds.push(src.sourceId);
      anyQuarantined = true;
      outcome.notes.push(
        `Deprecated web_search source "${src.sourceId}" — quarantined.`,
      );
    } else {
      // Event-source types: edgar_8k, prediction_event, mock.
      const mapping = EVENT_SOURCE_MAP[src.type];

      if (!mapping) {
        quarantineSource(db, sessionId, src.sourceId, "unknown_source_type", {
          sourceId: src.sourceId,
          type: src.type,
        });
        outcome.quarantinedSourceIds.push(src.sourceId);
        anyQuarantined = true;
        outcome.notes.push(
          `Unknown source type "${src.type}" for source "${src.sourceId}" — quarantined.`,
        );
        continue;
      }

      const subId = crypto.randomUUID();
      db.db
        .insert(sessionInputSubscriptions)
        .values({
          id: subId,
          sessionId,
          templateId: mapping.templateId,
          templateVersion: mapping.templateVersion,
          mode: "event_source",
          enabled: true,
          createdFromProfileId: mapping.profileId,
          revision: 1,
          sourceDefinitionId: mapping.sourceDefinitionId,
          sourceRevision: mapping.sourceRevision,
          analysisTimeframe: mapping.analysisTimeframe,
          filtersJson: JSON.stringify({}),
          usesUnvalidatedUniverse: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      outcome.subscriptionsCreated++;
      outcome.notes.push(
        `Mapped ${src.type} source "${src.sourceId}" → event_source subscription (def: ${mapping.sourceDefinitionId}).`,
      );
    }
  }

  if (anyQuarantined) {
    // Partial migration: flip to v2 but note quarantine state in logs.
    // The session can still operate with whatever subscriptions were created.
    outcome.status = "quarantined";
    outcome.notes.push(
      `Session has quarantined sources — review migration_quarantine table.`,
    );
  }

  markSessionMigrated(db, sessionId, currentRevision);
  return outcome;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function markSessionMigrated(
  db: DbClient,
  sessionId: string,
  currentRevision: number,
): void {
  const now = new Date().toISOString();
  db.db
    .update(sessions)
    .set({
      inputMigrationState: "v2",
      sessionInputRevision: currentRevision + 1,
      updatedAt: now,
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

function quarantineSource(
  db: DbClient,
  sessionId: string,
  sourceId: string,
  reason: string,
  detail: Record<string, unknown>,
): void {
  const now = new Date().toISOString();
  db.db
    .insert(migrationQuarantine)
    .values({
      id: crypto.randomUUID(),
      kind: "session_source_migration",
      sessionId,
      sourceId,
      reason,
      detailJson: JSON.stringify(detail),
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
}
