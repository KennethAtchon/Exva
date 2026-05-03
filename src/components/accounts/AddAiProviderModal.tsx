import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/exva";

export type AiProviderType = "anthropic" | "openai" | "openrouter";

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

const DEFAULT_NAMES: Record<AiProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

export const AddAiProviderModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const [providerType, setProviderType] = useState<AiProviderType>("anthropic");
  const [name, setName] = useState(DEFAULT_NAMES.anthropic);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProviderType("anthropic");
    setName(DEFAULT_NAMES.anthropic);
    setApiKey("");
    setBaseUrl("");
    setMessage(null);
  }, [open]);

  if (!open) return null;

  const onTypeChange = (next: AiProviderType) => {
    setProviderType(next);
    setName((current) => {
      const prevDefault = DEFAULT_NAMES[providerType];
      return current === prevDefault || current.trim() === "" ? DEFAULT_NAMES[next] : current;
    });
    if (next !== "openrouter") setBaseUrl("");
    setMessage(null);
  };

  const metadata =
    providerType === "openrouter" && baseUrl.trim().length > 0 ? { baseUrl: baseUrl.trim() } : undefined;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        setMessage("Enter an API key.");
        return;
      }
      const { id } = await api.saveProvider({
        name: name.trim() || DEFAULT_NAMES[providerType],
        category: "ai",
        providerType,
        apiKey: trimmedKey,
        metadata,
      });
      const test = await api.testProvider(id).catch(() => ({ ok: false as const, error: "Test failed" }));
      if (!test.ok) {
        setMessage(test.error ?? "Saved key, but the connection test failed. Check the key and try Test on the account.");
      }
      setApiKey("");
      await onSaved();
      if (test.ok) onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)", marginBottom: 4 }}>Add AI provider</div>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, lineHeight: 1.45 }}>
          Keys are stored in the OS keychain. Pick a provider, then assign models per role on the Strategy page.
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Provider</div>
          <select
            value={providerType}
            onChange={(e) => onTypeChange(e.target.value as AiProviderType)}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Display name</div>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder={DEFAULT_NAMES[providerType]} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>API key</div>
          <input
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", letterSpacing: "0.03em" }}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              providerType === "anthropic" ? "sk-ant-…" : providerType === "openai" ? "sk-…" : "sk-or-…"
            }
            autoComplete="off"
          />
        </div>

        {providerType === "openrouter" ? (
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>API base URL (optional)</div>
            <input
              style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>
              Leave empty to use the default OpenRouter endpoint. Use a full https URL if you override it.
            </div>
          </div>
        ) : null}

        {providerType === "anthropic" ? (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              background: "rgba(52,211,153,0.06)",
              border: "1px solid rgba(52,211,153,0.15)",
              borderRadius: 9,
              fontSize: 12,
              color: "var(--text3)",
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: "#34d399", fontWeight: 600 }}>Prompt caching</span> is used on Anthropic models where
            supported, which typically cuts cost on repeated agent calls.
          </div>
        ) : null}

        {message ? (
          <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12, lineHeight: 1.4 }}>{message}</div>
        ) : null}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 9,
              border: "1px solid var(--border)",
              background: "var(--surface2)",
              color: "var(--text2)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 9,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.85 : 1,
            }}
          >
            {saving ? "Saving…" : "Save & test"}
          </button>
        </div>
      </div>
    </div>
  );
};
