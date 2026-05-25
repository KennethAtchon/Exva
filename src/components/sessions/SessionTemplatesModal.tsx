import { useEffect, useReducer } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { InstrumentClass, SessionTemplatePayload } from "@/lib/types";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Dialog, DialogContent, Input } from "@/components/ui";

type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  sourceSessionId: string | null;
  sourceSessionName: string | null;
  instrumentClasses: InstrumentClass[];
  updatedAt: string;
};

type TemplateModalState = {
  templates: TemplateListItem[];
  templateName: string;
  templateDescription: string;
  search: string;
  instrumentClass: InstrumentClass | "all";
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type TemplateModalAction =
  | { type: "setSearch"; search: string }
  | { type: "setInstrumentClass"; instrumentClass: InstrumentClass | "all" }
  | { type: "setTemplateName"; templateName: string }
  | { type: "setTemplateDescription"; templateDescription: string }
  | { type: "loadStart" }
  | { type: "loadSuccess"; templates: TemplateListItem[] }
  | { type: "loadError"; error: string }
  | { type: "saveStart" }
  | { type: "saveEnd" }
  | { type: "setError"; error: string | null }
  | { type: "setTemplates"; templates: TemplateListItem[] }
  | {
      type: "hydrateFromSource";
      sourceSession: SessionSummary | null;
    };

// ---------------------------------------------------------------------------
// TemplateSearchBar
// ---------------------------------------------------------------------------

const TemplateSearchBar = ({
  search,
  instrumentClass,
  onSearchChange,
  onInstrumentClassChange,
}: {
  search: string;
  instrumentClass: InstrumentClass | "all";
  onSearchChange: (value: string) => void;
  onInstrumentClassChange: (value: InstrumentClass | "all") => void;
}) => (
  <div style={toolbarStyle}>
    <Input
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search templates"
      className="h-10 flex-1 border-border bg-[rgba(7,10,15,0.5)] text-[var(--text1)]"
    />
    <ShadcnSelect
      value={instrumentClass}
      onValueChange={(value) =>
        onInstrumentClassChange(value as InstrumentClass | "all")
      }
      className="w-[180px]"
      options={[
        { value: "all", label: "All instruments" },
        { value: "stock", label: "Stocks" },
        { value: "crypto", label: "Crypto" },
        { value: "futures", label: "Futures" },
      ]}
    />
  </div>
);

// ---------------------------------------------------------------------------
// TemplateCard
// ---------------------------------------------------------------------------

const TemplateCard = ({
  template,
  onUse,
  onDelete,
}: {
  template: TemplateListItem;
  onUse: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) => (
  <div style={templateCardStyle}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 15,
              color: "var(--text1)",
              fontWeight: 700,
            }}
          >
            {template.name}
          </div>
          {template.instrumentClasses.map((value) => (
            <span key={value} style={chipStyle}>
              {formatInstrumentClass(value)}
            </span>
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.5,
          }}
        >
          {template.description ?? "No description provided."}
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
          Source:{" "}
          {template.sourceSessionName ??
            template.sourceSessionId ??
            "Manual template"}{" "}
          · Updated {formatTimestamp(template.updatedAt)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <Button
          onClick={() => onUse(template.id)}
          className="bg-[var(--accent)] text-white"
        >
          Use Template
        </Button>
        <Button
          onClick={() => onDelete(template.id)}
          variant="outline"
          className="border-border bg-[var(--surface2)] text-[var(--text2)]"
        >
          Delete
        </Button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// SessionTemplatesModal
// ---------------------------------------------------------------------------

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
  const initialState: TemplateModalState = {
    templates: [],
    templateName: "",
    templateDescription: "",
    search: "",
    instrumentClass: "all",
    loading: false,
    saving: false,
    error: null,
  };

  function reducer(
    state: TemplateModalState,
    action: TemplateModalAction,
  ): TemplateModalState {
    switch (action.type) {
      case "setSearch":
        return { ...state, search: action.search };
      case "setInstrumentClass":
        return { ...state, instrumentClass: action.instrumentClass };
      case "setTemplateName":
        return { ...state, templateName: action.templateName };
      case "setTemplateDescription":
        return { ...state, templateDescription: action.templateDescription };
      case "loadStart":
        return { ...state, error: null, loading: true };
      case "loadSuccess":
        return { ...state, templates: action.templates, loading: false };
      case "loadError":
        return { ...state, error: action.error, loading: false };
      case "saveStart":
        return { ...state, saving: true, error: null };
      case "saveEnd":
        return { ...state, saving: false };
      case "setError":
        return { ...state, error: action.error };
      case "setTemplates":
        return { ...state, templates: action.templates };
      case "hydrateFromSource":
        return {
          ...state,
          templateName: action.sourceSession
            ? `${action.sourceSession.name} Template`
            : "",
          templateDescription: action.sourceSession?.objective ?? "",
        };
      default:
        return state;
    }
  }

  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    templates,
    templateName,
    templateDescription,
    search,
    instrumentClass,
    loading,
    saving,
    error,
  } = state;

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "loadStart" });
    void api
      .listTemplates({
        search: search.trim() || undefined,
        instrumentClass:
          instrumentClass === "all" ? undefined : instrumentClass,
      })
      .then((result) =>
        dispatch({ type: "loadSuccess", templates: result.templates }),
      )
      .catch((loadError: Error) =>
        dispatch({ type: "loadError", error: loadError.message }),
      );
  }, [open, search, instrumentClass]);

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "hydrateFromSource", sourceSession });
  }, [open, sourceSession]);

  const handleUseTemplate = async (templateId: string) => {
    dispatch({ type: "setError", error: null });
    try {
      const result = await api.useTemplate(templateId);
      onUseTemplate(payloadToInput(result.payload), result.clearedFields);
      onClose();
    } catch (useError) {
      dispatch({
        type: "setError",
        error:
          useError instanceof Error
            ? useError.message
            : "Failed to apply template.",
      });
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    dispatch({ type: "setError", error: null });
    try {
      await api.deleteTemplate(templateId);
      dispatch({
        type: "setTemplates",
        templates: templates.filter((entry) => entry.id !== templateId),
      });
    } catch (deleteError) {
      dispatch({
        type: "setError",
        error:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete template.",
      });
    }
  };

  if (!open) return null;

  return renderSessionTemplatesModalView({
    open,
    onClose,
    error,
    sourceSession,
    templateName,
    templateDescription,
    dispatch,
    saving,
    templates,
    search,
    instrumentClass,
    loading,
    handleUseTemplate,
    handleDeleteTemplate,
  });
};

