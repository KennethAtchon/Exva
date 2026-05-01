import { useEffect, useState } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { InstrumentClass, SessionTemplatePayload } from "@/lib/types";

type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  sourceSessionId: string | null;
  sourceSessionName: string | null;
  instrumentClasses: InstrumentClass[];
  updatedAt: string;
};

export const SessionTemplatesModal = ({
  open,
  sourceSession,
  onClose,
  onUseTemplate,
}: {
  open: boolean;
  sourceSession: SessionSummary | null;
  onClose: () => void;
  onUseTemplate: (input: SessionCreateInput, clearedFields: string[]) => void;
}) => {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [search, setSearch] = useState("");
  const [instrumentClass, setInstrumentClass] = useState<InstrumentClass | "all">("all");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void api
      .listTemplates({
        search: search.trim() || undefined,
        instrumentClass: instrumentClass === "all" ? undefined : instrumentClass,
      })
      .then((result) => setTemplates(result.templates))
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [open, search, instrumentClass]);

  useEffect(() => {
    if (!open) return;
    setTemplateName(sourceSession ? `${sourceSession.name} Template` : "");
    setTemplateDescription(sourceSession?.objective ?? "");
  }, [open, sourceSession]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Session Templates</h2>
            <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 13 }}>
              Capture a full session payload or seed a new one from saved structure.
            </div>
          </div>
          <button onClick={onClose} style={closeStyle}>✕</button>
        </div>

        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={heroCardStyle}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)" }}>Save session as template</div>
            <div style={{ marginTop: 8, color: "var(--text1)", fontSize: 16, fontWeight: 700 }}>
              {sourceSession?.name ?? "Choose a session from the table first"}
            </div>
            <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13, lineHeight: 1.5 }}>
              {sourceSession?.objective ?? "Use the page-level Templates button to manage existing templates, or use a row action to save a specific session."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" style={inputStyle} />
            <textarea value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} placeholder="What this template is for" rows={3} style={textareaStyle} />
            <button
              onClick={async () => {
                if (!sourceSession || !templateName.trim()) return;
                setSaving(true);
                setError(null);
                try {
                  const payload = await api.buildTemplatePayloadFromSession(sourceSession.id);
                  await api.createTemplate({
                    name: templateName.trim(),
                    description: templateDescription.trim() || undefined,
                    sourceSessionId: sourceSession.id,
                    payload,
                  });
                  const result = await api.listTemplates({
                    search: search.trim() || undefined,
                    instrumentClass: instrumentClass === "all" ? undefined : instrumentClass,
                  });
                  setTemplates(result.templates);
                } catch (saveError) {
                  setError(saveError instanceof Error ? saveError.message : "Failed to save template.");
                } finally {
                  setSaving(false);
                }
              }}
              style={primaryButtonStyle}
              disabled={saving || !sourceSession || !templateName.trim()}
            >
              {saving ? "Saving Template..." : "Save Full Session Payload"}
            </button>
          </div>
        </div>

        <div style={toolbarStyle}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" style={{ ...inputStyle, flex: 1 }} />
          <select value={instrumentClass} onChange={(event) => setInstrumentClass(event.target.value as InstrumentClass | "all")} style={inputStyle}>
            <option value="all">All instruments</option>
            <option value="stock">Stocks</option>
            <option value="crypto">Crypto</option>
            <option value="futures">Futures</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {loading ? <div style={emptyStateStyle}>Loading templates...</div> : null}
          {!loading && templates.length === 0 ? <div style={emptyStateStyle}>No templates matched the current filters.</div> : null}
          {!loading
            ? templates.map((template) => (
                <div key={template.id} style={templateCardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 15, color: "var(--text1)", fontWeight: 700 }}>{template.name}</div>
                        {template.instrumentClasses.map((value) => (
                          <span key={value} style={chipStyle}>{formatInstrumentClass(value)}</span>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
                        {template.description ?? "No description provided."}
                      </div>
                      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>
                        Source: {template.sourceSessionName ?? template.sourceSessionId ?? "Manual template"} · Updated {formatTimestamp(template.updatedAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <button
                        onClick={async () => {
                          setError(null);
                          try {
                            const result = await api.useTemplate(template.id);
                            onUseTemplate(payloadToInput(result.payload), result.clearedFields);
                            onClose();
                          } catch (useError) {
                            setError(useError instanceof Error ? useError.message : "Failed to apply template.");
                          }
                        }}
                        style={primaryButtonStyle}
                      >
                        Use Template
                      </button>
                      <button
                        onClick={async () => {
                          setError(null);
                          try {
                            await api.deleteTemplate(template.id);
                            setTemplates((current) => current.filter((entry) => entry.id !== template.id));
                          } catch (deleteError) {
                            setError(deleteError instanceof Error ? deleteError.message : "Failed to delete template.");
                          }
                        }}
                        style={secondaryButtonStyle}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            : null}
        </div>
      </div>
    </div>
  );
};

function payloadToInput(payload: SessionTemplatePayload): SessionCreateInput {
  return {
    name: "",
    objective: payload.identity.objective,
    selectionMode: payload.identity.selectionMode,
    instrumentClasses: payload.identity.instrumentClasses,
    instrumentScope: payload.identity.instrumentScope,
    defaultSearchProviderId: payload.identity.defaultSearchProviderId,
    selectorSettings: payload.selectorSettings,
    capitalLimitUsd: payload.identity.capitalLimitUsd,
    executionMode: payload.identity.executionMode,
    brokerAccountIds: payload.brokerAssignments.map((assignment) => assignment.brokerAccountId).filter(Boolean),
    brokerOverridesByInstrumentClass: payload.brokerOverridesByInstrumentClass,
  };
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock" ? "Stocks" : value === "crypto" ? "Crypto" : "Futures";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const overlayStyle = { position: "fixed", inset: 0, background: "rgba(3,6,11,0.74)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 18 } as const;
const panelStyle = { width: 920, maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", background: "linear-gradient(180deg, rgba(13,18,25,0.98), rgba(9,13,18,0.98))", border: "1px solid var(--border)", borderRadius: 20, padding: 24, boxShadow: "0 26px 60px rgba(2,6,23,0.48)" } as const;
const heroCardStyle = { display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18, alignItems: "start", marginBottom: 18, padding: 18, borderRadius: 18, border: "1px solid var(--accent-dim)", background: "linear-gradient(135deg, rgba(96,165,250,0.12), rgba(15,23,42,0.18))" } as const;
const toolbarStyle = { display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" } as const;
const templateCardStyle = { border: "1px solid var(--border)", borderRadius: 16, padding: 16, background: "rgba(18,26,36,0.72)" } as const;
const emptyStateStyle = { border: "1px dashed var(--border)", borderRadius: 16, padding: 22, color: "var(--text3)", textAlign: "center" as const };
const inputStyle = { padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(7,10,15,0.5)", color: "var(--text1)" } as const;
const textareaStyle = { ...inputStyle, resize: "vertical" as const, minHeight: 84 };
const chipStyle = { padding: "4px 9px", borderRadius: 999, border: "1px solid var(--border)", background: "rgba(7,10,15,0.38)", color: "var(--text2)", fontSize: 11 } as const;
const closeStyle = { background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 18 } as const;
const secondaryButtonStyle = { padding: "10px 13px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const primaryButtonStyle = { padding: "10px 13px", borderRadius: 10, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" } as const;
const errorBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.34)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: 13 } as const;
