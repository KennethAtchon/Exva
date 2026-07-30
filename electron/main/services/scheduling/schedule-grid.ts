import type { CadenceSpec } from "@electron/shared/domain/experience-inputs/cadence";
import { cadenceToMs } from "@electron/shared/domain/experience-inputs/cadence";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { isMarketOpen, type MarketHoursMode } from "./market-calendar-registry";

const ET = "America/New_York";

/** US equity regular open 09:30 ET on a UTC day key (YYYY-MM-DD). */
export function marketOpenAt(dayKey: string): Date {
  return zonedDateTime(dayKey, 9, 30);
}

/** Regular session close 16:00 ET. */
export function marketCloseAt(dayKey: string): Date {
  return zonedDateTime(dayKey, 16, 0);
}

function zonedDateTime(dayKey: string, hour: number, minute: number): Date {
  const probe = new Date(`${dayKey}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offset =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = offset.match(/GMT([+-]\d+(?::\d+)?)/);
  const normalized = match?.[1]?.replace(
    /^([+-])(\d)$/,
    (_m, sign, h) => `${sign}0${h}:00`,
  );
  const isoOffset =
    normalized && normalized.includes(":")
      ? normalized
      : normalized
        ? `${normalized}:00`
        : "-05:00";
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dayKey}T${hh}:${mm}:00${isoOffset}`);
}

export function dayKeyEt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function expectedEligibleMinutes(dayKey: string): number {
  const open = marketOpenAt(dayKey);
  const close = marketCloseAt(dayKey);
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
  }).format(open);
  if (dow === "Sat" || dow === "Sun") return 0;
  return Math.max(0, (close.getTime() - open.getTime()) / 60_000);
}

export function minutesLateAtOpen(
  firstEligibleScanAt: Date,
  dayKey?: string,
): number | null {
  const key = dayKey ?? dayKeyEt(firstEligibleScanAt);
  const open = marketOpenAt(key);
  if (firstEligibleScanAt.getTime() < open.getTime()) return 0;
  const lateMs = firstEligibleScanAt.getTime() - open.getTime();
  return Math.round((lateMs / 60_000) * 10) / 10;
}

const TIMEFRAME_MS: Record<TradingTimeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

/** Provider delay after bar close before scan (Solution 08). */
const BAR_CLOSE_DELAY_MS = 30_000;

function calendarMode(calendarId: string): MarketHoursMode {
  if (calendarId === "always-open" || calendarId === "us_equities") {
    return "24_7";
  }
  if (calendarId.includes("extended")) return "extended";
  return "regular";
}

/**
 * Next scan slot aligned to market open + cadence/bar grid.
 * Returns null when market is closed for the calendar.
 */
export function nextGridFireAt(input: {
  now?: Date;
  cadence: CadenceSpec;
  analysisTimeframe: TradingTimeframe;
  marketCalendarId: string;
}): Date | null {
  const now = input.now ?? new Date();
  const mode = calendarMode(input.marketCalendarId);
  if (!isMarketOpen(mode, now)) return null;

  const dayKey = dayKeyEt(now);
  const open = marketOpenAt(dayKey);
  const close = marketCloseAt(dayKey);
  const intervalMs = cadenceToMs(input.cadence);
  const barMs = TIMEFRAME_MS[input.analysisTimeframe] ?? intervalMs;

  let slot = open.getTime();
  if (now.getTime() >= open.getTime()) {
    const elapsed = now.getTime() - open.getTime();
    const barsSinceOpen = Math.floor(elapsed / barMs);
    slot = open.getTime() + (barsSinceOpen + 1) * barMs + BAR_CLOSE_DELAY_MS;
    if (slot <= now.getTime()) {
      slot = now.getTime() + intervalMs;
    }
  }

  while (slot < close.getTime()) {
    const candidate = new Date(slot);
    if (candidate.getTime() > now.getTime() && isMarketOpen(mode, candidate)) {
      return candidate;
    }
    slot += intervalMs;
  }
  return null;
}

/** Delay until the next grid slot (minimum 1s). */
export function delayUntilNextGridMs(input: {
  now?: Date;
  cadence: CadenceSpec;
  analysisTimeframe: TradingTimeframe;
  marketCalendarId: string;
}): number {
  const now = input.now ?? new Date();
  const mode = calendarMode(input.marketCalendarId);
  if (!isMarketOpen(mode, now)) return cadenceToMs(input.cadence);

  const next = nextGridFireAt(input);
  if (!next) return cadenceToMs(input.cadence);
  return Math.max(1000, next.getTime() - now.getTime());
}
