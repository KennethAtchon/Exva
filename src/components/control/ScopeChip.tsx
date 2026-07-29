import { useEffect, useState } from "react";
import { Globe, Layers } from "lucide-react";
import { api, type ControlConversation } from "@/lib/exva";
import { cn } from "@/lib/utils";

export function ScopeChip({
  conversation,
  sessionName,
  className,
}: {
  conversation: ControlConversation | null;
  sessionName?: string | null;
  className?: string;
}) {
  const isSession = conversation?.scopeKind === "session";
  const sessionId = isSession ? conversation.scopeSessionId : null;
  const [resolvedName, setResolvedName] = useState<string | null>(
    sessionName ?? null,
  );

  useEffect(() => {
    if (sessionName) {
      setResolvedName(sessionName);
      return;
    }
    if (!sessionId) {
      setResolvedName(null);
      return;
    }

    let cancelled = false;
    api
      .listSessions({ includeArchived: true, includeAllEnvironments: true })
      .then((result) => {
        if (cancelled) return;
        const match = result.sessions.find(
          (session) => session.id === sessionId,
        );
        setResolvedName(match?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolvedName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, sessionName]);

  let label: string;
  if (!isSession) {
    label = "Workspace";
  } else if (!sessionId) {
    label = "Session deleted";
  } else {
    label = resolvedName ?? "Session";
  }

  const Icon = isSession ? Layers : Globe;
  const title = isSession && sessionId ? (resolvedName ?? sessionId) : label;
  const showNamedSession = Boolean(isSession && resolvedName);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1.5 text-caption text-text3",
        className,
      )}
      title={title}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">
        {showNamedSession ? (
          <>
            Session · <span className="text-text2">{resolvedName}</span>
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}
