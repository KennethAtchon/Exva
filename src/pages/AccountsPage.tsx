import { useEffect, useState } from "react";
import { Badge, Card, Dot, PageShell, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { AddAiProviderModal } from "@/components/accounts/AddAiProviderModal";
import { AddBrokerModal } from "@/components/accounts/AddBrokerModal";
import { api } from "@/lib/exva";
import type { BrokerAccount, BrokerRoutingDefault, InstrumentClass, ProviderAccount, WorkspacePreferences } from "@/lib/types";

function parseProviderAccountMetadata(json: string | null): { baseUrl?: string } {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as unknown;
    if (typeof v !== "object" || v === null) return {};
    const raw = (v as { baseUrl?: unknown }).baseUrl;
    return typeof raw === "string" && raw.trim().length > 0 ? { baseUrl: raw.trim() } : {};
  } catch {
    return {};
  }
}

function aiProviderTypeLabel(providerType: string): string {
  switch (providerType) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
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
  const [aiProviders, setAiProviders] = useState<ProviderAccount[]>([]);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ broker: boolean; ai: boolean }>({ broker: false, ai: false });
  const [brokers, setBrokers] = useState<BrokerAccount[]>([]);
  const [prefs, setPrefs] = useState<WorkspacePreferences | null>(null);
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [rowSavingId, setRowSavingId] = useState<string | null>(null);
  const [routingDraft, setRoutingDraft] = useState<Partial<Record<InstrumentClass, string>>>({});

  const loadWorkspaceAccounts = async () => {
    const [b, r, view] = await Promise.all([
      api.listBrokerAccounts(),
      api.getBrokerRoutingDefaults(),
      api.getWorkspaceView(),
    ]);
    setBrokers(b.brokers);
    setPrefs(view.preferences);
    const draft: Partial<Record<InstrumentClass, string>> = {};
    for (const row of r.routing) {
      draft[row.instrumentClass] = row.defaultBrokerAccountId;
    }
    setRoutingDraft(draft);
  };

  const loadAiProviders = async () => {
    const list = await api.listProviders();
    const next = list.providers.filter((p) => p.category === "ai");
    setAiProviders(next);
    setStatus((prev) => ({
      ...prev,
      ai: next.length > 0 && next.some((p) => p.lastTestStatus === "ok"),
    }));
  };

  useEffect(() => {
    void loadAiProviders();
    void loadWorkspaceAccounts();
  }, []);

  const testAllConnections = async () => {
    setTesting(true);
    try {
      const [provList, brokerResp] = await Promise.all([api.listProviders(), api.listBrokerAccounts()]);
      const aiList = provList.providers.filter((p) => p.category === "ai");
      let anyAiOk = false;
      for (const p of aiList) {
        const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
        if (r.ok) anyAiOk = true;
      }
      await loadAiProviders();

      let anyBrokerOk = false;
      for (const b of brokerResp.brokers) {
        const t = await api.testSavedBrokerAccount(b.id).catch(() => ({ ok: false as const }));
        if (t.ok) anyBrokerOk = true;
      }
      setStatus({ broker: anyBrokerOk, ai: anyAiOk });
    } catch {
      setStatus({ broker: false, ai: false });
    } finally {
      setTesting(false);
    }
  };

  const beginEditProviderKey = (p: ProviderAccount) => {
    setEditingProviderId(p.id);
    setEditApiKey("");
    setEditBaseUrl(parseProviderAccountMetadata(p.metadataJson).baseUrl ?? "");
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
        p.providerType === "openrouter" && editBaseUrl.trim().length > 0
          ? { baseUrl: editBaseUrl.trim() }
          : undefined;
      await api.saveProvider({
        id: p.id,
        name: p.name,
        category: "ai",
        providerType: p.providerType as ProviderAccount["providerType"],
        apiKey: trimmed,
        metadata,
      });
      await api.testProvider(p.id).catch(() => ({ ok: false }));
      await loadAiProviders();
      cancelEditProviderKey();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not save provider key.");
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
                          {aiProviderTypeLabel(p.providerType)}
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
                            onClick={async () => {
                              const r = await api.testProvider(p.id).catch(() => ({ ok: false as const }));
                              setStatus((s) => ({ ...s, ai: r.ok || s.ai }));
                              await loadAiProviders();
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
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Broker accounts</div>
                <div style={{ fontSize: 12, color: "var(--text3)" }}>Multi-broker routing — keys in OS keychain</div>
              </div>
              <ConnBadge ok={status.broker} />
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
                        await loadWorkspaceAccounts();
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
            {(["stock", "crypto", "futures"] as InstrumentClass[]).map((ic) => (
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
                const rows: BrokerRoutingDefault[] = (["stock", "crypto", "futures"] as InstrumentClass[])
                  .map((instrumentClass) => ({
                    instrumentClass,
                    defaultBrokerAccountId: routingDraft[instrumentClass] ?? "",
                  }))
                  .filter((r) => r.defaultBrokerAccountId.length > 0);
                if (rows.length < 3) {
                  alert("Pick a default broker for stock, crypto, and futures.");
                  return;
                }
                await api.saveBrokerRoutingDefaults(rows);
                await loadWorkspaceAccounts();
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
            <SectionTitle>Capital allocation</SectionTitle>
            <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 6, marginBottom: 12 }}>
              Shared pool mode reserves capital across sessions (see Phase 8 spec).
            </p>
            {prefs && (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)", marginBottom: 6 }}>Mode</div>
                  <ShadcnSelect
                    value={prefs.capitalAllocationMode}
                    onValueChange={(value) =>
                      setPrefs((current) =>
                        current
                          ? {
                              ...current,
                              capitalAllocationMode: value as WorkspacePreferences["capitalAllocationMode"],
                            }
                          : current,
                      )
                    }
                    className="w-full"
                    options={[
                      { value: "per_session_only", label: "Per-session only" },
                      { value: "shared_global_pool", label: "Shared global pool" },
                    ]}
                  />
                </div>
                {prefs.capitalAllocationMode === "shared_global_pool" && (
                  <InputField
                    label="Global pool (USD)"
                    type="number"
                    value={String(prefs.globalCapitalPoolUsd ?? "")}
                    onChange={(v) =>
                      setPrefs((p) =>
                        p ? { ...p, globalCapitalPoolUsd: v === "" ? null : Number(v) } : p,
                      )
                    }
                    placeholder="100000"
                  />
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!prefs) return;
                    await api.patchWorkspacePreferences({
                      capitalAllocationMode: prefs.capitalAllocationMode,
                      globalCapitalPoolUsd: prefs.globalCapitalPoolUsd,
                    });
                    const view = await api.getWorkspaceView();
                    setPrefs(view.preferences);
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
                  Save capital settings
                </button>
              </>
            )}
          </Card>

          <Card>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text1)", marginBottom: 3 }}>Web Search</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                Researcher agents use this to fetch live news and market data
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["Brave", "Tavily"].map((p) => (
                <div
                  key={p}
                  style={{
                    flex: 1, padding: "14px 16px",
                    background: "var(--surface2)", border: "1px solid var(--border)",
                    borderRadius: 10, display: "flex",
                    justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 500 }}>{p}</span>
                  <Badge variant="default" size="sm">configure</Badge>
                </div>
              ))}
            </div>
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
        onSaved={loadWorkspaceAccounts}
      />
      <AddAiProviderModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onSaved={loadAiProviders}
      />
    </PageShell>
  );
};
