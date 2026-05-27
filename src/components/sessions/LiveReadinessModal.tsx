import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";

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
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)" }}>
            Live Trading Gate
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
            All checks must pass before starting a live session
          </div>
        </div>

        <div style={bodyStyle}>
          {currentReport.checks.map((check) => (
            <div key={check.name} style={checkRowStyle(check.passed)}>
              <div style={checkIconStyle(check.passed)}>
                {check.passed ? "✓" : "✗"}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  style={{
                    fontSize: 13,
                    color: check.passed ? "var(--text1)" : "var(--text2)",
                    fontWeight: 500,
                  }}
                >
                  {CHECK_LABELS[check.name] ?? check.name}
                </div>
                <div
                  style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}
                >
                  {check.message ?? CHECK_DESCRIPTIONS[check.name]}
                </div>
              </div>
              {check.requiresAck && !check.passed && (
                <span style={ackBadgeStyle}>requires consent</span>
              )}
            </div>
          ))}

          {testResult && (
            <div style={testResultBannerStyle(testResult.ok)}>
              <span className="font-mono text-[12px]">
                {testResult.ok ? "✓ " : "✗ "}
                {testResult.message}
              </span>
            </div>
          )}

          {allNonAckPassed && !currentReport.acknowledgedAt && (
            <div style={consentBoxStyle}>
              <div className="mb-1.5 text-[13px] font-semibold text-error">
                Live trading uses real capital
              </div>
              <div
                style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}
              >
                By proceeding, you confirm that this session will execute trades
                with real money via your connected live broker. Losses incurred
                are real. This cannot be undone once the session starts.
              </div>
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <Button
            variant="outline"
            onClick={onCancel}
            style={cancelButtonStyle}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void handleTestConnection()}
              disabled={testing}
              style={testButtonStyle}
            >
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleAcknowledge()}
              disabled={!allNonAckPassed || acknowledging}
              style={allNonAckPassed ? primaryButtonStyle : disabledButtonStyle}
            >
              {acknowledging ? "Confirming…" : "I Understand — Start Live"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: "fixed" as const,
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle = {
  background: "var(--surface)",
  border: "1px solid var(--color-error-border)",
  borderRadius: 16,
  width: 520,
  maxWidth: "90vw",
  display: "flex",
  flexDirection: "column" as const,
  overflow: "hidden",
  boxShadow: "0 24px 64px rgba(0,0,0,0.48)",
};

const headerStyle = {
  padding: "20px 24px 16px",
  borderBottom: "1px solid var(--border)",
  background: "var(--color-error-dim)",
};

const bodyStyle = {
  padding: "16px 24px",
  display: "flex",
  flexDirection: "column" as const,
  gap: 10,
  maxHeight: "60vh",
  overflowY: "auto" as const,
};

const footerStyle = {
  padding: "14px 24px",
  borderTop: "1px solid var(--border)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
};

function checkRowStyle(passed: boolean) {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${passed ? "var(--color-success-border)" : "var(--color-error-border)"}`,
    background: passed ? "var(--color-success-dim)" : "var(--color-error-dim)",
  } as const;
}

function checkIconStyle(passed: boolean) {
  return {
    width: 20,
    height: 20,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
    background: passed ? "var(--color-success-dim)" : "var(--color-error-dim)",
    color: passed ? "var(--color-success)" : "var(--color-error)",
  } as const;
}

const ackBadgeStyle = {
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--color-warning)",
  background: "var(--color-warning-dim)",
  border: "1px solid var(--color-warning-border)",
  borderRadius: 4,
  padding: "2px 6px",
  flexShrink: 0,
} as const;

function testResultBannerStyle(ok: boolean) {
  return {
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${ok ? "var(--color-success-border)" : "var(--color-error-border)"}`,
    background: ok ? "var(--color-success-dim)" : "var(--color-error-dim)",
    color: ok ? "var(--color-success)" : "var(--color-error)",
  } as const;
}

const consentBoxStyle = {
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--color-error-border)",
  background: "var(--color-error-dim)",
  marginTop: 4,
} as const;

const cancelButtonStyle = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
} as const;

const testButtonStyle = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
} as const;

const primaryButtonStyle = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--color-error-dim)",
  color: "var(--color-error)",
} as const;

const disabledButtonStyle = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--surface3)",
  color: "var(--text3)",
  opacity: 0.5,
  cursor: "not-allowed",
} as const;
