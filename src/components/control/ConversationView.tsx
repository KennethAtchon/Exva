import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ControlItem } from "@/hooks/useControlConversation";
import { ToolCallCard } from "./ToolCallCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { MarkdownContent } from "./MarkdownContent";

function MessageBubble({
  item,
}: {
  item: Extract<ControlItem, { kind: "message" }>;
}) {
  if (item.role === "system") {
    return (
      <div className="mx-auto rounded-full bg-muted px-3 py-1 text-center text-micro text-muted-foreground">
        {item.content}
      </div>
    );
  }
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[85%] text-sm text-foreground">
        <MarkdownContent content={item.content} />
        {item.status === "streaming" ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
        ) : null}
      </div>
    </div>
  );
}

export function ConversationTranscript({
  items,
  error,
  examples,
  onPickExample,
  onConfirm,
  onReject,
}: {
  items: ControlItem[];
  error: string | null;
  examples?: string[];
  onPickExample?: (text: string) => void;
  onConfirm: (toolCallId: string, alwaysApprove?: boolean) => void;
  onReject: (toolCallId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-foreground">
          Ask the assistant anything
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Create a session, tune strategy, check your risk, or run an audit — it
          has the same powers you do.
        </p>
        {examples?.length ? (
          <div className="mt-5 flex w-full max-w-md flex-col gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => onPickExample?.(ex)}
                className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
      {items.map((item) =>
        item.kind === "message" ? (
          <MessageBubble key={item.id} item={item} />
        ) : item.status === "awaiting_confirm" && item.confirm ? (
          <ConfirmationCard
            key={item.id}
            item={item}
            onConfirm={onConfirm}
            onReject={onReject}
          />
        ) : (
          <ToolCallCard key={item.id} item={item} />
        ),
      )}
      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div ref={bottomRef} />
    </div>
  );
}

export function Composer({
  streaming,
  disabled,
  onSend,
  onStop,
  prefill,
  prefillKey,
  scopeChip,
}: {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  prefill?: string;
  prefillKey?: number;
  scopeChip?: React.ReactNode;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill != null) {
      setValue(prefill);
      ref.current?.focus();
    }
    // reason: re-apply prefill whenever the parent bumps prefillKey, even if text repeats
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || streaming || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {scopeChip ? <div className="mb-2">{scopeChip}</div> : null}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 focus-within:border-primary/50">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder="Message the assistant…"
          className="max-h-40 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            onClick={onStop}
            title="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className={cn("h-8 w-8 shrink-0")}
            disabled={!value.trim() || disabled}
            onClick={submit}
            title="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
