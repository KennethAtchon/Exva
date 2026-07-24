import {
  hashBarWindow,
  type DeterministicStrategy,
} from "../../backtest/replay-engine";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

export const NY_RANGE_BREAKOUT_WARMUP_BARS = 288;

export type NyRangeBreakoutOptions = {
  pipSize?: number;
  stopBufferPips?: number;
  targetPips?: number;
  sessionEndHourNy?: number;
};

type NyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyParts(instant: Date): NyParts {
  const values = Object.fromEntries(
    nyFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function dateKey(parts: NyParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day,
  ).padStart(2, "0")}`;
}

function closeParts(bar: OhlcvBar): NyParts | null {
  const openedAt = new Date(bar.ts);
  if (Number.isNaN(openedAt.getTime())) return null;
  return nyParts(new Date(openedAt.getTime() + 5 * 60 * 1000));
}

function isRangeBar(parts: NyParts): boolean {
  return (
    (parts.hour === 0 && parts.minute >= 5) ||
    (parts.hour === 1 && parts.minute === 0)
  );
}

/**
 * Detect the first 5-minute close outside the completed New York midnight range.
 * Bar timestamps are opening instants, so all session rules use the bar close.
 */
export function createNyRangeBreakoutStrategy(
  options: NyRangeBreakoutOptions = {},
): DeterministicStrategy {
  const pipSize = options.pipSize ?? 0.1;
  const stopBufferPips = options.stopBufferPips ?? 10;
  const targetPips = options.targetPips ?? 20;
  const sessionEndHourNy = options.sessionEndHourNy ?? 23;

  if (!Number.isFinite(pipSize) || pipSize <= 0) {
    throw new Error("ny-range-breakout pipSize must be positive");
  }

  return {
    id: "ny-range-breakout",
    warmupBars: NY_RANGE_BREAKOUT_WARMUP_BARS,
    evaluate(bars, ctx) {
      if (ctx.timeframe !== "5m" || bars.length === 0) return null;

      const current = bars.at(-1);
      if (!current) return null;
      const currentParts = closeParts(current);
      if (
        !currentParts ||
        currentParts.hour < 1 ||
        currentParts.hour >= sessionEndHourNy
      ) {
        return null;
      }
      const rangeDate = dateKey(currentParts);

      const dayBars = bars
        .map((bar) => ({ bar, close: closeParts(bar) }))
        .filter(
          (item): item is { bar: OhlcvBar; close: NyParts } =>
            item.close != null && dateKey(item.close) === rangeDate,
        );
      const rangeBars = dayBars.filter((item) => isRangeBar(item.close));
      if (rangeBars.length !== 12) return null;

      const rangeHigh = Math.max(...rangeBars.map((item) => item.bar.high));
      const rangeLow = Math.min(...rangeBars.map((item) => item.bar.low));
      const candidates = dayBars.filter(
        (item) =>
          (item.close.hour > 1 ||
            (item.close.hour === 1 && item.close.minute >= 5)) &&
          item.close.hour < sessionEndHourNy,
      );
      const firstBreakout = candidates.find((item) => {
        return item.bar.close > rangeHigh || item.bar.close < rangeLow;
      });
      if (!firstBreakout || firstBreakout.bar.ts !== current.ts) return null;

      const direction = firstBreakout.bar.close > rangeHigh ? "buy" : "sell";
      const entryPrice = firstBreakout.bar.close;
      const initialStopPrice =
        direction === "buy"
          ? rangeLow - stopBufferPips * pipSize
          : rangeHigh + stopBufferPips * pipSize;
      const tp1Price =
        direction === "buy"
          ? entryPrice + targetPips * pipSize
          : entryPrice - targetPips * pipSize;

      return {
        action: direction,
        strength: 1,
        evidence: {
          rangeHigh,
          rangeLow,
          entryPrice,
          initialStopPrice,
          tp1Price,
          partialClosePct: 0.8,
          rangeDateNy: Number(rangeDate.replaceAll("-", "")),
          breakoutBarTs: new Date(firstBreakout.bar.ts).getTime(),
          sessionEndHourNy,
        },
        lifecycle: {
          initialStopPrice,
          firstTarget: { price: tp1Price, closeFraction: 0.8 },
          sessionEndTs: new Date(
            new Date(firstBreakout.bar.ts).getTime() +
              (sessionEndHourNy - currentParts.hour) * 60 * 60 * 1000,
          ).toISOString(),
          sameBarPriority: "stop_before_target",
        },
        barWindowHash: hashBarWindow([
          ...rangeBars.map((item) => item.bar),
          firstBreakout.bar,
        ]),
      };
    },
  };
}
