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
          className="max-w-xs overflow-hidden rounded-sm border-border bg-surface2 px-3 py-2 text-caption text-text2"
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
        className="z-[200] w-72 border-border bg-surface p-2 shadow-popover"
      >
        <div className="mb-2 font-mono text-micro uppercase tracking-wider text-text3">
          Workspace Context
        </div>
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onGoGlobal?.();
          }}
          className="justify-between rounded-sm text-text2"
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
            className="justify-between rounded-sm text-text2"
          >
            <span>{session.name}</span>
            <span className="font-mono text-caption text-text3">
              {session.status}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
