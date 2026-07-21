import { useEffect, useRef, useState } from "react";
import { Button, HelpTooltip } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ExecutionStage, ExecutionStepStatus } from "@/lib/types";
import type { SessionExecutionProgressResponse } from "@/lib/exva";

export interface SessionProgressState {
  cycleId: string;
  activeStage: ExecutionStage | null;
  activeStatus: ExecutionStepStatus | null;
  progressPct: number;
  stageLabel: string;
  activeRoleLabel: string | null;
  retryable: boolean;
  nextRetryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  cycleIdShort: string;
  isHoldingPosition: boolean;
  openTradeCount: number;
  workers?: Array<{
    workerId: string;
    status: "running" | "succeeded" | "failed";
  }> | null;
  workerPhase?: string | null;
  workerStageId?: string | null;
}

type StatusChipTone = {
  label: string;
  color: string;
  border: string;
  background: string;
};

const STAGE_ORDER: ExecutionStage[] = [
  "selector",
  "candidate_validation",
  "technical",
  "fundamental",
  "review",
  "decision",
  "risk_gate",
  "broker_order",
  "monitoring",
];

const STAGE_META: Record<
  ExecutionStage,
  { label: string; progressPct: number }
> = {
  selector: { label: "Finding instruments", progressPct: 10 },
  candidate_validation: { label: "Validating candidates", progressPct: 20 },
  technical: { label: "Technical analysis", progressPct: 35 },
  fundamental: { label: "Fundamental analysis", progressPct: 50 },
  review: { label: "Reviewing thesis", progressPct: 65 },
  decision: { label: "Making decision", progressPct: 78 },
  risk_gate: { label: "Risk checks", progressPct: 88 },
  broker_order: { label: "Broker execution", progressPct: 96 },
  monitoring: { label: "Monitoring position", progressPct: 96 },
};

export function deriveProgress(
  steps: SessionExecutionProgressResponse["steps"],
  cycleId: string,
  activeRoleLabel: string | null = null,
  openTradeCount = 0,
  monitoringActive = false,
  workers: SessionExecutionProgressResponse["workers"] = null,
  workerPhase: string | null = null,
  workerStageId: string | null = null,
): SessionProgressState | null {
  if (steps.length === 0 && !(workers && workers.length > 0)) return null;

  const stepsByStage = new Map(steps.map((step) => [step.stage, step]));
  let activeStep: SessionExecutionProgressResponse["steps"][number] | undefined;
  for (const stage of STAGE_ORDER) {
    const step = stepsByStage.get(stage);
    if (
      step &&
      step.status !== "succeeded" &&
      step.status !== "skipped" &&
      step.status !== "pending"
    ) {
      activeStep = step;
      break;
    }
  }

  const allSucceeded =
    steps.length > 0 &&
    steps.every((s) => s.status === "succeeded" || s.status === "skipped");
  const hasMonitoring =
    monitoringActive ||
    (allSucceeded && steps.some((s) => s.stage === "monitoring"));

  if (!activeStep && !hasMonitoring && !(workers && workers.length > 0)) {
    return null;
  }
  if (
    hasMonitoring &&
    openTradeCount === 0 &&
    !monitoringActive &&
    !(workers && workers.length > 0)
  ) {
    return null;
  }

  const stage = hasMonitoring || !activeStep ? "monitoring" : activeStep.stage;
  const status =
    hasMonitoring || !activeStep
      ? ("succeeded" as ExecutionStepStatus)
      : activeStep.status;
  const isHoldingPosition = hasMonitoring && openTradeCount > 0;
  const meta = STAGE_META[stage] ?? STAGE_META.selector;
  const runningWorkers = (workers ?? []).filter((w) => w.status === "running");
  const workerLabel =
    runningWorkers.length > 0
      ? runningWorkers.map((w) => w.workerId).join(", ")
      : activeRoleLabel;

  return {
    cycleId,
    activeStage: stage,
    activeStatus: status,
    progressPct: isHoldingPosition ? 96 : meta.progressPct,
    stageLabel: isHoldingPosition
      ? `Holding position (${openTradeCount}) — waiting for exit`
      : meta.label,
    activeRoleLabel: status === "running" || runningWorkers.length > 0
      ? workerLabel
      : null,
    retryable: activeStep?.retryable ?? false,
    nextRetryAt: activeStep?.nextRetryAt ?? null,
    lastErrorCode: activeStep?.lastErrorCode ?? null,
    lastErrorMessage: activeStep?.lastErrorMessage ?? null,
    cycleIdShort: cycleId.slice(0, 8),
    isHoldingPosition,
    openTradeCount,
    workers: workers ?? null,
    workerPhase,
    workerStageId,
  };
}

