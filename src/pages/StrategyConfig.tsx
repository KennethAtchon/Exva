import { useEffect, useRef, useState, type ReactNode } from "react";
import { Card, PageShell, SectionTitle, ShadcnSelect } from "@/components/custom-ui";
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { WorkspaceContextChip } from "@/components/WorkspaceContextChip";
import { AiRoleConfigCard } from "@/components/strategy/AiRoleConfigCard";
import { AiRoleProfileCard } from "@/components/strategy/AiRoleProfileCard";
import { CostSummaryCard } from "@/components/strategy/CostSummaryCard";
import { TimeframeHorizonCard } from "@/components/strategy/TimeframeHorizonCard";
import { GlobalPresetGrid, CreateEditGlobalPresetModal, type UserGlobalPresetInput } from "@/components/strategy/GlobalPresetComponents";
import { api } from "@/lib/exva";
import { useSessionStore } from "@/store/sessionStore";
import { useStrategyStore } from "@/store/strategyStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  buildTradeRulesMarkdown,
  buildResearchPostureMarkdown,
  STOP_LOSS_TYPES,
  SETUP_TYPES,
  TRADE_RULE_PRESETS,
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  STRATEGY_ENTRY_STYLES,
  STRATEGY_EXIT_STYLES,
  STRATEGY_SCALING_MODES,
  STRATEGY_SIDE_BIASES,
  RESEARCH_CATALYST_MODES,
  RESEARCH_DISCOVERY_MODES,
  RESEARCH_EVIDENCE_MODES,
  RESEARCH_FUNDAMENTAL_STRICTNESS,
  RESEARCH_POSTURE_PRESETS,
  type SessionResearchPosture,
  type SessionTradeRules,
  type SessionRiskConfig,
  type SessionTimeframeConfig,
  type ResearchPosturePreset,
  type TradeRulesPreset,
} from "../../electron/shared/domain";
import { GLOBAL_STRATEGY_PRESETS } from "../../electron/shared/presets";
import type { GlobalStrategyPreset } from "../../electron/shared/presets";

const ROLE_ORDER = [
  "analyst_technical",
  "analyst_fundamental",
  "reviewer",
  "decision_maker",
  "instrument_selector",
] as const;

const TABS = [
  ["style", "Style"],
  ["rules", "Rules"],
  ["risk", "Risk"],
  ["timeframe", "Timeframe"],
  ["role_profiles", "Role profiles"],
  ["ai_roles", "AI Roles"],
];

type SectionId = "style" | "rules" | "risk" | "timeframe" | "role_profiles" | "ai_roles";

