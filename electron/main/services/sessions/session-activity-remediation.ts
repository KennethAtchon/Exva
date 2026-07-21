/**
 * Auto-remediation for ERROR session-activity conditions.
 * Kept outside SessionActivityTracker so detectors stay observational.
 * See docs/feature-requests/session-activity-indicator.md.
 */

import type { SessionActivityCondition } from "@electron/shared/domain/session-activity";
import { ensureLiveSignalSources } from "../../experiences/ensure-live-signal-sources";
import type { SessionInputSubscriptionRepo } from "../session-inputs/session-input-subscription-repo";
import type { SourceDefinitionRepo } from "../signals/source-definition-repo";
import type { SignalSourcesRepo } from "../signals/repos/signal-sources-repo";
import type { SignalSourceRegistry } from "../signals/signal-source-registry";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import { createLogger } from "../infra/log";

const logger = createLogger("session-activity-remediation");

const AUTO_PAUSE_KINDS = new Set([
  "data_feed_failing",
  "runtime_crash_loop",
  "calendar_misconfigured",
  "spend_limit_hit",
]);

export interface SessionActivityRemediationDeps {
  subscriptionRepo: SessionInputSubscriptionRepo;
  sourceDefinitionRepo: SourceDefinitionRepo;
  signalSourcesRepo: SignalSourcesRepo;
  signalRegistry: SignalSourceRegistry;
  events: EventsRepo;
  pauseSession: (sessionId: string, reason: string) => Promise<void>;
  getSessionStatus: (sessionId: string) => string;
}

export async function remediateSessionActivityCondition(
  deps: SessionActivityRemediationDeps,
  sessionId: string,
  condition: SessionActivityCondition,
): Promise<void> {
  if (condition.severity !== "error") return;

  if (condition.kind === "input_source_dead") {
    await restartDeadInputSources(deps, sessionId, condition.message);
    return;
  }

  if (AUTO_PAUSE_KINDS.has(condition.kind)) {
    await autoPauseSession(deps, sessionId, condition);
  }
}

async function restartDeadInputSources(
  deps: SessionActivityRemediationDeps,
  sessionId: string,
  reason: string,
): Promise<void> {
  ensureLiveSignalSources(deps.signalSourcesRepo, deps.signalRegistry);

  const sourceKinds = collectEventSourceKinds(deps, sessionId);
  const restarted: string[] = [];

  for (const source of deps.signalSourcesRepo.list()) {
    if (!source.enabled || !sourceKinds.has(source.type)) continue;

    if (!deps.signalRegistry.get(source.id)) {
      deps.signalRegistry.create(source);
    }
    if (deps.signalRegistry.status(source.id)?.status === "running") continue;

    try {
      await deps.signalRegistry.start(source.id);
      restarted.push(source.id);
    } catch (err) {
      logger.error(
        { err, sessionId, sourceId: source.id },
        "auto-remediation failed to start signal source",
      );
    }
  }

  const recovered = restarted.length > 0;
  deps.events.insert({
    session_id: sessionId,
    trade_id: null,
    level: recovered ? "WARN" : "ERROR",
    agent_type: "session",
    message: recovered
      ? `Auto-remediation restarted signal source(s): ${restarted.join(", ")} (${reason})`
      : `Auto-remediation attempted input_source_dead recovery but found no startable sources (${reason})`,
  });

  logger.warn({ sessionId, restarted }, "session activity auto-remediation");
}

function collectEventSourceKinds(
  deps: SessionActivityRemediationDeps,
  sessionId: string,
): Set<string> {
  const kinds = new Set<string>();
  for (const sub of deps.subscriptionRepo.listEnabledBySession(sessionId)) {
    if (sub.mode !== "event_source") continue;
    const definition = deps.sourceDefinitionRepo.get(sub.sourceDefinitionId);
    if (definition) kinds.add(definition.kind);
  }
  return kinds;
}

async function autoPauseSession(
  deps: SessionActivityRemediationDeps,
  sessionId: string,
  condition: SessionActivityCondition,
): Promise<void> {
  const status = deps.getSessionStatus(sessionId);
  if (status !== "active" && status !== "attention_required") return;

  const reason = `${condition.kind}: ${condition.message}`;
  try {
    await deps.pauseSession(sessionId, reason);
    deps.events.insert({
      session_id: sessionId,
      trade_id: null,
      level: "ERROR",
      agent_type: "session",
      message: `Auto-remediation paused session — ${reason}`,
    });
    logger.warn(
      { sessionId, kind: condition.kind },
      "session activity auto-paused session",
    );
  } catch (err) {
    logger.error(
      { err, sessionId, kind: condition.kind },
      "session activity auto-pause failed",
    );
  }
}
