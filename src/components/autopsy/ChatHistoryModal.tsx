import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui";
import {
  parsePhaseTracesJson,
  type PhaseTrace,
  type TradeAutopsyRecord,
} from "@/lib/autopsy-types";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";

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

const phaseChipClass =
  "shrink-0 rounded-[4px] px-2 py-0.5 font-mono text-[12px] font-bold tracking-[0.05em]";

const promptBlockPreClass =
  "m-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-normal";

const versionChipClass =
  "cursor-pointer rounded-md px-[11px] py-1 font-mono text-[12px]";

const footerBtnClass =
  "cursor-pointer rounded-[7px] border border-[var(--border)] bg-transparent px-3.5 py-[7px] font-sans text-[12px] text-[var(--text2)]";

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
      className={cn(
        "overflow-hidden rounded-lg bg-[var(--surface2)]",
        hasError
          ? "border border-error-border"
          : "border border-[var(--border)]",
      )}
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
        className="flex cursor-pointer items-center gap-2.5 bg-transparent px-3.5 py-2.5"
        style={{
          borderLeft: `3px solid ${hasError ? "var(--color-error)" : ph.color}`,
        }}
      >
        {/* Phase chip */}
        <span
          className={phaseChipClass}
          style={{
            background: `${ph.color}22`,
            color: ph.color,
          }}
        >
          {ph.label.toUpperCase()}
        </span>

        {/* Stats */}
        <span className="flex-1 font-mono text-[12px] text-[var(--text3)]">
          {trace.providerKey} · {trace.modelId} ·{" "}
          {fmt.tokens(trace.inputTokens)} in · {fmt.tokens(trace.outputTokens)}{" "}
          out · {fmt.usd(trace.costUsd, 4)} · {fmt.duration(trace.durationMs)}
        </span>

        {hasError && (
          <span className="mr-1 font-mono text-[12px] text-error">ERROR</span>
        )}

        <span className="shrink-0 text-[12px] text-[var(--text3)]">
          {open ? "▲" : "▼"}
        </span>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="flex flex-col gap-3.5 border-t border-[var(--border)] px-4 py-3.5">
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
      <div className="mb-1.5 font-mono text-[12px] font-bold tracking-[0.05em] text-[var(--text3)]">
        {label}
      </div>
      <pre
        className={promptBlockPreClass}
        style={{
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
    <div className="flex flex-wrap gap-1.5">
      {autopsies.map((a, i) => {
        const active = a.id === selected;
        const date = formatIsoMonthDay(a.createdAt);
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={cn(
              versionChipClass,
              "border",
              active
                ? "border-[var(--accent)] bg-info-dim text-info"
                : "border-[var(--border)] bg-transparent text-[var(--text3)]",
            )}
          >
            v{i + 1} · <span suppressHydrationWarning>{date}</span>
            {i === autopsies.length - 1 && (
              <span className="ml-[5px] opacity-70">●</span>
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
        className={cn(
          "flex h-[88vh] max-w-[700px] flex-col overflow-hidden border-border bg-transparent p-0",
        )}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
          {/* Modal header */}
          <div className="shrink-0 border-b border-[var(--border)] px-5 pb-4 pt-[18px]">
            <div className="mb-1 text-[15px] font-bold text-[var(--text1)]">
              Autopsy Chat History
            </div>
            {autopsy && (
              <div className="font-mono text-[12px] text-[var(--text3)]">
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
            <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
              <VersionChips
                autopsies={autopsies}
                selected={selectedAutopsyId}
                onSelect={onSelectAutopsy}
              />
            </div>
          )}

          {/* Phase list */}
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-[18px] py-3.5">
            {phases.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[var(--text3)]">
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
          <div className="flex shrink-0 gap-2 border-t border-[var(--border)] px-[18px] py-3">
            <button onClick={handleCopyAll} className={footerBtnClass}>
              Copy All (JSON)
            </button>
            <button onClick={handleExportHistory} className={footerBtnClass}>
              Export Chat History
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
