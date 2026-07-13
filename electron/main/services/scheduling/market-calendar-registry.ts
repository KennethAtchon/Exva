import {
  isMarketOpen,
  type MarketHoursMode,
} from "../signals/scheduler/session-scheduler";

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
