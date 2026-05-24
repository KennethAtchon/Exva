import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type { EventRow } from "@/lib/types";
import { Button } from "@/components/ui";

interface ToastItem {
  id: string;
  level: "ERROR" | "WARN";
  message: string;
  sessionId?: string | null;
}

const MAX_TOASTS = 5;
const AUTO_DISMISS_MS = 8000;

export function RuntimeEventToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useExvaEvent("agent_event", (event: EventRow) => {
    if (event.level !== "ERROR" && event.level !== "WARN") return;
    const id = event.id || crypto.randomUUID();
    const item: ToastItem = {
      id,
      level: event.level as "ERROR" | "WARN",
      message: event.message,
      sessionId: event.session_id,
    };
    setToasts((prev) => [item, ...prev].slice(0, MAX_TOASTS));
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  });

  if (toasts.length === 0) return null;

  return (
    <div style={containerStyle} aria-live="polite">
      {toasts.map((toast) => {
        const isError = toast.level === "ERROR";
        return (
          <div
            key={toast.id}
            style={{
              ...toastStyle,
              borderColor: isError
                ? "rgba(248,113,113,0.35)"
                : "rgba(251,191,36,0.35)",
              background: isError
                ? "rgba(248,113,113,0.12)"
                : "rgba(251,191,36,0.1)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color: isError ? "#fca5a5" : "#fcd34d",
                  marginBottom: 4,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {toast.level}
              </div>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "var(--text1)",
                  wordBreak: "break-word",
                }}
              >
                {toast.message}
              </div>
            </div>
            <Button
              variant="ghost"
              style={dismissStyle}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              ×
            </Button>
          </div>
        );
      })}
    </div>
  );
}

const containerStyle: CSSProperties = {
  position: "fixed",
  top: 66,
  right: 20,
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  width: "min(420px, calc(100vw - 40px))",
  pointerEvents: "none",
};

const toastStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid",
  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  pointerEvents: "auto",
};

const dismissStyle: CSSProperties = {
  padding: "0 6px",
  minWidth: 24,
  height: 24,
  fontSize: 16,
  lineHeight: 1,
  color: "var(--text3)",
  flexShrink: 0,
};
