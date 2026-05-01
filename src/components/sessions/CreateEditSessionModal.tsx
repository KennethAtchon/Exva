import { useEffect, useState } from "react";
import type { SessionCreateInput, SessionSummary } from "@/lib/exva";
import type { InstrumentClass } from "@/lib/types";

interface Props {
  open: boolean;
  initialSession?: SessionSummary | null;
  templateInput?: SessionCreateInput | null;
  onClose: () => void;
  onSubmit: (input: SessionCreateInput, sessionId?: string) => Promise<void>;
}

export const CreateEditSessionModal = ({ open, initialSession, templateInput, onClose, onSubmit }: Props) => {
  const [form, setForm] = useState<SessionCreateInput>(defaultInput());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (templateInput) {
      setForm(templateInput);
      return;
    }
    if (initialSession) {
      setForm({
        name: initialSession.name,
        objective: initialSession.objective,
        selectionMode: initialSession.selectionMode,
        instrumentClasses: initialSession.instrumentClasses,
        instrumentScope: initialSession.instrumentScope,
        defaultSearchProviderId: initialSession.defaultSearchProviderId,
        selectorSettings: { aiPickerEnabled: true },
        capitalLimitUsd: initialSession.capitalLimitUsd,
        executionMode: initialSession.executionMode,
        brokerAccountIds: ["default-broker"],
        brokerOverridesByInstrumentClass: {},
      });
      return;
    }
    setForm(defaultInput());
  }, [open, initialSession, templateInput]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{initialSession ? "Edit Session" : "New Session"}</h2>
          <button onClick={onClose} style={closeStyle}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Session name" style={inputStyle} />
          <textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} placeholder="Objective" rows={3} style={inputStyle} />
          <input value={form.instrumentScope} onChange={(event) => setForm({ ...form, instrumentScope: event.target.value })} placeholder="Instrument scope (comma or newline separated)" style={inputStyle} />
          <div style={{ display: "flex", gap: 10 }}>
            <select value={form.selectionMode} onChange={(event) => setForm({ ...form, selectionMode: event.target.value as SessionCreateInput["selectionMode"] })} style={inputStyle}>
              <option value="manual_shortlist">Manual shortlist</option>
              <option value="ai_selected_universe">AI selected universe</option>
            </select>
            <select value={form.executionMode} onChange={(event) => setForm({ ...form, executionMode: event.target.value as SessionCreateInput["executionMode"] })} style={inputStyle}>
              <option value="paper_only">Paper only</option>
              <option value="live_allowed">Live allowed</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={checkboxStyle}>
              <input
                type="checkbox"
                checked={form.instrumentClasses.includes("stock")}
                onChange={(event) =>
                  setForm({
                    ...form,
                    instrumentClasses: toggleInstrumentClass(form.instrumentClasses, "stock", event.target.checked),
                  })
                }
              />
              Stocks
            </label>
            <label style={checkboxStyle}>
              <input
                type="checkbox"
                checked={form.instrumentClasses.includes("crypto")}
                onChange={(event) =>
                  setForm({
                    ...form,
                    instrumentClasses: toggleInstrumentClass(form.instrumentClasses, "crypto", event.target.checked),
                  })
                }
              />
              Crypto
            </label>
            <label style={checkboxStyle}>
              <input
                type="checkbox"
                checked={form.instrumentClasses.includes("futures")}
                onChange={(event) =>
                  setForm({
                    ...form,
                    instrumentClasses: toggleInstrumentClass(form.instrumentClasses, "futures", event.target.checked),
                  })
                }
              />
              Futures
            </label>
          </div>
          <input
            value={String(form.capitalLimitUsd)}
            onChange={(event) => setForm({ ...form, capitalLimitUsd: Number(event.target.value) || 0 })}
            placeholder="Capital limit"
            type="number"
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(form, initialSession?.id);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            style={primaryButtonStyle}
            disabled={saving}
          >
            {saving ? "Saving..." : initialSession ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
};

function defaultInput(): SessionCreateInput {
  return {
    name: "",
    objective: "",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "SPY,QQQ",
    defaultSearchProviderId: null,
    selectorSettings: { aiPickerEnabled: true },
    capitalLimitUsd: 10000,
    executionMode: "paper_only",
    brokerAccountIds: ["default-broker"],
    brokerOverridesByInstrumentClass: {},
  };
}

function toggleInstrumentClass(current: InstrumentClass[], value: InstrumentClass, checked: boolean): InstrumentClass[] {
  if (checked) {
    return current.includes(value) ? current : [...current, value];
  }
  return current.filter((entry) => entry !== value);
}

const overlayStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 } as const;
const panelStyle = { width: 560, maxWidth: "92vw", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 } as const;
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const closeStyle = { background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 18 } as const;
const secondaryButtonStyle = { padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const primaryButtonStyle = { padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" } as const;
const checkboxStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" } as const;
