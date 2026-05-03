import { useState, type CSSProperties } from "react";
import type { InstrumentClass } from "@/lib/types";
import { api } from "@/lib/exva";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from "@/components/ui";

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 };

export const AddBrokerModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const [brokerType, setBrokerType] = useState<"alpaca" | "coinbase_advanced_trade" | "tradovate" | "mock">("mock");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      default:
        return {};
    }
  };

  const runTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const result = await api.testBrokerCredentials({ brokerType, mode, credentials: credentials() });
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
        mode,
        credentials: credentials(),
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
      default:
        return ["stock", "crypto", "futures"];
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-border bg-[var(--surface)] p-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--text1)]">Add broker account</DialogTitle>
        </DialogHeader>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Broker type</div>
          <ShadcnSelect
            value={brokerType}
            onValueChange={(value) => {
              const next = value as typeof brokerType;
              setBrokerType(next);
              if (next === "coinbase_advanced_trade") setMode("live");
              setTestOk(null);
              setMessage(null);
            }}
            options={[
              { value: "mock", label: "Mock (dev — all instrument classes)" },
              { value: "alpaca", label: "Alpaca (stocks)" },
              { value: "coinbase_advanced_trade", label: "Coinbase Advanced Trade (crypto — CCXT)" },
              { value: "tradovate", label: "Tradovate (futures — simulated v1)" },
            ]}
          />
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
            Supports: {supportedHint().join(", ")}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Display name</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Main Alpaca"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Mode</div>
          <ShadcnSelect
            value={mode}
            onValueChange={(value) => setMode(value as "paper" | "live")}
            options={[
              { value: "paper", label: "Paper" },
              { value: "live", label: "Live" },
            ]}
          />
        </div>

        {brokerType === "alpaca" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key ID</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Secret key</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} type="password" />
            </div>
          </>
        )}

        {brokerType === "coinbase_advanced_trade" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API secret (CDP EC private key, PEM)</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} type="password" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Passphrase (if required)</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" />
            </div>
          </>
        )}

        {brokerType === "tradovate" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Username</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Password</div>
              <Input className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]" value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
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
              background: testOk ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
              color: testOk ? "#34d399" : "#f87171",
            }}
          >
            {message}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Button type="button" variant="outline" onClick={() => void runTest()} disabled={testing} className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]">
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
          <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
