import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import type { ControlItem } from "@/hooks/useControlConversation";

type ToolItem = Extract<ControlItem, { kind: "tool" }>;

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ConfirmationCard({
  item,
  onConfirm,
  onReject,
}: {
  item: ToolItem;
  onConfirm: (toolCallId: string, alwaysApprove?: boolean) => void;
  onReject: (toolCallId: string) => void;
}) {
  const confirm = item.confirm;
  const [showInput, setShowInput] = useState(false);
  const [alwaysApprove, setAlwaysApprove] = useState(false);
  const [deciding, setDeciding] = useState(false);
  if (!confirm) return null;

  const canAlwaysAllow = !confirm.alwaysConfirm && confirm.confirmClass != null;

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-foreground">
          Confirm: {item.label}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-foreground">{confirm.preview}</p>

      {confirm.risk ? (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] font-medium text-destructive">
          {confirm.risk}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showInput ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {showInput ? "Hide" : "Show"} full input
      </button>
      {showInput ? (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground">
          {prettyJson(confirm.inputJson)}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={deciding}
          onClick={() => {
            setDeciding(true);
            onConfirm(item.id, canAlwaysAllow ? alwaysApprove : false);
          }}
        >
          {deciding ? "Applying…" : "Confirm"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={deciding}
          onClick={() => {
            setDeciding(true);
            onReject(item.id);
          }}
        >
          Reject
        </Button>
        {canAlwaysAllow ? (
          <label className="ml-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-primary"
              checked={alwaysApprove}
              onChange={(e) => setAlwaysApprove(e.target.checked)}
            />
            Don&apos;t ask again for this action type
          </label>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        The assistant is paused until you decide.
      </p>
    </div>
  );
}
