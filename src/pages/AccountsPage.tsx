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
  PageShell,
  SectionTitle,
  ShadcnSelect,
} from "@/components/custom-ui";
import { ProviderModelPicker } from "@/components/strategy/ProviderModelPicker";
import { AddAiProviderModal } from "@/components/accounts/AddAiProviderModal";
import { AddSearchProviderModal } from "@/components/accounts/AddSearchProviderModal";
import { AddBrokerModal } from "@/components/accounts/AddBrokerModal";
import {
  MOCK_SCENARIO_KINDS,
  MOCK_SCENARIO_LABELS,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { api, type ProviderModelEntry } from "@/lib/exva";
import { REASONING_LEVEL_OPTIONS } from "../../electron/shared/ai/ai-phase";
import type {
  BrokerRoutingDefault,
  InstrumentClass,
  ProviderAccount,
  WorkspacePreferences,
} from "@/lib/types";

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
  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
      }}
    >
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>
        {label}
      </label>
      {hint && (
        <span style={{ fontSize: 12, color: "var(--text3)" }}>{hint}</span>
      )}
    </div>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputFieldInputStyle(mono)}
    />
  </div>
);

const ConnBadge = ({ ok }: { ok: boolean }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 11px",
      borderRadius: 20,
      background: ok ? "var(--color-success-dim)" : "var(--color-error-dim)",
      border: `1px solid ${ok ? "var(--color-success-border)" : "var(--color-error-border)"}`,
    }}
  >
    <Dot color={ok ? "var(--color-success)" : "var(--color-error)"} size={6} />
    <span
      style={{
        fontSize: 12,
        fontFamily: "var(--font-mono)",
        color: ok ? "var(--color-success)" : "var(--color-error)",
        fontWeight: 600,
      }}
    >
      {ok ? "Connected" : "Error"}
    </span>
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
        const ok = confirm(
          `You have ${activeLive.length} active live session(s). Switching to Paper will hide them — they will continue running.\n\nSwitch anyway?`,
        );
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

  const { data: providersData, refetch: refetchProviders } = useQuery({
    queryKey: ["accounts-providers"],
    queryFn: () => api.listProviders(),
  });
  const { data: workspaceData, refetch: refetchWorkspace } = useQuery({
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
    try {
      const metadata =
        p.providerType === "openrouter"
          ? editBaseUrl.trim().length > 0
            ? { baseUrl: editBaseUrl.trim() }
            : undefined
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
      alert(e instanceof Error ? e.message : "Could not save provider key.");
    } finally {
      setRowSavingId(null);
    }
  };

  const deleteProvider = async (p: ProviderAccount) => {
    const ok = window.confirm(
      `Delete provider "${p.name}"? This removes the stored key from keychain.`,
    );
    if (!ok) return;
    setRowSavingId(p.id);
    try {
      await api.deleteProvider(p.id);
      if (editingProviderId === p.id) cancelEditProviderKey();
      void refetchProviders();
      void refetchWorkspace();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete provider.");
    } finally {
      setRowSavingId(null);
    }
  };

  return (
    <PageShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--text1)",
              margin: 0,
            }}
          >
            Accounts
          </h1>
          <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
            API keys stored in OS keychain, never written to disk or logs
          </p>
        </div>
        <div style={envToggleStyle}>
          <button
            type="button"
            style={{
              ...envToggleButtonStyle,
              ...(environmentMode === "paper" ? envTogglePaperActiveStyle : {}),
            }}
            onClick={() => handleToggleEnvironment("paper")}
          >
            Paper
          </button>
          <button
            type="button"
            style={{
              ...envToggleButtonStyle,
              ...(environmentMode === "live" ? envToggleLiveActiveStyle : {}),
            }}
            onClick={() => handleToggleEnvironment("live")}
          >
            Live
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <Card>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text1)",
                    marginBottom: 3,
                  }}
                >
                  AI providers
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  Add keys for each vendor; assign provider and model per role
                  on Strategy
                </div>
              </div>
              {aiProviders.length === 0 ? (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text3)",
                    fontWeight: 500,
                  }}
                >
                  None yet
                </span>
              ) : (
                <ConnBadge ok={status.ai} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {aiProviders.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  No AI accounts yet. Add Anthropic, OpenAI, or OpenRouter (you
                  can configure more than one).
                </div>
              )}
              {aiProviders.map((p) => {
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
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 9,
                      border: "1px solid var(--border)",
                      background: "var(--surface2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--text1)",
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text3)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {providerTypeLabel(p.providerType)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: statusColor,
                            marginTop: 4,
                            fontWeight: 600,
                          }}
                        >
                          {statusLabel}
                        </div>
                      </div>
                      {!isEditing ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => beginEditProviderKey(p)}
                            style={{
                              fontSize: 12,
                              padding: "6px 10px",
                              borderRadius: 7,
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              cursor: "pointer",
                              color: "var(--text2)",
                            }}
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
                            style={{
                              fontSize: 12,
                              padding: "6px 10px",
                              borderRadius: 7,
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              cursor: "pointer",
                            }}
                          >
                            Test
                          </button>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void deleteProvider(p)}
                            style={{
                              fontSize: 12,
                              padding: "6px 10px",
                              borderRadius: 7,
                              border: "1px solid var(--color-error-border)",
                              background: "var(--color-error-dim)",
                              cursor: rowSavingId === p.id ? "wait" : "pointer",
                              color: "var(--color-error)",
                            }}
                          >
                            {rowSavingId === p.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
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
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            style={saveKeychainBtnStyle(rowSavingId === p.id)}
                          >
                            {rowSavingId === p.id
                              ? "Saving…"
                              : "Save to keychain"}
                          </button>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={cancelEditProviderKey}
                            style={{
                              fontSize: 12,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text2)",
                              cursor: "pointer",
                            }}
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
              style={addProviderBtnStyle}
            >
              + Add AI provider
            </button>
          </Card>

          <Card>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div
                style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)" }}
              >
                Workspace default AI model
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
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
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text3)",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  Reasoning
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
                <div
                  style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}
                >
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
                    alert(
                      e instanceof Error
                        ? e.message
                        : "Could not save default model.",
                    );
                  } finally {
                    setSavingDefaultModel(false);
                  }
                }}
                style={saveDefaultModelBtnStyle(
                  savingDefaultModel ||
                    !defaultModelProviderKey ||
                    !defaultModelModelId,
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
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text1)",
                    marginBottom: 3,
                  }}
                >
                  Broker accounts
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  Multi-broker routing: keys in OS keychain
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {brokers.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  No broker accounts yet. Add one to enable trading.
                </div>
              )}
              {brokers.map((b) => (
                <div key={b.id} style={brokerRowStyle}>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--text1)",
                      }}
                    >
                      {b.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text3)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {b.brokerType} · {b.supportedInstrumentClasses.join(", ")}
                    </div>
                    {b.brokerType === "mock" && (
                      <div style={{ marginTop: 8, maxWidth: 320 }}>
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
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await api.testSavedBrokerAccount(b.id);
                        setStatus((s) => ({ ...s, broker: r.ok }));
                      }}
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 7,
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        cursor: "pointer",
                      }}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          !confirm(
                            `Remove broker “${b.name}”? Routing rows that reference it will be deleted.`,
                          )
                        )
                          return;
                        await api.deleteBrokerAccount(b.id);
                        void refetchWorkspace();
                      }}
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 7,
                        border: "1px solid var(--color-error-border)",
                        color: "var(--color-error)",
                        background: "transparent",
                        cursor: "pointer",
                      }}
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
              style={addProviderBtnStyle}
            >
              + Add broker account
            </button>
          </Card>
        </div>

        <div
          style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <Card>
            <SectionTitle>Workspace routing defaults</SectionTitle>
            <p
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginTop: 6,
                marginBottom: 12,
              }}
            >
              Per-class default broker (session overrides live on the Strategy /
              session editor).
            </p>
            {(
              [
                "stock",
                "crypto",
                "futures",
                "prediction_market",
              ] as InstrumentClass[]
            ).map((ic) => (
              <div key={ic} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--text2)",
                    marginBottom: 6,
                  }}
                >
                  {ic}
                </div>
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
                const rows = (
                  [
                    "stock",
                    "crypto",
                    "futures",
                    "prediction_market",
                  ] as InstrumentClass[]
                ).reduce<BrokerRoutingDefault[]>((acc, instrumentClass) => {
                  const defaultBrokerAccountId =
                    routingDraft[instrumentClass] ?? "";
                  if (defaultBrokerAccountId) {
                    acc.push({ instrumentClass, defaultBrokerAccountId });
                  }
                  return acc;
                }, []);
                if (rows.length < 4) {
                  alert(
                    "Pick a default broker for stock, crypto, futures, and prediction markets.",
                  );
                  return;
                }
                await api.saveBrokerRoutingDefaults(rows);
                void refetchWorkspace();
              }}
              style={accentActionBtnStyle}
            >
              Save routing defaults
            </button>
          </Card>

          <Card>
            <SectionTitle>Broker allocation override</SectionTitle>
            <p
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginTop: 6,
                marginBottom: 12,
              }}
            >
              Optionally force all brokers to use the same over-allocation
              behavior.
            </p>
            {prefs && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--text2)",
                      marginBottom: 6,
                    }}
                  >
                    Override
                  </div>
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
                  style={saveOverrideBtnStyle}
                >
                  Save override
                </button>
              </>
            )}
          </Card>

          <Card>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text1)",
                  marginBottom: 3,
                }}
              >
                Web Search
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                AI-selected universe sessions require a dedicated search
                account. Brave and Tavily are supported today.
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text3)",
                  maxWidth: 360,
                  lineHeight: 1.5,
                }}
              >
                OpenRouter model accounts do not satisfy this requirement.
                DuckDuckGo is built in by default, and you can add Brave or
                Tavily if you want an API-backed override.
              </div>
              {searchProviders.length === 0 ? (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text3)",
                    fontWeight: 500,
                  }}
                >
                  None yet
                </span>
              ) : !hasTestedSearchProvider ? (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text3)",
                    fontWeight: 500,
                  }}
                >
                  Built-in default
                </span>
              ) : (
                <ConnBadge ok={status.search} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                  <div
                    key={p.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 9,
                      border: "1px solid var(--border)",
                      background: "var(--surface2)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div>
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
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text1)",
                            }}
                          >
                            {p.name}
                          </div>
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
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text3)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {providerTypeLabel(p.providerType)}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: statusColor,
                            marginTop: 4,
                            fontWeight: 600,
                          }}
                        >
                          {statusLabel}
                        </div>
                      </div>
                      {!isEditing ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          {!isBuiltIn ? (
                            <button
                              type="button"
                              onClick={() => beginEditProviderKey(p)}
                              style={{
                                fontSize: 12,
                                padding: "6px 10px",
                                borderRadius: 7,
                                border: "1px solid var(--border)",
                                background: "var(--surface)",
                                cursor: "pointer",
                                color: "var(--text2)",
                              }}
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
                            style={{
                              fontSize: 12,
                              padding: "6px 10px",
                              borderRadius: 7,
                              border: "1px solid var(--border)",
                              background: "var(--surface)",
                              cursor: "pointer",
                            }}
                          >
                            Test
                          </button>
                          {!isBuiltIn ? (
                            <button
                              type="button"
                              disabled={rowSavingId === p.id}
                              onClick={() => void deleteProvider(p)}
                              style={{
                                fontSize: 12,
                                padding: "6px 10px",
                                borderRadius: 7,
                                border: "1px solid var(--color-error-border)",
                                background: "var(--color-error-dim)",
                                cursor:
                                  rowSavingId === p.id ? "wait" : "pointer",
                                color: "var(--color-error)",
                              }}
                            >
                              {rowSavingId === p.id ? "Deleting…" : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div
                        style={{
                          marginTop: 12,
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <InputField
                          label="New API key"
                          hint="stored in OS keychain"
                          type="password"
                          value={editApiKey}
                          onChange={setEditApiKey}
                          placeholder="Paste key…"
                          mono
                        />
                        <div
                          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                        >
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            style={saveKeychainBtnStyle(rowSavingId === p.id)}
                          >
                            {rowSavingId === p.id
                              ? "Saving…"
                              : "Save to keychain"}
                          </button>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={cancelEditProviderKey}
                            style={{
                              fontSize: 12,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text2)",
                              cursor: "pointer",
                            }}
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
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--text2)",
                    marginBottom: 6,
                  }}
                >
                  Workspace default search provider
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
                style={saveSearchSettingsBtnStyle}
              >
                Save search settings
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              style={addProviderBtnStyle}
            >
              + Add search provider
            </button>
          </Card>

          <Card accent>
            <SectionTitle>Security Model</SectionTitle>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginTop: 16,
              }}
            >
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
                <div
                  key={k}
                  style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
                >
                  <span
                    style={{
                      color: "var(--color-success)",
                      fontSize: 13,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    ✓
                  </span>
                  <div>
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--text1)",
                        fontWeight: 500,
                      }}
                    >
                      {k}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>
                      {" "}
                      : {v}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <button
            type="button"
            onClick={() => void testAllConnections()}
            disabled={testing}
            style={testAllConnectionsBtnStyle}
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
    </PageShell>
  );
};

