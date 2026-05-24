/**
 * Shared types for aggregator phases (technical, fundamental, review, decision).
 *
 * Aggregator phases have a single "workers" stage that fans out AI workers
 * and then delegates to a finalizer engine. Worker results are NOT stored
 * in phase state — they are passed directly to the finalizer engine via
 * the `workerResults` third parameter of `FinalizerEngine.run`.
 *
 * State is intentionally empty. Adding fields here is a signal that you
 * should be using the `workerResults` param or a multi-stage design instead.
 */
export type AggregatorPlanState = Record<string, never>;
