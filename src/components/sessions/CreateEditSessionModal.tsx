import { useEffect, useMemo, useReducer } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { ExperienceSummary } from "@electron/shared/ipc/dto";
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
  Switch,
} from "@/components/ui";
import { EXPERIENCE_HELP_IDS, type HelpGlossaryId } from "@/lib/help-glossary";
import { cn } from "@/lib/utils";
import {
  buildSearchEverythingScope,
  isSearchEverythingEnabled,
  parseSearchEverythingFocusInstrumentClass,
  resolveBrokerInstrumentClasses,
} from "@electron/shared/instruments/session-instrument-classes";
import {
  experienceBrokerOverlap,
  isSessionLaunchable,
  resolveSessionInstrumentClasses,
  uncoveredExperienceClasses,
} from "@electron/shared/instruments/experience-launchability";
import {
  deriveSessionInputModel,
  deriveSessionReadiness,
  formatReadinessSummary,
  formatApproximateTradeHoldLabel,
  formatSignalScopeSectionCaption,
  formatSignalSourceTypeLabel,
  countManualTickers,
  resolveSelectionModeForInput,
  resolveSelectorSettingsForInput,
  showInstrumentScopeControls,
  sourceIsCompatibleWithExperience,
} from "@electron/shared/instruments/session-input-model";
import {
  MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
  resolvePreferredSubscribedSourceId,
  sessionEligibleForMockRehearsal,
  sessionSubscribedToMockRehearsal,
  shouldAutoSwitchSignalSubscription,
} from "@electron/shared/instruments/mock-rehearsal";

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
  signalSources: Awaited<ReturnType<typeof api.listSignalSources>>["sources"];
  subscribedSourceIds: string[];
  signalSourcesLoaded: boolean;
  experiences: ExperienceSummary[];
  experiencesLoaded: boolean;
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
    signalSources: [],
    subscribedSourceIds: [],
    signalSourcesLoaded: false,
    experiences: [],
    experiencesLoaded: false,
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
    dispatchData({ signalSourcesLoaded: false });
    void api
      .listSignalSources()
      .then(async ({ sources }) => {
        if (cancelled) return;
        const filtered = sources.filter((source) => source.type !== "manual");
        if (!initialSession) {
          dispatchData({
            signalSources: filtered,
            subscribedSourceIds: filtered
              .filter((source) => source.type === "edgar_8k" && source.enabled)
              .map((source) => source.id),
            signalSourcesLoaded: true,
          });
          return;
        }
        const subs = await api.getSessionSignalSubscriptions(initialSession.id);
        if (cancelled) return;
        dispatchData({
          signalSources: filtered,
          subscribedSourceIds: subs.sourceIds,
          signalSourcesLoaded: true,
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatchData({
          signalSources: [],
          subscribedSourceIds: [],
          signalSourcesLoaded: true,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialSession]);

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
    searchProviderState,
    signalSources,
    subscribedSourceIds,
    signalSourcesLoaded,
    experiences,
    experiencesLoaded,
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
  const brokerDrivenInstrumentClasses = useMemo(
    () => resolveBrokerInstrumentClasses(assignedActiveModeBrokers),
    [assignedActiveModeBrokers],
  );
  const selectedExperience = useMemo(
    () =>
      experiences.find(
        (entry) => entry.id === (form.experienceId ?? "edgar-catalyst"),
      ) ?? null,
    [experiences, form.experienceId],
  );
  const experienceClasses = useMemo(
    (): InstrumentClass[] =>
      (selectedExperience?.capabilities.instrumentClasses ?? [
        "stock",
      ]) as InstrumentClass[],
    [selectedExperience],
  );
  const effectiveInstrumentClasses = useMemo(
    () =>
      selectedExperience
        ? resolveSessionInstrumentClasses(
            selectedExperience.capabilities,
            form,
            assignedActiveModeBrokers,
          )
        : experienceClasses,
    [assignedActiveModeBrokers, experienceClasses, form, selectedExperience],
  );
  const overlappingClasses = useMemo(
    () => experienceBrokerOverlap(experienceClasses, assignedActiveModeBrokers),
    [assignedActiveModeBrokers, experienceClasses],
  );
  const uncoveredExperienceInstrumentClasses = useMemo(
    () =>
      uncoveredExperienceClasses(experienceClasses, assignedActiveModeBrokers),
    [assignedActiveModeBrokers, experienceClasses],
  );
  const isLaunchable =
    isSessionLaunchable(experienceClasses, assignedActiveModeBrokers) &&
    form.brokerAssignments.length > 0;
  const requiresSearchProviderSetup = false;
  const workspaceDefaultSearchProviderName =
    searchProviderState.providers.find(
      (provider) =>
        provider.id === searchProviderState.workspaceDefaultSearchProviderId,
    )?.name ?? null;
  const searchEverythingFocusInstrumentClass = useMemo(
    () => parseSearchEverythingFocusInstrumentClass(form.instrumentScope),
    [form.instrumentScope],
  );
  const searchEverything = isSearchEverythingInput(form);
  const manualTickerCount = useMemo(
    () => countManualTickers(form.instrumentScope),
    [form.instrumentScope],
  );
  const mockRehearsalBrokers = useMemo(
    () =>
      brokerAccounts.map((broker) => ({
        id: broker.id,
        brokerType: broker.brokerType,
        mockScenarioKind: broker.mockScenarioKind ?? null,
      })),
    [brokerAccounts],
  );
  const mockRehearsalMode = useMemo(
    () =>
      selectedExperience
        ? sessionEligibleForMockRehearsal({
            experience: selectedExperience.capabilities,
            brokerAccounts: mockRehearsalBrokers,
            brokerAssignmentIds: assignedBrokerIds,
          })
        : false,
    [assignedBrokerIds, mockRehearsalBrokers, selectedExperience],
  );
  const compatibleSignalSources = useMemo(
    () =>
      selectedExperience
        ? signalSources.filter((source) =>
            sourceIsCompatibleWithExperience(
              source.type,
              selectedExperience.capabilities.signalSourceTypes,
            ),
          )
        : signalSources,
    [selectedExperience, signalSources],
  );
  const subscribedSources = useMemo(
    () =>
      subscribedSourceIds.flatMap((sourceId) => {
        const source = signalSources.find((entry) => entry.id === sourceId);
        return source
          ? [
              {
                id: source.id,
                name: source.name,
                type: source.type,
                enabled: source.enabled,
              },
            ]
          : [];
      }),
    [signalSources, subscribedSourceIds],
  );
  const inputModel = useMemo(
    () =>
      deriveSessionInputModel({
        subscribedSources,
        instrumentScope: form.instrumentScope,
        selectorSettings: form.selectorSettings,
      }),
    [form.instrumentScope, form.selectorSettings, subscribedSources],
  );
  const readiness = deriveSessionReadiness({
    subscribedSources,
    instrumentScope: form.instrumentScope,
  });
  const showInstrumentFilter = showInstrumentScopeControls({
    inputModel,
    sourcesLoaded: signalSourcesLoaded,
  });
  const showSearchProviderField =
    showInstrumentFilter &&
    subscribedSources.some((source) => source.type === "web_search");
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
    (!showInstrumentFilter || form.instrumentScope.trim().length > 0) &&
    effectiveInstrumentClasses.length > 0 &&
    overAllocatedBrokerIds.size === 0 &&
    readiness !== "no_inputs";

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

  useEffect(() => {
    if (!searchEverything) return;
    if (
      sameInstrumentClasses(
        form.instrumentClasses ?? experienceClasses,
        brokerDrivenInstrumentClasses,
      )
    )
      return;
    dispatchData({
      form: { ...form, instrumentClasses: brokerDrivenInstrumentClasses },
    });
  }, [
    brokerDrivenInstrumentClasses,
    experienceClasses,
    form,
    form.instrumentClasses,
    searchEverything,
  ]);

  useEffect(() => {
    if (!searchEverythingFocusInstrumentClass) return;
    if (
      effectiveInstrumentClasses.includes(searchEverythingFocusInstrumentClass)
    ) {
      return;
    }
    dispatchData({
      form: { ...form, instrumentScope: buildSearchEverythingScope() },
    });
  }, [effectiveInstrumentClasses, form, searchEverythingFocusInstrumentClass]);

  useEffect(() => {
    if (!open || !selectedExperience || !signalSourcesLoaded) return;
    const compatibleSourceIds = compatibleSignalSources.map(
      (source) => source.id,
    );
    const preferredSourceId = resolvePreferredSubscribedSourceId({
      experience: {
        id: selectedExperience.id,
        signalSourceTypes: selectedExperience.capabilities.signalSourceTypes,
      },
      compatibleSourceIds,
      brokerAccounts: mockRehearsalBrokers,
      brokerAssignmentIds: assignedBrokerIds,
    });
    if (
      !preferredSourceId ||
      !shouldAutoSwitchSignalSubscription({
        preferredSourceId,
        subscribedSourceIds,
      })
    ) {
      return;
    }
    const preferredSource = compatibleSignalSources.find(
      (source) => source.id === preferredSourceId,
    );
    const preferredSubscribedSources = preferredSource
      ? [{ type: preferredSource.type }]
      : [];
    const nextInputModel = deriveSessionInputModel({
      subscribedSources: preferredSubscribedSources,
      instrumentScope: form.instrumentScope,
    });
    dispatchData({ subscribedSourceIds: [preferredSourceId] });
    dispatchData({
      form: {
        ...form,
        selectionMode: resolveSelectionModeForInput({
          subscribedSources: preferredSubscribedSources,
          instrumentScope: form.instrumentScope,
          selectorSettings: form.selectorSettings,
        }),
        instrumentScope:
          nextInputModel === "listener" ? "" : form.instrumentScope,
        selectorSettings: resolveSelectorSettingsForInput({
          inputModel: nextInputModel,
          selectorSettings: form.selectorSettings,
        }),
      },
    });
  }, [
    assignedBrokerIds,
    compatibleSignalSources,
    form,
    mockRehearsalBrokers,
    open,
    selectedExperience,
    signalSourcesLoaded,
    subscribedSourceIds,
  ]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-auto rounded-[20px] border-border bg-transparent p-0 sm:max-w-[900px]">
        <div className={panelClass}>
          <div className="mb-5 border-b border-[var(--border)] pb-[18px]">
            <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text1)]">
              {initialSession ? "Refine Session" : "Create Session"}
            </h2>
            <div className="mt-[5px] text-[12px] text-[var(--text3)]">
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
                        const experience = experiences.find(
                          (entry) => entry.id === experienceId,
                        );
                        const matchingSourceIds = experience
                          ? signalSources
                              .filter((source) =>
                                sourceIsCompatibleWithExperience(
                                  source.type,
                                  experience.capabilities.signalSourceTypes,
                                ),
                              )
                              .map((source) => source.id)
                          : [];
                        const preferredSourceId = experience
                          ? resolvePreferredSubscribedSourceId({
                              experience: {
                                id: experience.id,
                                signalSourceTypes:
                                  experience.capabilities.signalSourceTypes,
                              },
                              compatibleSourceIds: matchingSourceIds,
                              brokerAccounts: mockRehearsalBrokers,
                              brokerAssignmentIds: assignedBrokerIds,
                            })
                          : null;
                        // Mock-rehearsal: single source. Otherwise: all compatible+enabled sources.
                        const nextSubscribedSourceIds =
                          preferredSourceId === MOCK_REHEARSAL_SIGNAL_SOURCE_ID
                            ? [preferredSourceId]
                            : signalSources
                                .filter(
                                  (s) =>
                                    matchingSourceIds.includes(s.id) &&
                                    s.enabled,
                                )
                                .map((s) => s.id);
                        const nextSubscribedSources =
                          nextSubscribedSourceIds.flatMap((id) => {
                            const s = signalSources.find(
                              (src) => src.id === id,
                            );
                            return s ? [{ type: s.type }] : [];
                          });
                        setForm((prev) => {
                          const nextInputModel = deriveSessionInputModel({
                            subscribedSources: nextSubscribedSources,
                            instrumentScope: prev.instrumentScope,
                          });
                          return {
                            ...prev,
                            experienceId,
                            instrumentClasses: experience?.capabilities
                              .instrumentClasses ?? ["stock"],
                            selectionMode: resolveSelectionModeForInput({
                              subscribedSources: nextSubscribedSources,
                              instrumentScope: prev.instrumentScope,
                              selectorSettings: prev.selectorSettings,
                            }),
                            instrumentScope:
                              nextInputModel === "listener"
                                ? ""
                                : prev.instrumentScope,
                            selectorSettings: resolveSelectorSettingsForInput({
                              inputModel: nextInputModel,
                              selectorSettings: prev.selectorSettings,
                            }),
                          };
                        });
                        dispatchData({
                          subscribedSourceIds: nextSubscribedSourceIds,
                        });
                      }}
                      options={experiences.map((experience) => ({
                        value: experience.id,
                        label: experience.displayName,
                      }))}
                      disabled={Boolean(initialSession)}
                    />
                    {selectedExperience ? (
                      <div className={inlineHintClass}>
                        Supports{" "}
                        {selectedExperience.capabilities.instrumentClasses
                          .map(formatInstrumentClass)
                          .join(", ")}{" "}
                        via{" "}
                        {selectedExperience.capabilities.signalSourceTypes.join(
                          ", ",
                        )}
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
                title="Signal Sources"
                caption="Pick the one signal that drives this session."
                glossaryId="signal-source"
              />
              <div className={sectionBodyClass}>
                {mockRehearsalMode ? (
                  <div className={inlineHintClass}>
                    Mock rehearsal — synthetic filings aligned with your mock
                    broker scenario. After starting the session, use{" "}
                    <strong>Fire rehearsal signal</strong> on the session card.
                  </div>
                ) : null}
                {!signalSourcesLoaded ? (
                  <div className="grid gap-2">
                    {[0, 1].map((idx) => (
                      <div
                        key={idx}
                        className="h-[52px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      />
                    ))}
                  </div>
                ) : compatibleSignalSources.length === 0 ? (
                  <div className={inlineHintClass}>
                    No compatible signal sources are available for this
                    experience yet. They are provisioned automatically when the
                    app loads — try closing and reopening this dialog.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {compatibleSignalSources.map((source) => {
                      const checked = subscribedSourceIds.includes(source.id);
                      const isSearchStyle = source.type === "web_search";
                      const holdEstimate = formatApproximateTradeHoldLabel({
                        id: source.id,
                        type: source.type,
                      });
                      return (
                        <label key={source.id} className={brokerRowClass}>
                          <Switch
                            checked={checked}
                            onCheckedChange={(next) =>
                              dispatchData({
                                subscribedSourceIds: next
                                  ? [...subscribedSourceIds, source.id]
                                  : subscribedSourceIds.filter(
                                      (id) => id !== source.id,
                                    ),
                              })
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="text-[12px] font-semibold text-[var(--text1)]">
                                {source.name}
                              </span>
                              <span className={kindChipClass}>
                                {isSearchStyle ? "Search" : "Listener"}
                              </span>
                              <HelpTooltip
                                topic={
                                  isSearchStyle
                                    ? "Search source"
                                    : "Listener source"
                                }
                                body={
                                  isSearchStyle
                                    ? "Search sources actively look for relevant news or web results."
                                    : "Listener sources wait for incoming events such as filings or platform events."
                                }
                              />
                            </span>
                            <span className="mt-px block text-[12px] text-[var(--text3)]">
                              {formatSignalSourceTypeLabel(source.type)}
                              {!source.enabled
                                ? " · Disabled globally — does not count as a live input"
                                : ""}
                            </span>
                            {holdEstimate ? (
                              <span className="mt-px block text-[12px] text-[var(--text3)]">
                                Approx. avg hold: {holdEstimate}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text2)]">
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      {formatReadinessSummary({
                        readiness,
                        inputModel,
                        subscribedSources,
                        manualTickerCount,
                      })}
                    </span>
                    <HelpTooltip
                      glossaryId={
                        readiness === "armed"
                          ? "source-readiness-armed"
                          : readiness === "manual_only"
                            ? "source-readiness-manual-only"
                            : readiness === "waiting_for_source_enable"
                              ? "source-readiness-waiting-for-source-enable"
                              : "source-readiness-no-inputs"
                      }
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <SectionHeader
                title="Signal Scope"
                caption={formatSignalScopeSectionCaption(inputModel)}
              />
              <div className={sectionBodyClass}>
                {!signalSourcesLoaded ? (
                  <div className="grid gap-2">
                    {[0, 1].map((idx) => (
                      <div
                        key={idx}
                        className="h-[52px] animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
                      />
                    ))}
                  </div>
                ) : showInstrumentFilter ? (
                  <>
                    {showSearchProviderField ? (
                      <div className={twoColumnGridClass}>
                        <Field
                          label="Search provider override"
                          glossaryId="search-provider-override"
                        >
                          <ShadcnSelect
                            value={
                              form.defaultSearchProviderId ??
                              "__workspace_default__"
                            }
                            onValueChange={(value) =>
                              setForm((prev) => ({
                                ...prev,
                                defaultSearchProviderId:
                                  value === "__workspace_default__"
                                    ? null
                                    : value,
                              }))
                            }
                            options={[
                              {
                                value: "__workspace_default__",
                                label: workspaceDefaultSearchProviderName
                                  ? `Workspace default (${workspaceDefaultSearchProviderName})`
                                  : "Workspace default (not set)",
                              },
                              ...searchProviderState.providers.map(
                                (provider) => ({
                                  value: provider.id,
                                  label: provider.name,
                                }),
                              ),
                            ]}
                          />
                        </Field>
                      </div>
                    ) : null}
                    {searchEverything &&
                    effectiveInstrumentClasses.length > 1 ? (
                      <Field label="Research focus" glossaryId="research-focus">
                        <ShadcnSelect
                          value={
                            searchEverythingFocusInstrumentClass ?? "__all__"
                          }
                          onValueChange={(value) =>
                            setForm((prev) => ({
                              ...prev,
                              instrumentScope: buildSearchEverythingScope(
                                value === "__all__"
                                  ? null
                                  : (value as InstrumentClass),
                              ),
                            }))
                          }
                          options={[
                            {
                              value: "__all__",
                              label: "All enabled classes",
                            },
                            ...effectiveInstrumentClasses.map(
                              (instrumentClass) => ({
                                value: instrumentClass,
                                label: `Focus ${formatInstrumentClass(instrumentClass)}`,
                              }),
                            ),
                          ]}
                        />
                        <div className={inlineHintClass}>
                          Keeps the broader broker-backed universe available,
                          but tells the selector which class to prioritize
                          first.
                        </div>
                      </Field>
                    ) : null}
                    <Field label="Manual tickers" glossaryId="manual-tickers">
                      <textarea
                        value={form.instrumentScope}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            instrumentScope: event.target.value,
                          }))
                        }
                        placeholder="SPY, QQQ, NVDA"
                        rows={4}
                        className={textareaClass}
                      />
                    </Field>
                  </>
                ) : (
                  <div className={inlineHintClass}>
                    {sessionSubscribedToMockRehearsal(subscribedSources)
                      ? "Mock rehearsal listens via synthetic filings. Instruments come from the fired signal — not from a manual ticker list."
                      : selectedExperience
                        ? `${selectedExperience.displayName} listens via ${formatSignalSourceTypeLabel(selectedExperience.capabilities.signalSourceTypes[0] ?? "manual")}. Instruments come from the signal feed — not from a manual ticker list.`
                        : "Automatic listener — nothing to configure."}
                  </div>
                )}
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
                            <span className="block text-[12px] font-semibold text-[var(--text1)]">
                              {broker.name}
                            </span>
                            <span className="mt-px block text-[12px] text-[var(--text3)]">
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
                              <div className="text-[12px] font-semibold text-[var(--text1)]">
                                {broker.name}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--text3)]">
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
                  {uncoveredExperienceInstrumentClasses.length > 0 ? (
                    <div className={inlineHintClass}>
                      Uncovered experience classes (signals may dead-letter):{" "}
                      {uncoveredExperienceInstrumentClasses
                        .map(formatInstrumentClass)
                        .join(", ")}
                      .{" "}
                      <HelpTooltip
                        glossaryId="dead-letter"
                        topic="Dead letters"
                      />
                    </div>
                  ) : null}
                  {!isLaunchable ? (
                    <div className={warningTextClass}>
                      Selected brokers must cover at least one class supported
                      by this experience (
                      {experienceClasses.map(formatInstrumentClass).join(", ")}
                      ). <HelpTooltip glossaryId="launchability" />
                    </div>
                  ) : (
                    <div className={successTextClass}>
                      Launchable with broker coverage for{" "}
                      {overlappingClasses.map(formatInstrumentClass).join(", ")}
                      . <HelpTooltip glossaryId="launchability" />
                    </div>
                  )}
                </div>
              </Field>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] text-[var(--text3)]">
              {formatReadinessSummary({
                readiness,
                inputModel,
                subscribedSources,
                manualTickerCount,
              })}
            </div>
            <div className="flex justify-end gap-2.5">
              <Button
                onClick={onClose}
                variant="outline"
                className="border-border bg-[var(--surface2)] text-[var(--text2)]"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  dispatchReq({ saving: true, error: null });
                  try {
                    await onSubmit(
                      {
                        ...form,
                        instrumentScope: showInstrumentFilter
                          ? form.instrumentScope
                          : "",
                        selectionMode: resolveSelectionModeForInput({
                          subscribedSources,
                          instrumentScope: showInstrumentFilter
                            ? form.instrumentScope
                            : "",
                          selectorSettings: form.selectorSettings,
                        }),
                        selectorSettings: resolveSelectorSettingsForInput({
                          inputModel,
                          selectorSettings: form.selectorSettings,
                        }),
                        subscribedSourceIds,
                        brokerAssignments: form.brokerAssignments.filter(
                          (assignment) =>
                            brokerById.has(assignment.brokerAccountId),
                        ),
                        brokerOverridesByInstrumentClass: {},
                      },
                      initialSession?.id,
                    );
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
                className="bg-[var(--accent)] text-white"
                disabled={
                  req.saving ||
                  !isValid ||
                  !isLaunchable ||
                  requiresSearchProviderSetup
                }
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
    <div className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--text3)]">
      <span>{title}</span>
      {glossaryId ? (
        <HelpTooltip glossaryId={glossaryId} topic={title} />
      ) : null}
    </div>
    <div className="mt-1 text-[12px] text-[var(--text2)]">{caption}</div>
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
      labelClassName="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]"
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
    instrumentClasses: ["stock"],
    instrumentScope: "",
    defaultSearchProviderId: null,
    selectorSettings: { aiPickerEnabled: false },
    executionMode: "paper_only",
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
    subscribedSourceIds: [],
  };
}

