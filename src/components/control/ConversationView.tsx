import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ControlItem } from "@/hooks/useControlConversation";
import { ToolCallCard } from "./ToolCallCard";
import { ConfirmationCard } from "./ConfirmationCard";
import { MarkdownContent } from "./MarkdownContent";

const NEAR_BOTTOM_PX = 80;

function formatRelative(iso: string | undefined): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs)) return null;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function MessageBubble({
  item,
  isLastAssistant,
  onRetry,
  onRetryAssistant,
}: {
  item: Extract<ControlItem, { kind: "message" }>;
  isLastAssistant?: boolean;
  onRetry?: (messageId: string, content: string) => void;
  onRetryAssistant?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const relative = formatRelative(item.createdAt);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable.
    }
  };

  if (item.role === "system") {
    return (
      <div className="mx-auto rounded-full bg-surface2 px-3 py-1 text-center text-micro text-text3">
        {item.content}
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface3 px-3.5 py-2 text-sm text-text1">
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
        <div className="flex items-center gap-2">
          {relative ? (
            <span className="text-micro text-text3 opacity-0 transition-opacity group-hover:opacity-100">
              {relative}
            </span>
          ) : null}
          {item.status === "error" && onRetry ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetry(item.id, item.content)}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const cancelled = item.status === "cancelled";
  const errored = item.status === "error";

  return (
    <div className="group flex items-start gap-2">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info-dim text-info">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 max-w-[85%] flex-1">
        <div
          className={cn(
            "text-sm text-text1",
            cancelled && "opacity-60",
            errored && "text-error",
          )}
        >
          <MarkdownContent content={item.content} />
          {item.status === "streaming" ? (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-info align-middle" />
          ) : null}
          {cancelled ? (
            <p className="mt-1 text-micro text-text3">Cancelled</p>
          ) : null}
          {errored ? (
            <p className="mt-1 text-micro text-error">Failed to complete</p>
          ) : null}
        </div>
        {item.status !== "streaming" ? (
          <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            {relative ? (
              <span className="text-micro text-text3">{relative}</span>
            ) : null}
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-text3 hover:bg-surface2 hover:text-text1"
              title="Copy message"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </button>
            {isLastAssistant && onRetryAssistant ? (
              <button
                type="button"
                onClick={onRetryAssistant}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-text3 hover:bg-surface2 hover:text-text1"
                title="Retry last turn"
              >
                <RotateCcw className="h-3 w-3" />
                Retry
              </button>
            ) : null}
          </div>
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
  onRetry,
  onRetryLastAssistant,
  shortcutHint,
}: {
  items: ControlItem[];
  error: string | null;
  examples?: string[];
  onPickExample?: (text: string) => void;
  onConfirm: (toolCallId: string, alwaysApprove?: boolean) => void;
  onReject: (toolCallId: string) => void;
  onRetry?: (messageId: string, content: string) => void;
  onRetryLastAssistant?: () => void;
  shortcutHint?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const prevLenRef = useRef(items.length);

  const lastAssistantId = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === "message" && item.role === "assistant") return item.id;
    }
    return null;
  })();

  const updateAtBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near =
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setShowJump(false);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => updateAtBottom();
    el.addEventListener("scroll", onScroll, { passive: true });
    updateAtBottom();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const grew = items.length >= prevLenRef.current;
    prevLenRef.current = items.length;
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      setShowJump(false);
    } else if (grew) {
      setShowJump(true);
    }
  }, [items]);

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    atBottomRef.current = true;
    setAtBottom(true);
    setShowJump(false);
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-info-dim text-info">
          <Sparkles className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-text1">
          Ask the assistant anything
        </h3>
        <p className="mt-1 max-w-sm text-sm text-text2">
          Create a session, tune strategy, check your risk, or run an audit — it
          has the same powers you do.
        </p>
        {shortcutHint ? (
          <p className="mt-2 font-mono text-micro text-text3">{shortcutHint}</p>
        ) : null}
        {examples?.length ? (
          <div className="mt-5 flex w-full max-w-md flex-col gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => onPickExample?.(ex)}
                className="rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-left text-sm text-text1 transition-colors hover:border-info-border hover:bg-surface3"
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5"
      >
        {items.map((item) =>
          item.kind === "message" ? (
            <MessageBubble
              key={item.id}
              item={item}
              isLastAssistant={item.id === lastAssistantId}
              onRetry={onRetry}
              onRetryAssistant={onRetryLastAssistant}
            />
          ) : item.confirm ? (
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
          <div className="rounded-xl border border-error-border bg-error-dim px-4 py-3 text-sm text-error">
            {error}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      {showJump && !atBottom ? (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-caption text-text1 shadow-popover transition-opacity hover:bg-surface2"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          New messages
        </button>
      ) : null}
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
  placeholder,
  draft,
  onDraftChange,
}: {
  streaming: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  prefill?: string;
  prefillKey?: number;
  scopeChip?: React.ReactNode;
  placeholder?: string;
  draft?: string;
  onDraftChange?: (text: string) => void;
}) {
  const [value, setValue] = useState(draft ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const disabledReason = disabled
    ? "Select or create a conversation to send."
    : null;

  useEffect(() => {
    if (draft != null) setValue(draft);
  }, [draft]);

  useEffect(() => {
    if (prefill != null) {
      setValue(prefill);
      onDraftChange?.(prefill);
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
    onDraftChange?.("");
  };

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      {scopeChip ? <div className="mb-2">{scopeChip}</div> : null}
      <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface2 px-3 py-2 focus-within:border-info-border">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Message the assistant…"}
          className="max-h-40 flex-1 resize-none bg-transparent text-sm text-text1 outline-none placeholder:text-text3"
          onChange={(e) => {
            setValue(e.target.value);
            onDraftChange?.(e.target.value);
          }}
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
            title="Stop generating"
            aria-label="Stop generating"
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!value.trim() || disabled}
            onClick={submit}
            title="Send"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-micro text-text3">
          Enter to send · Shift+Enter for newline
        </p>
        {disabledReason ? (
          <p className="text-micro text-text3">{disabledReason}</p>
        ) : null}
      </div>
    </div>
  );
}
