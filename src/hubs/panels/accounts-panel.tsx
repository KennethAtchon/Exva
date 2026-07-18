import { useCallback, useEffect, useReducer, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  isBuiltInSearchProviderAccount,
  parseProviderMetadata,
} from "@electron/shared/instruments/search-providers";
import {
  Badge,
  Card,
  Dot,
  SectionTitle,
  ShadcnSelect,
} from "@/components/custom-ui";
import { ProviderModelPicker } from "@/components/strategy/ProviderModelPicker";
import { AddAiProviderModal } from "@/components/accounts/AddAiProviderModal";
import { AddSearchProviderModal } from "@/components/accounts/AddSearchProviderModal";
import { AddBrokerModal } from "@/components/accounts/AddBrokerModal";
import { HelpTooltip } from "@/components/ui";
import { confirm, focusRingClass } from "@/components/ui/confirm-dialog";
import { PanelLoading } from "@/components/ui/skeleton";
import {
  MOCK_EXECUTION_TIER_LABELS,
  MOCK_SCENARIO_KINDS,
  MOCK_SCENARIO_LABELS,
  type MockExecutionTier,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { api, type ProviderModelEntry } from "@/lib/exva";
import { cn } from "@/lib/utils";
import { formatIpcError } from "@/lib/ipc-error";
import { HubQueryError } from "@/hubs/dna";
import { REASONING_LEVEL_OPTIONS } from "@electron/shared/ai/ai-phase";
import type {
  BrokerRoutingDefault,
  InstrumentClass,
  ProviderAccount,
  WorkspacePreferences,
} from "@/lib/types";

// Every instrument class that needs a default broker route. Single list so the
// picker and the "all classes covered" guard below can never disagree.
const ROUTABLE_INSTRUMENT_CLASSES: InstrumentClass[] = [
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
];

function providerTypeLabel(providerType: string): string {
  switch (providerType) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "brave":
      return "Brave Search";
    case "tavily":
      return "Tavily";
    case "duckduckgo":
      return "DuckDuckGo";
    case "mcp":
      return "MCP Search";
    default:
      return providerType;
  }
}

const InputField = ({
  label,
  hint,
  type = "text",
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) => (
  <div className={inputFieldRootClass}>
    <div className={inputFieldHeaderClass}>
      <label className={inputFieldLabelClass}>{label}</label>
      {hint && <span className={inputFieldHintClass}>{hint}</span>}
    </div>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputFieldInputClass(mono)}
    />
  </div>
);

const ConnBadge = ({ ok }: { ok: boolean }) => (
  <div className={connBadgeClass(ok)}>
    <Dot color={ok ? "var(--color-success)" : "var(--color-error)"} size={6} />
    <span className={connBadgeTextClass(ok)}>{ok ? "Connected" : "Error"}</span>
  </div>
);

