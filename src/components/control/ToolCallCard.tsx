import { useState } from "react";
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
    className: "bg-primary/15 text-primary border-primary/30",
  },
  awaiting_confirm: {
    label: "Needs you",
    className:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  succeeded: {
    label: "Done",
    className:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  rejected: {
    label: "Skipped",
    className: "bg-muted text-muted-foreground border-border",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

function prettyJson(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ToolCallCard({ item }: { item: ToolItem }) {
  // Read tools default collapsed; mutating tools default expanded.
  const [expanded, setExpanded] = useState(item.toolKind === "mutating");
  const meta = STATUS_META[item.status];
  const StatusIcon =
    item.status === "running"
      ? Loader2
      : item.status === "succeeded"
        ? CircleCheck
        : item.status === "failed"
          ? CircleX
          : null;

  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {item.label}
        </span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
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
        </span>
      </button>
      <p className="mt-1.5 pl-6 text-[13px] text-muted-foreground">
        {item.summary}
      </p>
      {expanded ? (
        <div className="mt-2 space-y-2 pl-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Input
            </p>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground">
              {prettyJson(item.inputJson)}
            </pre>
          </div>
          {item.resultSummary ? (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Result · {item.resultSummary}
              </p>
              {item.resultJson ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground">
                  {prettyJson(item.resultJson)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
