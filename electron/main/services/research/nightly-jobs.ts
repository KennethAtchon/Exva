import { createLogger } from "../infra/log";
import type { CalibrationService } from "../signals/forecast/calibration-service";

const logger = createLogger("nightly-research-jobs");

export interface NightlyResearchJobDeps {
  /** Optional calibration store; refresh is a no-op stub until labels are wired. */
  calibration?: CalibrationService;
  /**
   * Hook: LabelBuilderService.runDue — resolve forward returns for due
   * observations. Pass when the research label pipeline is ready.
   */
  runLabelBuilder?: () => Promise<void>;
  /**
   * Hook: period-autopsy generation for the prior calendar day / rolling window.
   * Pass when PeriodAutopsyService exposes a nightly entrypoint.
   */
  runPeriodAutopsy?: () => Promise<void>;
}

/**
 * Once-per-day research maintenance. Today: calibration refresh stub +
 * optional label-builder / period-autopsy hooks. Safe to call from the
 * supervisor tick (caller should gate on a 24h interval).
 */
export async function runNightlyResearchJobs(
  deps: NightlyResearchJobDeps,
): Promise<void> {
  logger.info("nightly research jobs: starting");

  // Calibration refresh stub — full recompute needs labeled observations from
  // the label builder; until then we just touch the service so wiring is live.
  if (deps.calibration) {
    deps.calibration.refresh("nightly-stub", "0", [], new Date().toISOString());
    logger.info("nightly research jobs: calibration stub refreshed");
  }

  if (deps.runLabelBuilder) {
    try {
      await deps.runLabelBuilder();
      logger.info("nightly research jobs: label builder completed");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: label builder failed");
    }
  } else {
    logger.debug(
      "nightly research jobs: label-builder hook not configured (skip)",
    );
  }

  if (deps.runPeriodAutopsy) {
    try {
      await deps.runPeriodAutopsy();
      logger.info("nightly research jobs: period autopsy completed");
    } catch (err) {
      logger.warn({ err }, "nightly research jobs: period autopsy failed");
    }
  } else {
    logger.debug(
      "nightly research jobs: period-autopsy hook not configured (skip)",
    );
  }

  logger.info("nightly research jobs: done");
}