const inputFieldInputStyle = (mono?: boolean) =>
  ({
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "10px 14px",
    color: "var(--text1)",
    fontSize: 13,
    fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
    letterSpacing: mono ? "0.04em" : "normal",
    transition: "border-color 0.15s",
  }) as const;

const saveKeychainBtnStyle = (isSaving: boolean) =>
  ({
    fontSize: 12,
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "var(--accent)",
    color: "hsl(var(--primary-foreground))",
    fontWeight: 600,
    cursor: isSaving ? "wait" : "pointer",
    opacity: isSaving ? 0.85 : 1,
  }) as const;

const addProviderBtnStyle = {
  marginTop: 12,
  width: "100%",
  padding: "10px 14px",
  borderRadius: 9,
  border: "1px dashed var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 13,
  cursor: "pointer",
} as const;

const saveDefaultModelBtnStyle = (disabled: boolean) =>
  ({
    width: "100%",
    padding: "10px 14px",
    borderRadius: 9,
    border: "none",
    background: "var(--accent)",
    color: "hsl(var(--primary-foreground))",
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
  }) as const;

const brokerRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 9,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
} as const;

const accentActionBtnBase = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 9,
  border: "none",
  background: "var(--accent)",
  color: "hsl(var(--primary-foreground))",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
} as const;

const accentActionBtnStyle = {
  ...accentActionBtnBase,
  marginTop: 8,
} as const;

const saveOverrideBtnStyle = {
  ...accentActionBtnBase,
  marginTop: 12,
} as const;

const saveSearchSettingsBtnStyle = accentActionBtnBase;

const testAllConnectionsBtnStyle = {
  width: "100%",
  padding: "11px 20px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--text2)",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
  fontWeight: 500,
} as const;

const envToggleStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 6,
  padding: 5,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.34)",
  marginTop: 4,
} as const;

const envToggleButtonStyle = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  borderRadius: 7,
  padding: "7px 16px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
} as const;

const envTogglePaperActiveStyle = {
  background: "var(--color-warning-dim)",
  color: "var(--color-warning)",
  borderColor: "var(--color-warning-border)",
} as const;

const envToggleLiveActiveStyle = {
  background: "var(--color-success-dim)",
  color: "var(--color-success)",
  borderColor: "var(--color-success-border)",
} as const;
