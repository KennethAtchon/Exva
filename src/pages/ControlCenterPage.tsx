import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useControlConversation } from "@/hooks/useControlConversation";
import { useControlConversations } from "@/hooks/useControlConversations";
import {
  ConversationTranscript,
  Composer,
} from "@/components/control/ConversationView";
import { ScopeChip } from "@/components/control/ScopeChip";

const EXAMPLES = [
  "Create an EDGAR catalyst session on my paper broker",
  "What are my open trades and total risk right now?",
  "Run a period autopsy for the last 7 days",
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export function ControlCenterPage() {
  const {
    conversations,
    loading,
    activeId,
    setActive,
    createNew,
    remove,
    rename,
  } = useControlConversations({ autoCreate: true });
  const convo = useControlConversation(activeId);
  const [prefill, setPrefill] = useState<{ text: string; key: number }>({
    text: "",
    key: 0,
  });

  const handleRename = async () => {
    if (!convo.conversation) return;
    const next = window.prompt("Rename conversation", convo.conversation.title);
    if (next && next.trim()) {
      await rename(convo.conversation.id, next.trim());
      await convo.refetch();
    }
  };

  const handleDelete = async () => {
    if (!activeId) return;
    if (!window.confirm("Delete this conversation? This cannot be undone."))
      return;
    await remove(activeId);
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* History rail */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-card/30">
        <div className="p-3">
          <Button className="w-full" size="sm" onClick={() => void createNew()}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="space-y-2 px-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-lg bg-muted/60"
                />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(c.id)}
                className={cn(
                  "mb-1 w-full rounded-lg px-3 py-2 text-left transition-colors",
                  c.id === activeId
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {c.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {relativeTime(c.updatedAt)} · {c.messageCount} msg
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main column */}
      <section className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-foreground">
              {convo.conversation?.title ?? "Assistant"}
            </h1>
          </div>
          <ScopeChip conversation={convo.conversation} />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleRename}
            disabled={!convo.conversation}
            title="Rename"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={!activeId}
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </header>

        <ConversationTranscript
          items={convo.items}
          error={convo.error}
          examples={EXAMPLES}
          onPickExample={(text) =>
            setPrefill((p) => ({ text, key: p.key + 1 }))
          }
          onConfirm={(id, always) => void convo.confirm(id, always)}
          onReject={(id) => void convo.reject(id)}
        />

        <Composer
          streaming={convo.streaming}
          disabled={!activeId}
          prefill={prefill.text}
          prefillKey={prefill.key}
          onSend={(text) => void convo.send(text)}
          onStop={() => void convo.cancel()}
        />
      </section>
    </div>
  );
}
