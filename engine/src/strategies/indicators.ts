// Pure indicator functions. Each returns a series aligned with its input; NaN until warmed up.
import type { Bar } from "@shared/types.ts";

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = (values[i] as number) - (values[i - 1] as number);
    if (ch > 0) gain += ch;
    else loss -= ch;
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const ch = (values[i] as number) - (values[i - 1] as number);
    gain = (gain * (period - 1) + Math.max(ch, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-ch, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** Wilder's ATR. */
export function atr(bars: Bar[], period: number): number[] {
  const tr = bars.map((b, i) => {
    const prevClose = i > 0 ? (bars[i - 1] as Bar).c : b.c;
    return Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose));
  });
  const out = new Array<number>(bars.length).fill(Number.NaN);
  if (bars.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < bars.length; i++) {
    prev = (prev * (period - 1) + (tr[i] as number)) / period;
    out[i] = prev;
  }
  return out;
}

/** Highest high of the `period` bars BEFORE the last bar (excludes the bar being judged). */
export function priorHigh(bars: Bar[], period: number): number {
  const window = bars.slice(-period - 1, -1);
  return window.length < period ? Number.NaN : Math.max(...window.map((b) => b.h));
}

/** Lowest low of the `period` bars BEFORE the last bar. */
export function priorLow(bars: Bar[], period: number): number {
  const window = bars.slice(-period - 1, -1);
  return window.length < period ? Number.NaN : Math.min(...window.map((b) => b.l));
}

export const last = (series: number[], back = 0): number =>
  series[series.length - 1 - back] ?? Number.NaN;

export function pctChange(bars: Bar[], lookback: number): number {
  const now = bars[bars.length - 1];
  const then = bars[bars.length - 1 - lookback];
  return now && then ? ((now.c - then.c) / then.c) * 100 : Number.NaN;
}
