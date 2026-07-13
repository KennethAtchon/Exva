import { Globe, Layers } from "lucide-react";
import type { ControlConversation } from "@/lib/exva";

export function ScopeChip({
  conversation,
  sessionName,
}: {
  conversation: ControlConversation | null;
  sessionName?: string | null;
}) {
  const isSession = conversation?.scopeKind === "session";
  const label = isSession
    ? conversation?.scopeSessionId
      ? `Session: ${sessionName ?? conversation.scopeSessionId}`
      : "Workspace (session deleted)"
    : "Workspace";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-micro font-medium text-muted-foreground">
      {isSession ? (
        <Layers className="h-3 w-3" />
      ) : (
        <Globe className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}
