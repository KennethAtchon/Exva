import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { DashboardStats, SessionStatus } from "@/lib/types";
import { Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HelpTooltip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { api, type SessionSummary } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useControlStore } from "@/store/controlStore";
import { sessionMatchesEnvironment } from "@/lib/environment-mode";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { getNavItem, type PageKey } from "@/lib/nav";
import {
  getHelpEntry,
  SESSION_STATUS_HELP_IDS,
  type HelpGlossaryId,
} from "@/lib/help-glossary";
import { cn } from "@/lib/utils";

const SESSION_STATUS: Record<
  SessionStatus,
  { label: string; dotClass: string; pulse: boolean }
> = {
  draft: { label: "Draft", dotClass: "bg-text3", pulse: false },
  active: { label: "Active", dotClass: "bg-success", pulse: true },
  attention_required: {
    label: "Needs Attention",
    dotClass: "bg-error",
    pulse: true,
  },
  paused: { label: "Paused", dotClass: "bg-warning", pulse: false },
  monitoring_only: {
    label: "Stopping when flat",
    dotClass: "bg-status-orange",
    pulse: true,
  },
  stopped: { label: "Stopped", dotClass: "bg-error", pulse: false },
  idle: { label: "Idle", dotClass: "bg-text3", pulse: false },
  archived: { label: "Archived", dotClass: "bg-text2", pulse: false },
};

