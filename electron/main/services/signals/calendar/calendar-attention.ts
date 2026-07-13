/**
 * Dashboard attention items derived from upcoming calendar events and open
 * session holdings — e.g. "NVDA earnings in 2 days; breakout session holds 40 shares".
 */

export interface CalendarAttentionHolding {
  sessionId: string;
  sessionName: string;
  symbol: string;
  quantity: number;
}

export interface CalendarAttentionEvent {
  eventType: string;
  scheduledAt: string;
  symbol?: string | null;
  title?: string | null;
}

export interface CalendarAttentionItem {
  id: string;
  severity: "info" | "warn";
  message: string;
  scheduledAt: string;
  symbol: string | null;
  sessionId: string | null;
}

export function buildCalendarAttentionQueue(input: {
  events: CalendarAttentionEvent[];
  holdings: CalendarAttentionHolding[];
  nowMs?: number;
  lookaheadHours?: number;
}): CalendarAttentionItem[] {
  const nowMs = input.nowMs ?? Date.now();
  const lookaheadMs = (input.lookaheadHours ?? 72) * 3_600_000;
  const items: CalendarAttentionItem[] = [];

  for (const event of input.events) {
    const at = Date.parse(event.scheduledAt);
    if (!Number.isFinite(at)) continue;
    const delta = at - nowMs;
    if (delta < -3_600_000 || delta > lookaheadMs) continue;

    const hours = Math.max(0, delta / 3_600_000);
    const days = hours / 24;
    const when =
      days >= 1 ? `in ${days.toFixed(1)} days` : `in ${hours.toFixed(1)} hours`;
    const label =
      event.title ??
      `${event.eventType}${event.symbol ? ` ${event.symbol}` : ""}`;
    const symbol = event.symbol?.toUpperCase() ?? null;

    const matchingHoldings = symbol
      ? input.holdings.filter((h) => h.symbol.toUpperCase() === symbol)
      : [];

    if (matchingHoldings.length === 0) {
      items.push({
        id: `cal:${event.eventType}:${event.scheduledAt}:${symbol ?? "macro"}`,
        severity:
          event.eventType === "fomc" || event.eventType === "cpi"
            ? "warn"
            : "info",
        message: `${label.trim()} ${when}`,
        scheduledAt: event.scheduledAt,
        symbol,
        sessionId: null,
      });
      continue;
    }

    for (const h of matchingHoldings) {
      items.push({
        id: `cal:${event.eventType}:${event.scheduledAt}:${h.sessionId}`,
        severity: "warn",
        message: `${label.trim()} ${when}; ${h.sessionName} holds ${h.quantity} shares`,
        scheduledAt: event.scheduledAt,
        symbol,
        sessionId: h.sessionId,
      });
    }
  }

  return items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}
