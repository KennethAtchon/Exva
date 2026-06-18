import { useEffect, useState } from "react";
import { Badge } from "@/components/custom-ui";
import { Button, HelpTooltip } from "@/components/ui";
import type { SessionSummary } from "@/lib/exva";
import { SESSION_STATUS_HELP_IDS } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";
import type { ExecutionStage } from "@/lib/types";
import { getSearchProviderDisplayName } from "@electron/shared/instruments/search-providers";
import {
  formatInstrumentOriginLabel,
  formatSelectionModeChip,
  parseTimerSourceConfig,
  sessionIsWaitingForLiveInputs,
} from "@electron/shared/instruments/session-input-model";
import {
  SessionExecutionProgress,
  type SessionProgressState,
} from "./SessionExecutionProgress";

type LifecycleAction = "start" | "pause" | "resume" | "stop" | "forceStop";

const FORCE_STOP_CONFIRM_MESSAGE =
  "Force stop will end automated exit management for open positions. Continue?";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Live countdown to the session's soonest next timer-source fire. */
const TimerFireCountdown = ({ nextFireAt }: { nextFireAt: string }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = Date.parse(nextFireAt);
  if (Number.isNaN(target)) return null;
  return <>Next timer fire in {formatCountdown(target - now)}</>;
};

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
  onFireRehearsalSignal,
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
  onFireRehearsalSignal?: (session: SessionSummary) => void;
}) => {
  const locked =
    session.status === "active" ||
    session.status === "paused" ||
    session.status === "monitoring_only";

  return (
    <div className={controlsBarClass}>
      <HelpTooltip glossaryId="focus-session">
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
      </HelpTooltip>
      {locked ? (
        <HelpTooltip glossaryId="session-edit-locked">
          <Button
            onClick={() => onEdit(session)}
            variant="outline"
            className={actionButtonClass}
            disabled={busy || locked}
          >
            Edit
          </Button>
        </HelpTooltip>
      ) : (
        <Button
          onClick={() => onEdit(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy}
        >
          Edit
        </Button>
      )}
      <HelpTooltip glossaryId="duplicate-session">
        <Button
          onClick={() => onDuplicate(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy}
        >
          Duplicate
        </Button>
      </HelpTooltip>
      <HelpTooltip glossaryId="save-template">
        <Button
          onClick={() => onSaveTemplate(session)}
          variant="outline"
          className={actionButtonClass}
          disabled={busy}
        >
          Save Template
        </Button>
      </HelpTooltip>
      <div className="flex-1" />
      {session.status === "draft" ||
      session.status === "idle" ||
      session.status === "stopped" ? (
        <HelpTooltip
          topic="Start session"
          body={
            aiBlocked
              ? "AI providers are not connected yet. Configure them on the Strategy page before starting."
              : "Starts signal processing and new research cycles for this session."
          }
        >
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
        </HelpTooltip>
      ) : null}
      {session.status === "active" ? (
        <HelpTooltip
          topic="Pause session"
          body="Pause stops new research but keeps exits and open-position monitoring active."
        >
          <Button
            onClick={() => onLifecycle(session, "pause")}
            variant="outline"
            className={actionButtonClass}
            disabled={busy}
          >
            Pause
          </Button>
        </HelpTooltip>
      ) : null}
      {session.canFireRehearsalSignal && onFireRehearsalSignal ? (
        <HelpTooltip glossaryId="fire-rehearsal-signal">
          <Button
            onClick={() => onFireRehearsalSignal(session)}
            variant="outline"
            className={actionButtonClass}
            disabled={busy}
          >
            Fire rehearsal signal
          </Button>
        </HelpTooltip>
      ) : null}
      {session.status === "paused" ? (
        <HelpTooltip glossaryId="resume-session">
          <Button
            onClick={() => onLifecycle(session, "resume")}
            variant="ghost"
            className={primaryActionButtonClass}
            disabled={busy}
          >
            Resume
          </Button>
        </HelpTooltip>
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
        <HelpTooltip glossaryId="stop-when-flat">
          <Button
            onClick={() => onLifecycle(session, "stop")}
            variant="ghost"
            className={stopWhenFlatButtonClass}
            disabled={busy}
          >
            Stop when flat
          </Button>
        </HelpTooltip>
      ) : null}
      {(session.status === "active" ||
        session.status === "paused" ||
        session.status === "monitoring_only") &&
      hasOpenTrades ? (
        <HelpTooltip glossaryId="force-stop">
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
        </HelpTooltip>
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
  onFireRehearsalSignal,
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
  onFireRehearsalSignal?: (session: SessionSummary) => void;
}) => {
  const busy = busySessionId === session.id;
  const aiBlocked = session.isFocused && focusedSessionAiReady === false;
  const hasOpenTrades = session.openTradeCount > 0;
  const isDraining = session.status === "monitoring_only";
  const runningButWaiting = sessionIsWaitingForLiveInputs({
    status: session.status,
    readiness: session.readiness,
  });
  const selectionModeChip = formatSelectionModeChip({
    selectionMode: session.selectionMode,
    inputModel: session.inputModel,
    experienceSignalSourceType: session.subscribedSources[0]?.type ?? null,
  });
  const timerSource = session.subscribedSources.find(
    (source) => source.type === "timer",
  );
  const timerConfig = timerSource?.configJson
    ? parseTimerSourceConfig(timerSource.configJson)
    : null;
  const instrumentOrigin = formatInstrumentOriginLabel({
    inputModel: session.inputModel,
    experienceSignalSourceType: session.subscribedSources[0]?.type ?? null,
    timerSymbol: timerConfig?.symbol ?? null,
    timerCadence: timerConfig?.cadence ?? null,
    instrumentScope: session.instrumentScope,
  });
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
            <HelpTooltip
              topic="Selection mode"
              body={selectionModeChip.tooltip}
            >
              <span
                className={cn(chipClass, "text-[var(--text3)] cursor-default")}
              >
                {selectionModeChip.label}
              </span>
            </HelpTooltip>
            {session.rehearsalMode ? (
              <span className={cn(chipClass, "text-[var(--text3)]")}>
                Rehearsal
              </span>
            ) : null}
            <HelpTooltip
              glossaryId={
                session.executionMode === "live_allowed"
                  ? "execution-mode-live-allowed"
                  : "execution-mode-paper-only"
              }
            >
              <span
                className={cn(chipClass, "text-[var(--text3)] cursor-default")}
              >
                {session.executionMode === "live_allowed" ? "Live" : "Paper"}
              </span>
            </HelpTooltip>
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
        {runningButWaiting ? (
          "Waiting — no live inputs"
        ) : session.status === "active" &&
          session.subscribedSources.some((source) => source.enabled) ? (
          session.nextTimerFireAt ? (
            <TimerFireCountdown nextFireAt={session.nextTimerFireAt} />
          ) : (
            "Listening for signals"
          )
        ) : (
          ""
        )}
      </div>
      {session.rehearsalEligible && !session.rehearsalMode ? (
        <div className={rehearsalSetupBannerClass}>
          Mock broker assigned, but this session still listens to{" "}
          {session.subscribedSources[0]?.name ?? "the experience EDGAR source"}.
          Edit the session and select <strong>Mock rehearsal</strong> as the
          signal source, then save.
        </div>
      ) : null}
      {session.rehearsalMode ? (
        <div className={rehearsalBannerClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] leading-snug text-[var(--text2)]">
              {session.canFireRehearsalSignal
                ? "Mock rehearsal — fire a synthetic filing to drive the pipeline."
                : session.status === "active"
                  ? "Mock rehearsal — enable the Mock rehearsal signal source to fire."
                  : "Mock rehearsal — start the session, then fire a synthetic signal here."}
            </div>
            {session.canFireRehearsalSignal && onFireRehearsalSignal ? (
              <HelpTooltip glossaryId="fire-rehearsal-signal">
                <Button
                  onClick={() => onFireRehearsalSignal(session)}
                  variant="outline"
                  className={actionButtonClass}
                  disabled={busy}
                >
                  Fire rehearsal signal
                </Button>
              </HelpTooltip>
            ) : null}
          </div>
        </div>
      ) : null}
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
        <MetaBlock label="Instruments" value={instrumentOrigin} />
        <MetaBlock
          label="Allocated"
          value={`$${session.totalAllocatedUsd.toLocaleString()}`}
        />
        {session.inputModel === "search_scoped" ||
        session.inputModel === "search_universe" ? (
          <MetaBlock
            label="Search"
            value={getSearchProviderDisplayName(
              session.defaultSearchProviderId,
            )}
          />
        ) : null}
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
        onFireRehearsalSignal={onFireRehearsalSignal}
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
  onFireRehearsalSignal,
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
  onFireRehearsalSignal?: (session: SessionSummary) => void;
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
          onFireRehearsalSignal={onFireRehearsalSignal}
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

const rehearsalBannerClass =
  "mt-2 rounded-lg border border-info-border bg-info-dim px-3 py-2.5";

const rehearsalSetupBannerClass =
  "mt-2 rounded-lg border border-warning-border bg-warning-dim px-3 py-2.5 text-[12px] leading-snug text-warning";

const orphanWarningClass =
  "mt-2 rounded-lg border border-status-orange-border bg-status-orange-dim px-3 py-2.5 text-[12px] leading-[1.45] text-status-orange";

const blockedButtonClass = "cursor-not-allowed opacity-40";
