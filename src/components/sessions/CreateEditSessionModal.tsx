import { useEffect, useMemo, useReducer, useRef } from "react";
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
  onOpenAccounts,
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
  });
  const [req, dispatchReq] = useReducer(mergeReducer<ModalReqState>, {
    saving: false,
    error: null,
  });
  const searchEverythingSnapshotRef = useRef<{
    instrumentClasses: InstrumentClass[];
    instrumentScope: string;
    aiPickerEnabled: boolean;
  } | null>(null);
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
      applyInitializedForm({ ...templateInput, executionMode: envExecMode });
      return;
    }

    if (!initialSession) {
      applyInitializedForm({ ...defaultInput(), executionMode: envExecMode });
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

  const { form, brokerAccounts, searchProviderState } = data;

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
  const isValid =
    form.name.trim().length > 0 &&
    form.objective.trim().length > 0 &&
    effectiveInstrumentClasses.length > 0;
  const hasBrokerCoverage =
    uncoveredInstrumentClasses.length === 0 &&
    form.brokerAssignments.length > 0 &&
    effectiveInstrumentClasses.length > 0;
  const requiresSearchProviderSetup =
    form.selectionMode === "ai_selected_universe" &&
    form.selectorSettings.aiPickerEnabled &&
    !form.defaultSearchProviderId &&
    !searchProviderState.workspaceDefaultSearchProviderId;
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
  }, [brokerAccounts, brokerById, form.brokerAssignments, visibleBrokers]);

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
  }, [brokerDrivenInstrumentClasses, form.instrumentClasses, searchEverything]);

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
  }, [effectiveInstrumentClasses, searchEverythingFocusInstrumentClass]);

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
              Identity, task boundary, and execution routing in one place.
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
                title="Task Boundary"
                caption="Universe selection, scope, and search-provider behavior."
              />
              <div className={sectionBodyClass}>
                <div className={twoColumnGridClass}>
                  <Field label="Selection mode">
                    <ShadcnSelect
                      value={form.selectionMode}
                      onValueChange={(value) => {
                        const nextMode =
                          value as SessionCreateInput["selectionMode"];
                        if (
                          nextMode !== "ai_selected_universe" &&
                          searchEverything
                        ) {
                          const snapshot = searchEverythingSnapshotRef.current;
                          setForm((prev) => ({
                            ...prev,
                            selectionMode: nextMode,
                            instrumentScope:
                              snapshot?.instrumentScope ?? prev.instrumentScope,
                            selectorSettings: {
                              aiPickerEnabled:
                                snapshot?.aiPickerEnabled ??
                                prev.selectorSettings.aiPickerEnabled,
                            },
                          }));
                          searchEverythingSnapshotRef.current = null;
                          return;
                        }
                        setForm((prev) => ({
                          ...prev,
                          selectionMode: nextMode,
                        }));
                      }}
                      options={[
                        {
                          value: "manual_shortlist",
                          label: "Manual shortlist",
                        },
                        {
                          value: "ai_selected_universe",
                          label: "AI selected universe",
                        },
                      ]}
                    />
                  </Field>
                  <Field label="Search provider override">
                    <ShadcnSelect
                      value={
                        form.defaultSearchProviderId ?? "__workspace_default__"
                      }
                      onValueChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          defaultSearchProviderId:
                            value === "__workspace_default__" ? null : value,
                        }))
                      }
                      options={[
                        {
                          value: "__workspace_default__",
                          label: workspaceDefaultSearchProviderName
                            ? `Workspace default (${workspaceDefaultSearchProviderName})`
                            : "Workspace default (not set)",
                        },
                        ...searchProviderState.providers.map((provider) => ({
                          value: provider.id,
                          label: provider.name,
                        })),
                      ]}
                    />
                  </Field>
                </div>
                {requiresSearchProviderSetup ? (
                  <div className={warningBannerClass}>
                    AI-selected universe needs a search provider before this
                    session can be saved in selector mode. DuckDuckGo is built
                    in by default, and you can optionally add Brave or Tavily in
                    Accounts. OpenRouter model accounts do not satisfy this
                    requirement.
                    {onOpenAccounts ? (
                      <div className="mt-2.5">
                        <button
                          type="button"
                          onClick={onOpenAccounts}
                          className={inlineActionButtonClass}
                        >
                          Open Accounts setup
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {form.selectionMode === "ai_selected_universe" ? (
                  <div className={switchRowClass}>
                    <Switch
                      checked={searchEverything}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          searchEverythingSnapshotRef.current = {
                            instrumentClasses: form.instrumentClasses,
                            instrumentScope: form.instrumentScope,
                            aiPickerEnabled:
                              form.selectorSettings.aiPickerEnabled,
                          };
                          setForm((prev) => ({
                            ...prev,
                            instrumentClasses: brokerDrivenInstrumentClasses,
                            instrumentScope: buildSearchEverythingScope(),
                            selectorSettings: { aiPickerEnabled: true },
                          }));
                          return;
                        }

                        const snapshot = searchEverythingSnapshotRef.current;
                        setForm((prev) => ({
                          ...prev,
                          instrumentClasses:
                            snapshot?.instrumentClasses ??
                            prev.instrumentClasses,
                          instrumentScope:
                            snapshot?.instrumentScope ?? "SPY,QQQ",
                          selectorSettings: {
                            aiPickerEnabled: snapshot?.aiPickerEnabled ?? true,
                          },
                        }));
                        searchEverythingSnapshotRef.current = null;
                      }}
                    />
                    <span>
                      <span className="block font-semibold text-[var(--text1)]">
                        Search everything
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[var(--text3)]">
                        Ignore manual class picks and let the selected broker
                        accounts define the full tradable universe.
                      </span>
                    </span>
                  </div>
                ) : null}
                {searchEverything && effectiveInstrumentClasses.length > 1 ? (
                  <Field label="Research focus">
                    <ShadcnSelect
                      value={searchEverythingFocusInstrumentClass ?? "__all__"}
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
                      Keeps the broader broker-backed universe available, but
                      tells the selector which class to prioritize first.
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
                        effectiveInstrumentClasses.includes(instrumentClass);
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
                <Field label="Instrument scope">
                  <textarea
                    value={form.instrumentScope}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        instrumentScope: event.target.value,
                      }))
                    }
                    placeholder="SPY\nQQQ\nNVDA"
                    rows={4}
                    className={textareaClass}
                    disabled={searchEverything}
                  />
                </Field>
                <div className={switchRowClass}>
                  <Switch
                    checked={form.selectorSettings.aiPickerEnabled}
                    disabled={searchEverything}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        selectorSettings: { aiPickerEnabled: checked },
                      }))
                    }
                  />
                  <span>
                    <span className="block font-semibold text-[var(--text1)]">
                      AI picker enabled
                    </span>
                    <span className="mt-0.5 block text-[12px] text-[var(--text3)]">
                      Allow the selector role to expand or refine the shortlist
                      when the session calls for it.
                    </span>
                  </span>
                </div>
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
                            visibleBrokers.map((broker) => broker.id),
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
                                    Number(event.target.value) ||
                                      (broker.balanceCacheUsd != null
                                        ? broker.balanceCacheUsd / 10
                                        : 0),
                                  ),
                                }))
                              }
                              className={cn(inputClass, "w-[140px]")}
                            />
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
            <div className="text-[12px] text-[var(--text3)]">{""}</div>
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

