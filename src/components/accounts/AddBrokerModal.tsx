import { useState, type CSSProperties } from "react";
import type { InstrumentClass } from "@/lib/types";
import { api } from "@/lib/exva";

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 80,
};

const panel: CSSProperties = {
  width: "min(440px, 92vw)",
  background: "var(--surface)",
  borderRadius: 12,
  border: "1px solid var(--border)",
  padding: 20,
  maxHeight: "90vh",
  overflowY: "auto",
};

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 };
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
  fontSize: 13,
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
    <div style={overlay} onMouseDown={onClose}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)", marginBottom: 14 }}>Add broker account</div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Broker type</div>
          <select
            value={brokerType}
            onChange={(e) => {
              const next = e.target.value as typeof brokerType;
              setBrokerType(next);
              if (next === "coinbase_advanced_trade") setMode("live");
              setTestOk(null);
              setMessage(null);
            }}
            style={inputStyle}
          >
            <option value="mock">Mock (dev — all instrument classes)</option>
            <option value="alpaca">Alpaca (stocks)</option>
            <option value="coinbase_advanced_trade">Coinbase Advanced Trade (crypto — CCXT)</option>
            <option value="tradovate">Tradovate (futures — simulated v1)</option>
          </select>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
            Supports: {supportedHint().join(", ")}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Display name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Alpaca" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Mode</div>
          <select value={mode} onChange={(e) => setMode(e.target.value as "paper" | "live")} style={inputStyle}>
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>
        </div>

        {brokerType === "alpaca" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key ID</div>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Secret key</div>
              <input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} type="password" style={inputStyle} />
            </div>
          </>
        )}

        {brokerType === "coinbase_advanced_trade" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API key</div>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>API secret (CDP EC private key, PEM)</div>
              <input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} type="password" style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Passphrase (if required)</div>
              <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" style={inputStyle} />
            </div>
          </>
        )}

        {brokerType === "tradovate" && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Username</div>
              <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={labelStyle}>Password</div>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" style={inputStyle} />
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
          <button type="button" onClick={() => void runTest()} disabled={testing} style={{ ...inputStyle, cursor: "pointer" }}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || testOk !== true}
            style={{
              ...inputStyle,
              cursor: "pointer",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              opacity: testOk === true ? 1 : 0.45,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose} style={{ ...inputStyle, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
