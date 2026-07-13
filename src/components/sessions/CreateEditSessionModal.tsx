import { useEffect, useMemo, useReducer } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import {
  experienceCatalogApi,
  sessionInputsApi,
} from "@/lib/experience-catalog-api";
import type { ExperienceSummary } from "@electron/shared/ipc/dto";
import type { ExperienceTemplateSummary } from "@electron/shared/domain/experience-inputs/catalog";
import type { SessionInputSubscriptionDraft } from "@electron/shared/domain/experience-inputs/subscription";
import type {
  FieldError,
  FieldWarning,
} from "@electron/shared/domain/experience-inputs/validation-result";
import { SessionInputEditor } from "@/components/sessions/SessionInputEditor";
import { useWorkspaceStore } from "@/store/workspaceStore";
import type {
  BrokerAccountWithState,
  InstrumentClass,
  ProviderAccount,
  SessionTemplatePayload,
} from "@/lib/types";
import { ShadcnSelect } from "@/components/custom-ui";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  HelpTooltip,
  LabelWithHelp,
} from "@/components/ui";
import { EXPERIENCE_HELP_IDS, type HelpGlossaryId } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";
import {
  isSessionLaunchable,
  resolveSessionInstrumentClasses,
} from "@electron/shared/instruments/experience-launchability";

interface Props {
  open: boolean;
  initialSession?: SessionSummary | null;
  templateInput?: SessionCreateInput | null;
  templateWarnings?: string[];
  onOpenAccounts?: () => void;
  onClose: () => void;
  onSubmit: (input: SessionCreateInput, sessionId?: string) => Promise<void>;
}

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type ModalDataState = {
  form: SessionCreateInput;
  brokerAccounts: BrokerAccountWithState[];
  searchProviderState: {
    providers: ProviderAccount[];
    workspaceDefaultSearchProviderId: string | null;
  };
  experiences: ExperienceSummary[];
  experiencesLoaded: boolean;
  /** V2 experience catalog templates (may be empty if backend not yet ready). */
  v2Templates: ExperienceTemplateSummary[];
  v2TemplatesLoaded: boolean;
  /** Active V2 subscription drafts for the selected template. */
  v2Subscriptions: SessionInputSubscriptionDraft[];
  v2FieldErrors: FieldError[];
  v2FieldWarnings: FieldWarning[];
  v2UnvalidatedUniverse: boolean;
};

type ModalReqState = {
  saving: boolean;
  error: string | null;
};

