import { Card, SectionTitle } from "@/components/atoms";
import { PromptEditor } from "./PromptEditor";
import type { AgentRole, ProviderAccount, SessionAiRole, SelectionMode } from "@/lib/types";
import type { ProviderModelEntry } from "@/lib/exva";

const ROLE_LABELS: Record<AgentRole, string> = {
  researcher_bull: "Bull Researcher",
  researcher_bear: "Bear Researcher",
  reviewer: "Reviewer",
  decision_maker: "Decision Maker",
  instrument_selector: "Instrument Selector",
};

const ROLE_ORDER: AgentRole[] = [
  "researcher_bull",
  "researcher_bear",
  "reviewer",
  "decision_maker",
  "instrument_selector",
];

export const AiRoleConfigCard = ({
  activeRole,
  role,
  providers,
  models,
  selectionMode,
  disabled,
  errors,
  roleErrors,
  onTabChange,
  onRoleChange,
  onResetPrompt,
}: {
  activeRole: AgentRole;
  role: SessionAiRole;
  providers: ProviderAccount[];
  models: ProviderModelEntry[];
  selectionMode: SelectionMode | null;
  disabled: boolean;
  errors: string[];
  roleErrors: Record<AgentRole, string[]>;
  onTabChange: (role: AgentRole) => void;
  onRoleChange: (patch: Partial<SessionAiRole>) => void | Promise<void>;
  onResetPrompt: () => void | Promise<void>;
}) => {
  const selectorDisabled = role.role === "instrument_selector" && selectionMode === "manual_shortlist";
  const providerOptions = providers.filter((provider) => provider.category === "ai");
  const selectedProvider = providerOptions.find((provider) => provider.id === role.providerKey);
  const selectedProviderType = selectedProvider ? String(selectedProvider.providerType) : "";
  const useModelTextInput =
    selectedProviderType === "openrouter" ||
    selectedProviderType === "opencode" ||
    models.length === 0;

  return (
    <Card>
      <SectionTitle>AI Role Configuration</SectionTitle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 16 }}>
        {ROLE_ORDER.map((entry) => {
          const disabledTab = entry === "instrument_selector" && selectionMode === "manual_shortlist";
          return (
            <button
              key={entry}
              onClick={() => !disabledTab && onTabChange(entry)}
              title={disabledTab ? "Enable AI-selected universe in session settings to configure this role." : undefined}
              style={{
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: activeRole === entry ? "rgba(96,165,250,0.1)" : "var(--surface2)",
                color: disabledTab ? "var(--text3)" : activeRole === entry ? "#60a5fa" : "var(--text2)",
                cursor: disabledTab ? "not-allowed" : "pointer",
                opacity: disabledTab ? 0.6 : 1,
              }}
            >
              {ROLE_LABELS[entry]}
              {roleErrors[entry].length > 0 ? ` (${roleErrors[entry].length})` : ""}
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div style={rowStyle}>
          <div style={labelStyle}>Provider</div>
          <select
            value={role.providerKey}
            onChange={(event) => void onRoleChange({ providerKey: event.target.value })}
            disabled={disabled || selectorDisabled}
            style={inputStyle}
          >
            <option value="">Select provider</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
        </div>

        <div style={rowStyle}>
          <div style={labelStyle}>Model</div>
          {useModelTextInput ? (
            <input
              value={role.modelId}
              onChange={(event) => void onRoleChange({ modelId: event.target.value })}
              disabled={disabled || selectorDisabled || !role.providerKey}
              placeholder="Enter model id"
              style={inputStyle}
            />
          ) : (
            <select
              value={role.modelId}
              onChange={(event) => void onRoleChange({ modelId: event.target.value })}
              disabled={disabled || selectorDisabled || !role.providerKey}
              style={inputStyle}
            >
              <option value="">Select model</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
          )}
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
              disabled={disabled || selectorDisabled}
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
              disabled={disabled || selectorDisabled}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: disabled || selectorDisabled ? "var(--text3)" : "var(--text2)" }}>
          <input
            type="checkbox"
            checked={role.webSearchEnabled}
            onChange={(event) => void onRoleChange({ webSearchEnabled: event.target.checked })}
            disabled={disabled || selectorDisabled}
          />
          Web Search Enabled
        </label>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => void onRoleChange({ promptSource: "default" })}
            disabled={disabled || selectorDisabled}
            style={{ ...toggleStyle, ...(role.promptSource === "default" ? activeToggleStyle : {}) }}
          >
            Default Prompt
          </button>
          <button
            onClick={() => void onRoleChange({ promptSource: "session_override" })}
            disabled={disabled || selectorDisabled}
            style={{ ...toggleStyle, ...(role.promptSource === "session_override" ? activeToggleStyle : {}) }}
          >
            Session Override
          </button>
        </div>

        <div>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Prompt Asset Path</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
            {role.promptAssetPath ?? "No bundled prompt path"}
          </div>
          <PromptEditor
            value={role.promptMarkdown}
            readOnly={role.promptSource === "default" || disabled || selectorDisabled}
            onChange={(value) => void onRoleChange({ promptMarkdown: value })}
          />
          {role.promptSource === "session_override" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => void onResetPrompt()} disabled={disabled || selectorDisabled} style={secondaryButtonStyle}>
                Reset to Default Prompt
              </button>
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
const toggleStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
const activeToggleStyle = { background: "rgba(96,165,250,0.1)", color: "#60a5fa", borderColor: "rgba(96,165,250,0.3)" } as const;
const secondaryButtonStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer" } as const;