const renderSessionTemplatesModalView = ({
  open,
  onClose,
  error,
  sourceSession,
  templateName,
  templateDescription,
  dispatch,
  saving,
  templates,
  search,
  instrumentClass,
  loading,
  handleUseTemplate,
  handleDeleteTemplate,
}: {
  open: boolean;
  onClose: () => void;
  error: string | null;
  sourceSession: SessionSummary | null;
  templateName: string;
  templateDescription: string;
  dispatch: (action: TemplateModalAction) => void;
  saving: boolean;
  templates: TemplateListItem[];
  search: string;
  instrumentClass: InstrumentClass | "all";
  loading: boolean;
  handleUseTemplate: (templateId: string) => Promise<void>;
  handleDeleteTemplate: (templateId: string) => Promise<void>;
}) => (
  <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-auto rounded-[20px] border-border bg-transparent p-0 sm:max-w-[920px]">
      <div style={panelStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Session Templates</h2>
            <div style={{ marginTop: 6, color: "var(--text3)", fontSize: 13 }}>
              Capture a full session payload or seed a new one from saved
              structure.
            </div>
          </div>
        </div>

        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={heroCardStyle}>
          <div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text3)",
              }}
            >
              Save session as template
            </div>
            <div
              style={{
                marginTop: 8,
                color: "var(--text1)",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {sourceSession?.name ?? "Choose a session from the table first"}
            </div>
            <div
              style={{
                marginTop: 6,
                color: "var(--text2)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {sourceSession?.objective ??
                "Use the page-level Templates button to manage existing templates, or use a row action to save a specific session."}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <Input
              value={templateName}
              onChange={(event) =>
                dispatch({
                  type: "setTemplateName",
                  templateName: event.target.value,
                })
              }
              placeholder="Template name"
              className="h-10 border-border bg-[rgba(7,10,15,0.5)] text-[var(--text1)]"
            />
            <textarea
              value={templateDescription}
              onChange={(event) =>
                dispatch({
                  type: "setTemplateDescription",
                  templateDescription: event.target.value,
                })
              }
              placeholder="What this template is for"
              rows={3}
              style={textareaStyle}
            />
            <Button
              onClick={async () => {
                if (!sourceSession || !templateName.trim()) return;
                dispatch({ type: "saveStart" });
                try {
                  const payload = await api.buildTemplatePayloadFromSession(
                    sourceSession.id,
                  );
                  const created = await api.createTemplate({
                    name: templateName.trim(),
                    description: templateDescription.trim() || undefined,
                    sourceSessionId: sourceSession.id,
                    payload,
                  });
                  const nextTemplate = {
                    id: created.id,
                    name: templateName.trim(),
                    description: templateDescription.trim() || null,
                    sourceSessionId: sourceSession.id,
                    sourceSessionName: sourceSession.name,
                    instrumentClasses: payload.identity.instrumentClasses,
                    updatedAt: created.updatedAt,
                  };
                  const nextTemplates = (() => {
                    const next = [
                      nextTemplate,
                      ...templates.filter(
                        (template) => template.id !== created.id,
                      ),
                    ];
                    return next.filter((template) => {
                      const matchesSearch =
                        !search.trim() ||
                        template.name
                          .toLowerCase()
                          .includes(search.trim().toLowerCase()) ||
                        template.description
                          ?.toLowerCase()
                          .includes(search.trim().toLowerCase());
                      const matchesInstrument =
                        instrumentClass === "all" ||
                        template.instrumentClasses.includes(instrumentClass);
                      return matchesSearch && matchesInstrument;
                    });
                  })();
                  dispatch({
                    type: "setTemplates",
                    templates: nextTemplates,
                  });
                } catch (saveError) {
                  dispatch({
                    type: "setError",
                    error:
                      saveError instanceof Error
                        ? saveError.message
                        : "Failed to save template.",
                  });
                } finally {
                  dispatch({ type: "saveEnd" });
                }
              }}
              className="bg-[var(--accent)] text-white"
              disabled={saving || !sourceSession || !templateName.trim()}
            >
              {saving ? "Saving Template..." : "Save Full Session Payload"}
            </Button>
          </div>
        </div>

        <TemplateSearchBar
          search={search}
          instrumentClass={instrumentClass}
          onSearchChange={(value) =>
            dispatch({ type: "setSearch", search: value })
          }
          onInstrumentClassChange={(value) =>
            dispatch({ type: "setInstrumentClass", instrumentClass: value })
          }
        />

        <div style={{ display: "grid", gap: 10 }}>
          {loading ? (
            <div style={emptyStateStyle}>Loading templates…</div>
          ) : null}
          {!loading && templates.length === 0 ? (
            <div style={emptyStateStyle}>
              No templates matched the current filters.
            </div>
          ) : null}
          {!loading
            ? templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onUse={handleUseTemplate}
                  onDelete={handleDeleteTemplate}
                />
              ))
            : null}
        </div>
      </div>
    </DialogContent>
  </Dialog>
);

