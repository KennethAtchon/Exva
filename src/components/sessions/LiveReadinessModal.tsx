import { useState } from "react";
import { Button, Checkbox, HelpTooltip } from "@/components/ui";
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
  const [ackChecked, setAckChecked] = useState(false);
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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70">
      <div className="flex max-h-[90vh] w-[520px] max-w-[90vw] flex-col overflow-hidden rounded-sm border border-error-border bg-surface shadow-popover">
        <div className="border-b border-border bg-error-dim px-6 pb-4 pt-5">
          <div className="flex items-center gap-1.5">
            <div className="font-sans text-head text-text1">
              Live trading gate
            </div>
            <HelpTooltip glossaryId="live-readiness-gate" />
          </div>
          <div className="mt-1 font-sans text-caption text-text3">
            All checks must pass before starting a live session
          </div>
        </div>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-6 py-4">
          {currentReport.checks.map((check) => (
            <div
              key={check.name}
              className={cn(
                "flex items-start gap-3 rounded-sm px-3 py-2.5",
                check.passed
                  ? "border border-success-border bg-success-dim"
                  : "border border-error-border bg-error-dim",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full",
                  check.passed ? "bg-success" : "bg-error",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <div
                    className={cn(
                      "font-sans text-label",
                      check.passed ? "text-text1" : "text-text2",
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
                <div className="mt-0.5 font-sans text-caption text-text3">
                  {check.message ?? CHECK_DESCRIPTIONS[check.name]}
                </div>
              </div>
              {check.requiresAck && !check.passed ? (
                <span className="shrink-0 rounded-sm border border-warning-border bg-warning-dim px-1.5 py-0.5 font-mono text-micro text-warning">
                  requires consent
                </span>
              ) : null}
            </div>
          ))}

          {testResult ? (
            <div
              className={cn(
                "rounded-sm px-3 py-2",
                testResult.ok
                  ? "border border-success-border bg-success-dim text-success"
                  : "border border-error-border bg-error-dim text-error",
              )}
            >
              <span className="font-mono text-caption">
                {testResult.ok ? "✓ " : "✗ "}
                {testResult.message}
              </span>
            </div>
          ) : null}

          {allNonAckPassed && !currentReport.acknowledgedAt ? (
            <div className="mt-1 rounded-sm border border-error-border bg-error-dim px-3.5 py-3">
              <div className="mb-1.5 font-sans text-label text-error">
                Live trading uses real capital
              </div>
              <div className="font-sans text-caption leading-relaxed text-text2">
                By proceeding, you confirm that this session will execute trades
                with real money via your connected live broker. Losses incurred
                are real. This cannot be undone once the session starts.
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5">
                <Checkbox
                  checked={ackChecked}
                  onCheckedChange={(v) => setAckChecked(v === true)}
                  className="mt-0.5 border-error data-[state=checked]:bg-error data-[state=checked]:text-error-dim"
                />
                <span className="font-sans text-caption leading-relaxed text-text2">
                  I understand that live trading uses real capital and losses
                  are irreversible once the session starts.
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2.5 border-t border-border px-6 py-3.5">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => void handleTestConnection()}
              disabled={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleAcknowledge()}
              disabled={!allNonAckPassed || !ackChecked || acknowledging}
            >
              {acknowledging ? "Confirming…" : "Start live"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
