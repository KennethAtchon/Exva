import { useEffect, useReducer } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { InstrumentClass, SessionTemplatePayload } from "@/lib/types";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Dialog,
  DialogContent,
  HelpTooltip,
  Input,
} from "@/components/ui";
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
  <div className={toolbarClass}>
    <Input
      value={search}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder="Search templates"
      className="h-10 flex-1 border-border bg-[var(--surface2)] text-[var(--text1)]"
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
  <div className={templateCardClass}>
    <div className="flex flex-wrap items-start justify-between gap-[14px]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[15px] font-bold text-[var(--text1)]">
            {template.name}
          </div>
          {template.instrumentClasses.map((value) => (
            <span key={value} className={chipClass}>
              {formatInstrumentClass(value)}
            </span>
          ))}
        </div>
        <div className="mt-2 text-[13px] leading-normal text-[var(--text2)]">
          {template.description ?? "No description provided."}
        </div>
        <div className="mt-2.5 text-[12px] text-[var(--text3)]">
          Source:{" "}
          {template.sourceSessionName ??
            template.sourceSessionId ??
            "Manual template"}{" "}
          · Updated {formatTimestamp(template.updatedAt)}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2">
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
      <div className={panelClass}>
        <div className="mb-[18px] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="m-0 text-[20px]">Session Templates</h2>
              <HelpTooltip glossaryId="session-templates" />
            </div>
            <div className="mt-1.5 text-[13px] text-[var(--text3)]">
              Capture a full session payload or seed a new one from saved
              structure.
            </div>
          </div>
        </div>

        {error ? <div className={errorBannerClass}>{error}</div> : null}

        <div className={heroCardClass}>
          <div>
            <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
              Save session as template
            </div>
            <div className="mt-2 text-[16px] font-bold text-[var(--text1)]">
              {sourceSession?.name ?? "Choose a session from the table first"}
            </div>
            <div className="mt-1.5 text-[13px] leading-normal text-[var(--text2)]">
              {sourceSession?.objective ??
                "Use the page-level Templates button to manage existing templates, or use a row action to save a specific session."}
            </div>
          </div>

          <div className="grid gap-2.5">
            <Input
              value={templateName}
              onChange={(event) =>
                dispatch({
                  type: "setTemplateName",
                  templateName: event.target.value,
                })
              }
              placeholder="Template name"
              className="h-10 border-border bg-[var(--surface2)] text-[var(--text1)]"
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
              className={textareaClass}
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

        <div className="grid gap-2.5">
          {loading ? (
            <div className={emptyStateClass}>Loading templates…</div>
          ) : null}
          {!loading && templates.length === 0 ? (
            <div className={emptyStateClass}>
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
    experienceId: payload.identity.experienceId,
    selectionMode: payload.identity.selectionMode,
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
        : value === "options"
          ? "Options"
          : "Prediction Markets";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const panelClass =
  "max-h-[92vh] w-[920px] max-w-[96vw] overflow-auto rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_26px_60px_rgba(2,6,23,0.28)]";
const heroCardClass =
  "mb-[18px] grid grid-cols-[1.2fr_1fr] items-start gap-[18px] rounded-[18px] border border-info-border bg-info-dim p-[18px]";
const toolbarClass = "mb-3.5 flex flex-wrap items-center gap-2.5";
const templateCardClass =
  "rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-4";
const emptyStateClass =
  "rounded-2xl border border-dashed border-[var(--border)] p-[22px] text-center text-[var(--text3)]";
const textareaClass =
  "min-h-[84px] resize-y rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-[11px] text-[var(--text1)]";
const chipClass =
  "rounded-full border border-[var(--border)] bg-[var(--chip)] px-[9px] py-1 text-[12px] text-[var(--text2)]";
const errorBannerClass =
  "mb-4 rounded-xl border border-error-border bg-error-dim px-[14px] py-3 text-[13px] text-error";
