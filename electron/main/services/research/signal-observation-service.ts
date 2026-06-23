import type {
  EdgeEstimate,
  ExperienceResearchContract,
  InstrumentClass,
  ObservationAction,
  SignalObservation,
} from "@electron/shared/domain";
import { labelReadyAt } from "@electron/shared/domain/research-contract";
import type { SignalObservationsRepo } from "../../db/repositories/research/signal-observations-repo";

export interface RecordObservationInput {
  sessionId: string | null;
  experienceId: string;
  signalId: string;
  cycleId: string | null;
  instrumentSymbol: string;
  instrumentClass: InstrumentClass;
  action: ObservationAction;
  /** When the signal's information became available (filing time, bar close). */
  eventTime: string;
  sourceUri?: string | null;
  features: Record<string, unknown>;
  /** Decision reasoning + edge snapshot, if any. */
  reasoning?: string | null;
  edge?: EdgeEstimate | null;
  modelVersion?: string | null;
  referencePrice?: number | null;
  contract: ExperienceResearchContract;
}

/**
 * Persists every signal evaluation — including skips and rejects (P1/P3). This
 * is the dataset spine: you only learn whether the model is selective by
 * comparing traded setups against skipped ones.
 */
export class SignalObservationService {
  constructor(private readonly repo: SignalObservationsRepo) {}

  record(input: RecordObservationInput): SignalObservation {
    const observedAt = new Date().toISOString();
    const observation: SignalObservation = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      experienceId: input.experienceId,
      signalId: input.signalId,
      cycleId: input.cycleId,
      instrumentSymbol: input.instrumentSymbol,
      instrumentClass: input.instrumentClass,
      action: input.action,
      eventTime: input.eventTime,
      observedAt,
      sourceUri: input.sourceUri ?? null,
      featureJson: JSON.stringify(input.features ?? {}),
      decisionJson:
        input.reasoning != null || input.edge != null
          ? JSON.stringify({ reasoning: input.reasoning ?? null, edge: input.edge ?? null })
          : null,
      modelVersion: input.modelVersion ?? null,
      labelHorizon: input.contract.label.horizon,
      labelBenchmark: input.contract.label.benchmark,
      referencePrice: input.referencePrice ?? null,
      labelReadyAt: labelReadyAt(input.eventTime, input.contract.label.horizon),
      createdAt: observedAt,
    };
    this.repo.insert(observation);
    return observation;
  }
}
