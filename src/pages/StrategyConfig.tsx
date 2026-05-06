import { useEffect, type ReactNode } from "react";
import { Card, PageShell, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { Switch } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { AiRoleConfigCard } from "@/components/strategy/AiRoleConfigCard";
import { CostSummaryCard } from "@/components/strategy/CostSummaryCard";
import { TimeframeHorizonCard } from "@/components/strategy/TimeframeHorizonCard";
import { api } from "@/lib/exva";
import { useSessionStore } from "@/store/sessionStore";
import { useStrategyStore } from "@/store/strategyStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  buildStrategyBriefMarkdown,
  STOP_LOSS_TYPES,
  STRATEGY_ENTRY_STYLES,
  STRATEGY_EXIT_STYLES,
  STRATEGY_SCALING_MODES,
  STRATEGY_SIDE_BIASES,
  STRATEGY_TYPES,
} from "../../electron/shared/domain";

export const StrategyConfig = () => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);
  const setSessionStatus = useSessionStore((state) => state.setStatus);

  const profile = useStrategyStore((state) => state.profile);
  const riskConfig = useStrategyStore((state) => state.riskConfig);
  const timeframe = useStrategyStore((state) => state.timeframe);
  const aiRoles = useStrategyStore((state) => state.aiRoles);
  const providers = useStrategyStore((state) => state.providers);
  const selectionMode = useStrategyStore((state) => state.selectionMode);
  const selectorSettings = useStrategyStore((state) => state.selectorSettings);
  const dirtyFields = useStrategyStore((state) => state.dirtyFields);
  const activeRoleTab = useStrategyStore((state) => state.activeRoleTab);
  const activeSection = useStrategyStore((state) => state.activeSection);
  const providerModels = useStrategyStore((state) => state.providerModels);
  const isSaving = useStrategyStore((state) => state.isSaving);
  const pageState = useStrategyStore((state) => state.state);
  const roleErrors = useStrategyStore((state) => state.roleErrors);
  const strategyErrors = useStrategyStore((state) => state.strategyErrors);
  const loadStrategy = useStrategyStore((state) => state.loadStrategy);
  const updateProfile = useStrategyStore((state) => state.updateProfile);
  const updateRiskConfig = useStrategyStore((state) => state.updateRiskConfig);
  const updateTimeframe = useStrategyStore((state) => state.updateTimeframe);
  const updateRole = useStrategyStore((state) => state.updateRole);
  const saveAll = useStrategyStore((state) => state.saveAll);
  const resetRole = useStrategyStore((state) => state.resetRole);
  const setActiveTab = useStrategyStore((state) => state.setActiveTab);
  const setActiveSection = useStrategyStore((state) => state.setActiveSection);

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

  if (!profile || !riskConfig || !timeframe) {
    return <PageShell><div style={{ color: "var(--text3)" }}>Loading strategy...</div></PageShell>;
  }

  const isLocked = pageState === "locked";
  const hasDirty = dirtyFields.size > 0;
  const strategyContext = { profile, riskConfig, timeframe };
  const briefPreview = buildStrategyBriefMarkdown(strategyContext);
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
            Separate strategy intent, risk limits, timeframe rules, and AI role behavior for the focused session.
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
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div style={tabRowStyle}>
        {[
          ["strategy", "Strategy"],
          ["risk", "Risk"],
          ["timeframe", "Timeframe"],
          ["ai_roles", "AI Roles"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setActiveSection(value as "strategy" | "risk" | "timeframe" | "ai_roles")}
            style={activeSection === value ? activeTabStyle : inactiveTabStyle}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {activeSection === "strategy" && (
            <>
              <Card>
                <SectionTitle>Strategy Intent</SectionTitle>
                <div style={formGridStyle}>
                  <Field label="Strategy type">
                    <ShadcnSelect
                      value={profile.strategyType}
                      onValueChange={(value) => updateProfile({ strategyType: value as typeof profile.strategyType })}
                      disabled={isLocked}
                      options={STRATEGY_TYPES.map((value) => ({ value, label: labelize(value) }))}
                    />
                  </Field>
                  <Field label="Side bias">
                    <ShadcnSelect
                      value={profile.sideBias}
                      onValueChange={(value) => updateProfile({ sideBias: value as typeof profile.sideBias })}
                      disabled={isLocked}
                      options={STRATEGY_SIDE_BIASES.map((value) => ({ value, label: labelize(value) }))}
                    />
                  </Field>
                  <Field label="Entry style">
                    <ShadcnSelect
                      value={profile.entryStyle}
                      onValueChange={(value) => updateProfile({ entryStyle: value as typeof profile.entryStyle })}
                      disabled={isLocked}
                      options={STRATEGY_ENTRY_STYLES.map((value) => ({ value, label: labelize(value) }))}
                    />
                  </Field>
                  <Field label="Exit style">
                    <ShadcnSelect
                      value={profile.exitStyle}
                      onValueChange={(value) => updateProfile({ exitStyle: value as typeof profile.exitStyle })}
                      disabled={isLocked}
                      options={STRATEGY_EXIT_STYLES.map((value) => ({ value, label: labelize(value) }))}
                    />
                  </Field>
                  <Field label="Scaling mode">
                    <ShadcnSelect
                      value={profile.scalingMode}
                      onValueChange={(value) => updateProfile({ scalingMode: value as typeof profile.scalingMode })}
                      disabled={isLocked}
                      options={STRATEGY_SCALING_MODES.map((value) => ({ value, label: labelize(value) }))}
                    />
                  </Field>
                  <Field label="Custom instructions">
                    <textarea
                      value={profile.customInstructions}
                      onChange={(event) => updateProfile({ customInstructions: event.target.value })}
                      disabled={isLocked}
                      rows={6}
                      placeholder="Add any special entry filters, invalidation rules, or broker-specific instructions."
                      style={{ ...inputStyle, resize: "vertical", minHeight: 128 }}
                    />
                  </Field>
                </div>
              </Card>

              <Card>
                <SectionTitle>Live Strategy Brief</SectionTitle>
                <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
                  This is the canonical brief saved into the strategy profile and injected into every agent run.
                </p>
                <pre style={briefStyle}>{briefPreview}</pre>
              </Card>
            </>
          )}

          {activeSection === "risk" && (
            <Card>
              <SectionTitle>Risk Controls</SectionTitle>
              <div style={formGridStyle}>
                <Field label="Max position USD">
                  <input type="number" value={riskConfig.maxPositionUsd} onChange={(event) => updateRiskConfig({ maxPositionUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Max concurrent trades">
                  <input type="number" value={riskConfig.maxConcurrentTrades} onChange={(event) => updateRiskConfig({ maxConcurrentTrades: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Stop loss type">
                  <ShadcnSelect
                    value={riskConfig.stopLossType}
                    onValueChange={(value) => updateRiskConfig({ stopLossType: value as typeof riskConfig.stopLossType })}
                    disabled={isLocked}
                    options={STOP_LOSS_TYPES.map((value) => ({ value, label: labelize(value) }))}
                  />
                </Field>
                <Field label="Stop loss %">
                  <input type="number" step="0.1" value={riskConfig.stopLossPct ?? ""} onChange={(event) => updateRiskConfig({ stopLossPct: event.target.value === "" ? null : Number(event.target.value) })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Take profit %">
                  <input type="number" step="0.1" value={riskConfig.takeProfitPct ?? ""} onChange={(event) => updateRiskConfig({ takeProfitPct: event.target.value === "" ? null : Number(event.target.value) })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="ATR stop multiplier">
                  <input type="number" step="0.1" value={riskConfig.atrStopMultiplier ?? ""} onChange={(event) => updateRiskConfig({ atrStopMultiplier: event.target.value === "" ? null : Number(event.target.value) })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Kelly fraction">
                  <input type="number" step="0.05" value={riskConfig.kellyFraction} onChange={(event) => updateRiskConfig({ kellyFraction: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Prediction edge threshold">
                  <input type="number" step="0.01" value={riskConfig.predictionEdgeThreshold} onChange={(event) => updateRiskConfig({ predictionEdgeThreshold: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Max exposure USD">
                  <input type="number" value={riskConfig.maxExposureUsd ?? ""} onChange={(event) => updateRiskConfig({ maxExposureUsd: event.target.value === "" ? null : Number(event.target.value) })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Wait-for-open threshold">
                  <input type="number" step="0.01" value={riskConfig.waitForOpenThreshold} onChange={(event) => updateRiskConfig({ waitForOpenThreshold: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Daily loss limit USD">
                  <input type="number" value={riskConfig.dailyLossLimitUsd} onChange={(event) => updateRiskConfig({ dailyLossLimitUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Profit target USD">
                  <input type="number" value={riskConfig.profitTargetUsd} onChange={(event) => updateRiskConfig({ profitTargetUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <Field label="Max AI spend USD / day">
                  <input type="number" step="0.5" value={riskConfig.maxAiSpendUsd} onChange={(event) => updateRiskConfig({ maxAiSpendUsd: Number(event.target.value) || 0 })} disabled={isLocked} style={inputStyle} />
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text2)", fontSize: 13 }}>
                  <Switch
                    checked={riskConfig.humanApprovalRequired}
                    onCheckedChange={(checked) => updateRiskConfig({ humanApprovalRequired: checked })}
                    disabled={isLocked}
                  />
                  Human Approval Required
                </label>
              </div>
            </Card>
          )}

          {activeSection === "timeframe" && (
            <TimeframeHorizonCard timeframe={timeframe} disabled={isLocked} onChange={updateTimeframe} />
          )}

          {activeSection === "ai_roles" && (
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
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CostSummaryCard riskConfig={riskConfig} roleProviders={roleProviderSummary} />

          <Card>
            <SectionTitle>Prompt assets</SectionTitle>
            <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
              Bundled Markdown for the active role tab. When <strong>prompt source</strong> is Default, the editor shows this file.
            </p>
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--text2)" }}>
              <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: 4 }}>Bundled file path</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, wordBreak: "break-all" }}>
                {currentRole.promptAssetPath ?? "-"}
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text2)" }}>
              <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: 4 }}>Header / version hint</div>
              <div>{promptHeaderSummary(currentRole.promptMarkdown)}</div>
            </div>
          </Card>
        </div>
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

function labelize(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function promptHeaderSummary(markdown: string): string {
  const first = markdown.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("#")) return first.replace(/^#+\s*/, "");
  return "No markdown heading on first line";
}

const tabRowStyle = { display: "flex", gap: 10, flexWrap: "wrap" } as const;
const activeTabStyle = { padding: "8px 12px", borderRadius: 999, border: "1px solid var(--accent)", background: "rgba(59,130,246,0.12)", color: "var(--text1)", cursor: "pointer" } as const;
const inactiveTabStyle = { padding: "8px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const briefStyle = { marginTop: 14, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" } as const;
const formGridStyle = { display: "grid", gap: 14, marginTop: 16 } as const;
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const warningStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(251,191,36,0.24)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12 } as const;
const warningButtonStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.28)", background: "rgba(251,191,36,0.14)", color: "#fbbf24", cursor: "pointer" } as const;
