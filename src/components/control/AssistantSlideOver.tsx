import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Pencil,
  Plus,
  Settings2,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { useControlStore } from "@/store/controlStore";
import { useControlConversation } from "@/hooks/useControlConversation";
import { useControlConversations } from "@/hooks/useControlConversations";
import {
  Composer,
  ConversationTranscript,
} from "@/components/control/ConversationView";
import { ScopeChip } from "@/components/control/ScopeChip";
import { AssistantRuntimeMeta } from "@/components/control/AssistantRuntimeMeta";
import { RenameConversationDialog } from "@/components/control/RenameConversationDialog";
import {
  ASSISTANT_EXAMPLES,
  ASSISTANT_SHORTCUT_HINT,
} from "@/components/control/assistant-copy";

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

export function AssistantSlideOver({
  onOpenFullView,
}: {
  onOpenFullView?: () => void;
}) {
  const open = useControlStore((s) => s.slideOverOpen);
  const close = useControlStore((s) => s.closeSlideOver);
  const drafts = useControlStore((s) => s.draftsByConversationId);
  const setDraft = useControlStore((s) => s.setDraft);
  const {
    conversations,
    activeId,
    setActive,
    createNew,
    rename,
    remove,
    refresh,
  } = useControlConversations({
    autoCreate: open,
  });
  const convo = useControlConversation(open ? activeId : null);
  const [renameOpen, setRenameOpen] = useState(false);

  const draft = activeId ? (drafts[activeId] ?? "") : "";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogPortal>
          <DialogOverlay className="bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed inset-y-0 right-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border bg-surface shadow-popover duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right focus:outline-none"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // Focus lands in the composer textarea when present.
              const root = e.currentTarget as HTMLElement | null;
              const textarea = root?.querySelector("textarea");
              if (textarea instanceof HTMLTextAreaElement) {
                e.preventDefault();
                textarea.focus();
              }
            }}
          >
            <header className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="mb-0.5 font-mono text-micro uppercase tracking-wider text-text3">
                  Assistant
                </DialogTitle>
                <div className="flex items-center gap-2">
                  {conversations.length > 0 ? (
                    <Select
                      value={activeId ?? undefined}
                      onValueChange={(id) => setActive(id)}
                    >
                      <SelectTrigger className="h-8 min-w-0 max-w-[200px] border-none bg-transparent px-0 font-sans text-head text-text1 shadow-none focus:ring-0">
                        <SelectValue placeholder="New conversation" />
                      </SelectTrigger>
                      <SelectContent>
                        {conversations.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="truncate font-sans text-head text-text1">
                      {convo.conversation?.title ?? "New conversation"}
                    </span>
                  )}
                  <ScopeChip conversation={convo.conversation} />
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Assistant settings"
                      aria-label="Assistant settings"
                    >
                      <Settings2 className="h-4 w-4" />
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
                  title="Rename conversation"
                  aria-label="Rename conversation"
                  onClick={() => setRenameOpen(true)}
                  disabled={!convo.conversation}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Delete conversation"
                  aria-label="Delete conversation"
                  disabled={!convo.conversation}
                  onClick={() => {
                    if (!convo.conversation) return;
                    void remove(convo.conversation.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="New conversation"
                  aria-label="New conversation"
                  onClick={() => void createNew()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                {onOpenFullView ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Open full view"
                    aria-label="Open full view"
                    onClick={() => {
                      onOpenFullView();
                      close();
                    }}
                  >
                    <SquareArrowOutUpRight className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  title="Close"
                  aria-label="Close"
                  onClick={close}
                >
                  <X className="h-4 w-4" />
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
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

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
    </>
  );
}
