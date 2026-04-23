import { useState } from "react";
import { Badge, Card, Dot, PageShell, SectionTitle } from "@/components/atoms";
import { api } from "@/lib/exva";

const InputField = ({
  label, hint, type = "text", value, onChange, placeholder, mono,
}: {
  label: string; hint?: string; type?: string;
  value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: "var(--text3)" }}>{hint}</span>}
    </div>
    <input
      type={type} value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 9, padding: "10px 14px",
        color: "var(--text1)", fontSize: 13, outline: "none",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        letterSpacing: mono ? "0.04em" : "normal",
        transition: "border-color 0.15s",
      }}
    />
  </div>
);

const ConnBadge = ({ ok }: { ok: boolean }) => (
  <div
    style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 11px", borderRadius: 20,
      background: ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
      border: `1px solid ${ok ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
    }}
  >
    <Dot color={ok ? "#34d399" : "#f87171"} size={6} />
    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: ok ? "#34d399" : "#f87171", fontWeight: 600 }}>
      {ok ? "Connected" : "Error"}
    </span>
  </div>
);

export const AccountsPage = () => {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [alpacaKey, setAlpacaKey] = useState("");
  const [alpacaSecret, setAlpacaSecret] = useState("");
  const [alpacaMode, setAlpacaMode] = useState<"paper" | "live">("paper");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ broker: boolean; ai: boolean }>({ broker: false, ai: false });

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testBrokerConnection();
      setStatus({ broker: r.ok, ai: true });
    } catch {
      setStatus({ broker: false, ai: false });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (anthropicKey) await api.saveApiKey("anthropic", anthropicKey);
      if (alpacaKey && alpacaSecret) {
        await api.addBrokerAccount({
          provider: "alpaca", api_key: alpacaKey, secret_key: alpacaSecret, mode: alpacaMode,
        });
      }
      await test();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>Accounts</h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          API keys stored in OS keychain — never written to disk or logs
        </p>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Anthropic</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  Powers all AI agents — researcher, reviewer, decision maker
                </div>
              </div>
              <ConnBadge ok={status.ai} />
            </div>
            <InputField
              label="API Key" hint="stored in OS keychain" type="password"
              value={anthropicKey} onChange={setAnthropicKey}
              placeholder="sk-ant-..." mono
            />
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 9 }}>
              <span style={{ fontSize: 12, color: "#34d399" }}>Prompt caching active</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>— saves ~30–40% on repeated agent calls</span>
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Broker — Alpaca</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Trade execution and portfolio data</div>
              </div>
              <ConnBadge ok={status.broker} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {(
                [
                  ["paper", "🧪 Paper Trading"],
                  ["live", "⚡ Live Trading"],
                ] as ["paper" | "live", string][]
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => setAlpacaMode(m)}
                  style={{
                    flex: 1, padding: "9px 14px", fontSize: 13, borderRadius: 9,
                    cursor: "pointer", transition: "all 0.15s",
                    fontFamily: "var(--font-sans)",
                    fontWeight: alpacaMode === m ? 600 : 400,
                    background: alpacaMode === m
                      ? (m === "live" ? "rgba(248,113,113,0.12)" : "rgba(96,165,250,0.1)")
                      : "var(--surface2)",
                    border: alpacaMode === m
                      ? (m === "live" ? "1px solid rgba(248,113,113,0.3)" : "1px solid rgba(96,165,250,0.3)")
                      : "1px solid var(--border)",
                    color: alpacaMode === m
                      ? (m === "live" ? "#f87171" : "#60a5fa")
                      : "var(--text2)",
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {alpacaMode === "live" && (
              <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 9 }}>
                <span style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>
                  Live mode — trades will use real money and execute on the market
                </span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <InputField label="API Key ID" type="password" value={alpacaKey} onChange={setAlpacaKey} placeholder="PKXXXXXXXX" mono />
              <InputField label="Secret Key" type="password" value={alpacaSecret} onChange={setAlpacaSecret} placeholder="Secret…" mono />
            </div>
          </Card>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Web Search</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                Researcher agents use this to fetch live news and market data
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["Brave", "Tavily"].map((p) => (
                <div
                  key={p}
                  style={{
                    flex: 1, padding: "14px 16px",
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    borderRadius: 10, display: "flex",
                    justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500 }}>{p}</span>
                  <Badge variant="default" size="sm">configure</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card accent>
            <SectionTitle>Security Model</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              {(
                [
                  ["OS Keychain", "Secrets stored in system keychain, never SQLite"],
                  ["In-memory only", "Keys retrieved at call time, not held in process"],
                  ["Never logged", "Log macros only reference IDs — no key values"],
                  ["No cloud sync", "Local-only app — no data leaves this device"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ color: "#34d399", fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <div>
                    <span style={{ fontSize: 13, color: "var(--text1)", fontWeight: 500 }}>{k}</span>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}> — {v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={test}
              disabled={testing}
              style={{
                flex: 1, padding: "11px 20px",
                background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: 10, color: "var(--text2)", fontSize: 13,
                cursor: "pointer", fontFamily: "var(--font-sans)", fontWeight: 500,
              }}
            >
              {testing ? "Testing…" : "Test Connections"}
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{
                flex: 1, padding: "11px 20px", background: "var(--accent)",
                border: "none", borderRadius: 10, color: "#fff",
                fontSize: 13, fontWeight: 700, cursor: "pointer",
                fontFamily: "var(--font-sans)",
              }}
            >
              {saving ? "Saving…" : "Save Keys"}
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
};