export const CreateEditSessionModal = ({
  open,
  initialSession,
  templateInput,
  templateWarnings,
  onClose,
  onSubmit,
}: Props) => {
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const [data, dispatchData] = useReducer(mergeReducer<ModalDataState>, {
    form: defaultInput(),
    brokerAccounts: [],
    searchProviderState: {
      providers: [],
      workspaceDefaultSearchProviderId: null,
    },
    experiences: [],
    experiencesLoaded: false,
    v2Templates: [],
    v2TemplatesLoaded: false,
    v2Subscriptions: [],
    v2FieldErrors: [],
    v2FieldWarnings: [],
    v2UnvalidatedUniverse: false,
  });
  const [req, dispatchReq] = useReducer(mergeReducer<ModalReqState>, {
    saving: false,
    error: null,
  });
  const applyInitializedForm = (
    nextForm: SessionCreateInput,
    nextError: string | null = null,
  ) => {
    dispatchReq({ error: nextError });
    dispatchData({ form: nextForm });
  };

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const envExecMode =
      environmentMode === "live" ? "live_allowed" : "paper_only";

    if (templateInput) {
      applyInitializedForm({
        ...templateInput,
        executionMode: envExecMode,
      });
      return;
    }

    if (!initialSession) {
      applyInitializedForm({
        ...defaultInput(),
        executionMode: envExecMode,
      });
      return;
    }

    void (async () => {
      let nextError: string | null = null;
      let nextForm: SessionCreateInput;
      try {
        const payload = await api.buildTemplatePayloadFromSession(
          initialSession.id,
        );
        nextForm = {
          ...payloadToInput(payload, initialSession.name),
          executionMode: envExecMode,
        };
      } catch (seedError) {
        nextError =
          seedError instanceof Error
            ? seedError.message
            : "Failed to load seed.";
        nextForm = {
          ...summaryToInput(initialSession),
          executionMode: envExecMode,
        };
      }
      if (cancelled) return;
      applyInitializedForm(nextForm, nextError);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, initialSession, templateInput, environmentMode]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .listExperiences()
      .then((experiences) => {
        if (cancelled) return;
        dispatchData({ experiences, experiencesLoaded: true });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchData({ experiences: [], experiencesLoaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load V2 experience catalog templates (graceful fallback if not yet wired)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void experienceCatalogApi
      .listTemplates()
      .then(({ templates }) => {
        if (cancelled) return;
        dispatchData({ v2Templates: templates, v2TemplatesLoaded: true });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchData({ v2Templates: [], v2TemplatesLoaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load existing V2 subscriptions for editing
  useEffect(() => {
    if (!open || !initialSession) return;
    let cancelled = false;
    void sessionInputsApi
      .get({ sessionId: initialSession.id })
      .then((config) => {
        if (cancelled) return;
        dispatchData({
          v2Subscriptions: config.subscriptions.map((sub) => {
            if (sub.mode === "event_source") {
              return {
                mode: "event_source",
                templateId: sub.templateId,
                templateVersion: sub.templateVersion,
                sourceDefinitionId: sub.sourceDefinitionId,
                sourceRevision: sub.sourceRevision,
                filters: JSON.parse(sub.filtersJson || "{}"),
                analysisTimeframe: sub.analysisTimeframe,
                createdFromProfileId: sub.createdFromProfileId,
              };
            }
            return {
              mode: "scheduled_scan",
              templateId: sub.templateId,
              templateVersion: sub.templateVersion,
              instrumentSetId: sub.instrumentSetId,
              instrumentSetRevision: sub.instrumentSetRevision,
              cadence: JSON.parse(sub.cadenceJson),
              analysisTimeframe: sub.analysisTimeframe,
              marketCalendarId: sub.marketCalendarId,
              strategyParameters: JSON.parse(
                sub.strategyParametersJson || "{}",
              ),
              createdFromProfileId: sub.createdFromProfileId,
            };
          }),
        });
      })
      .catch(() => {
        // Not yet available — ignore silently
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialSession]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .listBrokerAccountState()
      .then((response) => {
        if (cancelled) return;
        dispatchData({ brokerAccounts: response });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchData({ brokerAccounts: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([api.listProviders(), api.getWorkspaceView()])
      .then(([providerResponse, workspaceView]) => {
        if (cancelled) return;
        dispatchData({
          searchProviderState: {
            providers: providerResponse.providers.filter(
              (provider) =>
                provider.category === "search" && provider.isConfigured,
            ),
            workspaceDefaultSearchProviderId:
              workspaceView.preferences.defaultSearchProviderId,
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchData({
          searchProviderState: {
            providers: [],
            workspaceDefaultSearchProviderId: null,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const {
    form,
    brokerAccounts,
    experiences,
    experiencesLoaded,
    v2Templates,
    v2TemplatesLoaded,
    v2Subscriptions,
    v2FieldErrors,
    v2FieldWarnings,
    v2UnvalidatedUniverse,
  } = data;

  const assignedBrokerIds = useMemo(
    () =>
      form.brokerAssignments.map((assignment) => assignment.brokerAccountId),
    [form.brokerAssignments],
  );
  const assignedBrokerIdSet = useMemo(
    () => new Set(assignedBrokerIds),
    [assignedBrokerIds],
  );
  const brokerById = useMemo(
    () => new Map(brokerAccounts.map((broker) => [broker.id, broker])),
    [brokerAccounts],
  );
  const brokerMode = environmentMode;
  const visibleBrokers = useMemo(
    () => brokerAccounts.filter((broker) => broker.mode === brokerMode),
    [brokerAccounts, brokerMode],
  );
  const assignedActiveModeBrokers = useMemo(
    () => visibleBrokers.filter((broker) => assignedBrokerIdSet.has(broker.id)),
    [visibleBrokers, assignedBrokerIdSet],
  );
  const selectedExperience = useMemo(
    () =>
      experiences.find(
        (entry) => entry.id === (form.experienceId ?? "edgar-catalyst"),
      ) ?? null,
    [experiences, form.experienceId],
  );

  // Look up a template matching the selected experience id
  const selectedV2Template = useMemo(
    () =>
      v2TemplatesLoaded && form.experienceId
        ? (v2Templates.find(
            (t) =>
              t.templateId === form.experienceId ||
              t.templateId.startsWith(form.experienceId + "-"),
          ) ?? null)
        : null,
    [v2Templates, v2TemplatesLoaded, form.experienceId],
  );
  const effectiveInstrumentClasses = useMemo(
    () =>
      resolveSessionInstrumentClasses(
        selectedExperience?.capabilities ?? {
          signalSourceTypes: [],
          brokerRequirement: "any_supported_class" as const,
        },
        form,
        assignedActiveModeBrokers,
      ),
    [assignedActiveModeBrokers, form, selectedExperience],
  );
  const isLaunchable =
    isSessionLaunchable(assignedActiveModeBrokers) &&
    form.brokerAssignments.length > 0;
  const overAllocatedBrokerIds = useMemo(
    () =>
      new Set(
        assignedActiveModeBrokers
          .filter((broker) => {
            const assignment = form.brokerAssignments.find(
              (entry) => entry.brokerAccountId === broker.id,
            );
            return (
              assignment != null &&
              broker.freeCapitalUsd != null &&
              assignment.allocatedUsd > broker.freeCapitalUsd
            );
          })
          .map((broker) => broker.id),
      ),
    [assignedActiveModeBrokers, form.brokerAssignments],
  );
  const isValid =
    form.name.trim().length > 0 &&
    form.objective.trim().length > 0 &&
    v2Subscriptions.length > 0 &&
    v2FieldErrors.length === 0 &&
    effectiveInstrumentClasses.length > 0 &&
    overAllocatedBrokerIds.size === 0;

  const setForm = (
    updater: (prev: SessionCreateInput) => SessionCreateInput,
  ) => {
    dispatchData({ form: updater(form) });
  };

  useEffect(() => {
    if (brokerAccounts.length === 0) return;
    const brokerIdsByMode = new Set(visibleBrokers.map((broker) => broker.id));
    const nextAssignments = form.brokerAssignments.filter((assignment) =>
      brokerIdsByMode.has(assignment.brokerAccountId),
    );
    if (nextAssignments.length === form.brokerAssignments.length) return;
    dispatchData({ form: { ...form, brokerAssignments: nextAssignments } });
  }, [brokerAccounts, form, form.brokerAssignments, visibleBrokers]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-auto rounded-[20px] border-border bg-transparent p-0 sm:max-w-[900px]">
        <div className={panelClass}>
          <div className="mb-5 border-b border-border pb-[18px]">
            <h2 className="m-0 text-title font-semibold tracking-[-0.01em] text-text1">
              {initialSession ? "Refine Session" : "Create Session"}
            </h2>
            <div className="mt-1 text-caption text-text3">
              Identity, signal scope, and execution routing in one place.
            </div>
          </div>

          {templateWarnings?.length ? (
            <div className={warningBannerClass}>
              Template fallback cleared {templateWarnings.length} unavailable
              field{templateWarnings.length === 1 ? "" : "s"}:{" "}
              {templateWarnings.join(", ")}
            </div>
          ) : null}
          {req.error ? (
            <div className={errorBannerClass}>{req.error}</div>
          ) : null}

          <div className="grid gap-4">
            <section className={sectionClass}>
              <SectionHeader
                title="Identity"
                caption="The operator-facing shell for this session."
              />
              <div className={sectionBodyClass}>
                {experiencesLoaded && experiences.length > 0 ? (
                  <Field label="Experience" glossaryId="experience">
                    <ShadcnSelect
                      value={form.experienceId ?? experiences[0]?.id ?? ""}
                      onValueChange={(experienceId) => {
                        if (initialSession) return;
                        setForm((prev) => ({
                          ...prev,
                          experienceId,
                          selectionMode: "signal_driven",
                          instrumentScope: "",
                          selectorSettings: { aiPickerEnabled: false },
                        }));
                      }}
                      options={experiences.map((experience) => ({
                        value: experience.id,
                        label: experience.displayName,
                      }))}
                      disabled={Boolean(initialSession)}
                    />
                    {selectedExperience ? (
                      <div className={inlineHintClass}>
                        Signal sources:{" "}
                        {selectedExperience.capabilities.signalSourceTypes.join(
                          ", ",
                        ) || "—"}
                        .
                        {EXPERIENCE_HELP_IDS[
                          selectedExperience.id as keyof typeof EXPERIENCE_HELP_IDS
                        ] ? (
                          <HelpTooltip
                            glossaryId={
                              EXPERIENCE_HELP_IDS[
                                selectedExperience.id as keyof typeof EXPERIENCE_HELP_IDS
                              ]
                            }
                          />
                        ) : null}{" "}
                        {initialSession
                          ? " Experience is fixed after session creation."
                          : null}
                      </div>
                    ) : null}
                  </Field>
                ) : null}
                <div className={twoColumnGridClass}>
                  <Field label="Session name">
                    <input
                      value={form.name}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Income Engine"
                      className={inputClass}
                    />
                  </Field>
                </div>
                <Field label="Objective" glossaryId="session-objective">
                  <textarea
                    value={form.objective}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        objective: event.target.value,
                      }))
                    }
                    rows={4}
                    className={textareaClass}
                  />
                </Field>
              </div>
            </section>

            <section className={sectionClass}>
              <SectionHeader
                title="Experience Inputs"
                caption="Configure how this session receives signals."
              />
              <div className={sectionBodyClass}>
                <SessionInputEditor
                  templateId={selectedV2Template?.templateId ?? null}
                  subscriptions={v2Subscriptions}
                  onChange={(subs) => dispatchData({ v2Subscriptions: subs })}
                  fieldErrors={v2FieldErrors}
                  fieldWarnings={v2FieldWarnings}
                  usesUnvalidatedUniverse={v2UnvalidatedUniverse}
                  locked={Boolean(initialSession)}
                />
              </div>
            </section>

            <section className={sectionClass}>
              <SectionHeader
                title="Execution Setup"
                caption="Pick broker accounts for this session."
              />
              <Field label="Broker accounts" glossaryId="broker-accounts">
                <div className={brokerPickerClass}>
                  {visibleBrokers.length === 0 ? (
                    <div className={inlineHintClass}>
                      No {brokerMode} broker accounts found. Add one in
                      Accounts.
                    </div>
                  ) : (
                    visibleBrokers.map((broker) => {
                      const checked = assignedBrokerIdSet.has(broker.id);
                      return (
                        <div key={broker.id} className={brokerRowClass}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              setForm((prev) => ({
                                ...prev,
                                brokerAssignments: toggleBrokerAssignment(
                                  prev.brokerAssignments,
                                  broker.id,
                                  nextChecked === true,
                                  defaultAllocationUsd(broker),
                                ),
                              }))
                            }
                          />
                          <span>
                            <span className="block text-caption font-semibold text-text1">
                              {broker.name}
                            </span>
                            <span className="mt-px block text-caption text-text3">
                              {broker.id} · {broker.brokerType}
                            </span>
                          </span>
                        </div>
                      );
                    })
                  )}
                  {visibleBrokers.length > 0 ? (
                    <button
                      type="button"
                      className={selectAllButtonClass}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          brokerAssignments: mergeUniqueBrokerAssignments(
                            prev.brokerAssignments,
                            visibleBrokers.map((broker) => ({
                              brokerAccountId: broker.id,
                              allocatedUsd: defaultAllocationUsd(broker),
                            })),
                          ),
                        }))
                      }
                    >
                      Select all {brokerMode} brokers
                    </button>
                  ) : null}
                  {assignedActiveModeBrokers.length > 0 ? (
                    <div className="mt-1 grid gap-2">
                      {assignedActiveModeBrokers.map((broker) => {
                        const assignment = form.brokerAssignments.find(
                          (entry) => entry.brokerAccountId === broker.id,
                        );
                        if (!assignment) return null;
                        const overAllocated = overAllocatedBrokerIds.has(
                          broker.id,
                        );
                        return (
                          <div key={broker.id} className={allocationRowClass}>
                            <div className="min-w-0">
                              <div className="text-caption font-semibold text-text1">
                                {broker.name}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-caption text-text3">
                                Balance:{" "}
                                {broker.balanceCacheUsd != null
                                  ? `$${broker.balanceCacheUsd.toLocaleString()}`
                                  : "—"}
                                {" · "}
                                Free:{" "}
                                {broker.freeCapitalUsd != null
                                  ? `$${broker.freeCapitalUsd.toLocaleString()}`
                                  : "—"}
                                <HelpTooltip
                                  glossaryId="allocation"
                                  topic="Broker allocation"
                                />
                              </div>
                            </div>
                            <div className="grid justify-items-end gap-1.5">
                              <input
                                type="number"
                                min={0}
                                value={String(assignment.allocatedUsd)}
                                onChange={(event) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    brokerAssignments: updateBrokerAllocation(
                                      prev.brokerAssignments,
                                      broker.id,
                                      Number(event.target.value) || 0,
                                    ),
                                  }))
                                }
                                className={cn(
                                  inputClass,
                                  "w-[140px]",
                                  overAllocated
                                    ? "border-error-border"
                                    : undefined,
                                )}
                              />
                              {broker.freeCapitalUsd != null ? (
                                <div className="flex gap-1.5">
                                  {(
                                    [
                                      ["20%", 0.2],
                                      ["50%", 0.5],
                                      ["Max", 1],
                                    ] as const
                                  ).map(([label, pct]) => (
                                    <button
                                      key={label}
                                      type="button"
                                      className={quickFillChipClass}
                                      onClick={() =>
                                        setForm((prev) => ({
                                          ...prev,
                                          brokerAssignments:
                                            updateBrokerAllocation(
                                              prev.brokerAssignments,
                                              broker.id,
                                              Math.round(
                                                (broker.freeCapitalUsd ?? 0) *
                                                  pct,
                                              ),
                                            ),
                                        }))
                                      }
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              {overAllocated ? (
                                <div className={warningTextClass}>
                                  Exceeds free capital ($
                                  {broker.freeCapitalUsd?.toLocaleString()}).
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {!isLaunchable ? (
                    <div className={warningTextClass}>
                      At least one broker account must be assigned.{" "}
                      <HelpTooltip glossaryId="launchability" />
                    </div>
                  ) : (
                    <div className={successTextClass}>
                      Launchable with{" "}
                      {effectiveInstrumentClasses
                        .map(formatInstrumentClass)
                        .join(", ")}{" "}
                      from assigned brokers.{" "}
                      <HelpTooltip glossaryId="launchability" />
                    </div>
                  )}
                </div>
              </Field>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-caption text-text3">
              {v2Subscriptions.length === 0
                ? "Configure at least one input subscription."
                : `${v2Subscriptions.length} input subscription${v2Subscriptions.length === 1 ? "" : "s"} configured.`}
            </div>
            <div className="flex justify-end gap-2.5">
              <Button
                onClick={onClose}
                variant="outline"
                className="border-border bg-surface2 text-text2"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  dispatchReq({ saving: true, error: null });
                  try {
                    // Validate subscriptions before submitting
                    if (selectedV2Template && v2Subscriptions.length > 0) {
                      try {
                        const validation =
                          await experienceCatalogApi.validateDraft({
                            templateId: selectedV2Template.templateId,
                            templateVersion: selectedV2Template.latestVersion,
                            subscriptions: v2Subscriptions.map((s) => {
                              if (s.mode === "event_source") {
                                return {
                                  mode: "event_source" as const,
                                  sourceDefinitionId: s.sourceDefinitionId,
                                  sourceRevision: s.sourceRevision,
                                  filters: s.filters,
                                  analysisTimeframe: s.analysisTimeframe,
                                };
                              }
                              return {
                                mode: "scheduled_scan" as const,
                                instrumentSetId: s.instrumentSetId,
                                instrumentSetRevision: s.instrumentSetRevision,
                                cadence: s.cadence,
                                analysisTimeframe: s.analysisTimeframe,
                                marketCalendarId: s.marketCalendarId,
                                strategyParameters: s.strategyParameters,
                              };
                            }),
                          });
                        if (!validation.overall.valid) {
                          dispatchData({
                            v2FieldErrors: validation.overall.errors,
                            v2FieldWarnings: validation.overall.warnings,
                            v2UnvalidatedUniverse:
                              validation.usesUnvalidatedUniverse,
                          });
                          dispatchReq({ saving: false });
                          return;
                        }
                        dispatchData({
                          v2FieldErrors: [],
                          v2FieldWarnings: validation.overall.warnings,
                          v2UnvalidatedUniverse:
                            validation.usesUnvalidatedUniverse,
                        });
                      } catch {
                        // Backend not yet ready — proceed anyway
                      }
                    }

                    await onSubmit(
                      {
                        ...form,
                        instrumentScope: "",
                        selectionMode: "signal_driven",
                        selectorSettings: { aiPickerEnabled: false },
                        brokerAssignments: form.brokerAssignments.filter(
                          (assignment) =>
                            brokerById.has(assignment.brokerAccountId),
                        ),
                        brokerOverridesByInstrumentClass: {},
                      },
                      initialSession?.id,
                    );

                    // Persist subscriptions
                    if (v2Subscriptions.length > 0) {
                      const resolvedId = initialSession?.id;
                      if (resolvedId) {
                        try {
                          await sessionInputsApi.replace({
                            sessionId: resolvedId,
                            inputRevision: 0,
                            subscriptions: v2Subscriptions,
                          });
                        } catch {
                          // Backend not yet ready — proceed anyway
                        }
                      }
                    }

                    onClose();
                  } catch (submitError) {
                    dispatchReq({
                      error:
                        submitError instanceof Error
                          ? submitError.message
                          : "Failed to save session.",
                    });
                  } finally {
                    dispatchReq({ saving: false });
                  }
                }}
                className="bg-accent text-white"
                disabled={req.saving || !isValid || !isLaunchable}
              >
                {req.saving
                  ? "Saving..."
                  : initialSession
                    ? "Save Session"
                    : "Create Session"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SectionHeader = ({
  title,
  caption,
  glossaryId,
}: {
  title: string;
  caption: string;
  glossaryId?: HelpGlossaryId;
}) => (
  <div className="mb-3.5">
    <div className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.14em] text-text3">
      <span>{title}</span>
      {glossaryId ? (
        <HelpTooltip glossaryId={glossaryId} topic={title} />
      ) : null}
    </div>
    <div className="mt-1 text-caption text-text2">{caption}</div>
  </div>
);

const Field = ({
  label,
  children,
  glossaryId,
  title,
  body,
}: {
  label: string;
  children: React.ReactNode;
  glossaryId?: HelpGlossaryId;
  title?: string;
  body?: string;
}) => (
  <div className="grid gap-1.5">
    <LabelWithHelp
      label={label}
      glossaryId={glossaryId}
      title={title}
      body={body}
      labelClassName="text-caption font-semibold uppercase tracking-[0.08em] text-text3"
    />
    {children}
  </div>
);

function defaultInput(): SessionCreateInput {
  return {
    name: "",
    objective: "",
    experienceId: "edgar-catalyst",
    selectionMode: "signal_driven",
    instrumentScope: "",
    defaultSearchProviderId: null,
    selectorSettings: { aiPickerEnabled: false },
    executionMode: "paper_only",
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
  };
}

function payloadToInput(
  payload: SessionTemplatePayload,
  name = "",
): SessionCreateInput {
  return {
    name,
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

function summaryToInput(session: SessionSummary): SessionCreateInput {
  return {
    name: session.name,
    objective: session.objective,
    experienceId: session.experienceId,
    selectionMode: session.selectionMode,
    instrumentScope: session.instrumentScope,
    defaultSearchProviderId: session.defaultSearchProviderId,
    selectorSettings:
      session.selectionMode === "ai_selected_universe"
        ? { aiPickerEnabled: true }
        : { aiPickerEnabled: false },
    executionMode: session.executionMode,
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
  };
}

// Seed a sensible non-zero default so operators don't create $0 sessions:
// 20% of free capital, falling back to 20% of balance, else 0 (unknown).
function defaultAllocationUsd(broker: BrokerAccountWithState): number {
  const free = broker.freeCapitalUsd;
  if (free != null && free > 0) {
    return Math.round(free * 0.2);
  }
  const balance = broker.balanceCacheUsd;
  if (balance != null && balance > 0) {
    return Math.round(balance * 0.2);
  }
  return 0;
}

function toggleBrokerAssignment(
  current: Array<{ brokerAccountId: string; allocatedUsd: number }>,
  brokerId: string,
  checked: boolean,
  defaultUsd: number,
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  if (checked) {
    return current.some((entry) => entry.brokerAccountId === brokerId)
      ? current
      : [...current, { brokerAccountId: brokerId, allocatedUsd: defaultUsd }];
  }
  return current.filter((entry) => entry.brokerAccountId !== brokerId);
}

function updateBrokerAllocation(
  current: Array<{ brokerAccountId: string; allocatedUsd: number }>,
  brokerId: string,
  allocatedUsd: number,
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  return current.map((entry) =>
    entry.brokerAccountId === brokerId
      ? { ...entry, allocatedUsd: Math.max(0, allocatedUsd) }
      : entry,
  );
}

function mergeUniqueBrokerAssignments(
  current: Array<{ brokerAccountId: string; allocatedUsd: number }>,
  nextEntries: Array<{ brokerAccountId: string; allocatedUsd: number }>,
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  const existing = new Set(current.map((entry) => entry.brokerAccountId));
  const merged = [...current];
  for (const entry of nextEntries) {
    if (!existing.has(entry.brokerAccountId)) {
      existing.add(entry.brokerAccountId);
      merged.push(entry);
    }
  }
  return merged;
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

const panelClass =
  "max-h-[92vh] w-[900px] max-w-[96vw] overflow-auto rounded-[20px] border border-border bg-surface p-[22px] shadow-[0_26px_60px_rgba(2,6,23,0.28)]";
const sectionClass = "rounded-xl border border-border bg-surface2 px-4 py-3.5";
const sectionBodyClass = "grid gap-3.5";
const inputClass =
  "w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-body text-text1";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-lg border border-border bg-surface2 px-3 py-2 text-body text-text1";
const twoColumnGridClass =
  "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5";
const brokerPickerClass =
  "grid gap-2 rounded-xl border border-border bg-surface2 p-2.5";
const brokerRowClass =
  "flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-2";
const allocationRowClass =
  "grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg border border-border bg-surface2 px-3 py-2.5";
const inlineHintClass = "text-caption text-text3";
const quickFillChipClass =
  "cursor-pointer rounded-md border border-border bg-surface px-2 py-0.5 text-micro font-semibold text-text2";
const selectAllButtonClass =
  "mt-0.5 cursor-pointer justify-self-start rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-caption font-semibold text-text2";
const warningTextClass = "text-caption font-semibold text-warning";
const successTextClass = "text-caption font-semibold text-success";
const warningBannerClass =
  "mb-4 rounded-xl border border-warning-border bg-warning-dim px-[14px] py-3 text-body leading-normal text-warning";
const errorBannerClass =
  "mb-4 rounded-xl border border-error-border bg-error-dim px-[14px] py-3 text-body text-error";
