import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui";
import {
  parsePhaseTracesJson,
  type PhaseTrace,
  type TradeAutopsyRecord,
} from "@/lib/autopsy-types";
import { fmt } from "@/lib/formatters";

// ---------------------------------------------------------------------------
// Phase colour palette
// ---------------------------------------------------------------------------

const PHASE_PALETTE: Record<string, { color: string; label: string }> = {
  thesis: { color: "var(--color-info)", label: "Thesis" },
  execution: { color: "var(--color-success)", label: "Execution" },
  behavioral: { color: "var(--color-warning)", label: "Behavioral" },
  market_context: { color: "var(--color-market)", label: "Market" },
  synthesis: { color: "var(--text1)", label: "Synthesis" },
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatIsoMonthDay(isoLike: string): string {
  const match = isoLike.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoLike;
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const month = MONTH_LABELS[monthIndex] ?? match[2];
  return `${month} ${day}`;
}

function formatIsoDateTime(isoLike: string): string {
  const match = isoLike.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return isoLike;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6] ?? "00"}`;
}

// ---------------------------------------------------------------------------
// PhaseRow
// ---------------------------------------------------------------------------

function PhaseRow({ trace }: { trace: PhaseTrace }) {
  const [open, setOpen] = useState(false);
  const ph = PHASE_PALETTE[trace.phase] ?? {
    color: "var(--text3)",
    label: trace.phase,
  };
  const hasError = !!trace.error;

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${hasError ? "var(--color-error-border)" : "var(--border)"}`,
        overflow: "hidden",
        background: "var(--surface2)",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          cursor: "pointer",
          borderLeft: `3px solid ${hasError ? "var(--color-error)" : ph.color}`,
          background: "transparent",
        }}
      >
        {/* Phase chip */}
        <span
          style={{
            ...phaseChipStyle,
            background: `${ph.color}22`,
            color: ph.color,
          }}
        >
          {ph.label.toUpperCase()}
        </span>

        {/* Stats */}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: "var(--text3)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {trace.providerKey} · {trace.modelId} ·{" "}
          {fmt.tokens(trace.inputTokens)} in · {fmt.tokens(trace.outputTokens)}{" "}
          out · {fmt.usd(trace.costUsd, 4)} · {fmt.duration(trace.durationMs)}
        </span>

        {hasError && (
          <span
            style={{
              fontSize: 12,
              color: "var(--color-error)",
              fontFamily: "var(--font-mono)",
              marginRight: 4,
            }}
          >
            ERROR
          </span>
        )}

        <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded body */}
      {open && (
        <div
          style={{
            padding: "14px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <PromptBlock
            label="SYSTEM PROMPT"
            text={trace.systemPrompt}
            maxH={180}
          />
          <PromptBlock label="USER PROMPT" text={trace.userPrompt} maxH={280} />
          {trace.toolCallsJson && (
            <PromptBlock
              label="TOOL CALLS"
              text={trace.toolCallsJson}
              maxH={180}
            />
          )}
          {hasError ? (
            <PromptBlock
              label="ERROR"
              text={trace.error ?? ""}
              maxH={120}
              color="var(--color-error)"
              borderColor="var(--color-error)"
            />
          ) : (
            <PromptBlock
              label="RESPONSE"
              text={trace.responseText}
              maxH={300}
              borderColor={ph.color}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PromptBlock({
  label,
  text,
  maxH,
  color,
  borderColor,
}: {
  label: string;
  text: string;
  maxH: number;
  color?: string;
  borderColor?: string;
}) {
  let displayText = text;
  try {
    const parsed: unknown = JSON.parse(text);
    displayText = JSON.stringify(parsed, null, 2);
  } catch {
    // keep as-is
  }

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: "var(--text3)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.05em",
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          ...promptBlockPreStyle,
          borderLeft: borderColor ? `3px solid ${borderColor}` : undefined,
          color: color ?? "var(--text2)",
          maxHeight: maxH,
        }}
      >
        {displayText}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version chip row
// ---------------------------------------------------------------------------

function VersionChips({
  autopsies,
  selected,
  onSelect,
}: {
  autopsies: TradeAutopsyRecord[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (autopsies.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {autopsies.map((a, i) => {
        const active = a.id === selected;
        const date = formatIsoMonthDay(a.createdAt);
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            style={{
              ...versionChipStyle,
              border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
              background: active ? "var(--color-info-dim)" : "transparent",
              color: active ? "var(--color-info)" : "var(--text3)",
            }}
          >
            v{i + 1} · <span suppressHydrationWarning>{date}</span>
            {i === autopsies.length - 1 && (
              <span style={{ marginLeft: 5, opacity: 0.7 }}>●</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatHistoryModal
// ---------------------------------------------------------------------------

export function ChatHistoryModal({
  open,
  onClose,
  autopsies,
  selectedAutopsyId,
  onSelectAutopsy,
}: {
  open: boolean;
  onClose: () => void;
  autopsies: TradeAutopsyRecord[];
  selectedAutopsyId: string;
  onSelectAutopsy: (id: string) => void;
}) {
  const autopsy = autopsies.find((a) => a.id === selectedAutopsyId);
  const phases: PhaseTrace[] = autopsy
    ? parsePhaseTracesJson(autopsy.phaseTracesJson)
    : [];
  const phaseKeyCounts = new Map<string, number>();

  const handleCopyAll = () => {
    void navigator.clipboard.writeText(autopsy?.phaseTracesJson ?? "[]");
  };

  const handleExportHistory = () => {
    if (!autopsy) return;
    const blob = new Blob([autopsy.phaseTracesJson], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `autopsy-chat-history-${autopsy.createdAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="border-border bg-transparent p-0"
        style={{
          maxWidth: 700,
          height: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            background: "var(--surface)",
            borderRadius: 14,
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          {/* Modal header */}
          <div
            style={{
              padding: "18px 20px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "var(--text1)",
                marginBottom: 4,
              }}
            >
              Autopsy Chat History
            </div>
            {autopsy && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text3)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {autopsy.modelId} ·{" "}
                <span suppressHydrationWarning>
                  {formatIsoDateTime(autopsy.createdAt)}
                </span>{" "}
                · {phases.length} phases
              </div>
            )}
          </div>

          {/* Version selector */}
          {autopsies.length > 1 && (
            <div
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--border)",
                flexShrink: 0,
              }}
            >
              <VersionChips
                autopsies={autopsies}
                selected={selectedAutopsyId}
                onSelect={onSelectAutopsy}
              />
            </div>
          )}

          {/* Phase list */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {phases.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 0",
                  color: "var(--text3)",
                  fontSize: 13,
                }}
              >
                Chat history not available for this autopsy.
              </div>
            ) : (
              phases.map((p) => {
                const baseKey = [
                  p.phase,
                  p.providerKey,
                  p.modelId,
                  p.inputTokens,
                  p.outputTokens,
                  p.durationMs,
                  p.error ?? "",
                ].join("|");
                const seenCount = phaseKeyCounts.get(baseKey) ?? 0;
                phaseKeyCounts.set(baseKey, seenCount + 1);
                return <PhaseRow key={`${baseKey}|${seenCount}`} trace={p} />;
              })
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <button onClick={handleCopyAll} style={footerBtn}>
              Copy All (JSON)
            </button>
            <button onClick={handleExportHistory} style={footerBtn}>
              Export Chat History
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const phaseChipStyle = {
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  letterSpacing: "0.05em",
  flexShrink: 0,
} as const;

const promptBlockPreStyle = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: 6,
  background: "var(--bg)",
  border: "1px solid var(--border)",
  fontSize: 12,
  lineHeight: 1.5,
  fontFamily: "var(--font-mono)",
  overflow: "auto",
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
} as const;

const versionChipStyle = {
  padding: "4px 11px",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
} as const;

const footerBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
};
