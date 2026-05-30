import { useEffect, useMemo, useReducer } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
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
  Switch,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  buildSearchEverythingScope,
  isSearchEverythingEnabled,
  parseSearchEverythingFocusInstrumentClass,
  resolveBrokerInstrumentClasses,
  resolveEffectiveInstrumentClasses,
} from "@electron/shared/instruments/session-instrument-classes";

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
        selectorSettings: { aiPickerEnabled: true },
        selectionMode: "manual_shortlist",
      });
      return;
    }

    if (!initialSession) {
      applyInitializedForm({
        ...defaultInput(),
        executionMode: envExecMode,
        selectorSettings: { aiPickerEnabled: true },
        selectionMode: "manual_shortlist",
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
          selectorSettings: { aiPickerEnabled: true },
          selectionMode: "manual_shortlist",
        };
      } catch (seedError) {
        nextError =
          seedError instanceof Error
            ? seedError.message
            : "Failed to load seed.";
        nextForm = {
          ...summaryToInput(initialSession),
          executionMode: envExecMode,
          selectorSettings: { aiPickerEnabled: true },
          selectionMode: "manual_shortlist",
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
            subscribedSourceIds: [],
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
  const effectiveInstrumentClasses = useMemo(
    () => resolveEffectiveInstrumentClasses(form, assignedActiveModeBrokers),
    [form, assignedActiveModeBrokers],
  );
  const uncoveredInstrumentClasses = useMemo(
    () =>
      effectiveInstrumentClasses.filter(
        (instrumentClass) =>
          !assignedActiveModeBrokers.some((broker) =>
            broker.supportedInstrumentClasses.includes(instrumentClass),
          ),
      ),
    [effectiveInstrumentClasses, assignedActiveModeBrokers],
  );
  const hasBrokerCoverage =
    uncoveredInstrumentClasses.length === 0 &&
    form.brokerAssignments.length > 0 &&
    effectiveInstrumentClasses.length > 0;
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
    () =>
      form.instrumentScope
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean).length,
    [form.instrumentScope],
  );
  const enabledSubscribedSourceCount = useMemo(
    () =>
      signalSources.filter(
        (source) => subscribedSourceIds.includes(source.id) && source.enabled,
      ).length,
    [signalSources, subscribedSourceIds],
  );
  const disabledSubscribedSourceCount = useMemo(
    () =>
      signalSources.filter(
        (source) => subscribedSourceIds.includes(source.id) && !source.enabled,
      ).length,
    [signalSources, subscribedSourceIds],
  );
  const readiness =
    enabledSubscribedSourceCount > 0 || manualTickerCount > 0
      ? enabledSubscribedSourceCount === 0
        ? "manual_only"
        : "armed"
      : disabledSubscribedSourceCount > 0
        ? "waiting_for_source_enable"
        : "no_inputs";

  const anySearchStyleSubscribed = useMemo(
    () =>
      signalSources.some(
        (source) =>
          subscribedSourceIds.includes(source.id) &&
          source.type === "web_search",
      ),
    [signalSources, subscribedSourceIds],
  );
  // Tickers are a property of search-style/manual scoping only — a listener
  // (EDGAR 8-K) carries its own subject, so it never asks for instruments.
  const showInstrumentFilter =
    anySearchStyleSubscribed || subscribedSourceIds.length === 0;
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
        form.instrumentClasses,
        brokerDrivenInstrumentClasses,
      )
    )
      return;
    dispatchData({
      form: { ...form, instrumentClasses: brokerDrivenInstrumentClasses },
    });
  }, [
    brokerDrivenInstrumentClasses,
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
                <Field label="Objective">
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
                caption="Pick what drives this session. Choose a signal first."
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
                ) : signalSources.length === 0 ? (
                  <div className={inlineHintClass}>
                    No automated signal sources configured yet. You can still
                    run from manual tickers below.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {signalSources.map((source) => {
                      const checked = subscribedSourceIds.includes(source.id);
                      const isSearchStyle = source.type === "web_search";
                      return (
                        <label key={source.id} className={brokerRowClass}>
                          <Switch
                            checked={checked}
                            onCheckedChange={(next) =>
                              dispatchData({
                                subscribedSourceIds: next
                                  ? [
                                      ...new Set([
                                        ...subscribedSourceIds,
                                        source.id,
                                      ]),
                                    ]
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
                            </span>
                            <span className="mt-px block text-[12px] text-[var(--text3)]">
                              {source.type === "edgar_8k"
                                ? "EDGAR 8-K"
                                : "Web Search"}
                              {!source.enabled
                                ? " · Disabled globally — does not count as a live input"
                                : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text2)]">
                  {readiness === "armed"
                    ? `Live inputs: ${manualTickerCount} manual ticker(s), ${enabledSubscribedSourceCount} enabled source(s)`
                    : readiness === "manual_only"
                      ? "This session will run from manual tickers only."
                      : readiness === "waiting_for_source_enable"
                        ? `This session is subscribed to ${disabledSubscribedSourceCount} source(s), but all are disabled. Starting now will put the session in waiting mode.`
                        : "This session has no live inputs yet. Add manual tickers or enable at least one subscribed source."}
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <SectionHeader
                title="Signal Scope"
                caption={
                  showInstrumentFilter
                    ? "Tell the web search what to look at."
                    : "Automatic listener — nothing to configure."
                }
              />
              <div className={sectionBodyClass}>
                {showInstrumentFilter ? (
                  <>
                    <div className={twoColumnGridClass}>
                      <Field label="Search provider override">
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
                    {searchEverything &&
                    effectiveInstrumentClasses.length > 1 ? (
                      <Field label="Research focus">
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
                    <Field label="Instrument classes">
                      <div className="flex flex-wrap gap-2.5">
                        {(
                          [
                            "stock",
                            "crypto",
                            "futures",
                            "prediction_market",
                          ] as const
                        ).map((instrumentClass) => {
                          const checked =
                            effectiveInstrumentClasses.includes(
                              instrumentClass,
                            );
                          return (
                            <label
                              key={instrumentClass}
                              className={cn(
                                toggleChipClass,
                                checked
                                  ? "border-[var(--accent-dim)]"
                                  : "border-[var(--border)]",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={searchEverything}
                                onCheckedChange={(nextChecked) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    instrumentClasses: toggleInstrumentClass(
                                      prev.instrumentClasses,
                                      instrumentClass,
                                      nextChecked === true,
                                    ),
                                  }))
                                }
                              />
                              {formatInstrumentClass(instrumentClass)}
                            </label>
                          );
                        })}
                      </div>
                      {searchEverything ? (
                        <div className={inlineHintClass}>
                          Broker-derived classes:{" "}
                          {effectiveInstrumentClasses.length > 0
                            ? effectiveInstrumentClasses
                                .map(formatInstrumentClass)
                                .join(", ")
                            : "Select at least one broker account to derive tradable classes."}
                          {searchEverythingFocusInstrumentClass
                            ? ` Focus: ${formatInstrumentClass(searchEverythingFocusInstrumentClass)}.`
                            : ""}
                        </div>
                      ) : null}
                    </Field>
                    <Field label="Manual tickers">
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
                    EDGAR 8-K is an automatic listener. No instruments to pick —
                    it responds to filings as they happen.
                  </div>
                )}
              </div>
            </section>

            <section className={sectionClass}>
              <SectionHeader
                title="Execution Setup"
                caption="Pick broker accounts for this session."
              />
              <Field label="Broker accounts">
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
                              <div className="mt-0.5 text-[12px] text-[var(--text3)]">
                                Balance:{" "}
                                {broker.balanceCacheUsd != null
                                  ? `$${broker.balanceCacheUsd.toLocaleString()}`
                                  : "—"}
                                {" · "}
                                Free:{" "}
                                {broker.freeCapitalUsd != null
                                  ? `$${broker.freeCapitalUsd.toLocaleString()}`
                                  : "—"}
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
                  {uncoveredInstrumentClasses.length > 0 ? (
                    <div className={warningTextClass}>
                      No selected broker can trade:{" "}
                      {uncoveredInstrumentClasses
                        .map(formatInstrumentClass)
                        .join(", ")}
                      .
                    </div>
                  ) : (
                    <div className={successTextClass}>
                      Coverage looks good for selected instrument classes.
                    </div>
                  )}
                </div>
              </Field>
            </section>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[12px] text-[var(--text3)]">
              {readiness === "manual_only"
                ? "This session runs from manual tickers only."
                : readiness === "waiting_for_source_enable"
                  ? "All subscribed sources are disabled — session will wait idle on start."
                  : readiness === "no_inputs"
                    ? "No live inputs — session will wait idle on start."
                    : ""}
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
                        // Tickers belong to search-style/manual scoping only.
                        // A listener-only session (EDGAR) carries no tickers.
                        instrumentScope: showInstrumentFilter
                          ? form.instrumentScope
                          : "",
                        selectionMode: "manual_shortlist",
                        selectorSettings: { aiPickerEnabled: true },
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
                  !hasBrokerCoverage ||
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
}: {
  title: string;
  caption: string;
}) => (
  <div className="mb-3.5">
    <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--text3)]">
      {title}
    </div>
    <div className="mt-1 text-[12px] text-[var(--text2)]">{caption}</div>
  </div>
);

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="grid gap-1.5">
    <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]">
      {label}
    </span>
    {children}
  </label>
);

function defaultInput(): SessionCreateInput {
  return {
    name: "",
    objective: "",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "SPY,QQQ",
    defaultSearchProviderId: null,
    selectorSettings: { aiPickerEnabled: true },
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
    selectionMode: session.selectionMode,
    instrumentClasses: session.instrumentClasses,
    instrumentScope: session.instrumentScope,
    defaultSearchProviderId: session.defaultSearchProviderId,
    selectorSettings: { aiPickerEnabled: true },
    executionMode: session.executionMode,
    brokerAssignments: [],
    brokerOverridesByInstrumentClass: {},
    subscribedSourceIds: [],
  };
}

function toggleInstrumentClass(
  current: InstrumentClass[],
  value: InstrumentClass,
  checked: boolean,
): InstrumentClass[] {
  if (checked) {
    return current.includes(value) ? current : [...current, value];
  }
  return current.filter((entry) => entry !== value);
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
const toggleChipClass =
  "inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--chip)] px-[11px] py-2 text-[12px] text-[var(--text2)]";
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
