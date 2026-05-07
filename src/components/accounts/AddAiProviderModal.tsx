import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/exva";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from "@/components/ui";

export type AiProviderType = "anthropic" | "openai" | "openrouter";

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 };

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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-border bg-[var(--surface)] p-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--text1)]">Add AI provider</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, lineHeight: 1.45 }}>
          Keys are stored in the OS keychain. Pick a provider, then assign models per role on the Strategy page.
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Provider</div>
          <ShadcnSelect
            value={providerType}
            onValueChange={(value) => onTypeChange(value as AiProviderType)}
            options={[
              { value: "anthropic", label: "Anthropic (Claude)" },
              { value: "openai", label: "OpenAI" },
              { value: "openrouter", label: "OpenRouter" },
            ]}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Display name</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] text-[13px] text-[var(--text1)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_NAMES[providerType]}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>API key</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] font-mono text-[13px] tracking-[0.03em] text-[var(--text1)]"
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
            <Input
              className="h-10 border-border bg-[var(--surface2)] font-mono text-[12px] text-[var(--text1)]"
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
          <div
            style={{
              fontSize: 12,
              color: "#f87171",
              marginBottom: 12,
              lineHeight: 1.4,
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            {message}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <Button type="button" variant="outline" className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex-1 bg-[var(--accent)] text-white hover:opacity-95"
          >
            {saving ? "Saving…" : "Save & test"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
