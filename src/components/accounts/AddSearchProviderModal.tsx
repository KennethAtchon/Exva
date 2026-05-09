import { useEffect, useState, type CSSProperties } from "react";
import { api } from "@/lib/exva";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from "@/components/ui";

export type SearchProviderType = "brave" | "tavily";

const labelStyle: CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 };

const DEFAULT_NAMES: Record<SearchProviderType, string> = {
  brave: "Brave Search",
  tavily: "Tavily Search",
};

export const AddSearchProviderModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const [providerType, setProviderType] = useState<SearchProviderType>("brave");
  const [name, setName] = useState(DEFAULT_NAMES.brave);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProviderType("brave");
    setName(DEFAULT_NAMES.brave);
    setApiKey("");
    setMessage(null);
  }, [open]);

  if (!open) return null;

  const onTypeChange = (next: SearchProviderType) => {
    setProviderType(next);
    setName((current) => {
      const prevDefault = DEFAULT_NAMES[providerType];
      return current === prevDefault || current.trim() === "" ? DEFAULT_NAMES[next] : current;
    });
    setMessage(null);
  };

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
        category: "search",
        providerType,
        apiKey: trimmedKey,
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
          <DialogTitle className="text-base font-bold text-[var(--text1)]">Add search provider</DialogTitle>
        </DialogHeader>
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, lineHeight: 1.45 }}>
          Exva already includes DuckDuckGo as the built-in default search path. Add Brave or Tavily here only if you want an API-backed provider instead.
        </p>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>Provider</div>
          <ShadcnSelect
            value={providerType}
            onValueChange={(value) => onTypeChange(value as SearchProviderType)}
            options={[
              { value: "brave", label: "Brave Search" },
              { value: "tavily", label: "Tavily" },
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
            placeholder={providerType === "brave" ? "BSA…" : "tvly-…"}
            autoComplete="off"
          />
        </div>

        <div
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            background: "rgba(96,165,250,0.06)",
            border: "1px solid rgba(96,165,250,0.15)",
            borderRadius: 9,
            fontSize: 12,
            color: "var(--text3)",
            lineHeight: 1.45,
          }}
        >
          Optional providers let you override the built-in default for sessions that need a specific backend.
        </div>

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