export const StrategyConfig = ({ onGoToSessions }: { onGoToSessions?: () => void }) => {
  const viewMode = useWorkspaceStore((state) => state.viewMode);
  const focusedSessionId = useWorkspaceStore((state) => state.focusedSessionId);
  const setViewMode = useWorkspaceStore((state) => state.setViewMode);
  const loadWorkspaceView = useWorkspaceStore((state) => state.loadWorkspaceView);
  const setSessionStatus = useSessionStore((state) => state.setStatus);

  const researchPosture = useStrategyStore((state) => state.researchPosture);
  const rules = useStrategyStore((state) => state.rules);
  const riskConfig = useStrategyStore((state) => state.riskConfig);
  const timeframe = useStrategyStore((state) => state.timeframe);
  const aiRoleProfiles = useStrategyStore((state) => state.aiRoleProfiles);
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
  const globalPresets = useStrategyStore((state) => state.globalPresets);
  const workspaceDefaultModelProviderKey = useStrategyStore((state) => state.workspaceDefaultModelProviderKey);
  const workspaceDefaultModelModelId = useStrategyStore((state) => state.workspaceDefaultModelModelId);
  const loadStrategy = useStrategyStore((state) => state.loadStrategy);
  const loadGlobalPresets = useStrategyStore((state) => state.loadGlobalPresets);
  const updateResearchPosture = useStrategyStore((state) => state.updateResearchPosture);
  const updateRules = useStrategyStore((state) => state.updateRules);
  const updateRiskConfig = useStrategyStore((state) => state.updateRiskConfig);
  const updateTimeframe = useStrategyStore((state) => state.updateTimeframe);
  const updateAiRoleProfile = useStrategyStore((state) => state.updateAiRoleProfile);
  const updateRole = useStrategyStore((state) => state.updateRole);
  const applyGlobalPreset = useStrategyStore((state) => state.applyGlobalPreset);
  const applyWorkspaceDefaultToAllRoles = useStrategyStore((state) => state.applyWorkspaceDefaultToAllRoles);
  const saveAll = useStrategyStore((state) => state.saveAll);
  const resetRole = useStrategyStore((state) => state.resetRole);
  const setActiveTab = useStrategyStore((state) => state.setActiveTab);
  const setActiveSection = useStrategyStore((state) => state.setActiveSection);

  const [activeView, setActiveView] = useState<"presets" | "customize">("presets");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<UserGlobalPresetInput & { id: string } | null>(null);

  useEffect(() => {
    if (viewMode !== "session" || !focusedSessionId) return;
    void loadStrategy(focusedSessionId);
  }, [focusedSessionId, loadStrategy, viewMode]);

  const isLocked = pageState === "locked";
  const hasDirty = dirtyFields.size > 0;

  // Auto-save: fires 1.5s after the last change
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  const focusedSessionIdRef = useRef(focusedSessionId);
  focusedSessionIdRef.current = focusedSessionId;
  useEffect(() => {
    if (!hasDirty || isSaving || isLocked || !focusedSessionId) return;
    const t = setTimeout(() => {
      if (focusedSessionIdRef.current) void saveAllRef.current(focusedSessionIdRef.current);
    }, 1500);
    return () => clearTimeout(t);
  // dirtyFields ref changes every update → correct debounce reset
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyFields, isSaving, isLocked, focusedSessionId]);

  const currentRole = aiRoles[activeRoleTab];

  if (viewMode === "global" || !focusedSessionId) {
    return (
      <PageShell>
        <Header loadWorkspaceView={loadWorkspaceView} setViewMode={setViewMode} />
        <div style={emptyStateStyle}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>⚙</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text1)", marginBottom: 8 }}>
            No session focused
          </div>
          <p style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.65, maxWidth: 380, margin: "0 auto 20px" }}>
            Strategy configuration is session-scoped. You need to focus a session first, then come back here to configure its AI roles, risk limits, and strategy behavior.
          </p>
          <div style={stepListStyle}>
            <Step n={1} text='Go to Sessions' />
            <Step n={2} text='Find the session you want to configure' />
            <Step n={3} text='Click "Focus" on that session' />
            <Step n={4} text='Return here to configure strategy' />
          </div>
          {onGoToSessions && (
            <button type="button" onClick={onGoToSessions} style={goToSessionsButtonStyle}>
              Go to Sessions →
            </button>
          )}
        </div>
      </PageShell>
    );
  }

  if (!researchPosture || !rules || !riskConfig || !timeframe || aiRoleProfiles.length < 1) {
    return <PageShell><div style={{ color: "var(--text3)" }}>Loading strategy...</div></PageShell>;
  }

  const stylePreview = buildResearchPostureMarkdown(researchPosture);
  const rulesPreview = buildTradeRulesMarkdown(rules);
  const selectedStylePreset = RESEARCH_POSTURE_PRESETS.find((preset) => preset.id === researchPosture.posturePresetId) ?? RESEARCH_POSTURE_PRESETS[RESEARCH_POSTURE_PRESETS.length - 1];
  const selectedRulesPreset = TRADE_RULE_PRESETS.find((preset) => preset.id === rules.rulesPresetId) ?? TRADE_RULE_PRESETS[TRADE_RULE_PRESETS.length - 1];
  const roleProviderSummary = Object.values(aiRoles).map((role) => {
    const connectedProvider = providers.find((provider) => provider.id === role.providerKey);
    const hasModel = role.modelId.trim().length > 0;
    return {
      role: role.role,
      providerLabel: connectedProvider?.name ?? (role.providerKey.trim().length > 0 ? role.providerKey : "No provider"),
      modelId: hasModel ? role.modelId : "Model not set",
      connected: !!connectedProvider && hasModel,
    };
  });
  const unconfiguredRoles = roleProviderSummary.filter((entry) => !entry.connected);

  return (
    <PageShell>
      <Header loadWorkspaceView={loadWorkspaceView} setViewMode={setViewMode} />

      {unconfiguredRoles.length > 0 && (
        <div style={{ ...warningStyle, marginBottom: 12, borderColor: "rgba(248,113,113,0.28)", color: "#fca5a5", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
          <strong>AI providers not connected — session cannot start</strong>
          <div style={{ color: "#fca5a5", opacity: 0.85 }}>
            {unconfiguredRoles.map((r) => r.role.replaceAll("_", " ")).join(", ")} — go to the AI Roles tab and select a provider account for each role.
          </div>
        </div>
      )}

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
            Separate research posture, trade rules, risk limits, timeframe, per-role operating briefs, and AI role models/prompts for the focused session.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={viewToggleContainerStyle}>
            <button
              type="button"
              onClick={() => setActiveView("presets")}
              style={activeView === "presets" ? viewToggleActiveStyle : viewToggleInactiveStyle}
            >
              Presets
            </button>
            <button
              type="button"
              onClick={() => setActiveView("customize")}
              style={activeView === "customize" ? viewToggleActiveStyle : viewToggleInactiveStyle}
            >
              Customize
            </button>
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
      </div>

      {activeView === "presets" && (
        <GlobalPresetGrid
          builtInPresets={GLOBAL_STRATEGY_PRESETS as GlobalStrategyPreset[]}
          userPresets={globalPresets}
          currentPosturePresetId={researchPosture.posturePresetId}
          currentRulesPresetId={rules.rulesPresetId}
          currentRiskPresetId={riskConfig.riskPresetId ?? "custom"}
          currentTimeframePresetId={timeframe.timeframePresetId ?? "custom"}
          disabled={isLocked}
          onApply={(preset) => applyGlobalPreset(preset)}
          onCreatePreset={() => setCreateModalOpen(true)}
          onEditPreset={(p) => {
            const j = JSON.parse(p.presetJson) as Partial<UserGlobalPresetInput>;
            setEditingPreset({
              id: p.id,
              name: p.name,
              posturePresetId: j.posturePresetId ?? "custom",
              rulesPresetId: j.rulesPresetId ?? "custom",
              riskPresetId: j.riskPresetId ?? "custom",
              timeframePresetId: j.timeframePresetId ?? "custom",
            });
          }}
          onDeletePreset={async (id) => {
            if (!window.confirm("Delete this preset?")) return;
            await api.deleteGlobalPreset({ id });
            await loadGlobalPresets();
          }}
        />
      )}

      {activeView === "customize" && (
        <Tabs value={activeSection} onValueChange={(v) => setActiveSection(v as SectionId)}>
          <TabsList>
            {TABS.map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {TABS.map(([value]) => (
                <TabsContent key={value} value={value}>
                  {value === "style" && (
                    <StyleSection
                      researchPosture={researchPosture}
                      isLocked={isLocked}
                      updateResearchPosture={updateResearchPosture}
                      selectedStylePreset={selectedStylePreset}
                      stylePreview={stylePreview}
                    />
                  )}
                  {value === "rules" && (
                    <RulesSection
                      rules={rules}
                      isLocked={isLocked}
                      updateRules={updateRules}
                      selectedRulesPreset={selectedRulesPreset}
                      rulesPreview={rulesPreview}
                    />
                  )}
                  {value === "risk" && (
                    <RiskSection
                      riskConfig={riskConfig}
                      isLocked={isLocked}
                      updateRiskConfig={updateRiskConfig}
                    />
                  )}
                  {value === "timeframe" && (
                    <TimeframeSection
                      timeframe={timeframe}
                      isLocked={isLocked}
                      updateTimeframe={updateTimeframe}
                    />
                  )}
                  {value === "role_profiles" && (
                    <AiRoleProfileCard
                      activeRole={activeRoleTab}
                      profiles={aiRoleProfiles}
                      selectionMode={selectionMode}
                      aiPickerEnabled={selectorSettings?.aiPickerEnabled ?? true}
                      disabled={isLocked}
                      onTabChange={setActiveTab}
                      onPatch={(role, patch) => updateAiRoleProfile(role, patch)}
                    />
                  )}
                  {value === "ai_roles" && (
                    <AiRoleConfigCard
                      activeRole={activeRoleTab}
                      roles={aiRoles}
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
                      onApplyModelConfigToOtherRoles={async () => {
                        const roleLabel = currentRole.role.replaceAll("_", " ");
                        const confirmed = window.confirm(
                          `Apply ${roleLabel} model settings to the other roles?\n\nThis copies provider, model, temperature, and max tokens.`,
                        );
                        if (!confirmed) return;

                        const patch = {
                          providerKey: currentRole.providerKey,
                          modelId: currentRole.modelId,
                          temperature: currentRole.temperature,
                          maxTokens: currentRole.maxTokens,
                        };

                        for (const role of ROLE_ORDER) {
                          if (role === currentRole.role) continue;
                          if (
                            role === "instrument_selector" &&
                            (selectionMode === "manual_shortlist" ||
                              (selectionMode === "ai_selected_universe" && selectorSettings?.aiPickerEnabled === false))
                          ) {
                            continue;
                          }
                          await updateRole(role, patch);
                        }
                      }}
                      onResetPrompt={async () => {
                        const confirmed = window.confirm("Discard your custom prompt for this role?");
                        if (!confirmed) return;
                        await resetRole(currentRole.role);
                      }}
                    />
                  )}
                </TabsContent>
              ))}
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
        </Tabs>
      )}

      <CreateEditGlobalPresetModal
        open={createModalOpen}
        onSave={async (input) => {
          await api.createGlobalPreset({
            name: input.name,
            preset: {
              description: "",
              summaryBullets: [],
              posturePresetId: input.posturePresetId,
              rulesPresetId: input.rulesPresetId,
              riskPresetId: input.riskPresetId,
              timeframePresetId: input.timeframePresetId,
            },
          });
          await loadGlobalPresets();
          setCreateModalOpen(false);
        }}
        onClose={() => setCreateModalOpen(false)}
      />

      <CreateEditGlobalPresetModal
        open={!!editingPreset}
        initial={editingPreset ?? undefined}
        onSave={async (input) => {
          if (!editingPreset) return;
          await api.updateGlobalPreset({
            id: editingPreset.id,
            name: input.name,
            preset: {
              description: "",
              summaryBullets: [],
              posturePresetId: input.posturePresetId,
              rulesPresetId: input.rulesPresetId,
              riskPresetId: input.riskPresetId,
              timeframePresetId: input.timeframePresetId,
            },
          });
          await loadGlobalPresets();
          setEditingPreset(null);
        }}
        onClose={() => setEditingPreset(null)}
      />
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

const PresetSummaryCard = ({
  presetLabel,
  thesis,
  bullets,
}: {
  presetLabel: string;
  thesis: string;
  bullets: string[];
}) => (
  <div style={presetSummaryStyle}>
    <div style={presetBadgeStyle}>{presetLabel}</div>
    <div style={presetThesisStyle}>{thesis}</div>
    <div style={{ display: "grid", gap: 8 }}>
      {bullets.map((bullet) => (
        <div key={bullet} style={presetBulletStyle}>{bullet}</div>
      ))}
    </div>
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

const Step = ({ n, text }: { n: number; text: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--surface3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--text2)", flexShrink: 0 }}>{n}</div>
    <span style={{ color: "var(--text2)", fontSize: 13 }}>{text}</span>
  </div>
);

const emptyStateStyle = {
  display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center",
  textAlign: "center" as const, padding: "60px 24px",
  border: "1px solid var(--border)", borderRadius: 16, background: "rgba(18,26,36,0.6)",
} as const;

const stepListStyle = {
  display: "grid", gap: 10, textAlign: "left" as const, marginBottom: 24, width: "100%", maxWidth: 340,
} as const;

const goToSessionsButtonStyle = {
  padding: "10px 22px", borderRadius: 10,
  border: "1px solid rgba(96,165,250,0.3)", background: "rgba(96,165,250,0.1)",
  color: "rgba(96,165,250,0.95)", fontSize: 13, fontWeight: 600, cursor: "pointer",
} as const;

const viewToggleContainerStyle = { display: "flex", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden", background: "var(--surface2)" } as const;
const viewToggleActiveStyle = { padding: "7px 16px", border: "none", background: "var(--surface3)", color: "var(--text1)", fontSize: 13, fontWeight: 600, cursor: "pointer" } as const;
const viewToggleInactiveStyle = { padding: "7px 16px", border: "none", background: "transparent", color: "var(--text3)", fontSize: 13, fontWeight: 500, cursor: "pointer" } as const;
const tabRowStyle = { display: "flex", gap: 10, flexWrap: "wrap" } as const;
const activeTabStyle = { padding: "8px 12px", borderRadius: 999, border: "1px solid var(--accent)", background: "rgba(59,130,246,0.12)", color: "var(--text1)", cursor: "pointer" } as const;
const inactiveTabStyle = { padding: "8px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const briefStyle = { marginTop: 14, padding: 14, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" } as const;
const formGridStyle = { display: "grid", gap: 14, marginTop: 16 } as const;
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const warningStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(251,191,36,0.24)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: 12 } as const;
const warningButtonStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(251,191,36,0.28)", background: "rgba(251,191,36,0.14)", color: "#fbbf24", cursor: "pointer" } as const;
const presetSummaryStyle = { display: "grid", gap: 12, marginTop: 14, padding: 14, borderRadius: 12, border: "1px solid rgba(96,165,250,0.22)", background: "linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.82))" } as const;
const presetBadgeStyle = { display: "inline-flex", width: "fit-content", padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(96,165,250,0.28)", background: "rgba(96,165,250,0.12)", color: "rgba(191,219,254,0.96)", fontSize: 11, fontWeight: 700, letterSpacing: 0.2 } as const;
const presetThesisStyle = { color: "var(--text1)", fontSize: 13, lineHeight: 1.55, fontWeight: 600 } as const;
const presetBulletStyle = { color: "var(--text3)", fontSize: 12, lineHeight: 1.5 } as const;

// ─── Section components ───────────────────────────────────────────────────────

const StyleSection = ({
  researchPosture,
  isLocked,
  updateResearchPosture,
  selectedStylePreset,
  stylePreview,
}: {
  researchPosture: SessionResearchPosture;
  isLocked: boolean;
  updateResearchPosture: (patch: Partial<SessionResearchPosture>) => void;
  selectedStylePreset: ResearchPosturePreset;
  stylePreview: string;
}) => (
  <>
    <Card>
      <SectionTitle>Research posture</SectionTitle>
      <div style={formGridStyle}>
        <Field label="Posture preset">
          <ShadcnSelect
            value={researchPosture.posturePresetId}
            onValueChange={(value) => {
              const preset = RESEARCH_POSTURE_PRESETS.find((entry) => entry.id === value);
              if (!preset) return;
              updateResearchPosture(preset.posture);
            }}
            disabled={isLocked}
            options={RESEARCH_POSTURE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          />
        </Field>
        <Field label="Discovery mode">
          <ShadcnSelect
            value={researchPosture.discoveryMode}
            onValueChange={(value) => updateResearchPosture({ discoveryMode: value as typeof researchPosture.discoveryMode })}
            disabled={isLocked}
            options={RESEARCH_DISCOVERY_MODES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Evidence mode">
          <ShadcnSelect
            value={researchPosture.evidenceMode}
            onValueChange={(value) => updateResearchPosture({ evidenceMode: value as typeof researchPosture.evidenceMode })}
            disabled={isLocked}
            options={RESEARCH_EVIDENCE_MODES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Catalyst posture">
          <ShadcnSelect
            value={researchPosture.catalystMode}
            onValueChange={(value) => updateResearchPosture({ catalystMode: value as typeof researchPosture.catalystMode })}
            disabled={isLocked}
            options={RESEARCH_CATALYST_MODES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Fundamental strictness">
          <ShadcnSelect
            value={researchPosture.fundamentalStrictness}
            onValueChange={(value) =>
              updateResearchPosture({ fundamentalStrictness: value as typeof researchPosture.fundamentalStrictness })
            }
            disabled={isLocked}
            options={RESEARCH_FUNDAMENTAL_STRICTNESS.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Posture notes">
          <textarea
            value={researchPosture.postureNotes}
            onChange={(event) => updateResearchPosture({ postureNotes: event.target.value })}
            disabled={isLocked}
            rows={6}
            placeholder="Describe the edge, posture, and evidence stack this session should favor."
            style={{ ...inputStyle, resize: "vertical", minHeight: 128 }}
          />
        </Field>
      </div>
    </Card>

    <Card>
      <SectionTitle>Selected Style Summary</SectionTitle>
      <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
        Keep style high-level here: what edge you want the AI to pursue and what evidence posture it should adopt.
      </p>
      <PresetSummaryCard presetLabel={selectedStylePreset.label} thesis={selectedStylePreset.thesis} bullets={selectedStylePreset.summaryBullets} />
    </Card>

    <Card>
      <SectionTitle>Live Style Guidance</SectionTitle>
      <pre style={briefStyle}>{stylePreview}</pre>
    </Card>
  </>
);

const RulesSection = ({
  rules,
  isLocked,
  updateRules,
  selectedRulesPreset,
  rulesPreview,
}: {
  rules: SessionTradeRules;
  isLocked: boolean;
  updateRules: (patch: Partial<SessionTradeRules>) => void;
  selectedRulesPreset: TradeRulesPreset;
  rulesPreview: string;
}) => (
  <>
    <Card>
      <SectionTitle>Trade Rules</SectionTitle>
      <div style={formGridStyle}>
        <Field label="Rules preset">
          <ShadcnSelect
            value={rules.rulesPresetId}
            onValueChange={(value) => {
              const preset = TRADE_RULE_PRESETS.find((entry) => entry.id === value);
              if (!preset) return;
              updateRules(preset.rules);
            }}
            disabled={isLocked}
            options={TRADE_RULE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          />
        </Field>
        <Field label="Setup type">
          <ShadcnSelect
            value={rules.setupType}
            onValueChange={(value) => updateRules({ setupType: value as typeof rules.setupType })}
            disabled={isLocked}
            options={SETUP_TYPES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Side bias">
          <ShadcnSelect
            value={rules.sideBias}
            onValueChange={(value) => updateRules({ sideBias: value as typeof rules.sideBias })}
            disabled={isLocked}
            options={STRATEGY_SIDE_BIASES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Entry style">
          <ShadcnSelect
            value={rules.entryStyle}
            onValueChange={(value) => updateRules({ entryStyle: value as typeof rules.entryStyle })}
            disabled={isLocked}
            options={STRATEGY_ENTRY_STYLES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Exit style">
          <ShadcnSelect
            value={rules.exitStyle}
            onValueChange={(value) => updateRules({ exitStyle: value as typeof rules.exitStyle })}
            disabled={isLocked}
            options={STRATEGY_EXIT_STYLES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Scaling mode">
          <ShadcnSelect
            value={rules.scalingMode}
            onValueChange={(value) => updateRules({ scalingMode: value as typeof rules.scalingMode })}
            disabled={isLocked}
            options={STRATEGY_SCALING_MODES.map((value) => ({ value, label: labelize(value) }))}
          />
        </Field>
        <Field label="Rule notes">
          <textarea
            value={rules.ruleNotes}
            onChange={(event) => updateRules({ ruleNotes: event.target.value })}
            disabled={isLocked}
            rows={6}
            placeholder="Add setup-specific filters, invalidation rules, liquidity constraints, or execution reminders."
            style={{ ...inputStyle, resize: "vertical", minHeight: 128 }}
          />
        </Field>
      </div>
    </Card>

    <Card>
      <SectionTitle>Selected Rules Summary</SectionTitle>
      <p style={{ color: "var(--text3)", fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
        Rules define how trades are structured after the style identifies the kind of edge to pursue.
      </p>
      <PresetSummaryCard presetLabel={selectedRulesPreset.label} thesis={selectedRulesPreset.thesis} bullets={selectedRulesPreset.summaryBullets} />
    </Card>

    <Card>
      <SectionTitle>Live Rules Markdown</SectionTitle>
      <pre style={briefStyle}>{rulesPreview}</pre>
    </Card>
  </>
);

const RiskSection = ({
  riskConfig,
  isLocked,
  updateRiskConfig,
}: {
  riskConfig: SessionRiskConfig;
  isLocked: boolean;
  updateRiskConfig: (patch: Partial<SessionRiskConfig>) => void;
}) => (
  <Card>
    <SectionTitle>Risk Controls</SectionTitle>
    <div style={formGridStyle}>
      <Field label="Risk preset">
        <ShadcnSelect
          value={riskConfig.riskPresetId ?? "custom"}
          onValueChange={(value) => {
            const preset = RISK_PRESETS.find((p) => p.id === value);
            if (!preset) return;
            updateRiskConfig({ riskPresetId: preset.id, ...preset.values });
          }}
          disabled={isLocked}
          options={RISK_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
      </Field>
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
);

const TimeframeSection = ({
  timeframe,
  isLocked,
  updateTimeframe,
}: {
  timeframe: SessionTimeframeConfig;
  isLocked: boolean;
  updateTimeframe: (patch: Partial<SessionTimeframeConfig>) => void;
}) => (
  <>
    <Card>
      <SectionTitle>Timeframe Preset</SectionTitle>
      <div style={formGridStyle}>
        <Field label="Timeframe preset">
          <ShadcnSelect
            value={timeframe.timeframePresetId ?? "custom"}
            onValueChange={(value) => {
              const preset = TIMEFRAME_PRESETS.find((p) => p.id === value);
              if (!preset) return;
              updateTimeframe({ timeframePresetId: preset.id, ...preset.values });
            }}
            disabled={isLocked}
            options={TIMEFRAME_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>
      </div>
    </Card>
    <TimeframeHorizonCard timeframe={timeframe} disabled={isLocked} onChange={updateTimeframe} />
  </>
);
