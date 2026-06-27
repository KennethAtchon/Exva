import type { InstrumentClass, WorkspaceSession } from "@/lib/types";
import type { OrchestratorDeps, PreflightStepFailure } from "../session-types";
import {
  parseSignalInstrumentMetadata,
  resolveOhlcvTimeframe,
} from "@electron/shared/domain/signal-timing";

type StepResult = { ok: true } | PreflightStepFailure;

/** Rules engines need at least a 20-bar window (z-score / SMA / Donchian). */
const MIN_PROBE_BARS = 20;
/** Request comfortably more than the minimum so a healthy feed clears the bar. */
const PROBE_BAR_COUNT = 30;

/** Instrument classes that trade on OHLCV bars (others, e.g. prediction markets, do not). */
const OHLCV_CLASSES: ReadonlySet<string> = new Set([
  "stock",
  "crypto",
  "futures",
  "options",
]);

/**
 * Probes the OHLCV feed once per concrete, bar-driven signal source at session
 * start and warns loudly when it comes back empty/short.
 *
 * Why this exists: the Alpaca bars endpoints silently return `[]` on a
 * misconfigured request (e.g. a missing `start` window), which is
 * indistinguishable at the decision layer from a healthy "no setup today" —
 * every cycle skips at the deterministic engines' `confidence 0.2`
 * "insufficient bars" fallback and the session trades nothing, forever, with no
 * error. This check surfaces a data outage before a wasted run instead of after.
 *
 * Warn-only (returns ok:true): a transient feed hiccup should not permanently
 * block a session, and broker/credential problems are already covered by other
 * preflight steps. The point is to make starvation visible, not to gate on it.
 */
export async function ohlcvDataProbeCheck(
  session: WorkspaceSession,
  deps: OrchestratorDeps,
): Promise<StepResult> {
  const sourceIds = deps.signalSourcesRepo.subscribedSourceIdsForSession(
    session.id,
  );
  if (sourceIds.length === 0) return { ok: true };

  const starved: Array<{
    sourceName: string;
    symbol: string;
    barsReturned: number;
  }> = [];

  for (const sourceId of sourceIds) {
    const source = deps.signalSourcesRepo.get(sourceId);
    if (!source?.instrumentClass) continue;
    if (!OHLCV_CLASSES.has(source.instrumentClass)) continue;

    const symbol = symbolFromConfig(source.configJson);
    if (!symbol) continue; // selector-driven sources have no fixed symbol to probe

    try {
      const { adapter } = await deps.brokerRouting.resolveAdapter(
        session.id,
        source.instrumentClass as InstrumentClass,
      );
      const getOhlcv = adapter.getOhlcv?.bind(adapter);
      if (!getOhlcv) continue;

      const timeframe = resolveOhlcvTimeframe(
        parseSignalInstrumentMetadata(
          JSON.stringify({ analysisTimeframe: source.analysisTimeframe }),
        ),
        "1h",
      );
      const wireSymbol = deps.instrumentNormalizer.toBrokerSymbol({
        symbol,
        instrumentClass: source.instrumentClass as InstrumentClass,
        brokerType: adapter.brokerType,
      });
      const bars = await getOhlcv(wireSymbol, timeframe, PROBE_BAR_COUNT);
      if (bars.length < MIN_PROBE_BARS) {
        starved.push({
          sourceName: source.name,
          symbol,
          barsReturned: bars.length,
        });
      }
    } catch {
      // Broker/credential resolution failures are covered by other preflight
      // steps; a probe that can't resolve a broker is not this check's concern.
      continue;
    }
  }

  if (starved.length > 0) {
    deps.logger.warn(
      { sessionId: session.id, starvedSources: starved, minBars: MIN_PROBE_BARS },
      `Session has ${starved.length} signal source(s) whose OHLCV feed returned ` +
        `fewer than ${MIN_PROBE_BARS} bars — the deterministic engines will skip ` +
        `every cycle ("insufficient bars"). Check the data feed/credentials: ` +
        starved
          .map((s) => `${s.sourceName} (${s.symbol}: ${s.barsReturned} bars)`)
          .join(", "),
    );
  }

  return { ok: true };
}

function symbolFromConfig(configJson: string): string | null {
  try {
    const parsed = JSON.parse(configJson) as { symbol?: unknown };
    return typeof parsed.symbol === "string" && parsed.symbol.length > 0
      ? parsed.symbol
      : null;
  } catch {
    return null;
  }
}
