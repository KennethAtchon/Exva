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

export type SearchProviderType = "brave" | "tavily";

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text2)",
  marginBottom: 6,
};

const DEFAULT_NAMES: Record<SearchProviderType, string> = {
  brave: "Brave Search",
  tavily: "Tavily Search",
};

type State = {
  providerType: SearchProviderType;
  name: string;
  apiKey: string;
  saving: boolean;
  message: string | null;
};

type Action =
  | { type: "reset" }
  | { type: "setProviderType"; providerType: SearchProviderType }
  | { type: "setName"; name: string }
  | { type: "setApiKey"; apiKey: string }
  | { type: "setSaving"; saving: boolean }
  | { type: "setMessage"; message: string | null };

const INITIAL_STATE: State = {
  providerType: "brave",
  name: DEFAULT_NAMES.brave,
  apiKey: "",
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
        message: null,
      };
    }
    case "setName":
      return { ...state, name: action.name };
    case "setApiKey":
      return { ...state, apiKey: action.apiKey };
    case "setSaving":
      return { ...state, saving: action.saving };
    case "setMessage":
      return { ...state, message: action.message };
    default:
      return state;
  }
}

export const AddSearchProviderModal = ({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { providerType, name, apiKey, saving, message } = state;

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset" });
  }, [open]);

  if (!open) return null;

  const onTypeChange = (next: SearchProviderType) => {
    dispatch({ type: "setProviderType", providerType: next });
  };

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
        category: "search",
        providerType,
        apiKey: trimmedKey,
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
            Add search provider
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
          Exva already includes DuckDuckGo as the built-in default search path.
          Add Brave or Tavily here only if you want an API-backed provider
          instead.
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
          Optional providers let you override the built-in default for sessions
          that need a specific backend.
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
