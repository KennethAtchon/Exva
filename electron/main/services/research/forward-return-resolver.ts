import type { SignalObservation } from "@electron/shared/domain";
import type { LabelHorizon } from "@electron/shared/domain/research-contract";
import { LABEL_HORIZON_MS } from "@electron/shared/domain/research-contract";
import { requireExperience } from "../../experiences/index";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type { InstrumentNormalizer } from "../broker/instrument-normalizer";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { Logger } from "../infra/log";
import type { ForwardReturn } from "./label-builder-service";

interface ResolverDeps {
  brokerRouting: BrokerRoutingService;
  instrumentNormalizer: InstrumentNormalizer;
  logger: Logger;
}

type Timeframe = "15m" | "30m" | "1h" | "4h" | "1d";

/** Bars to fetch per horizon so [eventTime, eventTime+horizon] is covered. */
const HORIZON_FETCH: Record<
  Exclude<LabelHorizon, "resolution">,
  { timeframe: Timeframe; barCount: number }
> = {
  "1h": { timeframe: "15m", barCount: 32 },
  "1d": { timeframe: "1h", barCount: 64 },
  "5d": { timeframe: "1d", barCount: 16 },
};

/**
 * Builds a {@link ForwardReturn} for an observation from broker OHLCV (P2).
 * Computes the instrument's forward return over the label horizon, signs it by
 * the action taken (skips use the BUY perspective for selectivity analysis),
 * adjusts for the benchmark when one is configured, and charges the contract's
 * round-trip cost.
 *
 * Returns null (observation re-queued) when data is unavailable or the horizon
 * is resolution-based (event markets are labeled elsewhere).
 */
export function createBrokerForwardReturnResolver(deps: ResolverDeps) {
  return async (observation: SignalObservation): Promise<ForwardReturn | null> => {
    if (observation.labelHorizon === "resolution") return null;
    if (!observation.sessionId) return null;

    const fetch = HORIZON_FETCH[observation.labelHorizon];
    const horizonMs = LABEL_HORIZON_MS[observation.labelHorizon];
    const eventMs = Date.parse(observation.eventTime);
    const targetMs = eventMs + horizonMs;

    const { adapter } = await deps.brokerRouting.resolveAdapter(
      observation.sessionId,
      observation.instrumentClass,
    );
    const getOhlcv = adapter.getOhlcv?.bind(adapter);
    if (!getOhlcv) return null;

    const wireSymbol = deps.instrumentNormalizer.toBrokerSymbol({
      symbol: observation.instrumentSymbol,
      instrumentClass: observation.instrumentClass,
      brokerType: adapter.brokerType,
    });
    const bars = await getOhlcv(wireSymbol, fetch.timeframe, fetch.barCount);
    if (bars.length === 0) return null;

    const entryBar = nearestBar(bars, eventMs);
    const exitBar = nearestBar(bars, targetMs);
    if (!entryBar || !exitBar) return null;

    const entryPrice = observation.referencePrice ?? entryBar.close;
    if (entryPrice <= 0) return null;

    const buyGrossBps = ((exitBar.close - entryPrice) / entryPrice) * 10_000;
    const signedGrossBps =
      observation.action === "sell" ? -buyGrossBps : buyGrossBps;

    const { mfeBps, maeBps } = windowExtremesBps(
      bars,
      eventMs,
      targetMs,
      entryPrice,
      observation.action === "sell",
    );

    const benchmarkReturnBps = await resolveBenchmarkReturnBps(
      deps,
      observation,
      eventMs,
      targetMs,
      fetch,
    );

    const costBps = roundTripCostBps(observation.experienceId);

    return {
      grossReturnBps: signedGrossBps,
      costBps,
      benchmarkReturnBps,
      maxFavorableBps: mfeBps,
      maxAdverseBps: maeBps,
      outcomeWin: signedGrossBps - costBps > 0 ? 1 : 0,
    };
  };
}

async function resolveBenchmarkReturnBps(
  deps: ResolverDeps,
  observation: SignalObservation,
  eventMs: number,
  targetMs: number,
  fetch: { timeframe: Timeframe; barCount: number },
): Promise<number | null> {
  if (observation.labelBenchmark !== "SPY") return null;
  if (!observation.sessionId) return null;
  try {
    const { adapter } = await deps.brokerRouting.resolveAdapter(
      observation.sessionId,
      "stock",
    );
    const getOhlcv = adapter.getOhlcv?.bind(adapter);
    if (!getOhlcv) return null;
    const symbol = deps.instrumentNormalizer.toBrokerSymbol({
      symbol: "SPY",
      instrumentClass: "stock",
      brokerType: adapter.brokerType,
    });
    const bars = await getOhlcv(symbol, fetch.timeframe, fetch.barCount);
    const entry = nearestBar(bars, eventMs);
    const exit = nearestBar(bars, targetMs);
    if (!entry || !exit || entry.close <= 0) return null;
    return ((exit.close - entry.close) / entry.close) * 10_000;
  } catch (err) {
    deps.logger.warn({ err }, "benchmark forward-return fetch failed");
    return null;
  }
}

function roundTripCostBps(experienceId: string): number {
  try {
    const c = requireExperience(experienceId).researchContract.costs;
    return (
      c.spreadBps + c.slippageBps + c.commissionBps + (c.borrowBps ?? 0)
    );
  } catch {
    return 0;
  }
}

function nearestBar(bars: OhlcvBar[], targetMs: number): OhlcvBar | null {
  let best: OhlcvBar | null = null;
  let bestDelta = Infinity;
  for (const bar of bars) {
    const delta = Math.abs(Date.parse(bar.ts) - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = bar;
    }
  }
  return best;
}

function windowExtremesBps(
  bars: OhlcvBar[],
  startMs: number,
  endMs: number,
  entryPrice: number,
  isShort: boolean,
): { mfeBps: number; maeBps: number } {
  const lo = Math.min(startMs, endMs);
  const hi = Math.max(startMs, endMs);
  const within = bars.filter((b) => {
    const t = Date.parse(b.ts);
    return t >= lo && t <= hi;
  });
  if (within.length === 0) return { mfeBps: 0, maeBps: 0 };

  const high = Math.max(...within.map((b) => b.high));
  const low = Math.min(...within.map((b) => b.low));
  const upBps = ((high - entryPrice) / entryPrice) * 10_000;
  const downBps = ((low - entryPrice) / entryPrice) * 10_000;

  // For a short, favorable = price down, adverse = price up.
  if (isShort) {
    return { mfeBps: Math.max(0, -downBps), maeBps: Math.min(0, -upBps) };
  }
  return { mfeBps: Math.max(0, upBps), maeBps: Math.min(0, downBps) };
}
