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
  const deciding = item.status !== "awaiting_confirm";
  if (!confirm) return null;

  const canAlwaysAllow = !confirm.alwaysConfirm;
  const riskIsLive = confirm.risk?.level === "live";

  return (
    <div className="rounded-xl border border-warning-border bg-warning-dim px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <span className="text-sm font-semibold text-text1">
          Confirm: {item.label}
        </span>
      </div>
      <p className="mt-2 text-body text-text1">{confirm.preview}</p>

      {confirm.outOfScope ? (
        <p className="mt-2 rounded-md border border-warning-border bg-surface/40 px-2.5 py-1.5 text-caption font-medium text-warning">
          Out of conversation scope — this targets a different session than the
          one this chat is scoped to.
        </p>
      ) : null}

      {confirm.risk ? (
        <p
          className={
            riskIsLive
              ? "mt-2 rounded-md border border-error-border bg-error-dim px-2.5 py-1.5 text-caption font-medium text-error"
              : "mt-2 rounded-md border border-warning-border bg-surface/40 px-2.5 py-1.5 text-caption font-medium text-warning"
          }
        >
          {confirm.risk.note}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        className="mt-2 flex items-center gap-1 text-micro text-text3 hover:text-text1"
      >
        {showInput ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {showInput ? "Hide" : "Show"} full input
      </button>
      {showInput ? (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-surface2 p-2 font-mono text-micro text-text1">
          {prettyJson(confirm.inputJson)}
        </pre>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={deciding}
          onClick={() => {
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
            onReject(item.id);
          }}
        >
          Reject
        </Button>
        {canAlwaysAllow ? (
          <label className="ml-1 flex items-center gap-1.5 text-caption text-text3">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-info"
              checked={alwaysApprove}
              onChange={(e) => setAlwaysApprove(e.target.checked)}
              disabled={deciding}
            />
            Don&apos;t ask again for this action
          </label>
        ) : null}
      </div>
      <p className="mt-2 text-micro text-text3">
        The assistant is paused until you decide.
      </p>
    </div>
  );
}
