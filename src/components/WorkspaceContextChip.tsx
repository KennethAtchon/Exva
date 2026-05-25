import { useEffect, useState } from "react";
import { api, type SessionSummary } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";

interface WorkspaceContextChipProps {
  onSwitchSession?: (id: string) => void;
  onGoGlobal?: () => void;
}

export const WorkspaceContextChip = ({
  onSwitchSession,
  onGoGlobal,
}: WorkspaceContextChipProps) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const environmentMode = useWorkspaceStore((state) => state.environmentMode);
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    api
      .listSessions({
        includeArchived: false,
        executionMode:
          environmentMode === "live" ? "live_allowed" : "paper_only",
      })
      .then((result) => setSessions(result.sessions))
      .catch(() => {});
  }, [open, environmentMode]);

  const focused = sessions.find((session) => session.id === focusedSessionId);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="max-w-[min(280px,42vw)] overflow-hidden rounded-full border-border bg-[var(--surface2)] px-3 py-2 text-xs text-[var(--text2)]"
        >
          <span className="truncate">
            {viewMode === "global"
              ? "Global Workspace"
              : (focused?.name ?? "Focused Session")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[200] w-[min(280px,calc(100vw-48px))] border-border bg-[var(--surface)] p-2"
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Workspace Context
        </div>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onGoGlobal?.();
          }}
          className="justify-between rounded-lg text-[var(--text2)]"
        >
          Global Workspace
        </DropdownMenuItem>
        {sessions.map((session) => (
          <DropdownMenuItem
            key={session.id}
            onClick={() => {
              setOpen(false);
              onSwitchSession?.(session.id);
            }}
            className="justify-between rounded-lg text-[var(--text2)]"
          >
            <span>{session.name}</span>
            <span style={{ color: "var(--text3)", fontSize: 12 }}>
              {session.status}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
