import { Card, SectionTitle } from "@/components/custom-ui";
import { Button, Toggle } from "@/components/ui";
import { PromptEditor } from "./PromptEditor";
import { ProviderModelPicker } from "./ProviderModelPicker";
import type { AgentRole, ProviderAccount, SessionAiRole, SelectionMode } from "@/lib/types";
import type { ProviderModelEntry } from "@/lib/exva";

const ROLE_LABELS: Record<AgentRole, string> = {
  analyst_technical: "Technical Analyst",
  analyst_fundamental: "Fundamental Analyst",
  reviewer: "Reviewer",
  decision_maker: "Decision Maker",
  instrument_selector: "Universe Researcher",
};

const ROLE_ORDER: AgentRole[] = [
  "analyst_technical",
  "analyst_fundamental",
  "reviewer",
  "decision_maker",
  "instrument_selector",
];

export const AiRoleConfigCard = ({
  activeRole,
  roles,
  role,
  providers,
  models,
  selectionMode,
  aiPickerEnabled,
  disabled,
  errors,
  roleErrors,
  onTabChange,
  onRoleChange,
  onApplyModelConfigToOtherRoles,
  onResetPrompt,
}: {
  activeRole: AgentRole;
  roles: Record<AgentRole, SessionAiRole>;
  role: SessionAiRole;
  providers: ProviderAccount[];
  models: ProviderModelEntry[];
  selectionMode: SelectionMode | null;
  /** When null, treated as enabled (loading). */
  aiPickerEnabled?: boolean | null;
  disabled: boolean;
  errors: string[];
  roleErrors: Record<AgentRole, string[]>;
  onTabChange: (role: AgentRole) => void;
  onRoleChange: (patch: Partial<SessionAiRole>) => void | Promise<void>;
  onApplyModelConfigToOtherRoles: () => void | Promise<void>;
  onResetPrompt: () => void | Promise<void>;
}) => {
  const selectorTabLocked =
    role.role === "instrument_selector" &&
    (selectionMode === "manual_shortlist" ||
      (selectionMode === "ai_selected_universe" && aiPickerEnabled === false));
  const providerOptions = providers.filter((provider) => provider.category === "ai");
  const selectedProvider = providerOptions.find((provider) => provider.id === role.providerKey);
  const modelsLoading = !!selectedProvider && models.length === 0;

  return (
    <Card>
      <SectionTitle>AI Role Configuration</SectionTitle>
      {selectionMode === "ai_selected_universe" && aiPickerEnabled === false ? (
        <div
          style={{
            marginTop: 12,
            marginBottom: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(96,165,250,0.25)",
            background: "rgba(96,165,250,0.08)",
            color: "var(--text2)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          AI picker is disabled for this session. Enable it in session settings (create/edit session) to use the
          universe researcher.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 16 }}>
        {ROLE_ORDER.map((entry) => {
          const disabledTabManual = entry === "instrument_selector" && selectionMode === "manual_shortlist";
          const roleData = roleErrors[entry];
          const isActive = entry === activeRole;
          const roleState = roles[entry];
          const roleProvider = providerOptions.find((provider) => provider.id === roleState.providerKey);
          const providerConnected = !!roleProvider && roleState.modelId.trim().length > 0;
          return (
            <Button
              key={entry}
              onClick={() => !disabledTabManual && onTabChange(entry)}
              variant="ghost"
              title={
                disabledTabManual
                  ? "Enable AI-selected universe in session settings to configure this role."
                  : !providerConnected
                    ? "Not connected — select provider and model below."
                    : undefined
              }
              style={{
                padding: "7px 10px",
                borderRadius: 8,
                border: `1px solid ${roleData.length > 0 || !providerConnected ? "rgba(248,113,113,0.4)" : "var(--border)"}`,
                background: isActive ? "rgba(96,165,250,0.1)" : "var(--surface2)",
                color: disabledTabManual ? "var(--text3)" : isActive ? "#60a5fa" : "var(--text2)",
                cursor: disabledTabManual ? "not-allowed" : "pointer",
                opacity: disabledTabManual ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {ROLE_LABELS[entry]}
              {roleData.length > 0 ? ` (${roleData.length})` : ""}
            </Button>
          );
        })}
      </div>

      {!selectedProvider && (
        <div style={noProviderBannerStyle}>
          No provider connected for this role. Select a provider account below — the model field will appear once connected.
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <ProviderModelPicker
            providers={providerOptions}
            providerKey={role.providerKey}
            modelId={role.modelId}
            models={models}
            modelsLoading={modelsLoading}
            disabled={disabled || selectorTabLocked}
            onProviderChange={(value) => void onRoleChange({ providerKey: value })}
            onModelChange={(value) => void onRoleChange({ modelId: value })}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => void onApplyModelConfigToOtherRoles()}
              disabled={disabled || selectorTabLocked || !role.providerKey || !role.modelId.trim()}
              style={secondaryButtonStyle}
              title="Apply provider, model, temperature, and max tokens to the other roles"
            >
              Set for Other Roles
            </Button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={rowStyle}>
            <div style={labelStyle}>Temperature</div>
            <input
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={role.temperature}
              onChange={(event) => void onRoleChange({ temperature: Number(event.target.value) || 0 })}
              disabled={disabled || selectorTabLocked}
              style={inputStyle}
            />
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>Max Tokens</div>
            <input
              type="number"
              min={1}
              step={1}
              value={role.maxTokens}
              onChange={(event) => void onRoleChange({ maxTokens: Number(event.target.value) || 0 })}
              disabled={disabled || selectorTabLocked}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <Toggle
            pressed={role.promptSource === "default"}
            onPressedChange={(pressed) => {
              if (pressed) void onRoleChange({ promptSource: "default" });
            }}
            disabled={disabled || selectorTabLocked}
            style={{ ...toggleStyle, ...(role.promptSource === "default" ? activeToggleStyle : {}) }}
          >
            Default Prompt
          </Toggle>
          <Toggle
            pressed={role.promptSource === "session_override"}
            onPressedChange={(pressed) => {
              if (pressed) void onRoleChange({ promptSource: "session_override" });
            }}
            disabled={disabled || selectorTabLocked}
            style={{ ...toggleStyle, ...(role.promptSource === "session_override" ? activeToggleStyle : {}) }}
          >
            Session Override
          </Toggle>
        </div>

        <div>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Prompt Asset Path</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
            {role.promptAssetPath ?? "No bundled prompt path"}
          </div>
          <PromptEditor
            value={role.promptMarkdown}
            readOnly={role.promptSource === "default" || disabled || selectorTabLocked}
            onChange={(value) => void onRoleChange({ promptMarkdown: value })}
          />
          {role.promptSource === "session_override" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Button onClick={() => void onResetPrompt()} disabled={disabled || selectorTabLocked} variant="outline" style={secondaryButtonStyle}>
                Reset to Default Prompt
              </Button>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.24)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: 12 }}>
            {errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

const rowStyle = { display: "grid", gap: 6 } as const;
const labelStyle = { fontSize: 12, color: "var(--text3)" } as const;
const inputStyle = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text1)" } as const;
const noProviderBannerStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.07)", color: "#fca5a5", fontSize: 12, lineHeight: 1.55, marginBottom: 8 } as const;
const toggleStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const activeToggleStyle = { background: "rgba(96,165,250,0.1)", color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)" } as const;
const secondaryButtonStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
