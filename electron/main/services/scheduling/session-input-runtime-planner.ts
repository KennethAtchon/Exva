import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  experienceTemplateRevisions,
  sessionInputSubscriptions,
} from "../../db/schema";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  parseCadence,
  type CadenceSpec,
} from "@electron/shared/domain/experience-inputs/cadence";
import type { StrategyDefinitionRegistry } from "../strategies/strategy-definition-registry";
import { computeScheduleGroupKey } from "./schedule-group-key";
import { createLogger } from "../infra/log";
import { safeJsonParse } from "../infra/safe-json-parse";

const logger = createLogger("session-input-runtime-planner");

// ---------------------------------------------------------------------------
// Runtime plan shape
// ---------------------------------------------------------------------------

/**
 * A coalesced execution group for the V2 scheduler.
 *
 * Subscriptions whose parameters produce the same `groupKey` are merged into
 * a single `ScheduledRuntimePlan`. The executor runs once per plan and the
 * coordinator fans the resulting signals out to all `subscriptionIds`.
 */
export interface ScheduledRuntimePlan {
  groupKey: string;
  templateId: string;
  templateVersion: number;
  pipelineId: string;
  strategyId: string;
  strategyImplementationVersion: number;
  instrumentSetId: string;
  instrumentSetRevision: number;
  cadence: CadenceSpec;
  analysisTimeframe: TradingTimeframe;
  marketCalendarId: string;
  strategyParameters: Record<string, unknown>;
  /** All subscription IDs that map to this group. */
  subscriptionIds: string[];
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface SessionInputRuntimePlannerDeps {
  db: DbClient;
  strategyRegistry: StrategyDefinitionRegistry;
}

/**
 * Load all enabled `scheduled_scan` subscriptions from the database and
 * collapse them into `ScheduledRuntimePlan`s keyed by group hash.
 *
 * Resolution chain:
 * 1. Load subscription rows where `mode = 'scheduled_scan' AND enabled = 1`.
 * 2. For each subscription, look up the `experience_template_revisions` row to
 *    resolve `pipelineId` and `strategyId`.
 * 3. Look up `strategyId` in the registry to get `implementationVersion`.
 * 4. Compute `groupKey` = SHA-256 of all scheduling parameters.
 * 5. Merge subscriptions with the same key into one plan.
 *
 * Subscriptions that reference an unknown template revision or disabled /
 * missing strategy are skipped (logged as warnings).
 */
export class SessionInputRuntimePlanner {
  constructor(private readonly deps: SessionInputRuntimePlannerDeps) {}

  buildPlans(): ScheduledRuntimePlan[] {
    const { db, strategyRegistry } = this.deps;

    const rows = db.db
      .select()
      .from(sessionInputSubscriptions)
      .where(
        and(
          eq(sessionInputSubscriptions.mode, "scheduled_scan"),
          eq(sessionInputSubscriptions.enabled, true),
        ),
      )
      .all();

    const groupMap = new Map<string, ScheduledRuntimePlan>();

    for (const row of rows) {
      const {
        id: subscriptionId,
        templateId,
        templateVersion,
        instrumentSetId,
        instrumentSetRevision,
        cadenceJson,
        analysisTimeframe,
        marketCalendarId,
        strategyParametersJson,
      } = row;

      // Validate required scheduled-scan columns are present.
      if (
        !instrumentSetId ||
        instrumentSetRevision === null ||
        instrumentSetRevision === undefined ||
        !cadenceJson ||
        !analysisTimeframe ||
        !marketCalendarId ||
        !strategyParametersJson
      ) {
        logger.warn(
          { subscriptionId },
          "subscription is missing required scheduled_scan fields — skipped",
        );
        continue;
      }

      // Resolve template revision for pipelineId / strategyId.
      const templateRev = db.db
        .select()
        .from(experienceTemplateRevisions)
        .where(
          and(
            eq(experienceTemplateRevisions.templateId, templateId),
            eq(experienceTemplateRevisions.version, templateVersion),
          ),
        )
        .get();

      if (!templateRev) {
        logger.warn(
          { subscriptionId, templateId, templateVersion },
          "template revision not found — skipped",
        );
        continue;
      }

      const { pipelineId, strategyId } = templateRev;

      if (!strategyId) {
        logger.warn(
          { subscriptionId, templateId, templateVersion },
          "template has no strategyId — skipped",
        );
        continue;
      }

      // Resolve implementation version from registry.
      const strategyDef = strategyRegistry.get(strategyId);
      if (!strategyDef) {
        logger.warn(
          { subscriptionId, strategyId },
          "strategy not registered — skipped",
        );
        continue;
      }
      if (strategyDef.implementationStatus === "disabled") {
        logger.warn(
          { subscriptionId, strategyId },
          "strategy is disabled — skipped",
        );
        continue;
      }

      // Parse cadence and strategy parameters.
      let cadence: CadenceSpec;
      try {
        const cadenceRaw = safeJsonParse(
          cadenceJson,
          undefined,
          "session-input-runtime-planner.cadence",
        );
        if (cadenceRaw == null) throw new Error("cadenceJson parse failed");
        cadence = parseCadence(cadenceRaw);
      } catch (err) {
        logger.warn({ subscriptionId, err }, "invalid cadenceJson — skipped");
        continue;
      }

      const strategyParameters =
        safeJsonParse<Record<string, unknown>>(
          strategyParametersJson,
          undefined,
          "session-input-runtime-planner.strategyParameters",
        ) ?? {};

      const groupKey = computeScheduleGroupKey({
        templateId,
        templateVersion,
        pipelineId,
        strategyId,
        strategyImplementationVersion: strategyDef.implementationVersion,
        instrumentSetId,
        instrumentSetRevision,
        cadence,
        analysisTimeframe,
        marketCalendarId,
        strategyParameters,
      });

      const existing = groupMap.get(groupKey);
      if (existing) {
        existing.subscriptionIds.push(subscriptionId);
      } else {
        groupMap.set(groupKey, {
          groupKey,
          templateId,
          templateVersion,
          pipelineId,
          strategyId,
          strategyImplementationVersion: strategyDef.implementationVersion,
          instrumentSetId,
          instrumentSetRevision,
          cadence,
          analysisTimeframe: analysisTimeframe as TradingTimeframe,
          marketCalendarId,
          strategyParameters,
          subscriptionIds: [subscriptionId],
        });
      }
    }

    return [...groupMap.values()];
  }
}
