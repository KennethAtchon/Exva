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
  broker_live_mode: "Assigned broker must be configured for live (not paper) trading",
  broker_connected: "Broker API connection test must pass",
  user_acknowledged: "You must explicitly acknowledge the risks of live trading",
};

export const LiveReadinessModal = ({ sessionId, report, onAcknowledged, onCancel }: Props) => {
  const [report_, setReport] = useState<LiveReadinessReport>(report);
  const [testing, setTesting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const nonAckChecks = report_.checks.filter((c) => !c.requiresAck);
  const allNonAckPassed = nonAckChecks.every((c) => c.passed);

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testLiveBrokerConnection(sessionId);
      setTestResult(result);
      const refreshed = await api.getLiveReadiness(sessionId);
      setReport(refreshed);
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : "Connection test failed" });
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
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)" }}>Live Trading Gate</div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
            All checks must pass before starting a live session
          </div>
        </div>

        <div style={bodyStyle}>
          {report_.checks.map((check) => (
            <div key={check.name} style={checkRowStyle(check.passed)}>
              <div style={checkIconStyle(check.passed)}>
                {check.passed ? "✓" : "✗"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: check.passed ? "var(--text1)" : "var(--text2)", fontWeight: 500 }}>
                  {CHECK_LABELS[check.name] ?? check.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
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
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {testResult.ok ? "✓ " : "✗ "}
                {testResult.message}
              </span>
            </div>
          )}

          {allNonAckPassed && !report_.acknowledgedAt && (
            <div style={consentBoxStyle}>
              <div style={{ fontSize: 13, color: "#fca5a5", fontWeight: 600, marginBottom: 6 }}>
                Live trading uses real capital
              </div>
              <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                By proceeding, you confirm that this session will execute trades with real money via your connected
                live broker. Losses incurred are real. This cannot be undone once the session starts.
              </div>
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <Button variant="outline" onClick={onCancel} style={cancelButtonStyle}>
            Cancel
          </Button>
          <div style={{ display: "flex", gap: 8 }}>
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
  border: "1px solid rgba(248,113,113,0.28)",
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
  background: "rgba(248,113,113,0.06)",
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
    border: `1px solid ${passed ? "rgba(0,229,160,0.2)" : "rgba(255,71,87,0.2)"}`,
    background: passed ? "rgba(0,229,160,0.04)" : "rgba(255,71,87,0.04)",
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
    background: passed ? "rgba(0,229,160,0.14)" : "rgba(255,71,87,0.14)",
    color: passed ? "#00e5a0" : "#ff4757",
  } as const;
}

const ackBadgeStyle = {
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  color: "#fbbf24",
  background: "rgba(251,191,36,0.1)",
  border: "1px solid rgba(251,191,36,0.2)",
  borderRadius: 4,
  padding: "2px 6px",
  flexShrink: 0,
} as const;

function testResultBannerStyle(ok: boolean) {
  return {
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${ok ? "rgba(0,229,160,0.24)" : "rgba(255,71,87,0.24)"}`,
    background: ok ? "rgba(0,229,160,0.06)" : "rgba(255,71,87,0.06)",
    color: ok ? "#00e5a0" : "#ff4757",
  } as const;
}

const consentBoxStyle = {
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid rgba(248,113,113,0.3)",
  background: "rgba(127,29,29,0.12)",
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
  background: "rgba(248,113,113,0.2)",
  color: "#fca5a5",
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
