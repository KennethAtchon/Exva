import { useEffect, type ReactNode } from "react";
import { Card, PageShell, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { AiRoleConfigCard } from "@/components/strategy/AiRoleConfigCard";
import { CostSummaryCard } from "@/components/strategy/CostSummaryCard";
import { TimeframeHorizonCard } from "@/components/strategy/TimeframeHorizonCard";
import { api } from "@/lib/exva";
import { useSessionStore } from "@/store/sessionStore";
import { useStrategyStore } from "@/store/strategyStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

export const StrategyConfig = () => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);
  const sessionStatus = useSessionStore((state) => state.status);
  const setSessionStatus = useSessionStore((state) => state.setStatus);

  const strategy = useStrategyStore((state) => state.strategy);
  const aiRoles = useStrategyStore((state) => state.aiRoles);
  const providers = useStrategyStore((state) => state.providers);
  const selectionMode = useStrategyStore((state) => state.selectionMode);
  const selectorSettings = useStrategyStore((state) => state.selectorSettings);
  const dirtyFields = useStrategyStore((state) => state.dirtyFields);
  const activeRoleTab = useStrategyStore((state) => state.activeRoleTab);
  const providerModels = useStrategyStore((state) => state.providerModels);
  const isSaving = useStrategyStore((state) => state.isSaving);
  const pageState = useStrategyStore((state) => state.state);
  const roleErrors = useStrategyStore((state) => state.roleErrors);
  const strategyErrors = useStrategyStore((state) => state.strategyErrors);
  const loadStrategy = useStrategyStore((state) => state.loadStrategy);
  const updateStrategy = useStrategyStore((state) => state.updateStrategy);
  const updateRole = useStrategyStore((state) => state.updateRole);
  const saveAll = useStrategyStore((state) => state.saveAll);
  const resetRole = useStrategyStore((state) => state.resetRole);
  const setActiveTab = useStrategyStore((state) => state.setActiveTab);

  useEffect(() => {
    if (viewMode !== "session" || !focusedSessionId) return;
    void loadStrategy(focusedSessionId);
  }, [focusedSessionId, loadStrategy, viewMode]);

  const currentRole = aiRoles[activeRoleTab];

  if (viewMode === "global" || !focusedSessionId) {
    return (
      <PageShell>
        <Header loadWorkspaceView={loadWorkspaceView} setViewMode={setViewMode} />
        <Card>
          <SectionTitle>No Focused Session</SectionTitle>
          <p style={{ color: "var(--text3)", fontSize: 13, marginTop: 12 }}>
            Choose a session to configure its strategy and AI role behavior.
          </p>
        </Card>
      </PageShell>
    );
  }

  if (!strategy) {
    return <PageShell><div style={{ color: "var(--text3)" }}>Loading strategy…</div></PageShell>;
  }

  const isLocked = pageState === "locked";
  const hasDirty = dirtyFields.size > 0;
  const roleProviderSummary = Object.values(aiRoles).map((role) => ({
    role: role.role,
    providerLabel: providers.find((provider) => provider.id === role.providerKey)?.name ?? "Unassigned",
    modelId: role.modelId,
  }));

  return (
    <PageShell>
      <Header loadWorkspaceView={loadWorkspaceView} setViewMode={setViewMode} />

      {strategyErrors.length > 0 && (
        <div style={{ ...warningStyle, marginBottom: 12, borderColor: "rgba(248,113,113,0.28)", color: "#fca5a5" }}>
          {strategyErrors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}

      {isLocked && (
        <div style={warningStyle}>
          <div>Stop this session before editing its strategy or AI configuration.</div>
          <button
            onClick={async () => {
              const next = await api.stopSession();
              setSessionStatus(next);
              await loadStrategy(focusedSessionId);
            }}
            style={warningButtonStyle}
          >
            Stop Session
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "var(--text1)" }}>Strategy</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text3)" }}>
            Trading rules and per-role AI configuration for the focused session.
          </p>
        </div>
        <button
          onClick={() => void saveAll(focusedSessionId)}
          disabled={!hasDirty || isSaving || isLocked}
          style={{
            padding: "9px 18px",
            borderRadius: 9,
            border: "none",
            background: !hasDirty || isLocked ? "var(--surface3)" : "var(--accent)",
            color: !hasDirty || isLocked ? "var(--text3)" : "#fff",
            cursor: !hasDirty || isLocked ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {isSaving ? "Saving…" : "Save Changes"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <SectionTitle>Trading Rules</SectionTitle>
            <div style={formGridStyle}>
              <Field label="Strategy Profile">
                <ShadcnSelect
                  value={strategy.strategyProfile}
                  onValueChange={(value) => updateStrategy({ strategyProfile: value as typeof strategy.strategyProfile })}
                  disabled={isLocked}
                  options={[
                    { value: "passive_income", label: "Passive Income" },
                    { value: "growth", label: "Growth" },
                    { value: "conservative", label: "Conservative" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
              </Field>
              <Field label="Research Depth">
                <ShadcnSelect
                  value={strategy.researchDepth}
                  onValueChange={(value) => updateStrategy({ researchDepth: value as typeof strategy.researchDepth })}
                  disabled={isLocked}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "balanced", label: "Balanced" },
                    { value: "deep", label: "Deep" },
                  ]}
                />
              </Field>
              <Field label="Max Position USD">
                <input type="number" value={strategy.maxPositionUsd} onChange={(event) => updateStrategy({ maxPositionUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Max Concurrent Trades">
                <input type="number" value={strategy.maxConcurrentTrades} onChange={(event) => updateStrategy({ maxConcurrentTrades: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Stop Loss %">
                <input type="number" step="0.1" value={strategy.stopLossPct} onChange={(event) => updateStrategy({ stopLossPct: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Take Profit %">
                <input type="number" step="0.1" value={strategy.takeProfitPct} onChange={(event) => updateStrategy({ takeProfitPct: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Daily Loss Limit USD">
                <input type="number" value={strategy.dailyLossLimitUsd} onChange={(event) => updateStrategy({ dailyLossLimitUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Profit Target USD">
                <input type="number" value={strategy.profitTargetUsd} onChange={(event) => updateStrategy({ profitTargetUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <Field label="Max AI Spend USD / Day">
                <input type="number" step="0.5" value={strategy.maxAiSpendUsd} onChange={(event) => updateStrategy({ maxAiSpendUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
              </Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text2)", fontSize: 13 }}>
                <input type="checkbox" checked={strategy.humanApprovalRequired} onChange={(event) => updateStrategy({ humanApprovalRequired: event.target.checked })} disabled={isLocked} />
                Human Approval Required
              </label>
            </div>
          </Card>
          <TimeframeHorizonCard strategy={strategy} disabled={isLocked} onChange={updateStrategy} />
          <CostSummaryCard strategy={strategy} roleProviders={roleProviderSummary} />
          <Card>
            <SectionTitle>Prompt assets</SectionTitle>
            <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
              Bundled Markdown for the active role tab. When <strong>prompt source</strong> is Default, the editor shows this file. Phase 7 can add richer versioning; for now the first line of the prompt text is treated as a title if it starts with <code>#</code>.
            </p>
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--text2)" }}>
              <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: 4 }}>Bundled file path</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, wordBreak: "break-all" }}>
                {currentRole.promptAssetPath ?? "—"}
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text2)" }}>
              <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: 4 }}>Header / version hint</div>
              <div>{promptHeaderSummary(currentRole.promptMarkdown)}</div>
            </div>
          </Card>
        </div>

        <AiRoleConfigCard
          activeRole={activeRoleTab}
          role={currentRole}
          providers={providers}
          models={providerModels[currentRole.providerKey] ?? []}
          selectionMode={selectionMode}
          aiPickerEnabled={selectorSettings?.aiPickerEnabled ?? true}
          disabled={isLocked}
          errors={roleErrors[activeRoleTab]}
          roleErrors={roleErrors}
          onTabChange={setActiveTab}
          onRoleChange={async (patch) => {
            if (patch.promptSource === "default" && currentRole.promptSource === "session_override") {
              const confirmed = window.confirm("Discard your custom prompt for this role?");
              if (!confirmed) return;
              await resetRole(currentRole.role);
              return;
            }
            await updateRole(currentRole.role, patch);
          }}
          onResetPrompt={async () => {
            const confirmed = window.confirm("Discard your custom prompt for this role?");
            if (!confirmed) return;
            await resetRole(currentRole.role);
          }}
        />
      </div>
    </PageShell>
  );
};

const Header = ({
  loadWorkspaceView,
  setViewMode,
}: {
  loadWorkspaceView: () => Promise<void>;
  setViewMode: (mode: "session" | "global", focusedSessionId?: string | null) => void;
}) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div />
    <WorkspaceContextChip
      onSwitchSession={async (id) => {
        await api.focusSession(id);
        await loadWorkspaceView();
      }}
      onGoGlobal={async () => {
        await api.goGlobal();
        setViewMode("global", null);
      }}
    />
  </div>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    {children}
  </div>
);

const formGridStyle = { display: "grid", gap: 14, marginTop: 16 } as const;
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const warningStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(251,191,36,0.24)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12 } as const;
const warningButtonStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.28)", background: "rgba(251,191,36,0.14)", color: "#fbbf24", cursor: "pointer" } as const;

function promptHeaderSummary(markdown: string): string {
  const first = markdown.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("#")) return first.replace(/^#+\s*/, "");
  return "No markdown heading on first line";
}
