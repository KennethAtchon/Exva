/**
 * Ensures a live `signal_sources` row (and running poller) exists for every
 * event-source signal type that session subscriptions can reference.
 *
 * `source_definitions` (source-definition-seeds.ts) are fanout metadata only —
 * nothing else converts them into a running poller. Without this, sessions
 * subscribed to e.g. edgar_8k or prediction_event never receive a signal
 * (see docs/reviews/2026-07-19-overnight-stress-session-review.md Bug 2).
 */
import type { SignalSourceRecord } from "@electron/shared/domain";
import type { SignalSourcesRepo } from "../services/signals/repos/signal-sources-repo";

export const EDGAR_8K_SIGNAL_SOURCE_ID = "source/edgar_8k";
export const PREDICTION_EVENT_SIGNAL_SOURCE_ID = "source/prediction_event";

const LIVE_SIGNAL_SOURCE_DEFAULTS: Array<
  Pick<SignalSourceRecord, "id" | "type" | "name" | "description">
> = [
  {
    id: EDGAR_8K_SIGNAL_SOURCE_ID,
    type: "edgar_8k",
    name: "EDGAR 8-K Catalyst",
    description: "Polls SEC EDGAR for 8-K filings.",
  },
  {
    id: PREDICTION_EVENT_SIGNAL_SOURCE_ID,
    type: "prediction_event",
    name: "Prediction Event Edge",
    description: "Polls prediction markets for odds/volume dislocations.",
  },
];

type LiveSignalSourceRegistry = {
  get(sourceId: string): unknown | null | undefined;
  create(source: SignalSourceRecord): void;
  start(sourceId: string): void | Promise<void>;
};

function ensureSource(
  sourcesRepo: SignalSourcesRepo,
  defaults: Pick<SignalSourceRecord, "id" | "type" | "name" | "description">,
): SignalSourceRecord {
  const existing = sourcesRepo.get(defaults.id);
  if (existing) return existing;
  return sourcesRepo.create({
    id: defaults.id,
    type: defaults.type,
    name: defaults.name,
    description: defaults.description,
    enabled: true,
    configJson: "{}",
  });
}

/** Idempotent: creates missing live-source rows and attaches/starts them. */
export function ensureLiveSignalSources(
  sourcesRepo: SignalSourcesRepo,
  registry: LiveSignalSourceRegistry,
): SignalSourceRecord[] {
  return LIVE_SIGNAL_SOURCE_DEFAULTS.map((defaults) => {
    const source = ensureSource(sourcesRepo, defaults);
    if (!registry.get(source.id)) {
      registry.create(source);
      if (source.enabled) void registry.start(source.id);
    }
    return source;
  });
}
