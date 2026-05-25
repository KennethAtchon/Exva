import { useEffect, useReducer, type CSSProperties } from "react";
import { api } from "@/lib/exva";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";

export type AiProviderType = "anthropic" | "openai" | "openrouter";

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text2)",
  marginBottom: 6,
};

const anthropicHintStyle: CSSProperties = {
  marginBottom: 16,
  padding: "10px 12px",
  background: "rgba(52,211,153,0.06)",
  border: "1px solid rgba(52,211,153,0.15)",
  borderRadius: 9,
  fontSize: 12,
  color: "var(--text3)",
  lineHeight: 1.45,
};

const DEFAULT_NAMES: Record<AiProviderType, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

type State = {
  providerType: AiProviderType;
  name: string;
  apiKey: string;
  baseUrl: string;
  saving: boolean;
  message: string | null;
};

type Action =
  | { type: "reset" }
  | { type: "setProviderType"; providerType: AiProviderType }
  | { type: "setName"; name: string }
  | { type: "setApiKey"; apiKey: string }
  | { type: "setBaseUrl"; baseUrl: string }
  | { type: "setSaving"; saving: boolean }
  | { type: "setMessage"; message: string | null };

const INITIAL_STATE: State = {
  providerType: "anthropic",
  name: DEFAULT_NAMES.anthropic,
  apiKey: "",
  baseUrl: "",
  saving: false,
  message: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return INITIAL_STATE;
    case "setProviderType": {
      const next = action.providerType;
      const prevDefault = DEFAULT_NAMES[state.providerType];
      return {
        ...state,
        providerType: next,
        name:
          state.name === prevDefault || state.name.trim() === ""
            ? DEFAULT_NAMES[next]
            : state.name,
        baseUrl: next === "openrouter" ? state.baseUrl : "",
        message: null,
      };
    }
    case "setName":
      return { ...state, name: action.name };
    case "setApiKey":
      return { ...state, apiKey: action.apiKey };
    case "setBaseUrl":
      return { ...state, baseUrl: action.baseUrl };
    case "setSaving":
      return { ...state, saving: action.saving };
    case "setMessage":
      return { ...state, message: action.message };
    default:
      return state;
  }
}

export const AddAiProviderModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { providerType, name, apiKey, baseUrl, saving, message } = state;

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset" });
  }, [open]);

  if (!open) return null;

  const onTypeChange = (next: AiProviderType) => {
    dispatch({ type: "setProviderType", providerType: next });
  };

  const metadata =
    providerType === "openrouter" && baseUrl.trim().length > 0
      ? { baseUrl: baseUrl.trim() }
      : undefined;

  const save = async () => {
    dispatch({ type: "setSaving", saving: true });
    dispatch({ type: "setMessage", message: null });
    try {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        dispatch({ type: "setMessage", message: "Enter an API key." });
        return;
      }
      const { id } = await api.saveProvider({
        name: name.trim() || DEFAULT_NAMES[providerType],
        category: "ai",
        providerType,
        apiKey: trimmedKey,
        metadata,
      });
      const test = await api
        .testProvider(id)
        .catch(() => ({ ok: false as const, error: "Test failed" }));
      if (!test.ok) {
        dispatch({
          type: "setMessage",
          message:
            test.error ??
            "Saved key, but the connection test failed. Check the key and try Test on the account.",
        });
      }
      dispatch({ type: "setApiKey", apiKey: "" });
      await onSaved();
      if (test.ok) onClose();
    } catch (e) {
      dispatch({
        type: "setMessage",
        message: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      dispatch({ type: "setSaving", saving: false });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-xl border-border bg-[var(--surface)] p-5 sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[var(--text1)]">
            Add AI provider
          </DialogTitle>
        </DialogHeader>
        <p
          style={{
            fontSize: 12,
            color: "var(--text3)",
            marginBottom: 16,
            lineHeight: 1.45,
          }}
        >
          Keys are stored in the OS keychain. Pick a provider, then assign
          models per role on the Strategy page.
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
            onChange={(e) =>
              dispatch({ type: "setName", name: e.target.value })
            }
            placeholder={DEFAULT_NAMES[providerType]}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>API key</div>
          <Input
            className="h-10 border-border bg-[var(--surface2)] font-mono text-[13px] tracking-[0.03em] text-[var(--text1)]"
            type="password"
            value={apiKey}
            onChange={(e) =>
              dispatch({ type: "setApiKey", apiKey: e.target.value })
            }
            placeholder={
              providerType === "anthropic"
                ? "sk-ant-…"
                : providerType === "openai"
                  ? "sk-…"
                  : "sk-or-…"
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
              onChange={(e) =>
                dispatch({ type: "setBaseUrl", baseUrl: e.target.value })
              }
              placeholder="https://openrouter.ai/api/v1"
            />
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>
              Leave empty to use the default OpenRouter endpoint. Use a full
              https URL if you override it.
            </div>
          </div>
        ) : null}

        {providerType === "anthropic" ? (
          <div style={anthropicHintStyle}>
            <span style={{ color: "#34d399", fontWeight: 600 }}>
              Prompt caching
            </span>{" "}
            is used on Anthropic models where supported, which typically cuts
            cost on repeated agent calls.
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
          <Button
            type="button"
            variant="outline"
            className="flex-1 border-border bg-[var(--surface2)] text-[var(--text2)]"
            onClick={onClose}
          >
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
