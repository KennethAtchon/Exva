import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isBuiltInSearchProviderAccount, parseProviderMetadata } from "@electron/shared/catalog/search-providers";
import { Badge, Card, Dot, PageShell, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { ProviderModelPicker } from "@/components/strategy/ProviderModelPicker";
import { AddAiProviderModal } from "@/components/accounts/AddAiProviderModal";
import { AddSearchProviderModal } from "@/components/accounts/AddSearchProviderModal";
import { AddBrokerModal } from "@/components/accounts/AddBrokerModal";
import { api, type ProviderModelEntry } from "@/lib/exva";
import type { BrokerRoutingDefault, InstrumentClass, ProviderAccount, WorkspacePreferences } from "@/lib/types";

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
  label, hint, type = "text", value, onChange, placeholder, mono,
}: {
  label: string; hint?: string; type?: string;
  value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text2)" }}>{label}</label>
      {hint && <span style={{ fontSize: 11, color: "var(--text3)" }}>{hint}</span>}
    </div>
    <input
      type={type} value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        borderRadius: 9, padding: "10px 14px",
        color: "var(--text1)", fontSize: 13, outline: "none",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        letterSpacing: mono ? "0.04em" : "normal",
        transition: "border-color 0.15s",
      }}
    />
  </div>
);

