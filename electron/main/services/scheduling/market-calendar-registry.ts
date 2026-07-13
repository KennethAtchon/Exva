export type MarketHoursMode = "regular" | "extended" | "24_7";

/** US equity regular session rough check (America/New_York wall clock). */
export function isMarketOpen(
  mode: MarketHoursMode,
  now: Date = new Date(),
): boolean {
  if (mode === "24_7") return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  if (mode === "regular") {
    // 09:30–16:00 ET
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  }
  // extended: 04:00–20:00 ET
  return mins >= 4 * 60 && mins < 20 * 60;
}

export interface MarketCalendar {
  id: string;
  isOpen(now?: Date): boolean;
}

/**
 * Registry of named market calendars used by the V2 schedule coordinator to
 * decide whether to fire a scheduled group on a given tick.
 *
 * Built-in entries:
 *  - `nyse-regular`  → NYSE regular session (09:30–16:00 ET, Mon–Fri)
 *  - `nyse-extended` → Extended hours (04:00–20:00 ET, Mon–Fri)
 *  - `always-open`   → Always fires regardless of clock or calendar
 */
export class MarketCalendarRegistry {
  private readonly calendars = new Map<string, MarketCalendar>();

  register(calendar: MarketCalendar): void {
    if (this.calendars.has(calendar.id)) {
      throw new Error(
        `Market calendar already registered: "${calendar.id}"`,
      );
    }
    this.calendars.set(calendar.id, calendar);
  }

  get(id: string): MarketCalendar | null {
    return this.calendars.get(id) ?? null;
  }

  /**
   * Return the calendar, throwing if not found.
   * Used by ScheduleCoordinator which must hard-fail on misconfiguration.
   */
  require(id: string): MarketCalendar {
    const cal = this.calendars.get(id);
    if (!cal) {
      throw new Error(
        `Market calendar not found: "${id}". ` +
          `Known calendars: ${[...this.calendars.keys()].join(", ")}`,
      );
    }
    return cal;
  }

  list(): MarketCalendar[] {
    return [...this.calendars.values()];
  }
}

function makeIsMarketOpenCalendar(
  id: string,
  mode: MarketHoursMode,
): MarketCalendar {
  return {
    id,
    isOpen(now?: Date): boolean {
      return isMarketOpen(mode, now);
    },
  };
}

let defaultRegistry: MarketCalendarRegistry | null = null;

/** Return the process-singleton registry pre-populated with built-in calendars. */
export function getMarketCalendarRegistry(): MarketCalendarRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new MarketCalendarRegistry();
    defaultRegistry.register(makeIsMarketOpenCalendar("nyse-regular", "regular"));
    defaultRegistry.register(
      makeIsMarketOpenCalendar("nyse-extended", "extended"),
    );
    defaultRegistry.register(makeIsMarketOpenCalendar("always-open", "24_7"));
  }
  return defaultRegistry;
}