function payloadToInput(payload: SessionTemplatePayload): SessionCreateInput {
  return {
    name: "",
    objective: payload.identity.objective,
    selectionMode: payload.identity.selectionMode,
    instrumentClasses: payload.identity.instrumentClasses,
    instrumentScope: payload.identity.instrumentScope,
    defaultSearchProviderId: payload.identity.defaultSearchProviderId,
    selectorSettings: payload.selectorSettings,
    executionMode: payload.identity.executionMode,
    brokerAssignments: payload.brokerAssignments.filter(
      (assignment) => assignment.brokerAccountId,
    ),
    brokerOverridesByInstrumentClass: payload.brokerOverridesByInstrumentClass,
  };
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock"
    ? "Stocks"
    : value === "crypto"
      ? "Crypto"
      : value === "futures"
        ? "Futures"
        : "Prediction Markets";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const panelStyle = {
  width: 920,
  maxWidth: "96vw",
  maxHeight: "92vh",
  overflow: "auto",
  background:
    "linear-gradient(180deg, rgba(13,18,25,0.98), rgba(9,13,18,0.98))",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 26px 60px rgba(2,6,23,0.48)",
} as const;
const heroCardStyle = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr",
  gap: 18,
  alignItems: "start",
  marginBottom: 18,
  padding: 18,
  borderRadius: 18,
  border: "1px solid var(--accent-dim)",
  background:
    "linear-gradient(135deg, rgba(96,165,250,0.12), rgba(15,23,42,0.18))",
} as const;
const toolbarStyle = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginBottom: 14,
  flexWrap: "wrap",
} as const;
const templateCardStyle = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 16,
  background: "rgba(18,26,36,0.72)",
} as const;
const emptyStateStyle = {
  border: "1px dashed var(--border)",
  borderRadius: 16,
  padding: 22,
  color: "var(--text3)",
  textAlign: "center" as const,
};
const inputStyle = {
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.5)",
  color: "var(--text1)",
} as const;
const textareaStyle = {
  ...inputStyle,
  resize: "vertical" as const,
  minHeight: 84,
};
const chipStyle = {
  padding: "4px 9px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.38)",
  color: "var(--text2)",
  fontSize: 12,
} as const;
const errorBannerStyle = {
  marginBottom: 16,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.34)",
  background: "rgba(248,113,113,0.08)",
  color: "#fca5a5",
  fontSize: 13,
} as const;
