import { useEffect, useState } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { SessionTemplatePayload } from "@/lib/types";

export const SessionTemplatesModal = ({
  open,
  focusedSession,
  onClose,
  onUseTemplate,
}: {
  open: boolean;
  focusedSession: SessionSummary | null;
  onClose: () => void;
  onUseTemplate: (input: SessionCreateInput) => void;
}) => {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string | null; sourceSessionName: string | null }>>([]);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    if (!open) return;
    api.listTemplates().then((result) => setTemplates(result.templates)).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div style={panelStyle}>
        {/* TODO(phase-04): Upgrade this modal to the fuller template management flow from the plan,
            including search/filter, validation surfacing for cleared fields, and richer template metadata. */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Session Templates</h2>
          <button onClick={onClose} style={closeStyle}>✕</button>
        </div>
        {focusedSession && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="New template name" style={inputStyle} />
            <button
              onClick={async () => {
                if (!templateName.trim()) return;
                const payload = buildTemplatePayload(focusedSession);
                await api.createTemplate({
                  name: templateName.trim(),
                  sourceSessionId: focusedSession.id,
                  payload,
                });
                setTemplateName("");
                const result = await api.listTemplates();
                setTemplates(result.templates);
              }}
              style={primaryButtonStyle}
            >
              Save Focused Session
            </button>
          </div>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {templates.map((template) => (
            <div key={template.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14, color: "var(--text1)", fontWeight: 600 }}>{template.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)" }}>{template.description ?? template.sourceSessionName ?? "Template"}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={async () => {
                      const result = await api.useTemplate(template.id);
                      onUseTemplate({
                        name: "",
                        objective: result.payload.identity.objective,
                        selectionMode: result.payload.identity.selectionMode,
                        instrumentClasses: result.payload.identity.instrumentClasses,
                        instrumentScope: result.payload.identity.instrumentScope,
                        defaultSearchProviderId: result.payload.identity.defaultSearchProviderId,
                        selectorSettings: result.payload.selectorSettings,
                        capitalLimitUsd: result.payload.identity.capitalLimitUsd,
                        executionMode: result.payload.identity.executionMode,
                        brokerAccountIds: result.payload.brokerAssignments.map((assignment) => assignment.brokerAccountId).filter(Boolean),
                        brokerOverridesByInstrumentClass: result.payload.brokerOverridesByInstrumentClass,
                      });
                      onClose();
                    }}
                    style={primaryButtonStyle}
                  >
                    Use
                  </button>
                  <button
                    onClick={async () => {
                      await api.deleteTemplate(template.id);
                      const result = await api.listTemplates();
                      setTemplates(result.templates);
                    }}
                    style={secondaryButtonStyle}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function buildTemplatePayload(session: SessionSummary): SessionTemplatePayload {
  // TODO(phase-04): Build this payload from the full persisted session family rows
  // (strategy, selector settings, AI roles, broker assignments, routing overrides)
  // instead of using placeholder defaults for fields that later phases own.
  return {
    version: 1,
    identity: {
      objective: session.objective,
      selectionMode: session.selectionMode,
      instrumentClasses: session.instrumentClasses,
      instrumentScope: session.instrumentScope,
      executionMode: session.executionMode,
      capitalLimitUsd: session.capitalLimitUsd,
      defaultSearchProviderId: session.defaultSearchProviderId,
    },
    selectorSettings: {
      aiPickerEnabled: true,
    },
    strategy: {
      strategyProfile: "passive_income",
      maxPositionUsd: 500,
      stopLossPct: 2,
      takeProfitPct: 4,
      maxConcurrentTrades: 3,
      researchDepth: "balanced",
      dailyLossLimitUsd: 200,
      profitTargetUsd: 1000,
      maxAiSpendUsd: 5,
      humanApprovalRequired: false,
    },
    aiRoles: [],
    brokerAssignments: [{ brokerAccountId: "default-broker" }],
    brokerOverridesByInstrumentClass: {},
  };
}

const overlayStyle = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40 } as const;
const panelStyle = { width: 720, maxWidth: "94vw", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 } as const;
const inputStyle = { flex: 1, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const closeStyle = { background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 18 } as const;
const secondaryButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const primaryButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "none", background: "var(--accent)", color: "white", cursor: "pointer" } as const;
