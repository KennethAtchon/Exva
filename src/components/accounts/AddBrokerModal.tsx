import { useState, type CSSProperties } from "react";
import type { InstrumentClass } from "@/lib/types";
import {
  DEFAULT_MOCK_SCENARIO_KIND,
  MOCK_SCENARIO_KINDS,
  MOCK_SCENARIO_LABELS,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { api } from "@/lib/exva";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text2)",
  marginBottom: 6,
};

export const AddBrokerModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const [brokerType, setBrokerType] = useState<
    "alpaca" | "coinbase_advanced_trade" | "tradovate" | "polymarket" | "mock"
  >("mock");
  const [mockScenarioKind, setMockScenarioKind] = useState<MockScenarioKind>(
    DEFAULT_MOCK_SCENARIO_KIND,
  );
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [funderAddress, setFunderAddress] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) return null;

  const credentials = (): Record<string, string> => {
    switch (brokerType) {
      case "alpaca":
        return { api_key: apiKey, secret_key: secretKey };
      case "coinbase_advanced_trade":
        return { apiKey, apiSecret: secretKey, passphrase };
      case "tradovate":
        return { username, password };
      case "polymarket":
        return { privateKey, funderAddress };
      default:
        return {};
    }
  };

  const runTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.testBrokerCredentials({
        brokerType,
        mode: environmentMode,
        credentials: credentials(),
      });
      setTestOk(result.ok);
      setMessage(result.message);
    } catch (e) {
      setTestOk(false);
      setMessage(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api.registerBrokerAccount({
        brokerType,
        name: name.trim() || `${brokerType} account`,
        mode: environmentMode,
        credentials: credentials(),
        ...(brokerType === "mock" ? { mockScenarioKind } : {}),
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      await onSaved();
      onClose();
      setName("");
      setApiKey("");
      setSecretKey("");
      setPassphrase("");
      setUsername("");
      setPassword("");
      setPrivateKey("");
      setFunderAddress("");
      setTestOk(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const supportedHint = (): InstrumentClass[] => {
    switch (brokerType) {
      case "alpaca":
        return ["stock"];
      case "coinbase_advanced_trade":
        return ["crypto"];
      case "tradovate":
        return ["futures"];
      case "polymarket":
        return ["prediction_market"];
      default:
        return ["stock", "crypto", "futures", "prediction_market"];
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-border bg-[var(--surface)] p-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--text1)]">
            Add broker account
          </DialogTitle>
        </DialogHeader>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Broker type</div>
          <ShadcnSelect
            value={brokerType}
            onValueChange={(value) => {
              const next = value as typeof brokerType;
              setBrokerType(next);
              setTestOk(null);
              setMessage(null);
            }}
            options={[
              { value: "mock", label: "Mock (dev — all instrument classes)" },
              { value: "alpaca", label: "Alpaca (stocks)" },
              {
                value: "coinbase_advanced_trade",
                label: "Coinbase Advanced Trade (crypto — CCXT)",
              },
              {
                value: "tradovate",
                label: "Tradovate (futures — simulated v1)",
              },
              { value: "polymarket", label: "Polymarket (prediction markets)" },
            ]}
          />
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
            Supports: {supportedHint().join(", ")}
          </div>
        </div>

        {brokerType === "mock" && (
          <div style={{ marginBottom: 12 }}>
            <div style={labelStyle}>Mock scenario</div>
            <ShadcnSelect
              value={mockScenarioKind}
              onValueChange={(value) =>
                setMockScenarioKind(value as MockScenarioKind)
              }
              options={MOCK_SCENARIO_KINDS.map((kind) => ({
                value: kind,
                label: `${MOCK_SCENARIO_LABELS[kind].label} ${MOCK_SCENARIO_LABELS[kind].outcome}`,
              }))}
            />
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
              Use Clean breakout to verify the bot selects, decides, and fills a
              trade end-to-end.
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Display name</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Alpaca"
          />
        </div>

        {brokerType === "alpaca" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key ID</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Secret key</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                type="password"
              />
            </div>
          </>
        )}

        {brokerType === "coinbase_advanced_trade" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API secret (CDP EC private key, PEM)</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                type="password"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Passphrase (if required)</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                type="password"
              />
            </div>
          </>
        )}

        {brokerType === "tradovate" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Username</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Password</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
              />
            </div>
          </>
        )}

        {brokerType === "polymarket" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Polygon private key</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                type="password"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Polymarket funder/profile address</div>
              <Input
                className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
                value={funderAddress}
                onChange={(e) => setFunderAddress(e.target.value)}
              />
            </div>
          </>
        )}

        {message && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 12,
              background: testOk
                ? "rgba(52,211,153,0.1)"
                : "rgba(248,113,113,0.1)",
              color: testOk ? "#34d399" : "#f87171",
            }}
          >
            {message}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Button
            type="button"
            variant="outline"
            onClick={() => void runTest()}
            disabled={testing}
            className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]"
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={saving || testOk !== true}
            className="flex-1 bg-[var(--accent)] text-white hover:opacity-95 disabled:opacity-45"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
