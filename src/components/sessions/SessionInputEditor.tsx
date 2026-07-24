import { useEffect, useReducer } from "react";
import { experienceCatalogApi } from "@/lib/experience-catalog-api";
import type {
  ExperienceTemplateSummary,
  InputMode,
  InstrumentSetRevision,
  SourceDefinition,
  TemplateConfigurationOptions,
} from "@electron/shared/domain/experience-inputs/catalog";
import type {
  SessionInputSubscriptionDraft,
  EventSourceSubscriptionDraft,
  ScheduledScanSubscriptionDraft,
} from "@electron/shared/domain/experience-inputs/subscription";
import type {
  FieldError,
  FieldWarning,
} from "@electron/shared/domain/experience-inputs/validation-result";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { cadenceLabel } from "@electron/shared/domain/experience-inputs/cadence";
import { ShadcnSelect } from "@/components/custom-ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionInputEditorProps {
  /** Which template the editor is bound to. null = not yet selected. */
  templateId: string | null;
  templateVersion?: number | null;
  /** Current draft subscriptions controlled by the parent. */
  subscriptions: SessionInputSubscriptionDraft[];
  onChange: (subscriptions: SessionInputSubscriptionDraft[]) => void;
  /** Field-level errors from the last validate-draft call. */
  fieldErrors?: FieldError[];
  fieldWarnings?: FieldWarning[];
  /** Set by parent after validateDraft returns usesUnvalidatedUniverse=true. */
  usesUnvalidatedUniverse?: boolean;
  /** Whether the parent is in "editing existing session" mode (lock template). */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type EditorState = {
  templates: ExperienceTemplateSummary[];
  templatesLoaded: boolean;
  templateError: string | null;
  options: TemplateConfigurationOptions | null;
  optionsLoaded: boolean;
  optionsError: string | null;
  /** Active mode (event_source | scheduled_scan | manual). */
  mode: InputMode | null;
  /** Whether user chose a recommended profile (profileId) or "custom". */
  profileId: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEFRAME_LABELS: Record<TradingTimeframe, string> = {
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
  "1w": "1 week",
};

function defaultEventDraft(
  templateId: string,
  templateVersion: number,
  options: TemplateConfigurationOptions,
): EventSourceSubscriptionDraft | null {
  const src = options.availableSourceDefinitions[0];
  const tf = options.supportedAnalysisTimeframes[0];
  if (!src || !tf) return null;
  return {
    mode: "event_source",
    templateId,
    templateVersion,
    sourceDefinitionId: src.id,
    sourceRevision: src.revision,
    filters: {},
    analysisTimeframe: tf,
  };
}

function defaultScheduledDraft(
  templateId: string,
  templateVersion: number,
  options: TemplateConfigurationOptions,
): ScheduledScanSubscriptionDraft | null {
  const set = options.availableInstrumentSets[0];
  const tf = options.supportedAnalysisTimeframes[0];
  if (!set || !tf) return null;
  const cadence =
    options.cadenceConstraints?.defaultCadence ??
    ({ kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 } as const);
  return {
    mode: "scheduled_scan",
    templateId,
    templateVersion,
    instrumentSetId: set.setId,
    instrumentSetRevision: set.revision,
    cadence,
    analysisTimeframe: tf,
    marketCalendarId: "us_equities",
    strategyParameters: {},
  };
}

function draftFromProfile(
  profileId: string,
  options: TemplateConfigurationOptions,
): SessionInputSubscriptionDraft | null {
  const profile = options.recommendedProfiles.find((p) => p.id === profileId);
  if (!profile) return null;
  if (profile.mode === "event_source") {
    return {
      mode: "event_source",
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      sourceDefinitionId: profile.sourceDefinitionId,
      sourceRevision: profile.sourceRevision,
      filters: profile.filters,
      analysisTimeframe: profile.analysisTimeframe,
      createdFromProfileId: profile.id,
    };
  }
  return {
    mode: "scheduled_scan",
    templateId: profile.templateId,
    templateVersion: profile.templateVersion,
    instrumentSetId: profile.instrumentSetId,
    instrumentSetRevision: profile.instrumentSetRevision,
    cadence: profile.cadence,
    analysisTimeframe: profile.analysisTimeframe,
    marketCalendarId: profile.marketCalendarId,
    strategyParameters: profile.strategyParameters,
    createdFromProfileId: profile.id,
  };
}

// ---------------------------------------------------------------------------
// Sub-editors
// ---------------------------------------------------------------------------

function EventSourceEditor({
  draft,
  options,
  onChange,
  fieldErrors,
}: {
  draft: EventSourceSubscriptionDraft;
  options: TemplateConfigurationOptions;
  onChange: (next: EventSourceSubscriptionDraft) => void;
  fieldErrors: FieldError[];
}) {
  const sourceError = fieldErrors.find((e) =>
    e.field.includes("sourceDefinitionId"),
  );
  const tfError = fieldErrors.find((e) =>
    e.field.includes("analysisTimeframe"),
  );

  return (
    <div className="grid gap-3.5">
      <Field label="Event source" error={sourceError?.message}>
        <ShadcnSelect
          value={draft.sourceDefinitionId}
          onValueChange={(id) => {
            const src = options.availableSourceDefinitions.find(
              (s) => s.id === id,
            );
            if (!src) return;
            onChange({
              ...draft,
              sourceDefinitionId: id,
              sourceRevision: src.revision,
            });
          }}
          options={options.availableSourceDefinitions.map((src) => ({
            value: src.id,
            label: src.name,
          }))}
        />
        {options.availableSourceDefinitions.length === 0 ? (
          <div className={hintClass}>
            No event sources are configured yet. Add one in Event Sources.
          </div>
        ) : null}
      </Field>

      <Field label="Analysis timeframe" error={tfError?.message}>
        <ShadcnSelect
          value={draft.analysisTimeframe}
          onValueChange={(tf) =>
            onChange({ ...draft, analysisTimeframe: tf as TradingTimeframe })
          }
          options={options.supportedAnalysisTimeframes.map((tf) => ({
            value: tf,
            label: TIMEFRAME_LABELS[tf] ?? tf,
          }))}
        />
        <div className={hintClass}>
          Bar size used for technical analysis in each research cycle.
        </div>
      </Field>
    </div>
  );
}

function ScheduledScanEditor({
  draft,
  options,
  onChange,
  fieldErrors,
}: {
  draft: ScheduledScanSubscriptionDraft;
  options: TemplateConfigurationOptions;
  onChange: (next: ScheduledScanSubscriptionDraft) => void;
  fieldErrors: FieldError[];
}) {
  const setError = fieldErrors.find((e) => e.field.includes("instrumentSetId"));
  const cadenceError = fieldErrors.find((e) => e.field.includes("cadence"));
  const tfError = fieldErrors.find((e) =>
    e.field.includes("analysisTimeframe"),
  );

  const cadence = draft.cadence;
  const isInterval = cadence.kind === "interval";

  return (
    <div className="grid gap-3.5">
      <Field label="Instrument set" error={setError?.message}>
        <ShadcnSelect
          value={draft.instrumentSetId}
          onValueChange={(id) => {
            const set = options.availableInstrumentSets.find(
              (s) => s.setId === id,
            );
            if (!set) return;
            onChange({
              ...draft,
              instrumentSetId: id,
              instrumentSetRevision: set.revision,
            });
          }}
          options={options.availableInstrumentSets.map((set) => ({
            value: set.setId,
            label: `${set.name} (${set.members.length} instruments, rev ${set.revision})`,
          }))}
        />
        {options.availableInstrumentSets.length === 0 ? (
          <div className={hintClass}>
            No instrument sets are configured yet. Create one in Instrument
            Sets.
          </div>
        ) : null}
      </Field>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        <Field label="Scan cadence" error={cadenceError?.message}>
          {isInterval ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-caption text-text3">Every</span>
              <input
                type="number"
                min={1}
                max={999}
                value={String(cadence.every)}
                onChange={(e) => {
                  const every = Math.max(1, parseInt(e.target.value) || 1);
                  onChange({
                    ...draft,
                    cadence: { ...cadence, every },
                  });
                }}
                className={cn(inputClass, "w-[72px]")}
              />
              <ShadcnSelect
                value={cadence.unit}
                onValueChange={(unit) =>
                  onChange({
                    ...draft,
                    cadence: {
                      ...cadence,
                      unit: unit as "minute" | "hour" | "day",
                    },
                  })
                }
                options={[
                  { value: "minute", label: "minutes" },
                  { value: "hour", label: "hours" },
                  { value: "day", label: "days" },
                ]}
              />
            </div>
          ) : (
            <div className={hintClass}>{cadenceLabel(cadence)}</div>
          )}
          <div className={hintClass}>
            How frequently the strategy scans the instrument set.
          </div>
        </Field>

        <Field label="Analysis timeframe" error={tfError?.message}>
          <ShadcnSelect
            value={draft.analysisTimeframe}
            onValueChange={(tf) =>
              onChange({ ...draft, analysisTimeframe: tf as TradingTimeframe })
            }
            options={options.supportedAnalysisTimeframes.map((tf) => ({
              value: tf,
              label: TIMEFRAME_LABELS[tf] ?? tf,
            }))}
          />
          <div className={hintClass}>
            Bar size used for technical analysis in each scan cycle.
          </div>
        </Field>
      </div>

      <Field label="Market calendar">
        <ShadcnSelect
          value={draft.marketCalendarId}
          onValueChange={(id) => onChange({ ...draft, marketCalendarId: id })}
          options={[
            { value: "us_equities", label: "US Equities (NYSE/NASDAQ)" },
            { value: "crypto_24_7", label: "Crypto 24/7" },
            { value: "us_futures", label: "US Futures (CME)" },
          ]}
        />
        <div className={hintClass}>
          Determines market-hours gating for scan execution.
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SessionInputEditor({
  templateId,
  templateVersion,
  subscriptions,
  onChange,
  fieldErrors = [],
  fieldWarnings = [],
  usesUnvalidatedUniverse = false,
  locked = false,
}: SessionInputEditorProps) {
  const [state, dispatch] = useReducer(mergeReducer<EditorState>, {
    templates: [],
    templatesLoaded: false,
    templateError: null,
    options: null,
    optionsLoaded: false,
    optionsError: null,
    mode: null,
    profileId: null,
  });

  // Load template catalog on mount
  useEffect(() => {
    let cancelled = false;
    void experienceCatalogApi
      .listTemplates()
      .then(({ templates }) => {
        if (cancelled) return;
        dispatch({ templates, templatesLoaded: true });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ templates: [], templatesLoaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load configuration options when templateId changes
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    dispatch({ options: null, optionsLoaded: false, optionsError: null });
    void experienceCatalogApi
      .getConfigurationOptions({
        templateId,
        ...(templateVersion != null ? { templateVersion } : {}),
      })
      .then((options) => {
        if (cancelled) return;
        // Auto-select mode if only one is available
        const autoMode: InputMode | null =
          options.availableSourceDefinitions.length === 0 &&
          options.availableInstrumentSets.length > 0
            ? "scheduled_scan"
            : options.availableInstrumentSets.length === 0 &&
                options.availableSourceDefinitions.length > 0
              ? "event_source"
              : null;
        dispatch({
          options,
          optionsLoaded: true,
          optionsError: null,
          mode: autoMode,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        dispatch({
          options: null,
          optionsLoaded: true,
          optionsError:
            err instanceof Error
              ? err.message
              : "Failed to load configuration options.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, templateVersion]);

  // Derive active mode from current subscriptions when options are loaded
  useEffect(() => {
    if (!state.optionsLoaded || !state.options) return;
    const firstSub = subscriptions[0];
    if (firstSub) {
      dispatch({ mode: firstSub.mode as InputMode });
    } else {
      // Auto-select mode when only one is available
      const opts = state.options;
      const derived: InputMode[] = [
        ...(opts.availableSourceDefinitions.length > 0
          ? ["event_source" as const]
          : []),
        ...(opts.availableInstrumentSets.length > 0
          ? ["scheduled_scan" as const]
          : []),
      ];
      if (derived.length === 1) {
        dispatch({ mode: derived[0] });
      }
    }
  }, [state.optionsLoaded, state.options, subscriptions]);

  const {
    templates,
    templatesLoaded,
    options,
    optionsLoaded,
    optionsError,
    mode,
  } = state;

  if (!templatesLoaded) {
    return (
      <div className="grid gap-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg border border-border bg-surface"
          />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className={hintClass}>
        No experience templates found. Using legacy signal sources below.
      </div>
    );
  }

  const selectedTemplate = templates.find((t) => t.templateId === templateId);

  // ---------------------------------------------------------------------------
  // Template picker (if not locked)
  // ---------------------------------------------------------------------------
  const templatePicker =
    !locked && templates.length > 0 ? (
      <Field label="Experience template">
        <ShadcnSelect
          value={templateId ?? ""}
          onValueChange={(id) => {
            if (!id) return;
            onChange([]);
            dispatch({ mode: null, options: null, optionsLoaded: false });
          }}
          options={templates.map((t) => ({
            value: t.templateId,
            label: t.displayName,
          }))}
          disabled={locked}
        />
        {selectedTemplate ? (
          <div className={hintClass}>{selectedTemplate.description}</div>
        ) : null}
      </Field>
    ) : null;

  if (!templateId) {
    return (
      <div className="grid gap-3.5">
        {templatePicker}
        <div className={hintClass}>Select a template to configure inputs.</div>
      </div>
    );
  }

  if (!optionsLoaded) {
    return (
      <div className="grid gap-3.5">
        {templatePicker}
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg border border-border bg-surface"
            />
          ))}
        </div>
      </div>
    );
  }

  if (optionsError) {
    return (
      <div className="grid gap-3.5">
        {templatePicker}
        <div className="rounded-lg border border-error-border bg-error-dim px-3 py-2 text-caption text-error">
          {optionsError}
        </div>
      </div>
    );
  }

  if (!options) return null;

  const availableModes: InputMode[] = [
    ...(options.availableSourceDefinitions.length > 0
      ? ["event_source" as const]
      : []),
    ...(options.availableInstrumentSets.length > 0
      ? ["scheduled_scan" as const]
      : []),
  ];
  const showModePicker = availableModes.length > 1;

  // ---------------------------------------------------------------------------
  // Recommended profiles
  // ---------------------------------------------------------------------------
  const hasProfiles = options.recommendedProfiles.length > 0;
  const isCustom = !state.profileId || state.profileId === "__custom__";

  const onSelectProfile = (pid: string) => {
    dispatch({ profileId: pid });
    if (pid === "__custom__") return;
    const draft = draftFromProfile(pid, options);
    if (draft) {
      onChange([draft]);
      dispatch({ mode: draft.mode as InputMode });
    }
  };

  // ---------------------------------------------------------------------------
  // Subscription mutation helpers
  // ---------------------------------------------------------------------------
  const firstSub = subscriptions[0];

  const buildDefault = () => {
    if (mode === "event_source") {
      return defaultEventDraft(templateId, options.templateVersion, options);
    }
    if (mode === "scheduled_scan") {
      return defaultScheduledDraft(
        templateId,
        options.templateVersion,
        options,
      );
    }
    return null;
  };

  const currentDraft: SessionInputSubscriptionDraft | null =
    firstSub && firstSub.mode === mode ? firstSub : buildDefault();

  const handleDraftChange = (next: SessionInputSubscriptionDraft) => {
    onChange([next]);
  };

  // ---------------------------------------------------------------------------
  // Warnings
  // ---------------------------------------------------------------------------
  const overallWarnings = fieldWarnings.filter(
    (w) => !w.field || w.field === ".",
  );

  return (
    <div className="grid gap-4">
      {templatePicker}

      {/* Mode picker */}
      {showModePicker ? (
        <Field label="Input mode">
          <div className="flex gap-2">
            {availableModes.map((m: InputMode) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  dispatch({ mode: m });
                  const next =
                    m === "event_source"
                      ? defaultEventDraft(
                          templateId,
                          options.templateVersion,
                          options,
                        )
                      : defaultScheduledDraft(
                          templateId,
                          options.templateVersion,
                          options,
                        );
                  if (next) onChange([next]);
                }}
                className={cn(modeChipClass, mode === m && modeChipActiveClass)}
              >
                {m === "event_source" ? "Event-driven" : "Scheduled scan"}
              </button>
            ))}
          </div>
          <div className={hintClass}>
            {mode === "event_source"
              ? "Strategy runs when an incoming event matches the source."
              : "Strategy runs on a recurring schedule across an instrument set."}
          </div>
        </Field>
      ) : null}

      {/* Recommended profiles */}
      {hasProfiles && mode ? (
        <Field label="Configuration">
          <div className="grid gap-2">
            {options.recommendedProfiles
              .filter((p) => p.mode === mode)
              .map((profile) => (
                <label key={profile.id} className={profileRowClass}>
                  <input
                    type="radio"
                    name="input-profile"
                    value={profile.id}
                    checked={state.profileId === profile.id}
                    onChange={() => onSelectProfile(profile.id)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-caption font-semibold text-text1">
                      {profile.name}
                    </span>
                    {profile.mode === "scheduled_scan" ? (
                      <span className="block text-caption text-text3">
                        {formatSetLabel(
                          profile.instrumentSetId,
                          options.availableInstrumentSets,
                        )}{" "}
                        · {cadenceLabel(profile.cadence)} ·{" "}
                        {TIMEFRAME_LABELS[profile.analysisTimeframe] ??
                          profile.analysisTimeframe}
                      </span>
                    ) : profile.mode === "event_source" ? (
                      <span className="block text-caption text-text3">
                        {formatSourceLabel(
                          profile.sourceDefinitionId,
                          options.availableSourceDefinitions,
                        )}{" "}
                        ·{" "}
                        {TIMEFRAME_LABELS[profile.analysisTimeframe] ??
                          profile.analysisTimeframe}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            <label className={profileRowClass}>
              <input
                type="radio"
                name="input-profile"
                value="__custom__"
                checked={isCustom}
                onChange={() => onSelectProfile("__custom__")}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-caption font-semibold text-text1">
                  Custom
                </span>
                <span className="block text-caption text-text3">
                  Configure inputs manually.
                </span>
              </span>
            </label>
          </div>
        </Field>
      ) : null}

      {/* Per-mode custom editor */}
      {(isCustom || !hasProfiles) && mode && currentDraft ? (
        <>
          {mode === "event_source" && currentDraft.mode === "event_source" ? (
            <EventSourceEditor
              draft={currentDraft}
              options={options}
              onChange={handleDraftChange}
              fieldErrors={fieldErrors}
            />
          ) : null}
          {mode === "scheduled_scan" &&
          currentDraft.mode === "scheduled_scan" ? (
            <ScheduledScanEditor
              draft={currentDraft}
              options={options}
              onChange={handleDraftChange}
              fieldErrors={fieldErrors}
            />
          ) : null}
        </>
      ) : null}

      {/* Unvalidated universe warning */}
      {usesUnvalidatedUniverse ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-dim px-3 py-2.5 text-caption text-warning">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>
            One or more instruments in this configuration are outside the
            strategy&apos;s validated research universe. Results may differ from
            backtested performance.
          </span>
        </div>
      ) : null}

      {/* Global field warnings */}
      {overallWarnings.map((w, i) => (
        <div
          key={i}
          className="rounded-xl border border-warning-border bg-warning-dim px-3 py-2 text-caption text-warning"
        >
          {w.message}
        </div>
      ))}

      {/* Global field errors */}
      {fieldErrors
        .filter((e) => !e.field || e.field === ".")
        .map((e, i) => (
          <div
            key={i}
            className="rounded-xl border border-error-border bg-error-dim px-3 py-2 text-caption text-error"
          >
            {e.message}
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minor helpers
// ---------------------------------------------------------------------------

function formatSetLabel(setId: string, sets: InstrumentSetRevision[]): string {
  return sets.find((s) => s.setId === setId)?.name ?? setId;
}

function formatSourceLabel(
  sourceId: string,
  sources: SourceDefinition[],
): string {
  return sources.find((s) => s.id === sourceId)?.name ?? sourceId;
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-caption font-semibold uppercase tracking-[0.08em] text-text3">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-micro font-medium text-error">{error}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const inputClass =
  "rounded-lg border border-border bg-surface2 px-3 py-2 text-body text-text1";
const hintClass = "text-caption text-text3";
const profileRowClass =
  "flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2";
const modeChipClass =
  "cursor-pointer rounded-lg border border-border bg-surface2 px-3 py-1.5 text-caption font-medium text-text2 transition-colors hover:border-accent hover:text-accent";
const modeChipActiveClass = "border-accent bg-accent-dim text-accent";
