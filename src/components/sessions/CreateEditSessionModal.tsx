import { useEffect, useMemo, useState } from "react";
import { api, type SessionCreateInput, type SessionSummary } from "@/lib/exva";
import type { BrokerAccountWithState, InstrumentClass, ProviderAccount, SessionTemplatePayload } from "@/lib/types";
import { ShadcnSelect } from "@/components/custom-ui";
import { Button, Checkbox, Dialog, DialogContent, Switch } from "@/components/ui";
import {
  isSearchEverythingEnabled,
  resolveBrokerInstrumentClasses,
  resolveEffectiveInstrumentClasses,
  SEARCH_EVERYTHING_SCOPE,
} from "@electron/shared/catalog/session-instrument-classes";

interface Props {
  open: boolean;
  initialSession?: SessionSummary | null;
  templateInput?: SessionCreateInput | null;
  templateWarnings?: string[];
  onOpenAccounts?: () => void;
  onClose: () => void;
  onSubmit: (input: SessionCreateInput, sessionId?: string) => Promise<void>;
}

export const CreateEditSessionModal = ({
  open,
  initialSession,
  templateInput,
  templateWarnings,
  onOpenAccounts,
  onClose,
  onSubmit,
}: Props) => {
  const [form, setForm] = useState<SessionCreateInput>(defaultInput());
  const [searchEverything, setSearchEverything] = useState(false);
  const [searchEverythingSnapshot, setSearchEverythingSnapshot] = useState<{
    instrumentClasses: InstrumentClass[];
    instrumentScope: string;
    aiPickerEnabled: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [loadingBrokers, setLoadingBrokers] = useState(false);
  const [brokerAccounts, setBrokerAccounts] = useState<BrokerAccountWithState[]>([]);
  const [searchProviders, setSearchProviders] = useState<ProviderAccount[]>([]);
  const [workspaceDefaultSearchProviderId, setWorkspaceDefaultSearchProviderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);

    if (templateInput) {
      setForm(templateInput);
      return;
    }

    if (!initialSession) {
      setForm(defaultInput());
      return;
    }

    setLoadingSeed(true);
    void api
      .buildTemplatePayloadFromSession(initialSession.id)
      .then((payload) => {
        if (cancelled) return;
        setForm(payloadToInput(payload, initialSession.name));
      })
      .catch((seedError: Error) => {
        if (cancelled) return;
        setError(seedError.message);
        setForm(summaryToInput(initialSession));
      })
      .finally(() => {
        if (!cancelled) setLoadingSeed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, initialSession, templateInput]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingBrokers(true);
    void api
      .listBrokerAccountState()
      .then((response) => {
        if (cancelled) return;
        setBrokerAccounts(response);
      })
      .catch(() => {
        if (cancelled) return;
        setBrokerAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBrokers(false);
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
        setSearchProviders(providerResponse.providers.filter((provider) => provider.category === "search" && provider.isConfigured));
        setWorkspaceDefaultSearchProviderId(workspaceView.preferences.defaultSearchProviderId);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchProviders([]);
        setWorkspaceDefaultSearchProviderId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearchEverything(isSearchEverythingInput(form));
  }, [open, form]);

  const assignedBrokerIds = useMemo(
    () => form.brokerAssignments.map((assignment) => assignment.brokerAccountId),
    [form.brokerAssignments],
  );
  const assignedBrokerIdSet = useMemo(() => new Set(assignedBrokerIds), [assignedBrokerIds]);
  const brokerById = useMemo(() => new Map(brokerAccounts.map((broker) => [broker.id, broker])), [brokerAccounts]);
  const brokerMode = form.executionMode === "live_allowed" ? "live" : "paper";
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
    () => effectiveInstrumentClasses.filter((instrumentClass) => !assignedActiveModeBrokers.some((broker) => broker.supportedInstrumentClasses.includes(instrumentClass))),
    [effectiveInstrumentClasses, assignedActiveModeBrokers],
  );
  const isValid = form.name.trim().length > 0 && form.objective.trim().length > 0 && effectiveInstrumentClasses.length > 0;
  const hasBrokerCoverage = uncoveredInstrumentClasses.length === 0 && form.brokerAssignments.length > 0 && effectiveInstrumentClasses.length > 0;
  const requiresSearchProviderSetup =
    form.selectionMode === "ai_selected_universe" &&
    form.selectorSettings.aiPickerEnabled &&
    !form.defaultSearchProviderId &&
    !workspaceDefaultSearchProviderId;
  const workspaceDefaultSearchProviderName = searchProviders.find((provider) => provider.id === workspaceDefaultSearchProviderId)?.name ?? null;
  const totalAllocatedUsd = useMemo(
    () => form.brokerAssignments.reduce((sum, assignment) => sum + assignment.allocatedUsd, 0),
    [form.brokerAssignments],
  );

  useEffect(() => {
    if (brokerAccounts.length === 0) return;
    const brokerIdsByMode = new Set(visibleBrokers.map((broker) => broker.id));
    const nextAssignments = form.brokerAssignments.filter((assignment) => brokerIdsByMode.has(assignment.brokerAccountId));
    if (nextAssignments.length === form.brokerAssignments.length) return;
    setForm((current) => ({ ...current, brokerAssignments: nextAssignments }));
  }, [brokerAccounts, brokerById, form.brokerAssignments, visibleBrokers]);

  useEffect(() => {
    if (!searchEverything) return;
    if (sameInstrumentClasses(form.instrumentClasses, brokerDrivenInstrumentClasses)) return;
    setForm((current) => ({ ...current, instrumentClasses: brokerDrivenInstrumentClasses }));
  }, [brokerDrivenInstrumentClasses, form.instrumentClasses, searchEverything]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-auto rounded-[20px] border-border bg-transparent p-0 sm:max-w-[900px]">
      <div style={panelStyle}>
        <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text1)", letterSpacing: "-0.01em" }}>
            {initialSession ? "Refine Session" : "Create Session"}
          </h2>
          <div style={{ marginTop: 5, color: "var(--text3)", fontSize: 12 }}>
            Identity, task boundary, and execution routing in one place.
          </div>
        </div>

        {templateWarnings?.length ? (
          <div style={warningBannerStyle}>
            Template fallback cleared {templateWarnings.length} unavailable field{templateWarnings.length === 1 ? "" : "s"}: {templateWarnings.join(", ")}
          </div>
        ) : null}
        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={{ display: "grid", gap: 16 }}>
          <section style={sectionStyle}>
            <SectionHeader title="Identity" caption="The operator-facing shell for this session." />
            <div style={sectionBodyStyle}>
              <div style={twoColumnGridStyle}>
                <Field label="Session name">
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Income Engine" style={inputStyle} />
                </Field>
              </div>
              <Field label="Objective">
                <textarea value={form.objective} onChange={(event) => setForm({ ...form, objective: event.target.value })} rows={4} style={textareaStyle} />
              </Field>
            </div>
          </section>

          <section style={sectionStyle}>
            <SectionHeader title="Task Boundary" caption="Universe selection, scope, and search-provider behavior." />
            <div style={sectionBodyStyle}>
              <div style={twoColumnGridStyle}>
                <Field label="Selection mode">
                  <ShadcnSelect
                    value={form.selectionMode}
                    onValueChange={(value) => {
                      const nextMode = value as SessionCreateInput["selectionMode"];
                      if (nextMode !== "ai_selected_universe" && searchEverything) {
                        setSearchEverything(false);
                        setForm({
                          ...form,
                          selectionMode: nextMode,
                          instrumentScope: searchEverythingSnapshot?.instrumentScope ?? form.instrumentScope,
                          selectorSettings: {
                            aiPickerEnabled: searchEverythingSnapshot?.aiPickerEnabled ?? form.selectorSettings.aiPickerEnabled,
                          },
                        });
                        setSearchEverythingSnapshot(null);
                        return;
                      }
                      setForm({ ...form, selectionMode: nextMode });
                    }}
                    options={[
                      { value: "manual_shortlist", label: "Manual shortlist" },
                      { value: "ai_selected_universe", label: "AI selected universe" },
                    ]}
                  />
                </Field>
                <Field label="Search provider override">
                  <ShadcnSelect
                    value={form.defaultSearchProviderId ?? "__workspace_default__"}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        defaultSearchProviderId: value === "__workspace_default__" ? null : value,
                      })
                    }
                    options={[
                      {
                        value: "__workspace_default__",
                        label: workspaceDefaultSearchProviderName
                          ? `Workspace default (${workspaceDefaultSearchProviderName})`
                          : "Workspace default (not set)",
                      },
                      ...searchProviders.map((provider) => ({ value: provider.id, label: provider.name })),
                    ]}
                  />
                </Field>
              </div>
              {requiresSearchProviderSetup ? (
                <div style={warningBannerStyle}>
                  AI-selected universe needs a search provider before this session can be saved in selector mode. DuckDuckGo is built in by default, and you can optionally add Brave or Tavily in Accounts. OpenRouter model accounts do not satisfy this requirement.
                  {onOpenAccounts ? (
                    <div style={{ marginTop: 10 }}>
                      <button type="button" onClick={onOpenAccounts} style={inlineActionButtonStyle}>Open Accounts setup</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {form.selectionMode === "ai_selected_universe" ? (
                <label style={switchRowStyle}>
                  <Switch
                    checked={searchEverything}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSearchEverythingSnapshot({
                          instrumentClasses: form.instrumentClasses,
                          instrumentScope: form.instrumentScope,
                          aiPickerEnabled: form.selectorSettings.aiPickerEnabled,
                        });
                        setForm({
                          ...form,
                          instrumentClasses: brokerDrivenInstrumentClasses,
                          instrumentScope: SEARCH_EVERYTHING_SCOPE,
                          selectorSettings: { aiPickerEnabled: true },
                        });
                        return;
                      }

                      setForm({
                        ...form,
                        instrumentClasses: searchEverythingSnapshot?.instrumentClasses ?? form.instrumentClasses,
                        instrumentScope: searchEverythingSnapshot?.instrumentScope ?? "SPY,QQQ",
                        selectorSettings: {
                          aiPickerEnabled: searchEverythingSnapshot?.aiPickerEnabled ?? true,
                        },
                      });
                      setSearchEverythingSnapshot(null);
                    }}
                  />
                    <span>
                      <span style={{ display: "block", color: "var(--text1)", fontWeight: 600 }}>Search everything</span>
                      <span style={{ display: "block", marginTop: 2, color: "var(--text3)", fontSize: 12 }}>
                      Ignore manual class picks and let the selected broker accounts define the full tradable universe.
                      </span>
                    </span>
                  </label>
              ) : null}
              <Field label="Instrument classes">
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(["stock", "crypto", "futures", "prediction_market"] as const).map((instrumentClass) => {
                    const checked = effectiveInstrumentClasses.includes(instrumentClass);
                    return (
                      <label key={instrumentClass} style={{ ...toggleChipStyle, borderColor: checked ? "var(--accent-dim)" : "var(--border)" }}>
                        <Checkbox
                          checked={checked}
                          disabled={searchEverything}
                          onCheckedChange={(nextChecked) =>
                            setForm({
                              ...form,
                              instrumentClasses: toggleInstrumentClass(form.instrumentClasses, instrumentClass, nextChecked === true),
                            })
                          }
                        />
                        {formatInstrumentClass(instrumentClass)}
                      </label>
                    );
                  })}
                </div>
                {searchEverything ? (
                  <div style={inlineHintStyle}>
                    Broker-derived classes: {effectiveInstrumentClasses.length > 0 ? effectiveInstrumentClasses.map(formatInstrumentClass).join(", ") : "Select at least one broker account to derive tradable classes."}
                  </div>
                ) : null}
              </Field>
              <Field label="Instrument scope">
                <textarea
                  value={form.instrumentScope}
                  onChange={(event) => setForm({ ...form, instrumentScope: event.target.value })}
                  placeholder="SPY\nQQQ\nNVDA"
                  rows={4}
                  style={textareaStyle}
                  disabled={searchEverything}
                />
              </Field>
              <label style={switchRowStyle}>
                <Switch
                  checked={form.selectorSettings.aiPickerEnabled}
                  disabled={searchEverything}
                  onCheckedChange={(checked) =>
                    setForm({
                      ...form,
                      selectorSettings: { aiPickerEnabled: checked },
                    })
                  }
                />
                <span>
                  <span style={{ display: "block", color: "var(--text1)", fontWeight: 600 }}>AI picker enabled</span>
                  <span style={{ display: "block", marginTop: 2, color: "var(--text3)", fontSize: 12 }}>
                    Allow the selector role to expand or refine the shortlist when the session calls for it.
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section style={sectionStyle}>
            <SectionHeader title="Execution Setup" caption="Choose paper or live, then pick broker accounts for this session." />
            <div style={twoColumnGridStyle}>
              <div>
              <Field label="Mode">
                <div style={modeToggleStyle}>
                  <button
                    type="button"
                    style={{ ...modeToggleButtonStyle, ...(form.executionMode === "paper_only" ? modeToggleButtonActiveStyle : {}) }}
                    onClick={() => setForm({ ...form, executionMode: "paper_only" })}
                  >
                    Paper
                  </button>
                  <button
                    type="button"
                    style={{ ...modeToggleButtonStyle, ...(form.executionMode === "live_allowed" ? modeToggleButtonActiveStyle : {}) }}
                    onClick={() => setForm({ ...form, executionMode: "live_allowed" })}
                  >
                    Live
                  </button>
                </div>
              </Field>
              </div>
              <Field label="Broker accounts">
                <div style={brokerPickerStyle}>
                  {loadingBrokers ? (
                    <div style={inlineHintStyle}>Loading broker accounts...</div>
                  ) : visibleBrokers.length === 0 ? (
                    <div style={inlineHintStyle}>No {brokerMode} broker accounts found. Add one in Accounts.</div>
                  ) : (
                    visibleBrokers.map((broker) => {
                      const checked = assignedBrokerIdSet.has(broker.id);
                      return (
                        <label key={broker.id} style={brokerRowStyle}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(nextChecked) =>
                              setForm({
                                ...form,
                                brokerAssignments: toggleBrokerAssignment(form.brokerAssignments, broker.id, nextChecked === true),
                              })
                            }
                          />
                          <span>
                            <span style={{ display: "block", color: "var(--text1)", fontSize: 12, fontWeight: 600 }}>{broker.name}</span>
                            <span style={{ display: "block", marginTop: 1, color: "var(--text3)", fontSize: 11 }}>
                              {broker.id} · {broker.brokerType} · {broker.mode}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                  {visibleBrokers.length > 0 ? (
                    <button
                      type="button"
                      style={selectAllButtonStyle}
                      onClick={() =>
                        setForm({
                          ...form,
                          brokerAssignments: mergeUniqueBrokerAssignments(
                            form.brokerAssignments,
                            visibleBrokers.map((broker) => broker.id),
                          ),
                        })
                      }
                    >
                      Select all {brokerMode} brokers
                    </button>
                  ) : null}
                  {assignedActiveModeBrokers.length > 0 ? (
                    <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                      {assignedActiveModeBrokers.map((broker) => {
                        const assignment = form.brokerAssignments.find((entry) => entry.brokerAccountId === broker.id);
                        if (!assignment) return null;
                        return (
                          <div key={broker.id} style={allocationRowStyle}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ color: "var(--text1)", fontSize: 12, fontWeight: 600 }}>{broker.name}</div>
                              <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>
                                Balance: {broker.balanceCacheUsd != null ? `$${broker.balanceCacheUsd.toLocaleString()}` : "—"}
                                {" · "}
                                Free: {broker.freeCapitalUsd != null ? `$${broker.freeCapitalUsd.toLocaleString()}` : "—"}
                              </div>
                            </div>
                            <input
                              type="number"
                              min={0}
                              value={String(assignment.allocatedUsd)}
                              onChange={(event) =>
                                setForm({
                                  ...form,
                                  brokerAssignments: updateBrokerAllocation(
                                    form.brokerAssignments,
                                    broker.id,
                                    Number(event.target.value) || 0,
                                  ),
                                })
                              }
                              style={{ ...inputStyle, width: 140 }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {uncoveredInstrumentClasses.length > 0 ? (
                    <div style={warningTextStyle}>
                      No selected broker can trade: {uncoveredInstrumentClasses.map(formatInstrumentClass).join(", ")}.
                    </div>
                  ) : (
                    <div style={successTextStyle}>Coverage looks good for selected instrument classes.</div>
                  )}
                </div>
              </Field>
            </div>
          </section>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ color: "var(--text3)", fontSize: 12 }}>
            {loadingSeed ? "Loading persisted strategy, broker assignments, and routing..." : ""}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button onClick={onClose} variant="outline" className="border-border bg-[var(--surface2)] text-[var(--text2)]">Cancel</Button>
            <Button
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await onSubmit({
                    ...form,
                    brokerAssignments: form.brokerAssignments.filter((assignment) => brokerById.has(assignment.brokerAccountId)),
                    brokerOverridesByInstrumentClass: {},
                  }, initialSession?.id);
                  onClose();
                } catch (submitError) {
                  setError(submitError instanceof Error ? submitError.message : "Failed to save session.");
                } finally {
                  setSaving(false);
                }
              }}
              className="bg-[var(--accent)] text-white"
              disabled={saving || loadingSeed || !isValid || !hasBrokerCoverage || requiresSearchProviderSetup}
            >
              {saving ? "Saving..." : initialSession ? "Save Session" : "Create Session"}
            </Button>
          </div>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
};

const SectionHeader = ({ title, caption }: { title: string; caption: string }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.14em" }}>{title}</div>
    <div style={{ marginTop: 4, color: "var(--text2)", fontSize: 12 }}>{caption}</div>
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label style={{ display: "grid", gap: 6 }}>
    <span style={{ color: "var(--text3)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
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

function payloadToInput(payload: SessionTemplatePayload, name = ""): SessionCreateInput {
  return {
    name,
    objective: payload.identity.objective,
    selectionMode: payload.identity.selectionMode,
    instrumentClasses: payload.identity.instrumentClasses,
    instrumentScope: payload.identity.instrumentScope,
    defaultSearchProviderId: payload.identity.defaultSearchProviderId,
    selectorSettings: payload.selectorSettings,
    executionMode: payload.identity.executionMode,
    brokerAssignments: payload.brokerAssignments.filter((assignment) => assignment.brokerAccountId),
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

function toggleInstrumentClass(current: InstrumentClass[], value: InstrumentClass, checked: boolean): InstrumentClass[] {
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
    entry.brokerAccountId === brokerId ? { ...entry, allocatedUsd: Math.max(0, allocatedUsd) } : entry,
  );
}

function mergeUniqueBrokerAssignments(
  current: Array<{ brokerAccountId: string; allocatedUsd: number }>,
  nextBrokerIds: string[],
): Array<{ brokerAccountId: string; allocatedUsd: number }> {
  const existing = new Set(current.map((entry) => entry.brokerAccountId));
  return [
    ...current,
    ...nextBrokerIds
      .filter((brokerId) => !existing.has(brokerId))
      .map((brokerAccountId) => ({ brokerAccountId, allocatedUsd: 0 })),
  ];
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

function sameInstrumentClasses(left: InstrumentClass[], right: InstrumentClass[]): boolean {
  return left.length === right.length && left.every((instrumentClass, index) => instrumentClass === right[index]);
}

const panelStyle = { width: 900, maxWidth: "96vw", maxHeight: "92vh", overflow: "auto", background: "linear-gradient(180deg, rgba(13,18,25,0.99) 0%, rgba(9,13,18,0.99) 100%)", border: "1px solid var(--border)", borderRadius: 20, padding: 22, boxShadow: "0 26px 60px rgba(2,6,23,0.48)" } as const;
const sectionStyle = { border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "rgba(18,26,36,0.6)" } as const;
const sectionBodyStyle = { display: "grid", gap: 14 } as const;
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(7,10,15,0.5)", color: "var(--text1)", fontSize: 13 } as const;
const textareaStyle = { ...inputStyle, resize: "vertical" as const, minHeight: 88 };
const toggleChipStyle = { display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 999, padding: "8px 11px", background: "rgba(7,10,15,0.38)", color: "var(--text2)", fontSize: 12 } as const;
const switchRowStyle = { display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "rgba(7,10,15,0.34)" } as const;
const twoColumnGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 } as const;
const brokerPickerStyle = { display: "grid", gap: 8, border: "1px solid var(--border)", borderRadius: 12, padding: 10, background: "var(--surface2)" } as const;
const brokerRowStyle = { display: "flex", alignItems: "flex-start", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface)" } as const;
const allocationRowStyle = { display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", background: "rgba(7,10,15,0.34)" } as const;
const inlineHintStyle = { color: "var(--text3)", fontSize: 12 } as const;
const modeToggleStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, padding: 6, borderRadius: 12, border: "1px solid var(--border)", background: "rgba(7,10,15,0.34)" } as const;
const modeToggleButtonStyle = { border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const;
const modeToggleButtonActiveStyle = { background: "var(--accent)", color: "white", borderColor: "var(--accent)" } as const;
const selectAllButtonStyle = { marginTop: 2, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", justifySelf: "start" } as const;
const inlineActionButtonStyle = { border: "1px solid rgba(251,191,36,0.34)", background: "rgba(7,10,15,0.34)", color: "#fde68a", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" } as const;
const warningTextStyle = { color: "#fbbf24", fontSize: 12, fontWeight: 600 } as const;
const successTextStyle = { color: "#86efac", fontSize: 12, fontWeight: 600 } as const;
const warningBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.08)", color: "#fcd34d", fontSize: 13, lineHeight: 1.5 } as const;
const errorBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.34)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: 13 } as const;