export const AccountsPage = () => {
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const setEnvironmentMode = useWorkspaceStore((s) => s.setEnvironmentMode);

  const handleToggleEnvironment = async (next: "paper" | "live") => {
    if (next === environmentMode) return;
    if (next === "paper") {
      const sessions = await api.listSessions({
        includeArchived: false,
        includeAllEnvironments: true,
      });
      const activeLive = sessions.sessions.filter(
        (s) =>
          s.executionMode === "live_allowed" &&
          ["active", "paused", "attention_required"].includes(s.status),
      );
      if (activeLive.length > 0) {
        const ok = await confirm({
          title: "Switch to Paper?",
          description: `You have ${activeLive.length} active live session(s). Switching to Paper will hide them — they will continue running.`,
          confirmLabel: "Switch to Paper",
          variant: "destructive",
        });
        if (!ok) return;
      }
    }
    await setEnvironmentMode(next);
  };

  const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

  type ReqState = {
    testing: boolean;
    status: { broker: boolean; ai: boolean; search: boolean };
    rowSavingId: string | null;
  };
  const [req, setReq] = useReducer(mergeReducer<ReqState>, {
    testing: false,
    status: { broker: false, ai: false, search: false },
    rowSavingId: null,
  });
  const { testing, status, rowSavingId } = req;
  const setTesting = (testing: boolean) => setReq({ testing });
  const setStatus = (
    update:
      | ReqState["status"]
      | ((prev: ReqState["status"]) => ReqState["status"]),
  ) =>
    setReq({
      status: typeof update === "function" ? update(req.status) : update,
    });
  const setRowSavingId = (rowSavingId: string | null) =>
    setReq({ rowSavingId });

  type ModalState = {
    brokerModalOpen: boolean;
    aiModalOpen: boolean;
    searchModalOpen: boolean;
    editingProviderId: string | null;
    editApiKey: string;
    editBaseUrl: string;
  };
  const [modal, setModal] = useReducer(mergeReducer<ModalState>, {
    brokerModalOpen: false,
    aiModalOpen: false,
    searchModalOpen: false,
    editingProviderId: null,
    editApiKey: "",
    editBaseUrl: "",
  });
  const {
    brokerModalOpen,
    aiModalOpen,
    searchModalOpen,
    editingProviderId,
    editApiKey,
    editBaseUrl,
  } = modal;
  const setBrokerModalOpen = (brokerModalOpen: boolean) =>
    setModal({ brokerModalOpen });
  const setAiModalOpen = (aiModalOpen: boolean) => setModal({ aiModalOpen });
  const setSearchModalOpen = (searchModalOpen: boolean) =>
    setModal({ searchModalOpen });
  const setEditApiKey = (editApiKey: string) => setModal({ editApiKey });
  const setEditBaseUrl = (editBaseUrl: string) => setModal({ editBaseUrl });

  type DefaultModelState = {
    providerKey: string;
    modelId: string;
    reasoningLevel: (typeof REASONING_LEVEL_OPTIONS)[number]["value"];
    models: ProviderModelEntry[];
    modelsLoading: boolean;
    saving: boolean;
    saved: boolean;
  };
  const [defaultModel, setDefaultModel] = useReducer(
    mergeReducer<DefaultModelState>,
    {
      providerKey: "",
      modelId: "",
      reasoningLevel: "off",
      models: [],
      modelsLoading: false,
      saving: false,
      saved: false,
    },
  );
  const {
    providerKey: defaultModelProviderKey,
    modelId: defaultModelModelId,
    reasoningLevel: defaultModelReasoningLevel,
    models: defaultModelModels,
    modelsLoading: defaultModelModelsLoading,
    saving: savingDefaultModel,
    saved: savedDefaultModel,
  } = defaultModel;
  const setDefaultModelProviderKey = (providerKey: string) =>
    setDefaultModel({ providerKey });
  const setDefaultModelModelId = (modelId: string) =>
    setDefaultModel({ modelId });
  const setDefaultModelReasoningLevel = (
    reasoningLevel: (typeof REASONING_LEVEL_OPTIONS)[number]["value"],
  ) => setDefaultModel({ reasoningLevel });
  const setDefaultModelModels = (models: ProviderModelEntry[]) =>
    setDefaultModel({ models });
  const setDefaultModelModelsLoading = (modelsLoading: boolean) =>
    setDefaultModel({ modelsLoading });
  const setSavingDefaultModel = (saving: boolean) =>
    setDefaultModel({ saving });
  const setSavedDefaultModel = (saved: boolean) => setDefaultModel({ saved });

  const [routingDraft, setRoutingDraft] = useState<
    Partial<Record<InstrumentClass, string>>
  >({});
  const [prefsDraft, setPrefsDraft] = useState<WorkspacePreferences | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const applyWorkspaceDrafts = useCallback(
    (workspace: NonNullable<typeof workspaceData>) => {
      const provKey = workspace.prefs.defaultModelProviderKey ?? "";
      const modId = workspace.prefs.defaultModelModelId ?? "";
      setDefaultModelProviderKey(provKey);
      setDefaultModelModelId(modId);
      setDefaultModelReasoningLevel(
        workspace.prefs.defaultModelReasoningLevel ?? "off",
      );
      if (provKey) {
        api
          .getStrategyProviderModels(provKey)
          .then((r) => setDefaultModelModels(r.models))
          .catch(() => {});
      }
      const draft: Partial<Record<InstrumentClass, string>> = {};
      for (const row of workspace.routing) {
        draft[row.instrumentClass] = row.defaultBrokerAccountId;
      }
      setRoutingDraft(draft);
      setPrefsDraft(workspace.prefs);
    },
    [],
  );

  const {
    data: providersData,
    refetch: refetchProviders,
    isError: providersIsError,
    error: providersError,
    isPending: providersPending,
  } = useQuery({
    queryKey: ["accounts-providers"],
    queryFn: () => api.listProviders(),
  });
  const {
    data: workspaceData,
    refetch: refetchWorkspace,
    isError: workspaceIsError,
    error: workspaceError,
    isPending: workspacePending,
  } = useQuery({
    queryKey: ["accounts-workspace", environmentMode],
    queryFn: async () => {
      const [b, r, view] = await Promise.all([
        api.listBrokerAccounts(),
        api.getBrokerRoutingDefaults(),
        api.getWorkspaceView(),
      ]);
      return {
        brokers: b.brokers,
        routing: r.routing,
        prefs: view.preferences,
      };
    },
  });
  const accountsLoading = providersPending || workspacePending;

  const aiProviders =
    providersData?.providers.filter((p) => p.category === "ai") ?? [];
  const searchProviders =
    providersData?.providers.filter((p) => p.category === "search") ?? [];
  const brokers = (workspaceData?.brokers ?? []).filter(
    (b) => b.mode === environmentMode,
  );
  const prefs = workspaceData?.prefs ?? null;
  const hasTestedSearchProvider = searchProviders.some(
    (provider) => provider.lastTestStatus !== "unknown",
  );

  // Sync connection status from latest provider data
  useEffect(() => {
    if (!providersData) return;
    setStatus((prev) => ({
      ...prev,
      ai:
        aiProviders.length > 0 &&
        aiProviders.some((p) => p.lastTestStatus === "ok"),
      search:
        searchProviders.length > 0 &&
        searchProviders.some((p) => p.lastTestStatus === "ok"),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providersData]);

  // Sync editable form state from workspace data
  useEffect(() => {
    if (!workspaceData) return;
    applyWorkspaceDrafts(workspaceData);
  }, [applyWorkspaceDrafts, workspaceData]);

  const testAllConnections = async () => {
    setTesting(true);
    try {
      const [provList, brokerResp] = await Promise.all([
        api.listProviders(),
        api.listBrokerAccounts(),
      ]);
      const aiList = provList.providers.filter((p) => p.category === "ai");
      const searchList = provList.providers.filter(
        (p) => p.category === "search",
      );
      const [aiResults, searchResults, brokerResults] = await Promise.all([
        Promise.all(
          aiList.map((provider) =>
            api.testProvider(provider.id).catch(() => ({ ok: false as const })),
          ),
        ),
        Promise.all(
          searchList.map((provider) =>
            api.testProvider(provider.id).catch(() => ({ ok: false as const })),
          ),
        ),
        Promise.all(
          brokerResp.brokers.reduce<Array<Promise<{ ok: boolean }>>>(
            (acc, broker) => {
              if (broker.mode === environmentMode) {
                acc.push(
                  api
                    .testSavedBrokerAccount(broker.id)
                    .catch(() => ({ ok: false as const })),
                );
              }
              return acc;
            },
            [],
          ),
        ),
      ]);
      const anyAiOk = aiResults.some((result) => result.ok);
      const anySearchOk = searchResults.some((result) => result.ok);
      void refetchProviders();
      const anyBrokerOk = brokerResults.some((result) => result.ok);
      setStatus({ broker: anyBrokerOk, ai: anyAiOk, search: anySearchOk });
    } catch {
      setStatus({ broker: false, ai: false, search: false });
    } finally {
      setTesting(false);
    }
  };

  const beginEditProviderKey = (p: ProviderAccount) => {
    const metadata = parseProviderMetadata(p.metadataJson);
    setModal({
      editingProviderId: p.id,
      editApiKey: "",
      editBaseUrl: metadata.baseUrl ?? "",
    });
  };

  const cancelEditProviderKey = () => {
    setModal({ editingProviderId: null, editApiKey: "", editBaseUrl: "" });
  };

  const saveEditedProviderKey = async (p: ProviderAccount) => {
    const trimmed = editApiKey.trim();
    if (!trimmed) return;
    setRowSavingId(p.id);
    setFormError(null);
    try {
      const metadata =
        p.providerType === "openrouter"
          ? editBaseUrl.trim().length > 0
            ? { baseUrl: editBaseUrl.trim() }
            : undefined
          : p.providerType === "mcp"
            ? parseProviderMetadata(p.metadataJson)
            : undefined;
      await api.saveProvider({
        id: p.id,
        name: p.name,
        category: p.category,
        providerType: p.providerType as ProviderAccount["providerType"],
        apiKey: trimmed,
        metadata,
      });
      await api.testProvider(p.id).catch(() => ({ ok: false }));
      void refetchProviders();
      void refetchWorkspace();
      cancelEditProviderKey();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Could not save provider key.",
      );
    } finally {
      setRowSavingId(null);
    }
  };

  const deleteProvider = async (p: ProviderAccount) => {
    const ok = await confirm({
      title: `Delete provider "${p.name}"?`,
      description: "This removes the stored key from keychain.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setRowSavingId(p.id);
    setFormError(null);
    try {
      await api.deleteProvider(p.id);
      if (editingProviderId === p.id) cancelEditProviderKey();
      void refetchProviders();
      void refetchWorkspace();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Could not delete provider.",
      );
    } finally {
      setRowSavingId(null);
    }
  };

  return (
    <div className="hub-panel-body flex flex-col gap-5">
      <div className={pageHeaderRowClass}>
        <div>
          <h1 className={pageTitleClass}>Accounts</h1>
          <p className={pageSubtitleClass}>
            API keys stored in OS keychain, never written to disk or logs
          </p>
        </div>
        <div className={envToggleClass}>
          <button
            type="button"
            className={cn(
              envToggleButtonClass,
              focusRingClass,
              environmentMode === "paper" && envTogglePaperActiveClass,
            )}
            onClick={() => handleToggleEnvironment("paper")}
          >
            Paper
          </button>
          <button
            type="button"
            className={cn(
              envToggleButtonClass,
              focusRingClass,
              environmentMode === "live" && envToggleLiveActiveClass,
            )}
            onClick={() => handleToggleEnvironment("live")}
          >
            Live
          </button>
        </div>
      </div>

      {providersIsError ? (
        <HubQueryError
          message={`Providers failed to load — ${formatIpcError(providersError).display}`}
          onRetry={() => void refetchProviders()}
          className="m-0"
        />
      ) : null}
      {workspaceIsError ? (
        <HubQueryError
          message={`Broker accounts and routing failed to load — ${formatIpcError(workspaceError).display}`}
          onRetry={() => void refetchWorkspace()}
          className="m-0"
        />
      ) : null}
      {formError ? (
        <p className="m-0 font-sans text-caption text-error" role="alert">
          {formError}
        </p>
      ) : null}

      {accountsLoading ? <PanelLoading rows={5} /> : null}

      <div className={cn(twoColumnLayoutClass, accountsLoading && "hidden")}>
        <div className={columnClass}>
          <Card>
            <div className={cardHeaderRowClass}>
              <div>
                <div className={cardTitleClass}>AI providers</div>
                <div className={cardSubtitleClass}>
                  Add keys for each vendor; assign provider and model per role
                  on Strategy
                </div>
              </div>
              {aiProviders.length === 0 ? (
                <span className={noneYetLabelClass}>None yet</span>
              ) : (
                <ConnBadge ok={status.ai} />
              )}
            </div>
            <div className={cardSectionStackClass}>
              {aiProviders.length === 0 && (
                <div className={mutedText12Class}>
                  No AI accounts yet. Add Anthropic, OpenAI, or OpenRouter (you
                  can configure more than one).
                </div>
              )}
              {aiProviders.map((p) => {
                const statusLabel =
                  p.lastTestStatus === "ok"
                    ? "OK"
                    : p.lastTestStatus === "error"
                      ? "Error"
                      : "Untested";
                const isEditing = editingProviderId === p.id;
                return (
                  <div key={p.id} className={providerCardClass}>
                    <div className={providerNameRowClass}>
                      <div className={providerNameClass}>{p.name}</div>
                      <div className={providerTypeMonoClass}>
                        {providerTypeLabel(p.providerType)}
                      </div>
                      <div
                        className={cn(
                          providerStatusClass,
                          p.lastTestStatus === "ok" && "text-success",
                          p.lastTestStatus === "error" && "text-error",
                          p.lastTestStatus === "unknown" && "text-text3",
                        )}
                      >
                        {statusLabel}
                      </div>
                    </div>
                    {!isEditing ? (
                      <div className={providerActionsClass}>
                        <button
                          type="button"
                          onClick={() => beginEditProviderKey(p)}
                          className={outlineBtnClass}
                        >
                          Update key
                        </button>
                        <button
                          type="button"
                          disabled={rowSavingId === p.id}
                          onClick={async () => {
                            const r = await api
                              .testProvider(p.id)
                              .catch(() => ({ ok: false as const }));
                            setStatus((s) => ({ ...s, ai: r.ok || s.ai }));
                            void refetchProviders();
                          }}
                          className={testBtnClass}
                        >
                          Test
                        </button>
                        <button
                          type="button"
                          disabled={rowSavingId === p.id}
                          onClick={() => void deleteProvider(p)}
                          className={deleteProviderBtnClass(
                            rowSavingId === p.id,
                          )}
                        >
                          {rowSavingId === p.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    ) : null}
                    {isEditing ? (
                      <div className={editFormClass}>
                        <InputField
                          label="New API key"
                          hint="stored in OS keychain"
                          type="password"
                          value={editApiKey}
                          onChange={setEditApiKey}
                          placeholder="Paste key…"
                          mono
                        />
                        {p.providerType === "openrouter" ? (
                          <InputField
                            label="API base URL (optional)"
                            hint="full https URL"
                            value={editBaseUrl}
                            onChange={setEditBaseUrl}
                            placeholder="https://openrouter.ai/api/v1"
                            mono
                          />
                        ) : null}
                        <div className={buttonRowClass}>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            className={saveKeychainBtnClass(
                              rowSavingId === p.id,
                            )}
                          >
                            {rowSavingId === p.id
                              ? "Saving…"
                              : "Save to keychain"}
                          </button>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={cancelEditProviderKey}
                            className={cancelBtnClass}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              className={addProviderBtnClass}
            >
              + Add AI provider
            </button>
          </Card>

          <Card>
            <div className={defaultModelSectionClass}>
              <div className={sectionLabelClass}>
                Workspace default AI model
                <HelpTooltip
                  topic="Workspace default AI model"
                  body="Seeds provider, model, and reasoning defaults for new sessions. Individual phases can still override these values later."
                />
              </div>
              <div className={mutedText12Class}>
                Auto-fills provider, model, and reasoning on new sessions.
                Phases still at Off are updated when you save here.
              </div>
              <ProviderModelPicker
                providers={aiProviders}
                providerKey={defaultModelProviderKey}
                modelId={defaultModelModelId}
                models={defaultModelModels}
                modelsLoading={defaultModelModelsLoading}
                disabled={savingDefaultModel}
                onProviderChange={async (v) => {
                  setDefaultModelProviderKey(v);
                  setDefaultModelModelId("");
                  if (v) {
                    setDefaultModelModelsLoading(true);
                    try {
                      const result = await api.getStrategyProviderModels(v);
                      setDefaultModelModels(result.models);
                    } finally {
                      setDefaultModelModelsLoading(false);
                    }
                  } else {
                    setDefaultModelModels([]);
                  }
                }}
                onModelChange={(v) => setDefaultModelModelId(v)}
              />
              <div>
                <div className={reasoningLabelClass}>
                  Reasoning{" "}
                  <HelpTooltip
                    topic="Reasoning level"
                    body="Higher reasoning levels can improve deeper analysis, but they also increase token spend and latency."
                  />
                </div>
                <ShadcnSelect
                  value={defaultModelReasoningLevel}
                  onValueChange={(value) =>
                    setDefaultModelReasoningLevel(
                      value as (typeof REASONING_LEVEL_OPTIONS)[number]["value"],
                    )
                  }
                  options={[...REASONING_LEVEL_OPTIONS]}
                  placeholder="Off"
                  disabled={savingDefaultModel}
                />
                <div className={hintBelowClass}>
                  Non-off levels increase token spend. Pair with a
                  reasoning-capable model. Override per phase in Strategy → AI
                  Phases.
                </div>
              </div>
              <button
                type="button"
                disabled={
                  savingDefaultModel ||
                  !defaultModelProviderKey ||
                  !defaultModelModelId
                }
                onClick={async () => {
                  setSavingDefaultModel(true);
                  setFormError(null);
                  try {
                    await api.saveWorkspaceDefaultModel({
                      providerKey: defaultModelProviderKey,
                      modelId: defaultModelModelId,
                      reasoningLevel: defaultModelReasoningLevel,
                    });
                    void refetchWorkspace();
                    setSavedDefaultModel(true);
                    setTimeout(() => setSavedDefaultModel(false), 2500);
                  } catch (e) {
                    setFormError(
                      e instanceof Error
                        ? e.message
                        : "Could not save default model.",
                    );
                  } finally {
                    setSavingDefaultModel(false);
                  }
                }}
                className={cn(
                  saveDefaultModelBtnClass(
                    savingDefaultModel ||
                      !defaultModelProviderKey ||
                      !defaultModelModelId,
                  ),
                  focusRingClass,
                )}
              >
                {savingDefaultModel
                  ? "Saving..."
                  : savedDefaultModel
                    ? "Saved ✓"
                    : "Save default model"}
              </button>
            </div>
          </Card>

          <Card>
            <div className={cardHeaderRowClass}>
              <div>
                <div className={cardTitleClass}>Broker accounts</div>
                <div className={cardSubtitleClass}>
                  Multi-broker routing: keys in OS keychain
                </div>
              </div>
            </div>
            <div className={cardSectionStackClass}>
              {brokers.length === 0 && (
                <div className={mutedText12Class}>
                  No broker accounts yet. Add one to enable trading.
                </div>
              )}
              {brokers.map((b) => (
                <div key={b.id} className={brokerRowClass}>
                  <div>
                    <div className={providerNameClass}>{b.name}</div>
                    <div className={providerTypeMonoClass}>
                      {b.brokerType} · {b.supportedInstrumentClasses.join(", ")}
                    </div>
                    {b.brokerType === "mock" && (
                      <div className={mockScenarioWrapClass}>
                        <ShadcnSelect
                          value={b.mockScenarioKind ?? "clean_breakout"}
                          onValueChange={async (value) => {
                            await api.updateBrokerAccountSettings({
                              brokerAccountId: b.id,
                              mockScenarioKind: value as MockScenarioKind,
                            });
                            void refetchWorkspace();
                          }}
                          options={MOCK_SCENARIO_KINDS.map((kind) => ({
                            value: kind,
                            label: `${MOCK_SCENARIO_LABELS[kind].label} ${MOCK_SCENARIO_LABELS[kind].outcome}`,
                          }))}
                        />
                        <ShadcnSelect
                          value={b.mockExecutionTier ?? "scripted"}
                          onValueChange={async (value) => {
                            await api.updateBrokerAccountSettings({
                              brokerAccountId: b.id,
                              mockExecutionTier: value as MockExecutionTier,
                            });
                            void refetchWorkspace();
                          }}
                          options={(["scripted", "rehearsal"] as const).map(
                            (tier) => ({
                              value: tier,
                              label: MOCK_EXECUTION_TIER_LABELS[tier].label,
                            }),
                          )}
                        />
                      </div>
                    )}
                  </div>
                  <div className={buttonRowClass}>
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await api.testSavedBrokerAccount(b.id);
                        setStatus((s) => ({ ...s, broker: r.ok }));
                      }}
                      className={testBtnClass}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Remove broker “${b.name}”?`,
                          description:
                            "Routing rows that reference it will be deleted.",
                          confirmLabel: "Remove",
                          variant: "destructive",
                        });
                        if (!ok) return;
                        await api.deleteBrokerAccount(b.id);
                        void refetchWorkspace();
                      }}
                      className={removeBrokerBtnClass}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setBrokerModalOpen(true)}
              className={addProviderBtnClass}
            >
              + Add broker account
            </button>
          </Card>
        </div>

        <div className={columnClass}>
          <Card>
            <div className="flex items-center gap-1.5">
              <SectionTitle>Workspace routing defaults</SectionTitle>
              <HelpTooltip
                topic="Workspace routing defaults"
                body="These are fallback broker routes by instrument class. A session can still override them with its own broker assignments."
              />
            </div>
            <p className={routingDescClass}>
              Per-class default broker (session overrides live on the Strategy /
              session editor).
            </p>
            {ROUTABLE_INSTRUMENT_CLASSES.map((ic) => (
              <div key={ic} className={routingItemClass}>
                <div className={routingItemLabelClass}>{ic}</div>
                <ShadcnSelect
                  value={routingDraft[ic] ?? ""}
                  onValueChange={(value) =>
                    setRoutingDraft((d) => ({ ...d, [ic]: value }))
                  }
                  className="w-full"
                  options={[
                    { value: "", label: "Select broker" },
                    ...brokers.map((broker) => ({
                      value: broker.id,
                      label: `${broker.name} (${broker.brokerType})`,
                    })),
                  ]}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={async () => {
                const rows = ROUTABLE_INSTRUMENT_CLASSES.reduce<
                  BrokerRoutingDefault[]
                >((acc, instrumentClass) => {
                  const defaultBrokerAccountId =
                    routingDraft[instrumentClass] ?? "";
                  if (defaultBrokerAccountId) {
                    acc.push({ instrumentClass, defaultBrokerAccountId });
                  }
                  return acc;
                }, []);
                if (rows.length < ROUTABLE_INSTRUMENT_CLASSES.length) {
                  setFormError(
                    "Pick a default broker for stock, crypto, futures, options, and prediction markets.",
                  );
                  return;
                }
                setFormError(null);
                await api.saveBrokerRoutingDefaults(rows);
                void refetchWorkspace();
              }}
              className={cn(accentActionBtnMt8Class, focusRingClass)}
            >
              Save routing defaults
            </button>
          </Card>

          <Card>
            <div className="flex items-center gap-1.5">
              <SectionTitle>Broker allocation override</SectionTitle>
              <HelpTooltip
                topic="Broker allocation override"
                body="Optionally force all brokers to use the same over-allocation behavior instead of each broker's own setting."
              />
            </div>
            <p className={routingDescClass}>
              Optionally force all brokers to use the same over-allocation
              behavior.
            </p>
            {prefs && (
              <>
                <div className={prefsFieldClass}>
                  <div className={prefsFieldLabelClass}>Override</div>
                  <ShadcnSelect
                    value={prefsDraft?.allocationEnforcementOverride ?? ""}
                    onValueChange={(value) =>
                      setPrefsDraft((current) =>
                        current
                          ? {
                              ...current,
                              allocationEnforcementOverride:
                                value === ""
                                  ? null
                                  : (value as WorkspacePreferences["allocationEnforcementOverride"]),
                            }
                          : current,
                      )
                    }
                    className="w-full"
                    options={[
                      { value: "", label: "Use each broker setting" },
                      { value: "hard", label: "Hard block" },
                      { value: "warn", label: "Warn only" },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!prefsDraft) return;
                    await api.patchWorkspacePreferences({
                      allocationEnforcementOverride:
                        prefsDraft.allocationEnforcementOverride,
                    });
                    void refetchWorkspace();
                  }}
                  className={saveOverrideBtnClass}
                >
                  Save override
                </button>
              </>
            )}
          </Card>

          <Card>
            <div className={webSearchHeaderClass}>
              <div className={cardTitleClass}>
                Web Search{" "}
                <HelpTooltip
                  topic="Search providers"
                  body="Search-style sessions use these external search services when they need web discovery beyond the built-in defaults."
                />
              </div>
              <div className={cardSubtitleClass}>
                AI-selected universe sessions require a dedicated search
                account. Brave and Tavily are supported today.
              </div>
            </div>
            <div className={webSearchMetaRowClass}>
              <div className={webSearchHintClass}>
                OpenRouter model accounts do not satisfy this requirement.
                DuckDuckGo is built in by default, and you can add Brave or
                Tavily if you want an API-backed override.
              </div>
              {searchProviders.length === 0 ? (
                <span className={noneYetLabelClass}>None yet</span>
              ) : !hasTestedSearchProvider ? (
                <span className={noneYetLabelClass}>Built-in default</span>
              ) : (
                <ConnBadge ok={status.search} />
              )}
            </div>
            <div className={cardSectionStackClass}>
              {searchProviders.map((p) => {
                const isBuiltIn = isBuiltInSearchProviderAccount(p);
                const statusColor =
                  p.lastTestStatus === "ok"
                    ? "var(--color-success)"
                    : p.lastTestStatus === "error"
                      ? "var(--color-error)"
                      : "var(--text3)";
                const statusLabel =
                  p.lastTestStatus === "ok"
                    ? "OK"
                    : p.lastTestStatus === "error"
                      ? "Error"
                      : "Untested";
                const isEditing = editingProviderId === p.id;
                const isWorkspaceDefault =
                  prefs?.defaultSearchProviderId === p.id;
                return (
                  <div key={p.id} className={providerCardClass}>
                    <div className={providerCardHeaderClass}>
                      <div>
                        <div className={providerNameRowClass}>
                          <div className={providerNameClass}>{p.name}</div>
                          {isWorkspaceDefault ? (
                            <Badge variant="blue" size="sm">
                              workspace default
                            </Badge>
                          ) : null}
                          {isBuiltIn ? (
                            <Badge variant="default" size="sm">
                              built-in
                            </Badge>
                          ) : null}
                        </div>
                        <div className={providerTypeMonoClass}>
                          {providerTypeLabel(p.providerType)}
                        </div>
                        <div
                          className={providerStatusClass}
                          style={{ color: statusColor }}
                        >
                          {statusLabel}
                        </div>
                      </div>
                      {!isEditing ? (
                        <div className={providerActionsClass}>
                          {!isBuiltIn ? (
                            <button
                              type="button"
                              onClick={() => beginEditProviderKey(p)}
                              className={outlineBtnClass}
                            >
                              Update key
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={async () => {
                              const r = await api
                                .testProvider(p.id)
                                .catch(() => ({ ok: false as const }));
                              setStatus((s) => ({
                                ...s,
                                search: r.ok || s.search,
                              }));
                              void refetchProviders();
                            }}
                            className={testBtnClass}
                          >
                            Test
                          </button>
                          {!isBuiltIn ? (
                            <button
                              type="button"
                              disabled={rowSavingId === p.id}
                              onClick={() => void deleteProvider(p)}
                              className={deleteProviderBtnClass(
                                rowSavingId === p.id,
                              )}
                            >
                              {rowSavingId === p.id ? "Deleting…" : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div className={editFormClass}>
                        <InputField
                          label="New API key"
                          hint="stored in OS keychain"
                          type="password"
                          value={editApiKey}
                          onChange={setEditApiKey}
                          placeholder="Paste key…"
                          mono
                        />
                        <div className={buttonRowClass}>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            className={saveKeychainBtnClass(
                              rowSavingId === p.id,
                            )}
                          >
                            {rowSavingId === p.id
                              ? "Saving…"
                              : "Save to keychain"}
                          </button>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={cancelEditProviderKey}
                            className={cancelBtnClass}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className={searchDefaultSectionClass}>
              <div>
                <div className={searchDefaultLabelClass}>
                  Workspace default search provider
                  <HelpTooltip
                    topic="Workspace default search provider"
                    body="Used when a session does not specify its own search provider override."
                  />
                </div>
                <ShadcnSelect
                  value={prefsDraft?.defaultSearchProviderId ?? ""}
                  onValueChange={(value) =>
                    setPrefsDraft((current) =>
                      current
                        ? { ...current, defaultSearchProviderId: value || null }
                        : current,
                    )
                  }
                  className="w-full"
                  options={[
                    { value: "", label: "No workspace default" },
                    ...searchProviders.map((provider) => ({
                      value: provider.id,
                      label: provider.name,
                    })),
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!prefsDraft) return;
                  await api.patchWorkspacePreferences({
                    defaultSearchProviderId: prefsDraft.defaultSearchProviderId,
                  });
                  void refetchWorkspace();
                }}
                className={saveSearchSettingsBtnClass}
              >
                Save search settings
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              className={addProviderBtnClass}
            >
              + Add search provider
            </button>
          </Card>

          <OpsHardeningCard />

          <Card accent>
            <SectionTitle>Security Model</SectionTitle>
            <div className={securityListClass}>
              {(
                [
                  [
                    "OS Keychain",
                    "Secrets stored in system keychain, never SQLite",
                  ],
                  [
                    "In-memory only",
                    "Keys retrieved at call time, not held in process",
                  ],
                  [
                    "Never logged",
                    "Log macros only reference IDs — no key values",
                  ],
                  [
                    "No cloud sync",
                    "Local-only app — no data leaves this device",
                  ],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className={securityItemClass}>
                  <span className={securityCheckClass}>✓</span>
                  <div>
                    <span className={securityTitleClass}>{k}</span>
                    <span className={securityDescClass}> : {v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <button
            type="button"
            onClick={() => void testAllConnections()}
            disabled={testing}
            className={testAllConnectionsBtnClass}
          >
            {testing ? "Testing…" : "Test all connections"}
          </button>
        </div>
      </div>

      <AddBrokerModal
        open={brokerModalOpen}
        onClose={() => setBrokerModalOpen(false)}
        onSaved={() => void refetchWorkspace()}
      />
      <AddAiProviderModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onSaved={() => void refetchProviders()}
      />
      <AddSearchProviderModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSaved={async () => {
          void refetchProviders();
          void refetchWorkspace();
        }}
      />
    </div>
  );
};

function OpsHardeningCard() {
  const [backupAt, setBackupAt] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [digestHour, setDigestHour] = useState(8);
  const [configured, setConfigured] = useState({
    ntfy: false,
    telegram: false,
    smtp: false,
  });

  const refresh = async () => {
    const ops = window.exva?.ops;
    if (!ops) return;
    const [backup, routing] = await Promise.all([
      ops.getBackupStatus(),
      ops.getNotificationRouting(),
    ]);
    setBackupAt(backup.lastBackup?.backedUpAt ?? null);
    setDbPath(backup.dbPath);
    setDigestHour(routing.routing.digestHourLocal);
    setConfigured({
      ntfy: routing.ntfyConfigured,
      telegram: routing.telegramConfigured,
      smtp: routing.smtpConfigured,
    });
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Card>
      <SectionTitle>Ops & notifications</SectionTitle>
      <p className={mutedText12Class}>
        DB backups, Telegram/ntfy sinks, and digest routing (kill → push now;
        daily summary → {digestHour}:00 local).
      </p>
      <div className={cardSectionStackClass}>
        <div className={prefsFieldClass}>
          <div className={prefsFieldLabelClass}>Last backup</div>
          <div className={mutedText12Class}>
            {backupAt ? new Date(backupAt).toLocaleString() : "Never"}
          </div>
          <div className={hintBelowClass}>{dbPath || "db path unknown"}</div>
          <button
            type="button"
            className={outlineBtnClass}
            onClick={async () => {
              const result = await window.exva?.ops?.runBackupNow();
              setStatus(
                result?.ok
                  ? `Backup ok → ${result.backupPath ?? "skipped"}`
                  : `Backup failed: ${result?.error ?? "unknown"}`,
              );
              await refresh();
            }}
          >
            Backup now
          </button>
        </div>

        <div className={prefsFieldClass}>
          <div className={prefsFieldLabelClass}>Digest hour (local)</div>
          <input
            type="number"
            min={0}
            max={23}
            value={digestHour}
            className={inputFieldInputClass(true)}
            onChange={(e) => setDigestHour(Number(e.target.value))}
          />
          <button
            type="button"
            className={outlineBtnClass}
            onClick={async () => {
              await window.exva?.ops?.updateNotificationRouting({
                digestHourLocal: digestHour,
              });
              setStatus(`Digest hour set to ${digestHour}:00`);
              await refresh();
            }}
          >
            Save digest hour
          </button>
        </div>

        <div className={prefsFieldClass}>
          <div className={prefsFieldLabelClass}>Telegram bot (Keychain)</div>
          <input
            type="password"
            placeholder="Bot token"
            value={telegramToken}
            className={inputFieldInputClass(true)}
            onChange={(e) => setTelegramToken(e.target.value)}
          />
          <input
            type="text"
            placeholder="Chat id"
            value={telegramChatId}
            className={cn(inputFieldInputClass(true), "mt-2")}
            onChange={(e) => setTelegramChatId(e.target.value)}
          />
          <div className={providerActionsClass}>
            <button
              type="button"
              className={outlineBtnClass}
              onClick={async () => {
                if (!telegramToken || !telegramChatId) return;
                await window.exva?.ops?.setTelegramSecret({
                  botToken: telegramToken,
                  chatId: telegramChatId,
                });
                setTelegramToken("");
                setTelegramChatId("");
                setStatus("Telegram secret saved to Keychain");
                await refresh();
              }}
            >
              Save Telegram
            </button>
            <button
              type="button"
              className={outlineBtnClass}
              onClick={async () => {
                await window.exva?.ops?.clearTelegramSecret();
                setStatus("Telegram secret cleared");
                await refresh();
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className={prefsFieldClass}>
          <div className={prefsFieldLabelClass}>Test sinks</div>
          <div className={providerActionsClass}>
            {(
              [
                ["ntfy", configured.ntfy],
                ["telegram", configured.telegram],
                ["smtp", configured.smtp],
              ] as const
            ).map(([sink, ok]) => (
              <button
                key={sink}
                type="button"
                className={testBtnClass}
                onClick={async () => {
                  const result = await window.exva?.ops?.testNotificationSink({
                    sink,
                  });
                  setStatus(
                    result?.ok
                      ? `${sink} test sent`
                      : `${sink} failed: ${result?.error ?? "unknown"}`,
                  );
                }}
              >
                Test {sink}
                {ok ? "" : " (not configured)"}
              </button>
            ))}
          </div>
        </div>

        {status ? <div className={hintBelowClass}>{status}</div> : null}
      </div>
    </Card>
  );
}

const inputFieldRootClass = "flex flex-col gap-2";
const inputFieldHeaderClass = "flex items-baseline justify-between";
const inputFieldLabelClass = "font-sans text-label text-text2";
const inputFieldHintClass = "font-sans text-caption text-text3";

const inputFieldInputClass = (mono?: boolean) =>
  cn(
    "h-8 rounded-sm border border-border bg-surface2 px-3 font-sans text-body text-text1 transition-colors duration-hover focus:outline-none focus:ring-1 focus:ring-primary",
    mono && "font-mono text-data",
  );

const connBadgeClass = (ok: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1",
    ok
      ? "border-success-border bg-success-dim"
      : "border-error-border bg-error-dim",
  );

const connBadgeTextClass = (ok: boolean) =>
  cn("font-mono text-caption font-medium", ok ? "text-success" : "text-error");

const pageHeaderRowClass = "mb-1 flex items-start justify-between gap-4";
const pageTitleClass = "m-0 font-sans text-head text-text1";
const pageSubtitleClass = "mt-1 font-sans text-caption text-text3";
const twoColumnLayoutClass = "flex flex-col gap-4 lg:flex-row";
const columnClass = "flex min-w-0 flex-1 flex-col gap-3";

const cardHeaderRowClass = "mb-3 flex items-start justify-between gap-3";
const cardTitleClass = "mb-0.5 font-sans text-head text-text1";
const cardSubtitleClass = "font-sans text-caption text-text3";
const cardSectionStackClass = "flex flex-col gap-2";
const mutedText12Class = "font-sans text-caption text-text3";
const noneYetLabelClass = "font-sans text-caption font-medium text-text3";

const providerCardClass =
  "flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface2 px-3.5 py-3";
const providerCardHeaderClass =
  "flex min-w-0 flex-1 items-center justify-between gap-3";
const providerNameClass = "font-sans text-label text-text1";
const providerTypeMonoClass = "font-mono text-caption text-text3";
const providerStatusClass = "mt-0.5 font-mono text-caption font-medium";
const providerActionsClass = "flex shrink-0 flex-wrap items-center gap-2";
const providerNameRowClass = "flex min-w-0 flex-1 flex-col";

const outlineBtnClass =
  "cursor-pointer rounded-sm border border-border bg-surface px-2.5 py-1.5 font-sans text-caption text-text2 hover:bg-surface3";
const testBtnClass =
  "cursor-pointer rounded-sm border border-border bg-surface px-2.5 py-1.5 font-sans text-caption text-text1 hover:bg-surface3";
const deleteProviderBtnClass = (waiting: boolean) =>
  cn(
    "rounded-sm border border-error-border bg-error-dim px-2.5 py-1.5 font-sans text-caption text-error hover:opacity-90",
    waiting ? "cursor-wait" : "cursor-pointer",
  );

const editFormClass = "mt-3 flex flex-col gap-3";
const buttonRowClass = "flex flex-wrap gap-2";

const saveKeychainBtnClass = (isSaving: boolean) =>
  cn(
    "rounded-sm border-none bg-primary px-3 py-2 font-sans text-caption font-medium text-primary-foreground hover:opacity-90",
    isSaving ? "cursor-wait opacity-70" : "cursor-pointer",
  );

const cancelBtnClass =
  "cursor-pointer rounded-sm border border-border bg-transparent px-3 py-2 font-sans text-caption text-text2 hover:bg-surface2";

const addProviderBtnClass =
  "mt-3 w-full cursor-pointer rounded-sm border border-dashed border-border bg-transparent px-3.5 py-2.5 font-sans text-body text-text2 hover:bg-surface2";

const saveDefaultModelBtnClass = (disabled: boolean) =>
  cn(
    "w-full rounded-sm border-none bg-primary px-3.5 py-2.5 font-sans text-label font-medium text-primary-foreground hover:opacity-90",
    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
  );

const defaultModelSectionClass = "mt-3 grid gap-2.5";
const sectionLabelClass = "font-sans text-caption font-medium text-text2";
const reasoningLabelClass =
  "mb-1 font-mono text-micro uppercase tracking-wider text-text3";
const hintBelowClass = "mt-1 font-sans text-caption text-text3";

const brokerRowClass =
  "flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface2 px-3.5 py-3";
const removeBrokerBtnClass =
  "cursor-pointer rounded-sm border border-error-border bg-error-dim px-2.5 py-1.5 font-sans text-caption text-error hover:opacity-90";
const mockScenarioWrapClass = "mt-2 max-w-xs";

const routingDescClass = "mb-3 mt-1 font-sans text-caption text-text3";
const routingItemClass = "mb-2.5";
const routingItemLabelClass =
  "mb-1 font-mono text-micro uppercase tracking-wider text-text3";

const accentActionBtnClass =
  "w-full cursor-pointer rounded-sm border-none bg-primary px-3.5 py-2 font-sans text-label font-medium text-primary-foreground hover:opacity-90";
const accentActionBtnMt8Class = cn(accentActionBtnClass, "mt-2");
const saveOverrideBtnClass = cn(accentActionBtnClass, "mt-3");
const saveSearchSettingsBtnClass = accentActionBtnClass;

const prefsFieldClass = "mb-2.5";
const prefsFieldLabelClass =
  "mb-1 font-mono text-micro uppercase tracking-wider text-text3";

const webSearchHeaderClass = "mb-3";
const webSearchMetaRowClass = "mb-3 flex items-start justify-between gap-3";
const webSearchHintClass =
  "max-w-sm font-sans text-caption leading-relaxed text-text3";

const searchDefaultSectionClass = "mt-3 grid gap-2.5";
const searchDefaultLabelClass =
  "mb-1 font-mono text-micro uppercase tracking-wider text-text3";

const securityListClass = "mt-4 flex flex-col gap-3";
const securityItemClass = "flex items-start gap-3";
const securityCheckClass = "mt-px shrink-0 font-sans text-body text-success";
const securityTitleClass = "font-sans text-label text-text1";
const securityDescClass = "font-sans text-body text-text3";

const testAllConnectionsBtnClass =
  "w-full cursor-pointer rounded-sm border border-border bg-surface px-4 py-2.5 font-sans text-label text-text2 hover:bg-surface2";

const envToggleClass =
  "mt-1 grid grid-cols-2 gap-1 rounded-sm border border-border bg-surface2 p-1";
const envToggleButtonClass =
  "cursor-pointer rounded-sm border border-transparent bg-transparent px-3 py-1.5 font-sans text-caption font-medium text-text2";
const envTogglePaperActiveClass =
  "border-warning-border bg-warning-dim text-warning";
const envToggleLiveActiveClass =
  "border-success-border bg-success-dim text-success";
