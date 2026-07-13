import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import type { PageKey } from "@/lib/nav";
import { TooltipProvider } from "@/components/ui";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { Rail } from "./Rail";
import { ContextBar } from "./ContextBar";
import { EventTape } from "./EventTape";

export type ShellProps = {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  attentionCountOnDashboard?: boolean;
  settingsAlarm?: boolean;
  sessionStatus: SessionStatus;
  onSessionAction: (
    a: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => void;
  sessionActionPending?: boolean;
  stats: DashboardStats | null;
  onOpenPalette: () => void;
  children: ReactNode;
};

export function Shell({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  attentionCountOnDashboard = true,
  settingsAlarm = false,
  sessionStatus,
  onSessionAction,
  sessionActionPending = false,
  stats,
  onOpenPalette,
  children,
}: ShellProps) {
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const [attentionCount, setAttentionCount] = useState(0);

  const refreshAttention = useCallback(() => {
    api
      .listSessions({ includeArchived: false })
      .then((res) => {
        setAttentionCount(
          res.sessions.filter((s) => s.status === "attention_required").length,
        );
      })
      .catch(() => setAttentionCount(0));
  }, []);

  useEffect(() => {
    refreshAttention();
  }, [focusedSessionId, refreshAttention]);

  useExvaEvent("session_status_changed", () => refreshAttention());
  useExvaEvent("stats_update", () => refreshAttention());

  const shownAttention = attentionCountOnDashboard ? attentionCount : 0;
  const needsStrategyConfig =
    sessionStatus === "draft" ||
    sessionStatus === "idle" ||
    sessionStatus === "stopped";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-bg font-sans text-text1">
        <Rail
          activePage={activePage}
          onNavigate={onNavigate}
          onNavigateToAttentionSessions={onNavigateToAttentionSessions}
          attentionCount={shownAttention}
          settingsAlarm={settingsAlarm}
          needsStrategyConfig={needsStrategyConfig && activePage !== "sessions"}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ContextBar
            activePage={activePage}
            onNavigate={onNavigate}
            onNavigateToAttentionSessions={onNavigateToAttentionSessions}
            attentionCount={shownAttention}
            sessionStatus={sessionStatus}
            onSessionAction={onSessionAction}
            sessionActionPending={sessionActionPending}
            stats={stats}
            onOpenPalette={onOpenPalette}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
          <EventTape />
        </div>
      </div>
    </TooltipProvider>
  );
}
