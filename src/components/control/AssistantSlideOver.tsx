import { useEffect } from "react";
import { Pencil, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useControlStore } from "@/store/controlStore";
import { useControlConversation } from "@/hooks/useControlConversation";
import { useControlConversations } from "@/hooks/useControlConversations";
import {
  Composer,
  ConversationTranscript,
} from "@/components/control/ConversationView";
import { ScopeChip } from "@/components/control/ScopeChip";
import { AssistantRuntimeMeta } from "@/components/control/AssistantRuntimeMeta";

const EXAMPLES = [
  "What's my open risk right now?",
  "Why is my session waiting?",
];

export function AssistantSlideOver({
  onOpenFullView,
}: {
  onOpenFullView?: () => void;
}) {
  const open = useControlStore((s) => s.slideOverOpen);
  const close = useControlStore((s) => s.closeSlideOver);
  const { activeId, createNew, rename } = useControlConversations({
    autoCreate: open,
  });
  const convo = useControlConversation(open ? activeId : null);

  const handleRename = async () => {
    if (!convo.conversation) return;
    const next = window.prompt("Rename conversation", convo.conversation.title);
    if (next && next.trim()) {
      await rename(convo.conversation.id, next.trim());
      await convo.refetch();
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-hidden
      />
      <div className="relative flex h-full w-[420px] max-w-[90vw] flex-col border-l border-border bg-surface shadow-popover">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 font-mono text-micro uppercase tracking-wider text-text3">
              Assistant
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate font-sans text-head text-text1">
                {convo.conversation?.title ?? "New conversation"}
              </span>
              <ScopeChip conversation={convo.conversation} />
            </div>
            <AssistantRuntimeMeta />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              title="Rename conversation"
              onClick={() => void handleRename()}
              disabled={!convo.conversation}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="New conversation"
              onClick={() => void createNew()}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {onOpenFullView ? (
              <Button
                size="icon"
                variant="ghost"
                title="Open full view"
                onClick={() => {
                  onOpenFullView();
                  close();
                }}
              >
                <SquareArrowOutUpRight className="h-4 w-4" />
              </Button>
            ) : null}
            <Button size="icon" variant="ghost" title="Close" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <ConversationTranscript
          items={convo.items}
          error={convo.error}
          examples={EXAMPLES}
          onConfirm={(id, always) => void convo.confirm(id, always)}
          onReject={(id) => void convo.reject(id)}
        />

        <Composer
          streaming={convo.streaming}
          disabled={!activeId}
          onSend={(text) => void convo.send(text)}
          onStop={() => void convo.cancel()}
        />
      </div>
    </div>
  );
}
