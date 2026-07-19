import { useState } from "react";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { useControlStore } from "@/store/controlStore";
import { useControlConversation } from "@/hooks/useControlConversation";
import { useControlConversations } from "@/hooks/useControlConversations";
import {
  Composer,
  ConversationTranscript,
} from "@/components/control/ConversationView";
import {
  ASSISTANT_EXAMPLES,
  ASSISTANT_SHORTCUT_HINT,
} from "@/components/control/assistant-copy";
import { ScopeChip } from "@/components/control/ScopeChip";
import { AssistantRuntimeMeta } from "@/components/control/AssistantRuntimeMeta";
import { RenameConversationDialog } from "@/components/control/RenameConversationDialog";
import { HubBody, HubFrame, HubHeader } from "./dna";

function scopePlaceholder(
  conversation: { scopeKind: string; scopeSessionId: string | null } | null,
): string {
  if (conversation?.scopeKind === "session" && conversation.scopeSessionId) {
    return `Ask about session ${conversation.scopeSessionId}…`;
  }
  return "Ask about workspace ops…";
}

function lastUserText(
  items: ReturnType<typeof useControlConversation>["items"],
): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "message" && item.role === "user") return item.content;
  }
  return null;
}

/**
 * Journey: pick or start a conversation → ask / confirm actions → leave with
 * ops work done in a full-width transcript.
 */
export function AssistantHub() {
  const {
    conversations,
    loading,
    activeId,
    setActive,
    createNew,
    remove,
    rename,
    refresh,
  } = useControlConversations({ autoCreate: true });
  const convo = useControlConversation(activeId);
  const drafts = useControlStore((s) => s.draftsByConversationId);
  const setDraft = useControlStore((s) => s.setDraft);
  const [renameOpen, setRenameOpen] = useState(false);
  const draft = activeId ? (drafts[activeId] ?? "") : "";

  return (
    <HubFrame>
      <HubHeader
        eyebrow="Control"
        title="Assistant"
        subtitle="Full-page workspace for longer control conversations."
      />
      <HubBody scroll={false} className="overflow-hidden">
        <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
              <span className="font-mono text-micro uppercase tracking-wider text-text3">
                Conversations
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void createNew()}
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading && conversations.length === 0 ? (
                <p className="px-2 py-3 font-sans text-caption text-text3">
                  Loading…
                </p>
              ) : null}
              {!loading && conversations.length === 0 ? (
                <p className="px-2 py-3 font-sans text-caption text-text3">
                  No conversations yet.
                </p>
              ) : null}
              <ul className="flex flex-col gap-0.5">
                {conversations.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <li key={c.id} className="group/row relative">
                      <button
                        type="button"
                        onClick={() => setActive(c.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 rounded-sm px-3 py-2 pr-14 text-left transition-colors duration-hover",
                          active
                            ? "bg-surface2 text-text1"
                            : "text-text2 hover:bg-surface2/60 hover:text-text1",
                        )}
                      >
                        <span className="truncate font-sans text-label">
                          {c.title}
                        </span>
                        <span className="font-mono text-micro text-text3">
                          {c.scopeKind === "session" ? "Session" : "Workspace"}
                          {" · "}
                          {c.messageCount} msg
                        </span>
                      </button>
                      <div className="absolute right-1 top-1.5 flex opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Rename"
                          aria-label="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActive(c.id);
                            setRenameOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Delete"
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(c.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-bg">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 flex-1 truncate font-sans text-head text-text1">
                  {convo.conversation?.title ?? "New conversation"}
                </span>
                <ScopeChip
                  conversation={convo.conversation}
                  className="max-w-[40%] shrink-0 justify-end"
                />
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Assistant settings"
                      aria-label="Assistant settings"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-72 border-border bg-surface p-3"
                  >
                    <AssistantRuntimeMeta />
                  </PopoverContent>
                </Popover>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Rename conversation"
                  aria-label="Rename conversation"
                  disabled={!convo.conversation}
                  onClick={() => setRenameOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  disabled={!convo.conversation}
                  onClick={() => {
                    if (!convo.conversation) return;
                    void remove(convo.conversation.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </header>

            <ConversationTranscript
              items={convo.items}
              error={convo.error}
              examples={ASSISTANT_EXAMPLES}
              shortcutHint={ASSISTANT_SHORTCUT_HINT}
              onPickExample={(text) => void convo.send(text)}
              onConfirm={(id, always) => void convo.confirm(id, always)}
              onReject={(id) => void convo.reject(id)}
              onRetry={(id, text) => void convo.send(text, { replaceId: id })}
              onRetryLastAssistant={() => {
                const text = lastUserText(convo.items);
                if (text) void convo.send(text);
              }}
            />

            <Composer
              streaming={convo.streaming}
              disabled={!activeId}
              placeholder={scopePlaceholder(convo.conversation)}
              draft={draft}
              onDraftChange={(text) => {
                if (activeId) setDraft(activeId, text);
              }}
              onSend={(text) => {
                void (async () => {
                  await convo.send(text);
                  await refresh();
                })();
              }}
              onStop={() => void convo.cancel()}
            />
          </section>
        </div>
      </HubBody>

      <RenameConversationDialog
        open={renameOpen}
        initialTitle={convo.conversation?.title ?? ""}
        onOpenChange={setRenameOpen}
        onSubmit={async (title) => {
          if (!convo.conversation) return;
          await rename(convo.conversation.id, title);
          await convo.refetch();
        }}
      />
    </HubFrame>
  );
}
