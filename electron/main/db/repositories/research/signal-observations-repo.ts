import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import type { DbClient } from "../../client";
import { signalObservations } from "../../schema";
import type {
  InstrumentClass,
  SignalObservation,
} from "@electron/shared/domain";
import type {
  LabelBenchmark,
  LabelHorizon,
} from "@electron/shared/domain/research-contract";
import type { ObservationAction } from "@electron/shared/domain/signal-observation";

type Row = typeof signalObservations.$inferSelect;

function toObservation(row: Row): SignalObservation {
  return {
    id: row.id,
    sessionId: row.sessionId,
    experienceId: row.experienceId,
    signalId: row.signalId,
    cycleId: row.cycleId,
    instrumentSymbol: row.instrumentSymbol,
    instrumentClass: row.instrumentClass as InstrumentClass,
    action: row.action as ObservationAction,
    eventTime: row.eventTime,
    observedAt: row.observedAt,
    sourceUri: row.sourceUri,
    featureJson: row.featureJson,
    decisionJson: row.decisionJson,
    modelVersion: row.modelVersion,
    labelHorizon: row.labelHorizon as LabelHorizon,
    labelBenchmark: row.labelBenchmark as LabelBenchmark,
    referencePrice: row.referencePrice,
    labelReadyAt: row.labelReadyAt,
    createdAt: row.createdAt,
  };
}

export class SignalObservationsRepo {
  constructor(private readonly client: DbClient) {}

  insert(observation: SignalObservation): void {
    this.client.db.insert(signalObservations).values(observation).run();
  }

  get(id: string): SignalObservation | null {
    const row = this.client.db
      .select()
      .from(signalObservations)
      .where(eq(signalObservations.id, id))
      .get();
    return row ? toObservation(row) : null;
  }

  listByExperience(experienceId: string): SignalObservation[] {
    return this.client.db
      .select()
      .from(signalObservations)
      .where(eq(signalObservations.experienceId, experienceId))
      .orderBy(asc(signalObservations.eventTime))
      .all()
      .map(toObservation);
  }

  /**
   * Observations whose label is ready (labelReadyAt <= now) and that do not yet
   * have a label row — the LabelBuilder's work queue.
   */
  listLabelReady(nowIso: string, limit = 500): SignalObservation[] {
    return this.client.db
      .select()
      .from(signalObservations)
      .where(
        and(
          isNotNull(signalObservations.labelReadyAt),
          lte(signalObservations.labelReadyAt, nowIso),
        ),
      )
      .orderBy(asc(signalObservations.labelReadyAt))
      .limit(limit)
      .all()
      .map(toObservation);
  }
}
