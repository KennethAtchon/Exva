import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
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
): SessionProgressState | null {
  if (steps.length === 0) return null;

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

  const allSucceeded = steps.every(
    (s) => s.status === "succeeded" || s.status === "skipped",
  );
  const hasMonitoring =
    monitoringActive ||
    (allSucceeded && steps.some((s) => s.stage === "monitoring"));

  if (!activeStep && !hasMonitoring) return null;
  if (hasMonitoring && openTradeCount === 0 && !monitoringActive) {
    return null;
  }

  const stage = hasMonitoring || !activeStep ? "monitoring" : activeStep.stage;
  const status = hasMonitoring || !activeStep ? "succeeded" : activeStep.status;
  const isHoldingPosition = hasMonitoring && openTradeCount > 0;
  const meta = STAGE_META[stage];

  return {
    cycleId,
    activeStage: stage,
    activeStatus: status as ExecutionStepStatus,
    progressPct: isHoldingPosition ? 96 : meta.progressPct,
    stageLabel: isHoldingPosition
      ? `Holding position (${openTradeCount}) — waiting for exit`
      : meta.label,
    activeRoleLabel: status === "running" ? activeRoleLabel : null,
    retryable: activeStep?.retryable ?? false,
    nextRetryAt: activeStep?.nextRetryAt ?? null,
    lastErrorCode: activeStep?.lastErrorCode ?? null,
    lastErrorMessage: activeStep?.lastErrorMessage ?? null,
    cycleIdShort: cycleId.slice(0, 8),
    isHoldingPosition,
    openTradeCount,
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
    ? "rgba(147,197,253,0.9)"
    : "rgba(251,146,60,0.8)";

  return (
    <div style={wrapperStyle}>
      <div style={trackStyle}>
        <div
          style={{
            ...fillStyle,
            width: isHoldingPosition ? "66%" : `${progressPct}%`,
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

      <div style={infoRowStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 500,
            }}
          >
            {stageLabel}
          </span>

          {statusChip ? (
            <span
              style={{
                ...statusChipStyle,
                color: statusChip.color,
                border: `1px solid ${statusChip.border}`,
                background: statusChip.background,
              }}
            >
              {statusChip.label}
            </span>
          ) : null}

          {activeRoleLabel && isRunning ? (
            <span style={roleChipStyle}>{activeRoleLabel}</span>
          ) : null}

          {lastErrorMessage && (isFailed || isRetrying) ? (
            <span
              style={{ ...errorMessageStyle, color: detailMessageColor }}
              title={lastErrorMessage}
            >
              {lastErrorMessage.length > 60
                ? `${lastErrorMessage.slice(0, 60)}…`
                : lastErrorMessage}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
          }}
        >
          {isFailed && activeStage ? (
            <>
              {retryable ? (
                <Button
                  variant="outline"
                  style={retryButtonStyle}
                  onClick={() => onRetry(sessionId, cycleId, activeStage)}
                >
                  Retry
                </Button>
              ) : null}
              <Button
                variant="outline"
                style={traceButtonStyle}
                onClick={() => onViewTrace(sessionId, cycleId, activeStage)}
              >
                View Trace
              </Button>
            </>
          ) : null}

          {isRunning || isRetrying || isMonitoring ? (
            <button
              type="button"
              style={pauseToggleStyle}
              onClick={() => onPauseAfterStep(sessionId)}
              title="Pause stops new research but keeps exits managed."
            >
              <span style={pauseDotStyle} />
              Pause after step
            </button>
          ) : null}

          <span style={cycleIdStyle} title={cycleId}>
            #{cycleIdShort}
          </span>
        </div>
      </div>
    </div>
  );
};

const wrapperStyle = {
  marginTop: 12,
  marginBottom: 4,
} as const;

const trackStyle = {
  height: 4,
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  overflow: "hidden",
  marginBottom: 8,
} as const;

const fillStyle = {
  height: "100%",
  borderRadius: 999,
  background: "rgba(96,165,250,0.6)",
} as const;

const infoRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
} as const;

const roleChipStyle = {
  fontSize: 12,
  color: "var(--text2)",
  background: "rgba(255,255,255,0.05)",
  borderRadius: 4,
  padding: "2px 6px",
  fontFamily: "monospace",
  flexShrink: 0,
} as const;

const statusChipStyle = {
  fontSize: 12,
  borderRadius: 999,
  padding: "2px 7px",
  fontFamily: "monospace",
  flexShrink: 0,
} as const;

const errorMessageStyle = {
  fontSize: 12,
  color: "rgba(251,146,60,0.8)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
} as const;

const retryButtonStyle = {
  height: 24,
  padding: "0 8px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--color-error-border)",
  color: "var(--color-error)",
  background: "transparent",
} as const;

const traceButtonStyle = {
  height: 24,
  padding: "0 8px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--border)",
  color: "var(--text2)",
  background: "transparent",
} as const;

const pauseToggleStyle = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: "var(--text3)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  padding: "2px 4px",
  borderRadius: 4,
} as const;

const pauseDotStyle = {
  width: 6,
  height: 6,
  borderRadius: 2,
  border: "1px solid var(--text3)",
  display: "inline-block",
  flexShrink: 0,
} as const;

const cycleIdStyle = {
  fontSize: 12,
  color: "var(--text3)",
  fontFamily: "monospace",
  opacity: 0.6,
} as const;

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