const Hint = ({
  children,
  glossaryId,
  title,
  body,
  topic,
  className,
}: {
  children: ReactNode;
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
  topic?: string;
  className?: string;
}) => {
  const entry = getHelpEntry({ glossaryId, title, body });
  const ariaTopic = topic ?? entry.title ?? "this item";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("inline-flex cursor-help", className)}
          aria-label={`More information about ${ariaTopic}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="end"
        className="max-w-xs space-y-1.5 px-3 py-2 text-left"
      >
        {entry.title ? (
          <div className="text-caption font-semibold text-text1">
            {entry.title}
          </div>
        ) : null}
        <div className="text-caption leading-snug text-text2">{entry.body}</div>
      </TooltipContent>
    </Tooltip>
  );
};

type ContextBarProps = {
  activePage: PageKey;
  onNavigate: (p: PageKey) => void;
  onNavigateToAttentionSessions?: () => void;
  attentionCount: number;
  sessionStatus: SessionStatus;
  onSessionAction: (
    a: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => void;
  sessionActionPending?: boolean;
  stats: DashboardStats | null;
  onOpenPalette: () => void;
};

export function ContextBar({
  activePage,
  onNavigate,
  onNavigateToAttentionSessions,
  attentionCount,
  sessionStatus,
  onSessionAction,
  sessionActionPending = false,
  stats,
  onOpenPalette,
}: ContextBarProps) {
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const aiReady = useWorkspaceStore((s) => s.focusedSessionAiReady);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const [focusedSession, setFocusedSession] = useState<SessionSummary | null>(
    null,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const refresh = useCallback(() => {
    api
      .listSessions({ includeArchived: false })
      .then((res) => {
        setSessions(res.sessions);
        if (focusedSessionId) {
          setFocusedSession(
            res.sessions.find((s) => s.id === focusedSessionId) ?? null,
          );
        } else {
          setFocusedSession(null);
        }
      })
      .catch(() => {
        setSessions([]);
      });
  }, [focusedSessionId]);

  useEffect(() => {
    refresh();
  }, [focusedSessionId, environmentMode, refresh]);

  useExvaEvent("session_status_changed", () => refresh());
  useExvaEvent("stats_update", () => refresh());

  const focusedInCurrentEnvironment =
    focusedSession != null &&
    sessionMatchesEnvironment(focusedSession.executionMode, environmentMode);
  const sessionControlsDisabled =
    !focusedInCurrentEnvironment ||
    viewMode === "global" ||
    sessionActionPending;

  const ss = SESSION_STATUS[sessionStatus];
  const isRunning = sessionStatus === "active" || sessionStatus === "paused";
  const isDraining = sessionStatus === "monitoring_only";
  const hasOpenTrades = (focusedSession?.openTradeCount ?? 0) > 0;
  const isGlobal =
    viewMode === "global" || !focusedSessionId || !focusedInCurrentEnvironment;
  const sessionName = focusedInCurrentEnvironment
    ? (focusedSession?.name ?? "Focused Session")
    : "Focused Session";
  const hubLabel = getNavItem(activePage).label;
  const isMonitorAlive = isRunning || isDraining;
  const startDisabled = aiReady === false || sessionControlsDisabled;

  const envSessions = sessions.filter((s) =>
    sessionMatchesEnvironment(s.executionMode, environmentMode),
  );

  return (
    <header className="relative z-10 flex h-contextbar min-w-0 shrink-0 items-center gap-3 overflow-x-auto border-b border-border bg-surface px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-sans text-label text-text2">
          {hubLabel}
        </span>
        <span className="text-text3">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex max-w-48 items-center gap-1 truncate rounded-sm px-1.5 py-0.5 font-sans text-label text-text1 transition-colors duration-hover hover:bg-surface2"
            >
              {isGlobal ? "Global" : sessionName}
              <ChevronDown size={14} className="shrink-0 text-text3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[200] min-w-44 border-border bg-surface p-1 shadow-popover"
          >
            <DropdownMenuItem
              onClick={async () => {
                await api.goGlobal();
                await loadWorkspaceView();
              }}
              className="gap-2 rounded-sm px-2.5 py-2 text-body text-text2 focus:bg-surface2 focus:text-text1"
            >
              Global
            </DropdownMenuItem>
            {envSessions.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={async () => {
                  await api.focusSession(s.id);
                  await loadWorkspaceView();
                  if (activePage !== "sessions") onNavigate("sessions");
                }}
                className={cn(
                  "gap-2 rounded-sm px-2.5 py-2 text-body text-text2 focus:bg-surface2 focus:text-text1",
                  s.id === focusedSessionId && "font-medium text-text1",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    SESSION_STATUS[s.status]?.dotClass ?? "bg-text3",
                  )}
                />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {attentionCount > 0 && (
          <button
            type="button"
            onClick={() => onNavigateToAttentionSessions?.()}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-error-border bg-error-dim px-1 font-mono text-micro text-error"
          >
            {attentionCount}
          </button>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Hint
          glossaryId={
            environmentMode === "live"
              ? "environment-live"
              : "environment-paper"
          }
          className={cn(
            "flex cursor-default items-center gap-1.5 rounded-full border px-2.5 py-1",
            environmentMode === "live"
              ? "border-success-border bg-success-dim"
              : "border-warning-border bg-warning-dim",
          )}
        >
          <Dot
            color={
              environmentMode === "live"
                ? "var(--color-success)"
                : "var(--color-warning)"
            }
            pulse={environmentMode === "live"}
            size={7}
          />
          <span
            className={cn(
              "text-caption font-medium uppercase tracking-wide",
              environmentMode === "live" ? "text-success" : "text-warning",
            )}
          >
            {environmentMode === "live" ? "Live" : "Paper"}
          </span>
        </Hint>

        {stats && sessionStatus === "active" && (
          <Hint
            glossaryId="daily-pnl"
            topic="Live session stats"
            body="Shows today's profit and loss and how long the focused session has been running."
            className="flex items-center gap-1.5 border-r border-hairline pr-2"
          >
            <span className="font-mono text-data font-semibold text-success">
              {fmt.pnl(stats.daily_pnl_usd)}
            </span>
            <span className="text-caption text-text3">·</span>
            <span className="font-mono text-caption text-text3">
              {fmt.uptime(stats.session_uptime_min)}
            </span>
          </Hint>
        )}

        {!isGlobal && (
          <Hint
            glossaryId={SESSION_STATUS_HELP_IDS[sessionStatus]}
            topic={`${sessionName} status`}
            className="flex max-w-52 cursor-default items-center gap-1.5 overflow-hidden rounded-sm border border-border bg-surface2 px-2.5 py-1"
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                ss.dotClass,
                ss.pulse && "animate-[pulse-dot_2s_ease-in-out_infinite]",
              )}
            />
            <span className="truncate text-caption font-medium text-text1">
              {ss.label}
            </span>
          </Hint>
        )}

        {!isGlobal &&
          sessionStatus !== "active" &&
          sessionStatus !== "monitoring_only" && (
            <Button
              size="sm"
              variant="default"
              disabled={startDisabled}
              title={
                sessionControlsDisabled
                  ? "The focused session is not in the current workspace environment."
                  : aiReady === false
                    ? "AI providers are not connected yet."
                    : "Start or resume the focused session."
              }
              onClick={() =>
                onSessionAction(
                  sessionStatus === "paused" ||
                    sessionStatus === "attention_required"
                    ? "resume"
                    : "start",
                )
              }
            >
              ▶{" "}
              {sessionStatus === "paused" ||
              sessionStatus === "attention_required"
                ? "Resume"
                : "Start"}
            </Button>
          )}
        {sessionStatus === "active" && !sessionControlsDisabled && (
          <Button
            size="sm"
            variant="warning"
            disabled={sessionActionPending}
            onClick={() => onSessionAction("pause")}
          >
            {sessionActionPending ? "Pausing…" : "⏸ Pause"}
          </Button>
        )}
        {isRunning && !sessionControlsDisabled && !hasOpenTrades ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={sessionActionPending}
            onClick={() => onSessionAction("stop")}
          >
            ■
          </Button>
        ) : null}
        {isRunning && !sessionControlsDisabled && hasOpenTrades ? (
          <Button
            size="sm"
            variant="warning"
            className="border-status-orange-border bg-status-orange-dim text-status-orange"
            disabled={sessionActionPending}
            onClick={() => onSessionAction("stop")}
          >
            {sessionActionPending ? "Stopping…" : "Stop when flat"}
          </Button>
        ) : null}
        {isMonitorAlive && !sessionControlsDisabled && hasOpenTrades ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={sessionActionPending}
            onClick={() => onSessionAction("forceStop")}
          >
            Force stop
          </Button>
        ) : null}

        <HelpTooltip topic="Command palette" body="Open quick actions with ⌘K.">
          <Button
            size="sm"
            variant="secondary"
            onClick={onOpenPalette}
            className="font-mono text-caption"
          >
            ⌘K
          </Button>
        </HelpTooltip>

        <HelpTooltip
          topic="Assistant"
          body="Open the assistant panel (⌘K → Open assistant)."
        >
          <Button
            size="icon"
            variant="secondary"
            aria-label="Open assistant"
            onClick={() => useControlStore.getState().toggleSlideOver()}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </HelpTooltip>
      </div>
    </header>
  );
}
