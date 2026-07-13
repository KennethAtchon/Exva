import { createLogger } from "../infra/log";
import type {
  CalibrationService,
  LabelObservation,
} from "../signals/forecast/calibration-service";

const logger = createLogger("nightly-research-jobs");

export interface NightlyResearchJobDeps {
  /** Optional calibration store. */
  calibration?: CalibrationService;
  /**
   * Load labeled forecast outcomes for calibration refresh.
   * When omitted (or returns empty), falls back to an empty stub refresh so
   * wiring stays live.
   */
  loadCalibrationLabels?: () => Array<{
    modelId: string;
    modelVersion: string;
    labels: LabelObservation[];
  }>;
  /**
   * Hook: LabelBuilderService.runDue — resolve forward returns for due
   * observations. Pass when the research label pipeline is ready.
   */
  runLabelBuilder?: () => Promise<void>;
  /**
   * Hook: period-autopsy for the prior calendar day.
   * May return a one-line digest fragment; otherwise "period-autopsy: ok".
   */
  runPeriodAutopsy?: () => Promise<string | undefined>;
  /** Optional promotion-ladder tick for known experiences. */
  runLadderAutomation?: () => void;
  /** Optional operator digest (ntfy / in-app notification). */
  sendDigest?: (summary: string) => void;
  /** Optional DB snapshot (doc 04 T1 nightly backup). */
  runDbBackup?: () => Promise<string | undefined> | string | undefined;
}

/**
 * Once-per-day research maintenance. Calibration refresh + optional
 * label-builder / period-autopsy / ladder hooks. Safe to call from the
 * supervisor tick (caller should gate on a 24h interval).
 */
export async function runNightlyResearchJobs(
  deps: NightlyResearchJobDeps,
): Promise<void> {
  logger.info("nightly research jobs: starting");
  const parts: string[] = [];

  if (deps.calibration) {
    const groups = deps.loadCalibrationLabels?.() ?? [];
    if (groups.length > 0) {
      let totalLabels = 0;
      for (const group of groups) {
        deps.calibration.refresh(
          group.modelId,
          group.modelVersion,
          group.labels,
          new Date().toISOString(),
        );
        totalLabels += group.labels.length;
      }
      logger.info(
        { groups: groups.length, totalLabels },
        "nightly research jobs: calibration refreshed from labels",
      );
      parts.push(
        `calibration: ${totalLabels} labels / ${groups.length} models`,
      );
    } else {
      deps.calibration.refresh(
        "nightly-stub",
        "0",
        [],
        new Date().toISOString(),
      );
      logger.info("nightly research jobs: calibration stub refreshed");
      parts.push("calibration: stub (no labels)");
    }
  } else {
    parts.push("calibration: skipped");
  }

  if (deps.runLabelBuilder) {
    try {
      await deps.runLabelBuilder();
      logger.info("nightly research jobs: label builder completed");
      parts.push("label-builder: ok");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: label builder failed");
      parts.push("label-builder: failed");
    }
  } else {
    logger.debug(
      "nightly research jobs: label-builder hook not configured (skip)",
    );
    parts.push("label-builder: skip");
  }

  if (deps.runPeriodAutopsy) {
    try {
      const autopsyLine = await deps.runPeriodAutopsy();
      logger.info("nightly research jobs: period autopsy completed");
      parts.push(autopsyLine?.trim() || "period-autopsy: ok");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: period autopsy failed");
      parts.push("period-autopsy: failed");
    }
  } else {
    logger.debug(
      "nightly research jobs: period-autopsy hook not configured (skip)",
    );
    parts.push("period-autopsy: skip");
  }

  if (deps.runLadderAutomation) {
    try {
      deps.runLadderAutomation();
      logger.info("nightly research jobs: ladder automation ticked");
      parts.push("ladder: ok");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: ladder automation failed");
      parts.push("ladder: failed");
    }
  } else {
    parts.push("ladder: skip");
  }

  if (deps.runDbBackup) {
    try {
      const backupLine = await deps.runDbBackup();
      logger.info("nightly research jobs: db backup completed");
      parts.push(backupLine?.trim() || "db-backup: ok");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: db backup failed");
      parts.push("db-backup: failed");
    }
  } else {
    parts.push("db-backup: skip");
  }

  const summary = `Nightly research: ${parts.join("; ")}`;
  logger.info({ summary }, "nightly research jobs: done");
  deps.sendDigest?.(summary);
}