function payloadToInput(
  payload: SessionTemplatePayload,
  name = "",
): SessionCreateInput {
  return {
    name,
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
    subscribedSourceIds: [],
  };
}

function summaryToInput(session: SessionSummary): SessionCreateInput {
  return {
    name: session.name,
    objective: session.objective,
    experienceId: session.experienceId,
    selectionMode: session.selectionMode,
    instrumentClasses: session.instrumentClasses,
    instrumentScope: session.instrumentScope,
    defaultSearchProviderId: session.defaultSearchProviderId,
    selectorSettings:
      session.selectionMode === "ai_selected_universe"
        ? { aiPickerEnabled: true }
        : { aiPickerEnabled: false },
    executionMode: session.executionMode,
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
    subscribedSourceIds: [],
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
        : "Prediction Markets";
}

function isSearchEverythingInput(input: SessionCreateInput): boolean {
  return isSearchEverythingEnabled(input);
}

function sameInstrumentClasses(
  left: InstrumentClass[],
  right: InstrumentClass[],
): boolean {
  return (
    left.length === right.length &&
    left.every((instrumentClass, index) => instrumentClass === right[index])
  );
}

const panelClass =
  "max-h-[92vh] w-[900px] max-w-[96vw] overflow-auto rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-[22px] shadow-[0_26px_60px_rgba(2,6,23,0.28)]";
const sectionClass =
  "rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5";
const sectionBodyClass = "grid gap-3.5";
const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] py-[9px] text-[13px] text-[var(--text1)]";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] py-[9px] text-[13px] text-[var(--text1)]";
const twoColumnGridClass =
  "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5";
const brokerPickerClass =
  "grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2.5";
const brokerRowClass =
  "flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2";
const allocationRowClass =
  "grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5";
const inlineHintClass = "text-[12px] text-[var(--text3)]";
const kindChipClass =
  "rounded-full border border-[var(--border)] bg-[var(--chip)] px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text3)]";
const quickFillChipClass =
  "cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-[3px] text-[11px] font-semibold text-[var(--text2)]";
const selectAllButtonClass =
  "mt-0.5 cursor-pointer justify-self-start rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-[7px] text-[12px] font-semibold text-[var(--text2)]";
const warningTextClass = "text-[12px] font-semibold text-warning";
const successTextClass = "text-[12px] font-semibold text-success";
const warningBannerClass =
  "mb-4 rounded-xl border border-warning-border bg-warning-dim px-[14px] py-3 text-[13px] leading-normal text-warning";
const errorBannerClass =
  "mb-4 rounded-xl border border-error-border bg-error-dim px-[14px] py-3 text-[13px] text-error";
