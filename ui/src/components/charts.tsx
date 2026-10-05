// Charts on TradingView lightweight-charts: candles with buy/sell markers, and equity curves.
import type { EquityPoint, Timeframe } from "@shared/types.ts";
import { TIMEFRAME_MS } from "@shared/types.ts";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

const C = {
  up: "#4ade80",
  down: "#f4655f",
  ink2: "#98968b",
  hair: "#232320",
  line: "#2b2b26",
  info: "#7eb3e8",
};
// lightweight-charts draws UTC; shift by the local offset so axes read in local time.
const local = (ms: number) =>
  ((ms - new Date(ms).getTimezoneOffset() * 60_000) / 1000) as UTCTimestamp;

function useChart(
  height: number,
): [React.RefObject<HTMLDivElement | null>, React.RefObject<IChartApi | null>] {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!el.current) return;
    chart.current = createChart(el.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.ink2,
        fontFamily: "IBM Plex Mono",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: C.hair }, horzLines: { color: C.hair } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { color: C.ink2 }, vertLine: { color: C.ink2 } },
    });
    return () => {
      chart.current?.remove();
      chart.current = null;
    };
  }, [height]);
  return [el, chart];
}

export interface CandleData {
  bars: { ts: number; o: number; h: number; l: number; c: number }[];
  markers: { ts: number; side: "buy" | "sell"; price: number }[];
}

export function CandleChart({
  data,
  timeframe,
  height = 320,
}: {
  data: CandleData | undefined;
  timeframe: Timeframe;
  height?: number;
}) {
  const [el, chart] = useChart(height);
  useEffect(() => {
    const c = chart.current;
    if (!c || !data) return;
    const series = c.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderVisible: false,
      wickUpColor: C.up,
      wickDownColor: C.down,
      priceFormat: {
        type: "price",
        precision: data.bars[0] && data.bars[0].c < 10 ? 4 : 2,
        minMove: 0.0001,
      },
    });
    series.setData(
      data.bars.map((b) => ({ time: local(b.ts), open: b.o, high: b.h, low: b.l, close: b.c })),
    );
    const tf = TIMEFRAME_MS[timeframe];
    const drawn = new Set(data.bars.map((b) => b.ts));
    const markers: SeriesMarker<Time>[] = data.markers
      .filter((m) => drawn.has(Math.floor(m.ts / tf) * tf)) // a marker must sit on a drawn bar
      .map((m) => ({
        time: local(Math.floor(m.ts / tf) * tf),
        position: m.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
        color: m.side === "buy" ? C.up : C.down,
        shape: m.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
        text: m.side === "buy" ? "B" : "S",
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    c.timeScale().fitContent();
    return () => {
      if (chart.current === c) c.removeSeries(series); // the chart itself may already be gone
    };
  }, [data, timeframe, chart]);
  return <div ref={el} className="w-full" style={{ height }} />;
}

/** Equity curve, optionally with a drawdown area underneath. */
export function EquityChart({
  points,
  height = 220,
  drawdown = false,
}: {
  points: EquityPoint[];
  height?: number;
  drawdown?: boolean;
}) {
  const [el, chart] = useChart(height);
  useEffect(() => {
    const c = chart.current;
    if (!c || points.length === 0) return;
    const rising = (points.at(-1)?.equity ?? 0) >= (points[0]?.equity ?? 0);
    const color = rising ? C.up : C.down;
    const seen = new Set<number>();
    const data = points
      .map((p) => ({ time: local(p.ts), value: p.equity }))
      .filter((p) => !seen.has(p.time) && seen.add(p.time));
    c.priceScale("right").applyOptions({
      scaleMargins: drawdown ? { top: 0.08, bottom: 0.32 } : { top: 0.1, bottom: 0.1 },
    });
    const eq = c.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}33`,
      bottomColor: `${color}00`,
      lineWidth: 2,
      priceLineVisible: false,
    });
    eq.setData(data);
    const extra = [eq];
    if (drawdown) {
      let peak = Number.NEGATIVE_INFINITY;
      const dd = c.addSeries(AreaSeries, {
        lineColor: C.down,
        topColor: `${C.down}00`,
        bottomColor: `${C.down}44`,
        lineWidth: 1,
        priceScaleId: "dd",
        priceLineVisible: false,
        invertFilledArea: true,
      });
      c.priceScale("dd").applyOptions({ scaleMargins: { top: 0.74, bottom: 0.02 } });
      dd.setData(
        points
          .map((p) => {
            peak = Math.max(peak, p.equity);
            return { time: local(p.ts), value: p.equity - peak };
          })
          .filter((p, i, all) => i === 0 || p.time !== all[i - 1]?.time),
      );
      extra.push(dd);
    }
    c.timeScale().fitContent();
    return () => {
      if (chart.current === c) for (const s of extra) c.removeSeries(s);
    };
  }, [points, drawdown, chart]);
  return <div ref={el} className="w-full" style={{ height }} />;
}
