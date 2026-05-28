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

const toastClass =
  "pointer-events-auto flex items-start gap-2 rounded-[10px] border px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]";

const dismissClass =
  "h-6 min-w-6 shrink-0 px-1.5 text-base leading-none text-[var(--text3)]";

function formatExitReason(exitReason: string | null | undefined): string {
  if (!exitReason) return "closed";
  return exitReason.replace(/_/g, " ");
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
      message: `⚠ Andon Cord — ${payload.lessonText.slice(0, 80)}. Recurred ${payload.recurrenceCount} times without resolution.`,
      sessionId: payload.sessionId,
      persistent: true,
      autopsyScope: payload.scope,
      autopsyId: payload.periodAutopsyId,
    });
  });

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
              toastClass,
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
                  "mb-1 font-mono text-[12px] font-bold tracking-[0.05em]",
                  isError
                    ? "text-error"
                    : isInfo
                      ? "text-info"
                      : "text-warning",
                )}
              >
                {toast.level}
              </div>
              <div className="break-words text-[12px] leading-[1.45] text-[var(--text1)]">
                {toast.message}
              </div>
              {toast.autopsyScope ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    className="h-7 border-warning-border bg-transparent px-2.5 text-[11px] text-warning"
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
                    View Autopsy
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-7 px-2.5 text-[11px] text-[var(--text3)]"
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
                className={dismissClass}
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
