import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../client";
import { signalLabels } from "../../schema";
import type { SignalLabel } from "@electron/shared/domain";
import type {
  LabelBenchmark,
  LabelHorizon,
} from "@electron/shared/domain/research-contract";

type Row = typeof signalLabels.$inferSelect;

function toLabel(row: Row): SignalLabel {
  return {
    observationId: row.observationId,
    horizon: row.horizon as LabelHorizon,
    benchmark: row.benchmark as LabelBenchmark,
    grossReturnBps: row.grossReturnBps,
    costBps: row.costBps,
    netReturnBps: row.netReturnBps,
    benchmarkReturnBps: row.benchmarkReturnBps,
    maxFavorableBps: row.maxFavorableBps,
    maxAdverseBps: row.maxAdverseBps,
    outcomeWin: row.outcomeWin,
    labelReadyAt: row.labelReadyAt,
    createdAt: row.createdAt,
  };
}

export class SignalLabelsRepo {
  constructor(private readonly client: DbClient) {}

  upsert(label: SignalLabel): void {
    this.client.db
      .insert(signalLabels)
      .values(label)
      .onConflictDoUpdate({
        target: [
          signalLabels.observationId,
          signalLabels.horizon,
          signalLabels.benchmark,
        ],
        set: {
          grossReturnBps: label.grossReturnBps,
          costBps: label.costBps,
          netReturnBps: label.netReturnBps,
          benchmarkReturnBps: label.benchmarkReturnBps,
          maxFavorableBps: label.maxFavorableBps,
          maxAdverseBps: label.maxAdverseBps,
          outcomeWin: label.outcomeWin,
        },
      })
      .run();
  }

  get(
    observationId: string,
    horizon: LabelHorizon,
    benchmark: LabelBenchmark,
  ): SignalLabel | null {
    const row = this.client.db
      .select()
      .from(signalLabels)
      .where(
        and(
          eq(signalLabels.observationId, observationId),
          eq(signalLabels.horizon, horizon),
          eq(signalLabels.benchmark, benchmark),
        ),
      )
      .get();
    return row ? toLabel(row) : null;
  }

  listByObservation(observationId: string): SignalLabel[] {
    return this.client.db
      .select()
      .from(signalLabels)
      .where(eq(signalLabels.observationId, observationId))
      .all()
      .map(toLabel);
  }
}