function toggleBrokerAssignment(
  current: Array<{ brokerAccountId: string; allocatedUsd: number }>,
  brokerId: string,
  checked: boolean,
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  if (checked) {
    return current.some((entry) => entry.brokerAccountId === brokerId)
      ? current
      : [...current, { brokerAccountId: brokerId, allocatedUsd: 0 }];
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
  nextBrokerIds: string[],
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  const existing = new Set(current.map((entry) => entry.brokerAccountId));
  const nextEntries = [...current];
  for (const brokerAccountId of nextBrokerIds) {
    if (!existing.has(brokerAccountId)) {
      existing.add(brokerAccountId);
      nextEntries.push({ brokerAccountId, allocatedUsd: 0 });
    }
  }
  return nextEntries;
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
const switchRowClass =
  "flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-[14px] py-3";
const twoColumnGridClass =
  "grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3.5";
const brokerPickerClass =
  "grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2.5";
const brokerRowClass =
  "flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2";
const allocationRowClass =
  "grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5";
const inlineHintClass = "text-[12px] text-[var(--text3)]";
const selectAllButtonClass =
  "mt-0.5 cursor-pointer justify-self-start rounded-lg border border-[var(--border)] bg-transparent px-2.5 py-[7px] text-[12px] font-semibold text-[var(--text2)]";
const inlineActionButtonClass =
  "cursor-pointer rounded-lg border border-warning-border bg-warning-dim px-2.5 py-2 text-[12px] font-semibold text-warning";
const warningTextClass = "text-[12px] font-semibold text-warning";
const successTextClass = "text-[12px] font-semibold text-success";
const warningBannerClass =
  "mb-4 rounded-xl border border-warning-border bg-warning-dim px-[14px] py-3 text-[13px] leading-normal text-warning";
const errorBannerClass =
  "mb-4 rounded-xl border border-error-border bg-error-dim px-[14px] py-3 text-[13px] text-error";