interface SessionExecutionProgressProps {
  sessionId: string;
  progress: SessionProgressState | null;
  onRetry: (sessionId: string, cycleId: string, stage: ExecutionStage) => void;
  onViewTrace: (
    sessionId: string,
    cycleId: string,
    stage: ExecutionStage,
  ) => void;
  onPauseAfterStep: (sessionId: string) => void;
}

export const SessionExecutionProgress = ({
  sessionId,
  progress,
  onRetry,
  onViewTrace,
  onPauseAfterStep,
}: SessionExecutionProgressProps) => {
  const [countdown, setCountdown] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (progress?.activeStatus === "retrying" && progress.nextRetryAt) {
      const tick = () => {
        const nextRetryAt = progress.nextRetryAt;
        if (!nextRetryAt) return;
        const secs = Math.max(
          0,
          Math.ceil((new Date(nextRetryAt).getTime() - Date.now()) / 1000),
        );
        setCountdown(secs);
      };
      tick();
      intervalRef.current = setInterval(tick, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [progress?.activeStatus, progress?.nextRetryAt]);

  if (!progress) return null;

  const {
    activeStage,
    activeStatus,
    progressPct,
    stageLabel,
    activeRoleLabel,
    retryable,
    lastErrorMessage,
    cycleId,
    cycleIdShort,
    isHoldingPosition,
    workers,
    workerPhase,
    workerStageId,
  } = progress;
  const isFailed = activeStatus === "failed";
  const isRetrying = activeStatus === "retrying";
  const isRunning = activeStatus === "running";
  const isMonitoring =
    activeStatus === "succeeded" && activeStage === "monitoring";

  const statusChip = resolveStatusChip({
    isRetrying,
    isFailed,
    retryable,
    countdown,
    isHoldingPosition,
  });
  const detailMessageColor = isRetrying
    ? "var(--color-info)"
    : "var(--color-orange)";

  return (
      <div className="mb-1 mt-3">
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface3">
        <div
          className={cn(
            "h-full rounded-full",
            !isHoldingPosition && "bg-accent",
            isHoldingPosition && "w-[66%]",
          )}
          style={{
            width: isHoldingPosition ? undefined : `${progressPct}%`,
            transition: isRunning ? "width 0.6s ease" : "none",
            ...(isHoldingPosition
              ? {
                  background:
                    "linear-gradient(90deg, rgba(251,191,36,0.35), rgba(251,191,36,0.75), rgba(251,191,36,0.35))",
                  backgroundSize: "200% 100%",
                  animation: "exva-holding-pulse 2.4s ease-in-out infinite",
                }
              : {}),
          }}
        />
      </div>

      {workers && workers.length > 0 ? (
        <WorkerProgressBars
          workers={workers}
          phase={workerPhase}
          stageId={workerStageId}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="text-caption font-medium uppercase tracking-[0.08em] text-text3">
            {stageLabel}
          </span>

          {statusChip ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-mono text-caption"
              style={{
                color: statusChip.color,
                border: `1px solid ${statusChip.border}`,
                background: statusChip.background,
              }}
            >
              {statusChip.label}
            </span>
          ) : null}

          {activeRoleLabel && isRunning ? (
            <span className="shrink-0 rounded bg-surface2 px-1.5 py-0.5 font-mono text-caption text-text2">
              {activeRoleLabel}
            </span>
          ) : null}

          {lastErrorMessage && (isFailed || isRetrying) ? (
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-caption"
                style={{ color: detailMessageColor }}
              >
                {lastErrorMessage.length > 60
                  ? `${lastErrorMessage.slice(0, 60)}…`
                  : lastErrorMessage}
              </span>
              <HelpTooltip topic="Last error" body={lastErrorMessage} />
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-[5px]">
          {isFailed && activeStage ? (
            <>
              {retryable ? (
                <Button
                  variant="outline"
                  className="h-6 rounded-md border border-error-border bg-transparent px-2 text-caption text-error"
                  onClick={() => onRetry(sessionId, cycleId, activeStage)}
                >
                  Retry
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="h-6 rounded-md border border-border bg-transparent px-2 text-caption text-text2"
                onClick={() => onViewTrace(sessionId, cycleId, activeStage)}
              >
                View Trace
              </Button>
            </>
          ) : null}

          {isRunning || isRetrying || isMonitoring ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded bg-transparent px-1 py-0.5 text-caption text-text3"
                onClick={() => onPauseAfterStep(sessionId)}
              >
                <span className="inline-block size-1.5 shrink-0 rounded-sm border border-text3" />
                Pause after step
              </button>
              <HelpTooltip
                topic="Pause after step"
                body="Finishes the current stage, then pauses new research while leaving exits and open-position monitoring active."
              />
            </div>
          ) : null}

          <div className="flex items-center gap-1">
            <span className="font-mono text-caption text-text3 opacity-60">
              #{cycleIdShort}
            </span>
            <HelpTooltip
              topic="Cycle id"
              body={`Cycle ${cycleId} is the execution trace id for this research run.`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

type WorkerBarStatus = NonNullable<SessionProgressState["workers"]>[number]["status"];

function workerBarAppearance(status: WorkerBarStatus): {
  tone: string;
  width: string;
  animated: boolean;
} {
  switch (status) {
    case "succeeded":
      return { tone: "bg-success", width: "100%", animated: false };
    case "failed":
      return { tone: "bg-error", width: "100%", animated: false };
    case "running":
      return { tone: "bg-accent", width: "66%", animated: true };
  }
}

function WorkerProgressBars({
  workers,
  phase,
  stageId,
}: {
  workers: NonNullable<SessionProgressState["workers"]>;
  phase?: string | null;
  stageId?: string | null;
}) {
  return (
    <div className="mb-2 grid gap-1">
      <div className="font-mono text-micro uppercase tracking-wider text-text3">
        {phase ?? "phase"}
        {stageId ? ` · ${stageId}` : ""} · workers
      </div>
      {workers.map((worker) => {
        const { tone, width, animated } = workerBarAppearance(worker.status);
        return (
          <div
            key={worker.workerId}
            className="grid grid-cols-[7rem_1fr_auto] items-center gap-2"
          >
            <span className="truncate font-mono text-micro text-text2">
              {worker.workerId}
            </span>
            <div className="h-1 overflow-hidden rounded-full bg-surface3">
              <div
                className={cn("h-full rounded-full", tone)}
                style={{
                  width,
                  transition: "width 0.4s ease",
                  ...(animated
                    ? {
                        backgroundSize: "200% 100%",
                        animation:
                          "exva-holding-pulse 2.4s ease-in-out infinite",
                      }
                    : {}),
                }}
              />
            </div>
            <span className="font-mono text-micro text-text3">
              {worker.status}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function resolveStatusChip({
  isRetrying,
  isFailed,
  retryable,
  countdown,
  isHoldingPosition,
}: {
  isRetrying: boolean;
  isFailed: boolean;
  retryable: boolean;
  countdown: number;
  isHoldingPosition: boolean;
}): StatusChipTone | null {
  if (isHoldingPosition) {
    return {
      label: "Holding",
      color: "var(--color-warning)",
      border: "var(--color-warning-border)",
      background: "var(--color-warning-dim)",
    };
  }

  if (isRetrying) {
    return {
      label: `Retrying in ${countdown}s`,
      color: "var(--color-info)",
      border: "var(--color-info-border)",
      background: "var(--color-info-dim)",
    };
  }

  if (isFailed && retryable) {
    return {
      label: "Retry available",
      color: "var(--color-error)",
      border: "var(--color-error-border)",
      background: "var(--color-error-dim)",
    };
  }

  if (isFailed) {
    return {
      label: "Needs attention",
      color: "var(--color-orange)",
      border: "var(--color-orange-border)",
      background: "var(--color-orange-dim)",
    };
  }

  return null;
}
