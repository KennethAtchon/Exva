import type { SignalLabel, SignalObservation } from "@electron/shared/domain";
import type { SignalObservationsRepo } from "../../db/repositories/research/signal-observations-repo";
import type { SignalLabelsRepo } from "../../db/repositories/research/signal-labels-repo";
import type { Logger } from "../infra/log";

/**
 * Realized forward returns for an observation, resolved from market data once
 * the label horizon has passed. `costBps` is the realized round-trip cost; the
 * service derives net return = gross - cost.
 */
export interface ForwardReturn {
  grossReturnBps: number;
  costBps: number;
  benchmarkReturnBps: number | null;
  maxFavorableBps: number | null;
  maxAdverseBps: number | null;
  /** 1 if the target outcome occurred, 0 otherwise; null for non-binary. */
  outcomeWin: number | null;
}

export type ForwardReturnResolver = (
  observation: SignalObservation,
) => Promise<ForwardReturn | null>;

interface LabelBuilderDeps {
  observations: SignalObservationsRepo;
  labels: SignalLabelsRepo;
  logger: Logger;
}

/**
 * Turns label-ready observations into trainable research data (P2). Runs on a
 * cadence; idempotent (skips observations that already have a label).
 */
export class LabelBuilderService {
  constructor(private readonly deps: LabelBuilderDeps) {}

  async runDue(
    resolver: ForwardReturnResolver,
    nowIso = new Date().toISOString(),
    limit = 500,
  ): Promise<{ labeled: number; skipped: number }> {
    const due = this.deps.observations.listLabelReady(nowIso, limit);
    let labeled = 0;
    let skipped = 0;

    for (const observation of due) {
      const existing = this.deps.labels.get(
        observation.id,
        observation.labelHorizon,
        observation.labelBenchmark,
      );
      if (existing) {
        skipped += 1;
        continue;
      }

      let forward: ForwardReturn | null;
      try {
        forward = await resolver(observation);
      } catch (err) {
        this.deps.logger.warn(
          { err, observationId: observation.id },
          "label resolver failed",
        );
        skipped += 1;
        continue;
      }
      if (!forward) {
        skipped += 1;
        continue;
      }

      const label: SignalLabel = {
        observationId: observation.id,
        horizon: observation.labelHorizon,
        benchmark: observation.labelBenchmark,
        grossReturnBps: forward.grossReturnBps,
        costBps: forward.costBps,
        netReturnBps: forward.grossReturnBps - forward.costBps,
        benchmarkReturnBps: forward.benchmarkReturnBps,
        maxFavorableBps: forward.maxFavorableBps,
        maxAdverseBps: forward.maxAdverseBps,
        outcomeWin: forward.outcomeWin,
        labelReadyAt: observation.labelReadyAt ?? nowIso,
        createdAt: nowIso,
      };
      this.deps.labels.upsert(label);
      labeled += 1;
    }

    return { labeled, skipped };
  }
}
