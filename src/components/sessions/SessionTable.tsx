import { Badge } from "@/components/custom-ui";
import { Button, HelpTooltip } from "@/components/ui";
import type { SessionSummary } from "@/lib/exva";
import { SESSION_STATUS_HELP_IDS } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";
import type { ExecutionStage } from "@/lib/types";
import { getSearchProviderDisplayName } from "@electron/shared/instruments/search-providers";
import {
  SessionExecutionProgress,
  type SessionProgressState,
} from "./SessionExecutionProgress";

type LifecycleAction = "start" | "pause" | "resume" | "stop" | "forceStop";

const FORCE_STOP_CONFIRM_MESSAGE =
  "Force stop will end automated exit management for open positions. Continue?";

// ---------------------------------------------------------------------------
// SessionControls — lifecycle action button group within each card
// ---------------------------------------------------------------------------

const SessionControls = ({
  session,
  busy,
  aiBlocked,
  hasOpenTrades,
  onFocus,
  onEdit,
  onDuplicate,
  onSaveTemplate,
  onArchive,
  onLifecycle,
}: {
  session: SessionSummary;
  busy: boolean;
  aiBlocked: boolean;
  hasOpenTrades: boolean;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
}) => {
  const locked =
    session.status === "active" ||
    session.status === "paused" ||
    session.status === "monitoring_only";

  return (
    <div className={controlsBarClass}>
      <div className="flex items-center gap-1">
        <Button
          onClick={() => onFocus(session.id)}
          variant="outline"
          className={cn(
            actionButtonClass,
            session.isFocused && focusedButtonClass,
          )}
          disabled={busy || session.isFocused}
        >
          {session.isFocused ? "Focused" : "Focus"}
        </Button>
        <HelpTooltip glossaryId="focus-session" />
      </div>
      <div className="flex items-center gap-1">
        <Button
          onClick={() => onEdit(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy || locked}
        >
          Edit
        </Button>
        {locked ? <HelpTooltip glossaryId="session-edit-locked" /> : null}
      </div>
      <div className="flex items-center gap-1">
        <Button
          onClick={() => onDuplicate(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy}
        >
          Duplicate
        </Button>
        <HelpTooltip glossaryId="duplicate-session" />
      </div>
      <div className="flex items-center gap-1">
        <Button
          onClick={() => onSaveTemplate(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy}
        >
          Save Template
        </Button>
        <HelpTooltip glossaryId="save-template" />
      </div>
      <div className="flex-1" />
      {session.status === "draft" ||
      session.status === "idle" ||
      session.status === "stopped" ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={() => onLifecycle(session, "start")}
            variant="ghost"
            className={cn(
              primaryActionButtonClass,
              aiBlocked && blockedButtonClass,
            )}
            disabled={busy || aiBlocked}
          >
            Start
          </Button>
          <HelpTooltip
            topic="Start session"
            body={
              aiBlocked
                ? "AI providers are not connected yet. Configure them on the Strategy page before starting."
                : "Starts signal processing and new research cycles for this session."
            }
          />
        </div>
      ) : null}
      {session.status === "active" ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={() => onLifecycle(session, "pause")}
            variant="outline"
            className={actionButtonClass}
            disabled={busy}
          >
            Pause
          </Button>
          <HelpTooltip
            topic="Pause session"
            body="Pause stops new research but keeps exits and open-position monitoring active."
          />
        </div>
      ) : null}
      {session.status === "paused" ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={() => onLifecycle(session, "resume")}
            variant="ghost"
            className={primaryActionButtonClass}
            disabled={busy}
          >
            Resume
          </Button>
          <HelpTooltip glossaryId="resume-session" />
        </div>
      ) : null}
      {(session.status === "active" || session.status === "paused") &&
      !hasOpenTrades ? (
        <Button
          onClick={() => onLifecycle(session, "stop")}
          variant="ghost"
          className={dangerButtonClass}
          disabled={busy}
        >
          Stop
        </Button>
      ) : null}
      {(session.status === "active" || session.status === "paused") &&
      hasOpenTrades ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={() => onLifecycle(session, "stop")}
            variant="ghost"
            className={stopWhenFlatButtonClass}
            disabled={busy}
          >
            Stop when flat
          </Button>
          <HelpTooltip glossaryId="stop-when-flat" />
        </div>
      ) : null}
      {(session.status === "active" ||
        session.status === "paused" ||
        session.status === "monitoring_only") &&
      hasOpenTrades ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={() => {
              if (!window.confirm(FORCE_STOP_CONFIRM_MESSAGE)) return;
              onLifecycle(session, "forceStop");
            }}
            variant="ghost"
            className={forceStopButtonClass}
            disabled={busy}
          >
            Force stop (loses trade management)
          </Button>
          <HelpTooltip glossaryId="force-stop" />
        </div>
      ) : null}
      <Button
        onClick={() => onArchive(session.id)}
        variant="outline"
        className={actionButtonClass}
        disabled={busy || locked}
      >
        Archive
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SessionCard — single session article
// ---------------------------------------------------------------------------

