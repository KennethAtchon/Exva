import { useCallback, useRef, useState } from "react";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useSessionStore } from "@/store/sessionStore";
import { useTradeStore } from "@/store/tradeStore";
import type { EventRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type TapeEntry = {
  id: string;
  at: number;
  label: string;
  tone: "default" | "success" | "error" | "warning" | "info" | "market";
  tradeId?: string | null;
};

const MAX_ENTRIES = 40;

function toneForEvent(event: EventRow): TapeEntry["tone"] {
  const msg = `${event.agent_type ?? ""} ${event.message}`.toLowerCase();
  if (event.level === "ERROR") return "error";
  if (event.level === "WARN") return "warning";
  if (msg.includes("risk") || msg.includes("gate")) return "warning";
  if (msg.includes("technical") || msg.includes("buy")) return "success";
  if (msg.includes("review")) return "info";
  if (msg.includes("decision") || msg.includes("selector")) return "market";
  return "default";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ageLabel(msAgo: number): string {
  const sec = Math.floor(msAgo / 1000);
  if (sec < 60) return `${sec}S AGO`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}M AGO`;
  return `${Math.floor(min / 60)}H AGO`;
}

const TONE_CLASS: Record<TapeEntry["tone"], string> = {
  default: "text-text2",
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  info: "text-info",
  market: "text-market",
};

export function EventTape() {
  const [entries, setEntries] = useState<TapeEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const status = useSessionStore((s) => s.status);
  const setSelected = useTradeStore((s) => s.setSelected);
  const sessionActive =
    status === "active" ||
    status === "paused" ||
    status === "monitoring_only" ||
    status === "attention_required";

  const push = useCallback((entry: TapeEntry) => {
    if (pausedRef.current) return;
    setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
    setNow(Date.now());
  }, []);

  useExvaEvent("agent_event", (event: EventRow) => {
    push({
      id: event.id || crypto.randomUUID(),
      at: Date.parse(event.created_at) || Date.now(),
      label: event.message.replace(/\s+/g, " ").trim().slice(0, 80),
      tone: toneForEvent(event),
      tradeId: event.trade_id,
    });
  });

  useExvaEvent("trade_opened", (trade) => {
    push({
      id: `open-${trade.id}-${Date.now()}`,
      at: Date.now(),
      label: `TRADE OPENED ${trade.instrumentSymbol} ${trade.side}`,
      tone: "success",
      tradeId: trade.id,
    });
  });

  useExvaEvent("trade_closed", (trade) => {
    push({
      id: `close-${trade.id}-${Date.now()}`,
      at: Date.now(),
      label: `TRADE CLOSED ${trade.instrumentSymbol}`,
      tone: (trade.final_pnl_usd ?? 0) >= 0 ? "success" : "error",
      tradeId: trade.id,
    });
  });

  // Heartbeat tick so idle age stays fresh
  useExvaEvent("stats_update", () => {
    setNow(Date.now());
  });

  const lastAt = entries[0]?.at ?? null;
  const idle =
    entries.length === 0
      ? `IDLE · WAITING FOR EVENTS · DB OK`
      : `IDLE · LAST EVENT ${ageLabel(now - (lastAt ?? now))} · DB OK`;

  return (
    <div
      className="flex h-tape shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-surface px-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
      aria-live="polite"
      aria-label="Event tape"
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          sessionActive ? "bg-success" : "bg-text3",
          sessionActive && "animate-[pulse-dot_2s_ease-in-out_infinite]",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden font-mono text-micro uppercase tracking-wider">
        {entries.length === 0 ? (
          <span className="truncate text-text3">{idle}</span>
        ) : (
          entries.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                if (entry.tradeId) setSelected(entry.tradeId);
              }}
              className={cn(
                "shrink-0 truncate transition-opacity duration-tape",
                TONE_CLASS[entry.tone],
                i === 0 && "animate-[tape-slide_240ms_ease-out]",
                !entry.tradeId && "cursor-default",
              )}
            >
              {formatTime(entry.at)} {entry.label}
              {i < entries.length - 1 ? (
                <span className="ml-4 text-text3">·</span>
              ) : null}
            </button>
          ))
        )}
      </div>
      {paused && entries.length > 0 && (
        <span className="shrink-0 font-mono text-micro uppercase text-text3">
          Paused
        </span>
      )}
    </div>
  );
}
