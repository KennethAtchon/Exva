// Deterministic synthetic market for tests and demo mode (no network). Price is a closed-form
// function of time, so any range is reproducible and every timeframe agrees with every other.
import type { Bar, Timeframe } from "@shared/types.ts";
import { assetClassOf, TIMEFRAME_MS } from "@shared/types.ts";
import type { UsEquityCalendar } from "../core/calendar.ts";
import type { BarProvider } from "./alpaca-data.ts";

const STEP = 300_000; // 5-minute grid: the finest timeframe
const BASE: Record<string, number> = {
  "BTC/USD": 60_000,
  "ETH/USD": 3_000,
  "SOL/USD": 150,
  SPY: 500,
  QQQ: 430,
};

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic noise in [-1, 1] for (seed, step). */
function noise(seed: number, step: number): number {
  let x =
    (seed ^ Math.imul(step | 0, 0x9e3779b1) ^ Math.imul(Math.floor(step / 2 ** 31), 0x85ebca77)) >>>
    0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

export function syntheticPrice(symbol: string, ts: number): number {
  const seed = hash32(symbol);
  const base = BASE[symbol] ?? 20 + (seed % 480);
  const phase = (seed % 1000) / 159;
  const hours = ts / 3_600_000;
  const swing =
    0.06 * Math.sin(hours / 97 + phase) + // multi-week trend
    0.025 * Math.sin(hours / 13.3 + phase * 2) + // multi-day swings
    0.008 * Math.sin(hours / 1.7 + phase * 3) + // intraday waves
    0.0025 * noise(seed, Math.floor(ts / STEP));
  return base * Math.exp(swing);
}

export function syntheticBar(symbol: string, timeframe: Timeframe, ts: number): Bar {
  const tf = TIMEFRAME_MS[timeframe];
  const seed = hash32(symbol);
  let h = Number.NEGATIVE_INFINITY;
  let l = Number.POSITIVE_INFINITY;
  for (let t = ts; t <= ts + tf; t += STEP) {
    const p = syntheticPrice(symbol, t);
    h = Math.max(h, p);
    l = Math.min(l, p);
  }
  const o = syntheticPrice(symbol, ts);
  const c = syntheticPrice(symbol, ts + tf);
  const v = Math.round((500 + 400 * noise(seed + 7, Math.floor(ts / tf))) * (tf / STEP));
  return { ts, o, h, l, c, v };
}

export class SyntheticData implements BarProvider {
  readonly name = "synthetic";
  constructor(private readonly calendar: UsEquityCalendar) {}

  async fetchBars(
    symbols: string[],
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Map<string, Bar[]>> {
    const tf = TIMEFRAME_MS[timeframe];
    const out = new Map<string, Bar[]>();
    for (const symbol of symbols) {
      const bars: Bar[] = [];
      const stock = assetClassOf(symbol) === "stock";
      for (let ts = Math.ceil(from / tf) * tf; ts < to; ts += tf) {
        if (stock && !this.calendar.isOpen(ts) && !this.calendar.isOpen(ts + tf - 1)) continue;
        bars.push(syntheticBar(symbol, timeframe, ts));
      }
      out.set(symbol, bars);
    }
    return out;
  }
}