const SessionCard = ({
  session,
  busySessionId,
  focusedSessionAiReady,
  progressBySessionId,
  researchFailuresBySessionId,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
  onSaveTemplate,
  onLifecycle,
  onRetryStep,
  onViewTrace,
  onPauseAfterStep,
}: {
  session: SessionSummary;
  busySessionId?: string | null;
  focusedSessionAiReady?: boolean | null;
  progressBySessionId?: Record<string, SessionProgressState>;
  researchFailuresBySessionId?: Record<
    string,
    { phase: string; error: string; at: string }
  >;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
  onRetryStep?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onViewTrace?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onPauseAfterStep?: (sessionId: string) => void;
}) => {
  const busy = busySessionId === session.id;
  const aiBlocked = session.isFocused && focusedSessionAiReady === false;
  const hasOpenTrades = session.openTradeCount > 0;
  const isDraining = session.status === "monitoring_only";
  const manualTickerCount = session.instrumentScope
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const runningButWaiting =
    session.status === "active" && manualTickerCount === 0;
  const showOrphanWarning =
    session.status === "stopped" && session.openTradeCount > 0;

  return (
    <article
      className="rounded-2xl px-[18px] py-4"
      style={{
        border: `1px solid ${session.isFocused ? "var(--color-info-border)" : "var(--border)"}`,
        background: session.isFocused
          ? "var(--color-info-dim)"
          : "var(--surface)",
        boxShadow: session.isFocused ? "0 8px 24px rgba(2,6,23,0.12)" : "none",
      }}
    >
      {/* Top row: name+objective | metrics+chips */}
      <div className="grid grid-cols-[1fr_220px] items-start gap-4">
        {/* Left: clickable name + objective */}
        <button
          type="button"
          onClick={() => onOpen(session)}
          className={titleButtonClass}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-[7px]">
            <span className="text-[15px] font-bold tracking-[-0.01em] text-[var(--text1)]">
              {session.name}
            </span>
            {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
            <div className="flex items-center gap-1">
              <Badge
                variant={
                  runningButWaiting ? "warn" : statusVariant(session.status)
                }
              >
                {runningButWaiting
                  ? "Waiting"
                  : formatSessionStatusLabel(session.status)}
              </Badge>
              <HelpTooltip
                glossaryId={SESSION_STATUS_HELP_IDS[session.status]}
                topic={`${session.name} status`}
              />
            </div>
          </div>
          <div className={objectiveClass}>{session.objective}</div>
        </button>

        {/* Right: metrics + chips */}
        <div className="grid gap-2">
          <div className={metricStripClass}>
            <Metric
              label="uptime"
              value={session.uptimeMin > 0 ? `${session.uptimeMin}m` : "—"}
            />
            <Metric label="trades" value={String(session.openTradeCount)} />
            <Metric label="brokers" value={String(session.brokerCount)} />
          </div>
          <div className="flex flex-wrap justify-end gap-[5px]">
            {session.instrumentClasses.map((ic) => (
              <span key={ic} className={chipClass}>
                {formatInstrumentClass(ic)}
              </span>
            ))}
            <span className={cn(chipClass, "text-[var(--text3)]")}>
              {session.selectionMode === "signal_driven"
                ? "Signals"
                : session.selectionMode === "ai_selected_universe"
                  ? "AI"
                  : "Manual"}
            </span>
            <HelpTooltip
              topic="Selection mode"
              body={
                session.selectionMode === "signal_driven"
                  ? "Signal-driven sessions react to subscribed signals."
                  : session.selectionMode === "ai_selected_universe"
                    ? "AI mode lets the selector discover instruments from the allowed universe."
                    : "Manual mode works from the tickers you provide."
              }
            />
            <span className={cn(chipClass, "text-[var(--text3)]")}>
              {session.executionMode === "live_allowed" ? "Live" : "Paper"}
            </span>
            <HelpTooltip
              glossaryId={
                session.executionMode === "live_allowed"
                  ? "execution-mode-live-allowed"
                  : "execution-mode-paper-only"
              }
            />
          </div>
        </div>
      </div>

      {/* Execution progress strip */}
      <SessionExecutionProgress
        sessionId={session.id}
        progress={progressBySessionId?.[session.id] ?? null}
        onRetry={onRetryStep ?? (() => undefined)}
        onViewTrace={onViewTrace ?? (() => undefined)}
        onPauseAfterStep={onPauseAfterStep ?? (() => undefined)}
      />
      {researchFailuresBySessionId?.[session.id] ? (
        <div className="mt-2 text-[12px] leading-snug text-error">
          Research phase failed ({researchFailuresBySessionId[session.id].phase}
          ): {researchFailuresBySessionId[session.id].error}
        </div>
      ) : null}
      <div className="mt-2 text-[12px] text-[var(--text3)]">
        {runningButWaiting
          ? "Waiting — no live inputs"
          : manualTickerCount > 0
            ? "No signals pending"
            : ""}
      </div>
      {isDraining ? (
        <div className={drainBannerClass}>
          Stopping when flat: managing {session.openTradeCount} open trade
          {session.openTradeCount === 1 ? "" : "s"}. Session stops automatically
          once flat.
        </div>
      ) : null}
      {showOrphanWarning ? (
        <div className={orphanWarningClass}>
          Stopped with {session.openTradeCount} open trade
          {session.openTradeCount === 1 ? "" : "s"}, no automated exits will
          fire. Restart to resume monitoring.
        </div>
      ) : null}

      {/* Meta strip */}
      <div className={metaGridClass}>
        <MetaBlock label="Scope" value={session.instrumentScope} />
        <MetaBlock
          label="Allocated"
          value={`$${session.totalAllocatedUsd.toLocaleString()}`}
        />
        <MetaBlock
          label="Search"
          value={getSearchProviderDisplayName(session.defaultSearchProviderId)}
        />
        <MetaBlock label="Updated" value={formatTimestamp(session.updatedAt)} />
      </div>

      <SessionControls
        session={session}
        busy={busy}
        aiBlocked={aiBlocked}
        hasOpenTrades={hasOpenTrades}
        onFocus={onFocus}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onSaveTemplate={onSaveTemplate}
        onArchive={onArchive}
        onLifecycle={onLifecycle}
      />
    </article>
  );
};

// ---------------------------------------------------------------------------
// SessionTable
// ---------------------------------------------------------------------------

export const SessionTable = ({
  sessions,
  busySessionId,
  focusedSessionAiReady,
  progressBySessionId,
  researchFailuresBySessionId,
  onFocus,
  onEdit,
  onOpen,
  onDuplicate,
  onArchive,
  onSaveTemplate,
  onLifecycle,
  onRetryStep,
  onViewTrace,
  onPauseAfterStep,
}: {
  sessions: SessionSummary[];
  busySessionId?: string | null;
  focusedSessionAiReady?: boolean | null;
  progressBySessionId?: Record<string, SessionProgressState>;
  researchFailuresBySessionId?: Record<
    string,
    { phase: string; error: string; at: string }
  >;
  onFocus: (id: string) => void;
  onEdit: (session: SessionSummary) => void;
  onOpen: (session: SessionSummary) => void;
  onDuplicate: (session: SessionSummary) => void;
  onArchive: (id: string) => void;
  onSaveTemplate: (session: SessionSummary) => void;
  onLifecycle: (session: SessionSummary, action: LifecycleAction) => void;
  onRetryStep?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onViewTrace?: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onPauseAfterStep?: (sessionId: string) => void;
}) => {
  return (
    <div className="grid gap-2.5">
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          busySessionId={busySessionId}
          focusedSessionAiReady={focusedSessionAiReady}
          progressBySessionId={progressBySessionId}
          researchFailuresBySessionId={researchFailuresBySessionId}
          onFocus={onFocus}
          onEdit={onEdit}
          onOpen={onOpen}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          onSaveTemplate={onSaveTemplate}
          onLifecycle={onLifecycle}
          onRetryStep={onRetryStep}
          onViewTrace={onViewTrace}
          onPauseAfterStep={onPauseAfterStep}
        />
      ))}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="text-center">
    <div className="text-[15px] font-bold tabular-nums text-[var(--text1)]">
      {value}
    </div>
    <div className="mt-0.5 text-[12px] uppercase tracking-[0.10em] text-[var(--text3)]">
      {label}
    </div>
  </div>
);

const MetaBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="mb-[3px] text-[12px] uppercase tracking-[0.10em] text-[var(--text3)]">
      {label}
    </div>
    <div className="truncate text-[12px] leading-snug text-[var(--text2)]">
      {value}
    </div>
  </div>
);

function formatSessionStatusLabel(status: SessionSummary["status"]): string {
  if (status === "monitoring_only") return "Stopping when flat";
  if (status === "attention_required") return "Needs attention";
  return status;
}

function statusVariant(
  status: SessionSummary["status"],
): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "monitoring_only":
      return "warn";
    case "attention_required":
      return "danger";
    case "archived":
      return "danger";
    case "stopped":
      return "purple";
    default:
      return "default";
  }
}

function formatInstrumentClass(
  value: SessionSummary["instrumentClasses"][number],
): string {
  return value === "stock"
    ? "Stocks"
    : value === "crypto"
      ? "Crypto"
      : value === "futures"
        ? "Futures"
        : "Predict";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const titleButtonClass =
  "block w-full min-w-0 cursor-pointer border-none bg-transparent p-0 text-left text-inherit";

const objectiveClass =
  "mt-1.5 line-clamp-2 overflow-hidden text-[12px] leading-normal text-[var(--text2)]";

const metricStripClass =
  "grid grid-cols-3 gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2.5";

const metaGridClass =
  "mt-3.5 grid grid-cols-4 gap-3 border-t border-[var(--border)] pt-3";

const chipClass =
  "rounded-full border border-[var(--border)] bg-[var(--chip)] px-2 py-[3px] text-[12px] font-medium tracking-[0.02em] text-[var(--text2)]";

const controlsBarClass =
  "mt-3.5 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-3";

const actionButtonClass =
  "h-auto min-h-[30px] rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-[var(--text2)]";

const focusedButtonClass = "border-info-border text-info";

const primaryActionButtonClass =
  "h-auto min-h-[30px] rounded-lg border border-transparent bg-[var(--accent)] px-2.5 py-1.5 text-[12px] font-semibold text-[hsl(var(--primary-foreground))]";

const dangerButtonClass =
  "h-auto min-h-[30px] rounded-lg border border-error-border bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-error";

const forceStopButtonClass =
  "h-auto min-h-[30px] rounded-lg border border-error-border bg-error-dim px-2.5 py-1.5 text-[12px] font-medium text-error";

const stopWhenFlatButtonClass =
  "h-auto min-h-[30px] rounded-lg border border-status-orange-border bg-status-orange-dim px-2.5 py-1.5 text-[12px] font-semibold text-status-orange";

const drainBannerClass =
  "mt-2 rounded-lg border border-status-orange-border bg-status-orange-dim px-3 py-2.5 text-[12px] leading-[1.45] text-status-orange";

const orphanWarningClass =
  "mt-2 rounded-lg border border-status-orange-border bg-status-orange-dim px-3 py-2.5 text-[12px] leading-[1.45] text-status-orange";

const blockedButtonClass = "cursor-not-allowed opacity-40";
