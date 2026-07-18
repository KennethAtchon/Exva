import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlItem } from "@/hooks/useControlConversation";

type ToolItem = Extract<ControlItem, { kind: "tool" }>;

const STATUS_META: Record<
  ToolItem["status"],
  { label: string; className: string }
> = {
  running: {
    label: "Running",
    className: "bg-info-dim text-info border-info-border",
  },
  awaiting_confirm: {
    label: "Needs you",
    className: "bg-warning-dim text-warning border-warning-border",
  },
  succeeded: {
    label: "Done",
    className: "bg-success-dim text-success border-success-border",
  },
  rejected: {
    label: "Skipped",
    className: "bg-surface2 text-text3 border-border",
  },
  failed: {
    label: "Failed",
    className: "bg-error-dim text-error border-error-border",
  },
};

function tryParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (v) =>
      v == null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );
}

function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function formatScalar(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function KeyValueTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-caption text-text3">Empty object</p>;
  }
  return (
    <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border bg-surface2 px-2.5 py-2">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-mono text-micro text-text3">{key}</dt>
          <dd className="truncate font-sans text-caption text-text1">
            {formatScalar(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function JsonPanel({
  raw,
  emptyLabel = "—",
}: {
  raw: string | null | undefined;
  emptyLabel?: string;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = tryParseJson(raw);
  const flat = isFlatObject(parsed);

  if (!raw) {
    return <p className="mt-1 text-caption text-text3">{emptyLabel}</p>;
  }

  return (
    <div className="mt-1">
      {flat && !showRaw ? <KeyValueTable data={parsed} /> : null}
      {!flat || showRaw ? (
        <pre className="max-h-48 overflow-auto rounded-md bg-surface2 p-2 font-mono text-micro text-text1">
          {prettyJson(raw)}
        </pre>
      ) : null}
      {flat ? (
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="mt-1 font-mono text-micro text-text3 hover:text-text1"
        >
          {showRaw ? "Pretty view" : "Raw JSON"}
        </button>
      ) : null}
    </div>
  );
}

function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    setSeconds(0);
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);

  return seconds;
}

function displayResultSummary(item: ToolItem): string | undefined {
  const summary = item.resultSummary?.trim();
  if (summary && summary !== "Done.") return summary;

  const parsed = tryParseJson(item.resultJson ?? null);
  if (parsed == null) return summary;
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  if (Array.isArray(parsed))
    return `${parsed.length} item${parsed.length === 1 ? "" : "s"}`;
  if (typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["summary", "message", "status", "name", "id"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.length <= 4 && isFlatObject(obj)) {
      return keys.map((k) => `${k}: ${formatScalar(obj[k])}`).join(" · ");
    }
    if (keys.length > 0) return `${keys.length} fields`;
  }
  return summary;
}

export function ToolCallCard({ item }: { item: ToolItem }) {
  const [expanded, setExpanded] = useState(item.toolKind === "mutating");
  const meta = STATUS_META[item.status];
  const elapsed = useElapsedSeconds(item.status === "running");
  const showSummary = Boolean(item.summary) && item.summary !== item.label;
  const resultSummary = displayResultSummary(item);
  const StatusIcon =
    item.status === "running"
      ? Loader2
      : item.status === "succeeded"
        ? CircleCheck
        : item.status === "failed"
          ? CircleX
          : null;

  return (
    <div className="rounded-xl border border-border bg-surface2/60 px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text3" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text3" />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-text3" />
        <span className="text-sm font-medium text-text1">{item.label}</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-semibold",
            meta.className,
          )}
        >
          {StatusIcon ? (
            <StatusIcon
              className={cn(
                "h-3 w-3",
                item.status === "running" && "animate-spin",
              )}
            />
          ) : null}
          {meta.label}
          {item.status === "running" && elapsed >= 2 ? (
            <span className="font-mono tabular-nums">{elapsed}s</span>
          ) : null}
        </span>
      </button>
      {showSummary ? (
        <p className="mt-1.5 pl-6 text-body text-text2">{item.summary}</p>
      ) : null}
      {expanded ? (
        <div className="mt-2 space-y-2 pl-6">
          <div>
            <p className="text-micro uppercase tracking-wide text-text3">
              Input
            </p>
            <JsonPanel raw={item.inputJson} />
          </div>
          {resultSummary || item.resultJson ? (
            <div>
              <p className="text-micro uppercase tracking-wide text-text3">
                Result
                {resultSummary ? ` · ${resultSummary}` : ""}
              </p>
              {item.resultJson ? <JsonPanel raw={item.resultJson} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
