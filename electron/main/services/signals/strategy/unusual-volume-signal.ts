import { z } from "zod";
import {
  strengthFields,
  tradeSignalSchema,
  type TradeSignal,
} from "@electron/shared/ai/trade-signals";
import {
  hashBarWindow,
  type DeterministicStrategy,
} from "../../backtest/replay-engine";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";

export const unusualVolumeInputSchema = z.object({
  symbol: z.string(),
  ohlcv: z.array(
    z.object({
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().nullable().optional(),
      timestamp: z.string().optional(),
      ts: z.string().optional(),
    }),
  ),
  /** Relative volume vs N-day baseline (default 20). */
  baselineBars: z.number().int().positive().default(20),
  /** Emit when today's volume / baseline >= this. */
  rvolThreshold: z.number().positive().default(2.5),
  /** Require close above prior high by this fraction (e.g. 0.01 = 1%). */
  priceBreakPct: z.number().nonnegative().default(0.005),
});

export type UnusualVolumeInput = z.input<typeof unusualVolumeInputSchema>;

export interface UnusualVolumeHit {
  symbol: string;
  rvol: number;
  baselineVol: number;
  priceBreakPct: number;
  barWindowHash: string;
  action: "buy";
}

export function computeUnusualVolume(
  input: UnusualVolumeInput,
): UnusualVolumeHit | null {
  const parsed = unusualVolumeInputSchema.parse(input);
  const baselineBars = parsed.baselineBars;
  if (parsed.ohlcv.length < baselineBars + 1) return null;

  const bars = parsed.ohlcv;
  const today = bars[bars.length - 1];
  if (!today) return null;
  const prior = bars.slice(-(baselineBars + 1), -1);
  const volumes = prior.map((b) => b.volume ?? 0).filter((v) => v > 0);
  if (volumes.length < Math.floor(baselineBars / 2)) return null;

  const baselineVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const todayVol = today.volume ?? 0;
  if (baselineVol <= 0 || todayVol <= 0) return null;

  const rvol = todayVol / baselineVol;
  const priorHigh = Math.max(...prior.map((b) => b.high));
  const breakPct = priorHigh > 0 ? (today.close - priorHigh) / priorHigh : 0;

  if (rvol < parsed.rvolThreshold) return null;
  if (breakPct < parsed.priceBreakPct) return null;

  const window = bars.slice(-(baselineBars + 1));
  const barWindowHash = hashBarWindow(
    window.map((b) => ({
      ts: b.timestamp ?? b.ts ?? "",
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume ?? null,
    })),
  );

  return {
    symbol: parsed.symbol,
    rvol,
    baselineVol,
    priceBreakPct: breakPct,
    barWindowHash,
    action: "buy",
  };
}

export function computeUnusualVolumeSignal(
  input: UnusualVolumeInput,
): TradeSignal {
  const hit = computeUnusualVolume(input);
  if (!hit) {
    return tradeSignalSchema.parse({
      symbol: input.symbol,
      action: "skip",
      executionStrategy: "event_driven",
      entryPrice: null,
      ...strengthFields(0.2),
      reasoning: "No unusual-volume + price-break setup.",
    });
  }
  const strength = Math.min(0.95, hit.rvol / 5);
  return tradeSignalSchema.parse({
    symbol: hit.symbol,
    action: "buy",
    executionStrategy: "event_driven",
    entryPrice: null,
    ...strengthFields(strength),
    reasoning: `RVOL ${hit.rvol.toFixed(2)}x baseline with ${(hit.priceBreakPct * 100).toFixed(2)}% price break.`,
  });
}

export function unusualVolumeHitToMarketSignal(
  hit: UnusualVolumeHit,
  opts?: { sourceId?: string; now?: string },
): MarketSignal {
  const now = opts?.now ?? new Date().toISOString();
  const sourceId = opts?.sourceId ?? "schedule:unusual-volume";
  return {
    id: crypto.randomUUID(),
    sourceId,
    kind: "scan_hit",
    instrumentClass: "stock",
    symbols: [hit.symbol],
    occurredAt: now,
    detectedAt: now,
    ttl: DEFAULT_SIGNAL_TTL.scan_hit,
    dedupeKey: computeDedupeKey("scan_hit", {
      strategy: "unusual-volume",
      symbol: hit.symbol,
      barWindowHash: hit.barWindowHash,
    }),
    provenance: {},
    payload: {
      strategyId: "unusual-volume",
      evidence: {
        rvol: hit.rvol,
        baselineVol: hit.baselineVol,
        priceBreakPct: hit.priceBreakPct,
      },
      barWindowHash: hit.barWindowHash,
      proposedAction: "buy",
    },
  };
}

export function createUnusualVolumeStrategy(options?: {
  rvolThreshold?: number;
  baselineBars?: number;
  priceBreakPct?: number;
  id?: string;
}): DeterministicStrategy {
  const rvolThreshold = options?.rvolThreshold ?? 2.5;
  const baselineBars = options?.baselineBars ?? 20;
  const priceBreakPct = options?.priceBreakPct ?? 0.005;
  return {
    id: options?.id ?? "unusual-volume",
    warmupBars: baselineBars + 1,
    evaluate(bars: OhlcvBar[], ctx) {
      const hit = computeUnusualVolume({
        symbol: ctx.symbol,
        ohlcv: bars.map((b) => ({
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume ?? null,
          ts: b.ts,
        })),
        rvolThreshold,
        baselineBars,
        priceBreakPct,
      });
      if (!hit) return null;
      return {
        action: "buy",
        strength: Math.min(0.95, hit.rvol / 5),
        evidence: {
          rvol: hit.rvol,
          baselineVol: hit.baselineVol,
          priceBreakPct: hit.priceBreakPct,
        },
        barWindowHash: hit.barWindowHash,
      };
    },
  };
}