const ConnBadge = ({ ok }: { ok: boolean }) => (
  <div
    style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 11px", borderRadius: 20,
      background: ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
      border: `1px solid ${ok ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
    }}
  >
    <Dot color={ok ? "#34d399" : "#f87171"} size={6} />
    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: ok ? "#34d399" : "#f87171", fontWeight: 600 }}>
      {ok ? "Connected" : "Error"}
    </span>
  </div>
);

export const AccountsPage = () => {
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ broker: boolean; ai: boolean; search: boolean }>({ broker: false, ai: false, search: false });
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [routingDraft, setRoutingDraft] = useState<Partial<Record<InstrumentClass, string>>>({});
  const [prefsDraft, setPrefsDraft] = useState<WorkspacePreferences | null>(null);
  const [defaultModelProviderKey, setDefaultModelProviderKey] = useState("");
  const [defaultModelModelId, setDefaultModelModelId] = useState("");
  const [defaultModelModels, setDefaultModelModels] = useState<ProviderModelEntry[]>([]);
  const [defaultModelModelsLoading, setDefaultModelModelsLoading] = useState(false);
  const [savingDefaultModel, setSavingDefaultModel] = useState(false);
  const [savedDefaultModel, setSavedDefaultModel] = useState(false);

  const { data: providersData, refetch: refetchProviders } = useQuery({
    queryKey: ["accounts-providers"],
    queryFn: () => api.listProviders(),
  });
  const { data: workspaceData, refetch: refetchWorkspace } = useQuery({
    queryKey: ["accounts-workspace"],
    queryFn: async () => {
      const [b, r, view] = await Promise.all([
        api.listBrokerAccounts(),
        api.getBrokerRoutingDefaults(),
        api.getWorkspaceView(),
      ]);
      return { brokers: b.brokers, routing: r.routing, prefs: view.preferences };
    },
  });

  const aiProviders = providersData?.providers.filter((p) => p.category === "ai") ?? [];
  const searchProviders = providersData?.providers.filter((p) => p.category === "search") ?? [];
  const brokers = workspaceData?.brokers ?? [];
  const prefs = workspaceData?.prefs ?? null;
  const hasTestedSearchProvider = searchProviders.some((provider) => provider.lastTestStatus !== "unknown");

  // Sync connection status from latest provider data
  useEffect(() => {
    if (!providersData) return;
    setStatus((prev) => ({
      ...prev,
      ai: aiProviders.length > 0 && aiProviders.some((p) => p.lastTestStatus === "ok"),
      search: searchProviders.length > 0 && searchProviders.some((p) => p.lastTestStatus === "ok"),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providersData]);

  // Sync editable form state from workspace data
  useEffect(() => {
    if (!workspaceData) return;
    const provKey = workspaceData.prefs.defaultModelProviderKey ?? "";
    const modId = workspaceData.prefs.defaultModelModelId ?? "";
    setDefaultModelProviderKey(provKey);
    setDefaultModelModelId(modId);
    if (provKey) {
      api.getStrategyProviderModels(provKey).then((r) => setDefaultModelModels(r.models)).catch(() => {});
    }
    const draft: Partial<Record<InstrumentClass, string>> = {};
    for (const row of workspaceData.routing) {
      draft[row.instrumentClass] = row.defaultBrokerAccountId;
    }
    setRoutingDraft(draft);
    setPrefsDraft(workspaceData.prefs);
  }, [workspaceData]);

  const testAllConnections = async () => {
    setTesting(true);
    try {
      const [provList, brokerResp] = await Promise.all([api.listProviders(), api.listBrokerAccounts()]);
      const aiList = provList.providers.filter((p) => p.category === "ai");
      const searchList = provList.providers.filter((p) => p.category === "search");
      let anyAiOk = false;
      let anySearchOk = false;
      for (const p of aiList) {
        const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
        if (r.ok) anyAiOk = true;
      }
      for (const p of searchList) {
        const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
        if (r.ok) anySearchOk = true;
      }
      void refetchProviders();

      let anyBrokerOk = false;
      for (const b of brokerResp.brokers) {
        const t = await api.testSavedBrokerAccount(b.id).catch(() => ({ ok: false as const }));
        if (t.ok) anyBrokerOk = true;
      }
      setStatus({ broker: anyBrokerOk, ai: anyAiOk, search: anySearchOk });
    } catch {
      setStatus({ broker: false, ai: false, search: false });
    } finally {
      setTesting(false);
    }
  };

  const beginEditProviderKey = (p: ProviderAccount) => {
    setEditingProviderId(p.id);
    setEditApiKey("");
    const metadata = parseProviderMetadata(p.metadataJson);
    setEditBaseUrl(metadata.baseUrl ?? "");
  };

  const cancelEditProviderKey = () => {
    setEditingProviderId(null);
    setEditApiKey("");
    setEditBaseUrl("");
  };

  const saveEditedProviderKey = async (p: ProviderAccount) => {
    const trimmed = editApiKey.trim();
    if (!trimmed) return;
    setRowSavingId(p.id);
    try {
      const metadata =
        p.providerType === "openrouter"
          ? (editBaseUrl.trim().length > 0 ? { baseUrl: editBaseUrl.trim() } : undefined)
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
    const ok = window.confirm(`Delete provider "${p.name}"? This removes the stored key from keychain.`);
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
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text1)", margin: 0 }}>Accounts</h1>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>
          API keys stored in OS keychain — never written to disk or logs
        </p>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>AI providers</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  Add keys for each vendor; assign provider and model per role on Strategy
                </div>
              </div>
              {aiProviders.length === 0 ? (
                <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>None yet</span>
              ) : (
                <ConnBadge ok={status.ai} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {aiProviders.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>
                  No AI accounts yet. Add Anthropic, OpenAI, or OpenRouter (you can configure more than one).
                </div>
              )}
              {aiProviders.map((p) => {
                const statusColor =
                  p.lastTestStatus === "ok" ? "#34d399" : p.lastTestStatus === "error" ? "#f87171" : "var(--text3)";
                const statusLabel =
                  p.lastTestStatus === "ok" ? "OK" : p.lastTestStatus === "error" ? "Error" : "Untested";
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
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                          {providerTypeLabel(p.providerType)}
                        </div>
                        <div style={{ fontSize: 11, color: statusColor, marginTop: 4, fontWeight: 600 }}>{statusLabel}</div>
                      </div>
                      {!isEditing ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => beginEditProviderKey(p)}
                            style={{
                              fontSize: 11,
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
                              const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
                              setStatus((s) => ({ ...s, ai: r.ok || s.ai }));
                              void refetchProviders();
                            }}
                            style={{
                              fontSize: 11,
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
                              fontSize: 11,
                              padding: "6px 10px",
                              borderRadius: 7,
                              border: "1px solid rgba(248,113,113,0.35)",
                              background: "rgba(248,113,113,0.08)",
                              cursor: rowSavingId === p.id ? "wait" : "pointer",
                              color: "#fca5a5",
                            }}
                          >
                            {rowSavingId === p.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
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
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            style={{
                              fontSize: 12,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "var(--accent)",
                              color: "#fff",
                              fontWeight: 600,
                              cursor: rowSavingId === p.id ? "wait" : "pointer",
                              opacity: rowSavingId === p.id ? 0.85 : 1,
                            }}
                          >
                            {rowSavingId === p.id ? "Saving…" : "Save to keychain"}
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
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 9,
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--text2)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              + Add AI provider
            </button>
          </Card>

          <Card>
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)" }}>Workspace default AI model</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>
                Auto-fills all AI phases on new sessions. Set once here, never configure per-session.
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
              <button
                type="button"
                disabled={savingDefaultModel || !defaultModelProviderKey || !defaultModelModelId}
                onClick={async () => {
                  setSavingDefaultModel(true);
                  try {
                    await api.saveWorkspaceDefaultModel({
                      providerKey: defaultModelProviderKey,
                      modelId: defaultModelModelId,
                    });
                    void refetchWorkspace();
                    setSavedDefaultModel(true);
                    setTimeout(() => setSavedDefaultModel(false), 2500);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "Could not save default model.");
                  } finally {
                    setSavingDefaultModel(false);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 9,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: savingDefaultModel || !defaultModelProviderKey || !defaultModelModelId ? "not-allowed" : "pointer",
                  opacity: savingDefaultModel || !defaultModelProviderKey || !defaultModelModelId ? 0.7 : 1,
                }}
              >
                {savingDefaultModel ? "Saving..." : savedDefaultModel ? "Saved ✓" : "Save default model"}
              </button>
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Broker accounts</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Multi-broker routing — keys in OS keychain</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {brokers.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text3)" }}>No broker accounts yet. Add one to enable trading.</div>
              )}
              {brokers.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: "1px solid var(--border)",
                    background: "var(--surface2)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                      {b.brokerType} · {b.mode} · {b.supportedInstrumentClasses.join(", ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await api.testSavedBrokerAccount(b.id);
                        setStatus((s) => ({ ...s, broker: r.ok }));
                      }}
                      style={{ fontSize: 11, padding: "6px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Remove broker “${b.name}”? Routing rows that reference it will be deleted.`)) return;
                        await api.deleteBrokerAccount(b.id);
                        void refetchWorkspace();
                      }}
                      style={{ fontSize: 11, padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(248,113,113,0.35)", color: "#f87171", background: "transparent", cursor: "pointer" }}
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
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 9,
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--text2)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              + Add broker account
            </button>
          </Card>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <SectionTitle>Workspace routing defaults</SectionTitle>
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, marginBottom: 12 }}>
              Per-class default broker (session overrides live on the Strategy / session editor).
            </p>
            {(["stock", "crypto", "futures", "prediction_market"] as InstrumentClass[]).map((ic) => (
              <div key={ic} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 }}>{ic}</div>
                <ShadcnSelect
                  value={routingDraft[ic] ?? ""}
                  onValueChange={(value) => setRoutingDraft((d) => ({ ...d, [ic]: value }))}
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
                const rows: BrokerRoutingDefault[] = (["stock", "crypto", "futures", "prediction_market"] as InstrumentClass[])
                  .map((instrumentClass) => ({
                    instrumentClass,
                    defaultBrokerAccountId: routingDraft[instrumentClass] ?? "",
                  }))
                  .filter((r) => r.defaultBrokerAccountId.length > 0);
                if (rows.length < 4) {
                  alert("Pick a default broker for stock, crypto, futures, and prediction markets.");
                  return;
                }
                await api.saveBrokerRoutingDefaults(rows);
                void refetchWorkspace();
              }}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 9,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Save routing defaults
            </button>
          </Card>

          <Card>
            <SectionTitle>Broker allocation override</SectionTitle>
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, marginBottom: 12 }}>
              Optionally force all brokers to use the same over-allocation behavior.
            </p>
            {prefs && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 }}>Override</div>
                  <ShadcnSelect
                    value={prefsDraft?.allocationEnforcementOverride ?? ""}
                    onValueChange={(value) =>
                      setPrefsDraft((current) =>
                        current
                          ? {
                              ...current,
                              allocationEnforcementOverride:
                                value === "" ? null : (value as WorkspacePreferences["allocationEnforcementOverride"]),
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
                      allocationEnforcementOverride: prefsDraft.allocationEnforcementOverride,
                    });
                    void refetchWorkspace();
                  }}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 9,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Save override
                </button>
              </>
            )}
          </Card>

          <Card>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Web Search</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                AI-selected universe sessions require a dedicated search account. Brave and Tavily are supported today.
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "var(--text3)", maxWidth: 360, lineHeight: 1.5 }}>
                OpenRouter model accounts do not satisfy this requirement. DuckDuckGo is built in by default, and you can add Brave or Tavily if you want an API-backed override.
              </div>
              {searchProviders.length === 0 ? (
                <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>None yet</span>
              ) : !hasTestedSearchProvider ? (
                <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>Built-in default</span>
              ) : (
                <ConnBadge ok={status.search} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {searchProviders.map((p) => {
                const isBuiltIn = isBuiltInSearchProviderAccount(p);
                const statusColor =
                  p.lastTestStatus === "ok" ? "#34d399" : p.lastTestStatus === "error" ? "#f87171" : "var(--text3)";
                const statusLabel =
                  p.lastTestStatus === "ok" ? "OK" : p.lastTestStatus === "error" ? "Error" : "Untested";
                const isEditing = editingProviderId === p.id;
                const isWorkspaceDefault = prefs?.defaultSearchProviderId === p.id;
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
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text1)" }}>{p.name}</div>
                            {isWorkspaceDefault ? <Badge variant="blue" size="sm">workspace default</Badge> : null}
                            {isBuiltIn ? <Badge variant="default" size="sm">built-in</Badge> : null}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
                            {providerTypeLabel(p.providerType)}
                          </div>
                          <div style={{ fontSize: 11, color: statusColor, marginTop: 4, fontWeight: 600 }}>{statusLabel}</div>
                        </div>
                      {!isEditing ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                          {!isBuiltIn ? (
                            <button
                              type="button"
                              onClick={() => beginEditProviderKey(p)}
                              style={{
                                fontSize: 11,
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
                              const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
                              setStatus((s) => ({ ...s, search: r.ok || s.search }));
                              void refetchProviders();
                            }}
                            style={{
                              fontSize: 11,
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
                                fontSize: 11,
                                padding: "6px 10px",
                                borderRadius: 7,
                                border: "1px solid rgba(248,113,113,0.35)",
                                background: "rgba(248,113,113,0.08)",
                                cursor: rowSavingId === p.id ? "wait" : "pointer",
                                color: "#fca5a5",
                              }}
                            >
                              {rowSavingId === p.id ? "Deleting…" : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {isEditing ? (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        <InputField
                          label="New API key"
                          hint="stored in OS keychain"
                          type="password"
                          value={editApiKey}
                          onChange={setEditApiKey}
                          placeholder="Paste key…"
                          mono
                        />
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            disabled={rowSavingId === p.id}
                            onClick={() => void saveEditedProviderKey(p)}
                            style={{
                              fontSize: 12,
                              padding: "8px 12px",
                              borderRadius: 8,
                              border: "none",
                              background: "var(--accent)",
                              color: "#fff",
                              fontWeight: 600,
                              cursor: rowSavingId === p.id ? "wait" : "pointer",
                              opacity: rowSavingId === p.id ? 0.85 : 1,
                            }}
                          >
                            {rowSavingId === p.id ? "Saving…" : "Save to keychain"}
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
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 }}>Workspace default search provider</div>
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
                    ...searchProviders.map((provider) => ({ value: provider.id, label: provider.name })),
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!prefsDraft) return;
                  await api.patchWorkspacePreferences({ defaultSearchProviderId: prefsDraft.defaultSearchProviderId });
                  void refetchWorkspace();
                }}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 9,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Save search settings
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              style={{
                marginTop: 12,
                width: "100%",
                padding: "10px 14px",
                borderRadius: 9,
                border: "1px dashed var(--border)",
                background: "transparent",
                color: "var(--text2)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              + Add search provider
            </button>
          </Card>

          <Card accent>
            <SectionTitle>Security Model</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              {(
                [
                  ["OS Keychain", "Secrets stored in system keychain, never SQLite"],
                  ["In-memory only", "Keys retrieved at call time, not held in process"],
                  ["Never logged", "Log macros only reference IDs — no key values"],
                  ["No cloud sync", "Local-only app — no data leaves this device"],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ color: "#34d399", fontSize: 13, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <div>
                    <span style={{ fontSize: 13, color: "var(--text1)", fontWeight: 500 }}>{k}</span>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}> — {v}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <button
            type="button"
            onClick={() => void testAllConnections()}
            disabled={testing}
            style={{
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
            }}
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
