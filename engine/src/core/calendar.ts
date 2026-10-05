// US equity regular-hours calendar. Computed NYSE holidays and early closes, optionally overridden
// by the broker's official calendar (Alpaca /v2/calendar) when one is available.
import type { Timeframe } from "@shared/types.ts";
import { assetClassOf, TIMEFRAME_MS } from "@shared/types.ts";

export interface Session {
  date: string; // YYYY-MM-DD in New York
  open: number; // epoch ms
  close: number;
}

const DAY = 86_400_000;
const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

function etParts(ts: number) {
  const p: Record<string, string> = {};
  for (const part of etFormat.formatToParts(new Date(ts))) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour),
    mm: Number(p.minute),
  };
}

export function etDateKey(ts: number): string {
  const { y, m, d } = etParts(ts);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Epoch ms for a New York wall-clock time. */
export function etToEpoch(y: number, m: number, d: number, hh: number, mm: number): number {
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const p = etParts(guess);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function nthWeekday(y: number, m: number, wd: number, n: number): number {
  const first = weekday(y, m, 1);
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y: number, m: number, wd: number): number {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = weekday(y, m, days);
  return days - ((last - wd + 7) % 7);
}
function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}
/** Saturday holidays are observed Friday, Sunday holidays Monday. */
function observed(y: number, m: number, d: number): string {
  const wd = weekday(y, m, d);
  const t = Date.UTC(y, m - 1, d) + (wd === 6 ? -DAY : wd === 0 ? DAY : 0);
  const o = new Date(t);
  return key(o.getUTCFullYear(), o.getUTCMonth() + 1, o.getUTCDate());
}

const yearCache = new Map<number, { closed: Set<string>; early: Set<string> }>();
function nyseRules(y: number) {
  const cached = yearCache.get(y);
  if (cached) return cached;
  const closed = new Set<string>();
  const early = new Set<string>();
  if (weekday(y, 1, 1) !== 6) closed.add(observed(y, 1, 1)); // a Saturday New Year's is not observed
  closed.add(key(y, 1, nthWeekday(y, 1, 1, 3))); // MLK
  closed.add(key(y, 2, nthWeekday(y, 2, 1, 3))); // Presidents
  const [em, ed] = easter(y);
  const gf = new Date(Date.UTC(y, em - 1, ed) - 2 * DAY);
  closed.add(key(y, gf.getUTCMonth() + 1, gf.getUTCDate())); // Good Friday
  closed.add(key(y, 5, lastWeekday(y, 5, 1))); // Memorial
  if (y >= 2022) closed.add(observed(y, 6, 19)); // Juneteenth
  closed.add(observed(y, 7, 4)); // Independence
  closed.add(key(y, 9, nthWeekday(y, 9, 1, 1))); // Labor
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  closed.add(key(y, 11, thanksgiving));
  closed.add(observed(y, 12, 25)); // Christmas
  early.add(key(y, 11, thanksgiving + 1));
  const jul3 = weekday(y, 7, 3);
  if (jul3 >= 1 && jul3 <= 4) early.add(key(y, 7, 3));
  const dec24 = weekday(y, 12, 24);
  if (dec24 >= 1 && dec24 <= 4) early.add(key(y, 12, 24));
  const rules = { closed, early };
  yearCache.set(y, rules);
  return rules;
}

export class UsEquityCalendar {
  private overrides = new Map<string, Session | null>();

  /** Apply the broker's official sessions for [fromKey, toKey]; dates in range but absent are closed. */
  setSessions(sessions: Session[], fromKey: string, toKey: string): void {
    const byDate = new Map(sessions.map((s) => [s.date, s]));
    const [fy, fm, fd] = fromKey.split("-").map(Number) as [number, number, number];
    for (let t = Date.UTC(fy, fm - 1, fd); ; t += DAY) {
      const d = new Date(t);
      const k = key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (k > toKey) break;
      this.overrides.set(k, byDate.get(k) ?? null);
    }
  }

  session(dateKey: string): Session | null {
    if (this.overrides.has(dateKey)) return this.overrides.get(dateKey) ?? null;
    const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
    const wd = weekday(y, m, d);
    if (wd === 0 || wd === 6) return null;
    const rules = nyseRules(y);
    if (rules.closed.has(dateKey)) return null;
    const closeHour = rules.early.has(dateKey) ? 13 : 16;
    return {
      date: dateKey,
      open: etToEpoch(y, m, d, 9, 30),
      close: etToEpoch(y, m, d, closeHour, 0),
    };
  }

  sessionAt(ts: number): Session | null {
    return this.session(etDateKey(ts));
  }

  isOpen(ts: number): boolean {
    const s = this.sessionAt(ts);
    return s !== null && ts >= s.open && ts < s.close;
  }

  /** Should a bar closing at T be acted on? Only when there is still time to place orders. */
  isTickTime(closeTs: number): boolean {
    const s = this.sessionAt(closeTs - 1);
    return s !== null && closeTs > s.open && closeTs < s.close;
  }

  /** Next session open strictly after ts (or the current session's open if not yet open). */
  nextOpen(ts: number): number | null {
    for (let i = 0; i < 15; i++) {
      const s = this.sessionAt(ts + i * DAY);
      if (s && s.open > ts) return s.open;
    }
    return null;
  }

  nextClose(ts: number): number | null {
    for (let i = 0; i < 15; i++) {
      const s = this.sessionAt(ts + i * DAY);
      if (s && s.close > ts) return s.close;
    }
    return null;
  }
}

/** Can this symbol be traded at `ts`? Crypto always; stocks during regular hours. */
export function marketOpenFor(calendar: UsEquityCalendar, symbol: string, ts: number): boolean {
  return assetClassOf(symbol) === "crypto" || calendar.isOpen(ts);
}

/** Is a bar of this symbol that closes at T a moment the bot should check? */
export function isCheckTime(calendar: UsEquityCalendar, symbol: string, closeTs: number): boolean {
  return assetClassOf(symbol) === "crypto" || calendar.isTickTime(closeTs);
}

/** The next bar-close time after `after` at which a bot trading these symbols will check. */
export function nextCheckTime(
  calendar: UsEquityCalendar,
  symbols: string[],
  timeframe: Timeframe,
  after: number,
): number | null {
  const tf = TIMEFRAME_MS[timeframe];
  let t = Math.floor(after / tf) * tf + tf;
  const anyCrypto = symbols.some((s) => assetClassOf(s) === "crypto");
  if (anyCrypto) return t;
  for (let i = 0; i < 2000; i++) {
    if (calendar.isTickTime(t)) return t;
    const open = calendar.nextOpen(t - 1); // t may be exactly today's open
    if (open === null) return null;
    t = Math.max(t + tf, Math.floor(open / tf) * tf + tf);
  }
  return null;
}
