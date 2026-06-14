import { useState } from "react";
import { Button, HelpTooltip } from "@/components/ui";
import { api } from "@/lib/exva";
import { cn } from "@/lib/utils";

interface ReadinessCheck {
  name: string;
  passed: boolean;
  requiresAck?: boolean;
  message?: string;
}

interface LiveReadinessReport {
  readyToStart: boolean;
  allChecksPassed: boolean;
  checks: ReadinessCheck[];
  acknowledgedAt: string | null;
}

interface Props {
  sessionId: string;
  report: LiveReadinessReport;
  onAcknowledged: () => void;
  onCancel: () => void;
}

const CHECK_LABELS: Record<string, string> = {
  execution_mode: "Execution mode set to live_allowed",
  broker_assigned: "Broker account assigned",
  broker_live_mode: "Broker in live mode",
  broker_connected: "Broker connection verified",
  user_acknowledged: "Live trading risks acknowledged",
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  execution_mode: "Session must have execution_mode = live_allowed",
  broker_assigned: "At least one live broker must be assigned to this session",
  broker_live_mode:
    "Assigned broker must be configured for live (not paper) trading",
  broker_connected: "Broker API connection test must pass",
  user_acknowledged:
    "You must explicitly acknowledge the risks of live trading",
};

export const LiveReadinessModal = ({
  sessionId,
  report,
  onAcknowledged,
  onCancel,
}: Props) => {
  const [refreshedReport, setRefreshedReport] =
    useState<LiveReadinessReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const currentReport = refreshedReport ?? report;

  const nonAckChecks = currentReport.checks.filter((c) => !c.requiresAck);
  const allNonAckPassed = nonAckChecks.every((c) => c.passed);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testLiveBrokerConnection(sessionId);
      setTestResult(result);
      const refreshed = await api.getLiveReadiness(sessionId);
      setRefreshedReport(refreshed);
    } catch (error) {
      setTestResult({
        ok: false,
        message:
          error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAcknowledge = async () => {
    setAcknowledging(true);
    try {
      await api.acknowledgeLiveReadiness(sessionId);
      onAcknowledged();
    } catch {
      setAcknowledging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(0,0,0,0.72)]">
      <div className="flex max-w-[90vw] w-[520px] flex-col overflow-hidden rounded-2xl border border-error-border bg-[var(--surface)] shadow-[0_24px_64px_rgba(0,0,0,0.48)]">
        <div className="border-b border-[var(--border)] bg-error-dim px-6 pb-4 pt-5">
          <div className="flex items-center gap-1.5">
            <div className="text-base font-bold text-[var(--text1)]">
              Live Trading Gate
            </div>
            <HelpTooltip glossaryId="live-readiness-gate" />
          </div>
          <div className="mt-1 text-[12px] text-[var(--text3)]">
            All checks must pass before starting a live session
          </div>
        </div>

        <div className="flex max-h-[60vh] flex-col gap-2.5 overflow-y-auto px-6 py-4">
          {currentReport.checks.map((check) => (
            <div
              key={check.name}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-2.5",
                check.passed
                  ? "border border-success-border bg-success-dim"
                  : "border border-error-border bg-error-dim",
              )}
            >
              <div
                className={cn(
                  "mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                  check.passed
                    ? "bg-success-dim text-success"
                    : "bg-error-dim text-error",
                )}
              >
                {check.passed ? "✓" : "✗"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <div
                    className={cn(
                      "text-[13px] font-medium",
                      check.passed
                        ? "text-[var(--text1)]"
                        : "text-[var(--text2)]",
                    )}
                  >
                    {CHECK_LABELS[check.name] ?? check.name}
                  </div>
                  <HelpTooltip
                    topic={CHECK_LABELS[check.name] ?? check.name}
                    body={
                      CHECK_DESCRIPTIONS[check.name] ??
                      check.message ??
                      "Readiness check for live execution."
                    }
                  />
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--text3)]">
                  {check.message ?? CHECK_DESCRIPTIONS[check.name]}
                </div>
              </div>
              {check.requiresAck && !check.passed && (
                <span className="shrink-0 rounded border border-warning-border bg-warning-dim px-1.5 py-0.5 font-mono text-[12px] text-warning">
                  requires consent
                </span>
              )}
            </div>
          ))}

          {testResult && (
            <div
              className={cn(
                "rounded-md px-3 py-2",
                testResult.ok
                  ? "border border-success-border bg-success-dim text-success"
                  : "border border-error-border bg-error-dim text-error",
              )}
            >
              <span className="font-mono text-[12px]">
                {testResult.ok ? "✓ " : "✗ "}
                {testResult.message}
              </span>
            </div>
          )}

          {allNonAckPassed && !currentReport.acknowledgedAt && (
            <div className="mt-1 rounded-lg border border-error-border bg-error-dim px-3.5 py-3">
              <div className="mb-1.5 text-[13px] font-semibold text-error">
                Live trading uses real capital
              </div>
              <div className="text-[12px] leading-[1.6] text-[var(--text2)]">
                By proceeding, you confirm that this session will execute trades
                with real money via your connected live broker. Losses incurred
                are real. This cannot be undone once the session starts.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2.5 border-t border-[var(--border)] px-6 py-3.5">
          <Button
            variant="outline"
            onClick={onCancel}
            className="rounded-lg border border-[var(--border)] bg-transparent px-4 py-[9px] text-[var(--text2)]"
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void handleTestConnection()}
              disabled={testing}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3.5 py-[9px] text-[var(--text2)]"
            >
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleAcknowledge()}
              disabled={!allNonAckPassed || acknowledging}
              className={cn(
                "rounded-lg border-none px-[18px] py-[9px]",
                allNonAckPassed
                  ? "bg-error-dim text-error"
                  : "cursor-not-allowed bg-[var(--surface3)] text-[var(--text3)] opacity-50",
              )}
            >
              {acknowledging ? "Confirming…" : "I Understand — Start Live"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
