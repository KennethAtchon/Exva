import { useCallback, useState } from "react";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type { AndonCordPayload } from "@/lib/autopsy-types";
import type { EventRow, Trade } from "@/lib/types";
import { Button } from "@/components/ui";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: string;
  level: "ERROR" | "WARN" | "INFO" | "CRITICAL";
  message: string;
  sessionId?: string | null;
  persistent?: boolean;
  autopsyScope?: "global" | "session";
  autopsyId?: string | null;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 8000;
const ALERT_LEVELS = new Set(["ERROR", "WARN", "CRITICAL"]);

function formatExitReason(exitReason: string | null | undefined): string {
  if (!exitReason) return "closed";
  return exitReason.replace(/_/g, " ");
}

function normalizeAlertLevel(
  level: string,
): "ERROR" | "WARN" | "CRITICAL" | null {
  const normalized = level.toUpperCase();
  return ALERT_LEVELS.has(normalized)
    ? (normalized as "ERROR" | "WARN" | "CRITICAL")
    : null;
}

export function RuntimeEventToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (item: ToastItem) => {
      setToasts((prev) => [item, ...prev].slice(0, MAX_TOASTS));
      if (!item.persistent) {
        window.setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
      }
    },
    [dismiss],
  );

  useExvaEvent("agent_event", (event: EventRow) => {
    if (event.level !== "ERROR" && event.level !== "WARN") return;
    pushToast({
      id: event.id || crypto.randomUUID(),
      level: event.level as "ERROR" | "WARN",
      message: event.message,
      sessionId: event.session_id,
    });
  });

  useExvaEvent("trade_closed", (trade: Trade) => {
    const pnl =
      trade.final_pnl_usd == null
        ? "P&L unavailable"
        : fmt.pnl(trade.final_pnl_usd);
    pushToast({
      id: `trade-closed-${trade.id}-${trade.closed_at ?? Date.now()}`,
      level: "INFO",
      message: `${trade.instrumentSymbol} ${formatExitReason(trade.exit_reason)} — ${pnl}`,
      sessionId: trade.sessionId,
    });
  });

  useExvaEvent("andon_cord_fired", (payload: AndonCordPayload) => {
    pushToast({
      id: `andon-${payload.lessonId}-${payload.recurrenceCount}`,
      level: "CRITICAL",
      message: `Andon cord — ${payload.lessonText.slice(0, 80)}. Recurred ${payload.recurrenceCount} times without resolution.`,
      sessionId: payload.sessionId,
      persistent: true,
      autopsyScope: payload.scope,
      autopsyId: payload.periodAutopsyId,
    });
  });

  useExvaEvent(
    "notification",
    (payload: { title: string; body: string; level: string }) => {
      const level = normalizeAlertLevel(payload.level);
      if (!level) return;
      pushToast({
        id: `notification-${payload.title}-${Date.now()}`,
        level,
        message: `${payload.title}: ${payload.body}`,
      });
    },
  );

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-5 top-[66px] z-[100] flex w-[min(420px,calc(100vw-40px))] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const isError = toast.level === "ERROR" || toast.level === "CRITICAL";
        const isInfo = toast.level === "INFO";
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-sm border px-3 py-2.5 shadow-popover",
              isError
                ? "border-error-border bg-error-dim"
                : isInfo
                  ? "border-info-border bg-info-dim"
                  : "border-warning-border bg-warning-dim",
            )}
          >
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "mb-1 font-mono text-micro font-bold uppercase tracking-wider",
                  isError
                    ? "text-error"
                    : isInfo
                      ? "text-info"
                      : "text-warning",
                )}
              >
                {toast.level}
              </div>
              <div className="break-words font-sans text-caption leading-relaxed text-text1">
                {toast.message}
              </div>
              {toast.autopsyScope ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("exva:navigate-autopsy", {
                          detail: {
                            scope: toast.autopsyScope,
                            sessionId: toast.sessionId ?? null,
                            periodAutopsyId: toast.autopsyId ?? null,
                          },
                        }),
                      );
                      dismiss(toast.id);
                    }}
                  >
                    View autopsy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismiss(toast.id)}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : null}
            </div>
            {!toast.autopsyScope ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 min-w-6 shrink-0 px-1.5 text-text3"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                ×
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
