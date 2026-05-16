import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { Card, SectionTitle } from "@/components/custom-ui";
import type { AgentRole, SessionAiRoleProfile, SelectionMode } from "@/lib/types";
import {
  AI_ROLE_PROFILE_VERSION,
  DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX,
  SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN,
  aiRoleProfileDocumentSchema,
  type AiRoleProfileDocument,
  type AiRoleToolMode,
} from "../../../electron/shared/ai/ai-role-profile";

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

const TOOL_MODE_OPTIONS: Array<{ value: AiRoleToolMode; label: string }> = [
  { value: "disabled", label: "Disabled" },
  { value: "optional", label: "Optional" },
  { value: "preferred", label: "Preferred" },
  { value: "required", label: "Required" },
];

const ROLE_TOOL_FIELDS: Record<AgentRole, Array<{ key: string; label: string }>> = {
  analyst_technical: [
    { key: "search_web", label: "Web Search" },
    { key: "get_news", label: "News" },
  ],
  analyst_fundamental: [
    { key: "search_web", label: "Web Search" },
    { key: "get_news", label: "News" },
  ],
  reviewer: [
    { key: "search_web", label: "Web Search" },
    { key: "get_news", label: "News" },
  ],
  decision_maker: [],
  instrument_selector: [
    { key: "search_web", label: "Web Search" },
    { key: "search_reddit", label: "Reddit Search" },
    { key: "get_trending_symbols", label: "Trending Symbols" },
    { key: "fetch_url", label: "Fetch URL" },
    { key: "get_news", label: "News" },
    { key: "get_quote", label: "Quote" },
    { key: "get_ohlcv", label: "OHLCV" },
    { key: "submit_candidates", label: "Submit Candidates" },
  ],
};

const OUTPUT_FORMAT_OPTIONS = ["memo", "structured_json", "candidate_list", "custom"] as const;

export const AiRoleProfileCard = ({
  activeRole,
  profiles,
  selectionMode,
  aiPickerEnabled,
  disabled,
  onTabChange,
  onPatch,
}: {
  activeRole: AgentRole;
  profiles: SessionAiRoleProfile[];
  selectionMode: SelectionMode | null;
  aiPickerEnabled?: boolean | null;
  disabled: boolean;
  onTabChange: (role: AgentRole) => void;
  onPatch: (role: AgentRole, patch: Partial<Pick<SessionAiRoleProfile, "profileJson">>) => void;
}) => {
  const profile = profiles.find((p) => p.role === activeRole);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setJsonDraft(JSON.stringify(profile.profileJson, null, 2));
    setJsonError(null);
  }, [activeRole, profile?.sessionId, profile?.updatedAt]);

  const selectorTabLocked =
    activeRole === "instrument_selector" &&
    (selectionMode === "manual_shortlist" ||
      (selectionMode === "ai_selected_universe" && aiPickerEnabled === false));

  if (!profile) {
    return (
      <Card>
        <SectionTitle>Role operating profiles</SectionTitle>
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--text3)" }}>Loading role profiles…</p>
      </Card>
    );
  }

  const profileJson = profile.profileJson;
  const toolFields = ROLE_TOOL_FIELDS[activeRole];
  const selectorRetryMinutes = profileJson.selectorSettings?.noInstrumentRetryMinutes ?? DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES;

  const applyProfileJson = (next: AiRoleProfileDocument) => {
    const normalized = normalizeProfileJson(next);
    setJsonDraft(JSON.stringify(normalized, null, 2));
    setJsonError(null);
    onPatch(activeRole, { profileJson: normalized });
  };

  const flushJson = () => {
    try {
      const parsed = jsonDraft.trim() === "" ? { version: AI_ROLE_PROFILE_VERSION } : JSON.parse(jsonDraft);
      const result = aiRoleProfileDocumentSchema.safeParse(parsed);
      if (!result.success) {
        setJsonError(result.error.issues[0]?.message ?? "Invalid role profile JSON.");
        return;
      }
      applyProfileJson(result.data);
    } catch {
      setJsonError("Invalid JSON.");
    }
  };

  return (
    <Card>
      <SectionTitle>Role operating profiles</SectionTitle>
      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text3)", lineHeight: 1.55 }}>
        Per-role operating behavior now lives in one structured JSON document. Use the guided fields for the common
        parts, and use Advanced JSON only when you need extra keys the UI does not expose yet.
      </p>
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
          AI picker is disabled — universe researcher role may be inactive, but you can still edit stored profile rows.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16, marginBottom: 16 }}>
        {ROLE_ORDER.map((entry) => {
          const isActive = entry === activeRole;
          const disabledTabManual = entry === "instrument_selector" && selectionMode === "manual_shortlist";
          return (
            <Button
              key={entry}
              onClick={() => !disabledTabManual && onTabChange(entry)}
              variant="ghost"
              title={
                disabledTabManual
                  ? "Universe researcher is unused while instrument selection is manual shortlist."
                  : undefined
              }
              style={{
                padding: "7px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: isActive ? "rgba(96,165,250,0.1)" : "var(--surface2)",
                color: disabledTabManual ? "var(--text3)" : isActive ? "#60a5fa" : "var(--text2)",
                cursor: disabledTabManual ? "not-allowed" : "pointer",
                opacity: disabledTabManual ? 0.6 : 1,
              }}
            >
              {ROLE_LABELS[entry]}
            </Button>
          );
        })}
      </div>

      {selectorTabLocked ? (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.25)",
            background: "rgba(148,163,184,0.08)",
            color: "var(--text2)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          This role is inactive for the current session mode; edits still save to the database for when the mode changes.
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14, marginTop: 4 }}>
        <Field label="Objective">
          <input
            type="text"
            value={profileJson.objective ?? ""}
            onChange={(event) => applyProfileJson({ ...profileJson, objective: event.target.value })}
            disabled={disabled}
            placeholder="What this role should optimize for in this session"
            style={inputStyle}
          />
        </Field>
        <StringListField
          label="Constraints"
          value={profileJson.constraints}
          disabled={disabled}
          placeholder="One constraint per line"
          helper="Short hard rules for this role. One line per item."
          onChange={(value) => applyProfileJson({ ...profileJson, constraints: value })}
        />
        <Section label="Tool Policy">
          {toolFields.length === 0 ? (
            <div style={helperStyle}>No common tool controls for this role. Use Advanced JSON if needed.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {toolFields.map((tool) => {
                const policy = profileJson.toolPolicy[tool.key] ?? {};
                return (
                  <div key={tool.key} style={{ display: "grid", gap: 6, padding: 10, border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--text2)" }}>{tool.label}</div>
                    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "160px 1fr" }}>
                      <select
                        value={policy.mode ?? ""}
                        onChange={(event) =>
                          applyProfileJson(
                            updateToolPolicy(profileJson, tool.key, {
                              ...policy,
                              mode: event.target.value === "" ? undefined : (event.target.value as AiRoleToolMode),
                            }),
                          )
                        }
                        disabled={disabled}
                        style={inputStyle}
                      >
                        <option value="">Default</option>
                        {TOOL_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={policy.notes ?? ""}
                        onChange={(event) =>
                          applyProfileJson(updateToolPolicy(profileJson, tool.key, { ...policy, notes: event.target.value }))
                        }
                        disabled={disabled}
                        placeholder="Optional notes for how this tool should be used"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
        {activeRole === "instrument_selector" ? (
          <Section label="Selector Runtime">
            <Field label="No-result retry (minutes)">
              <input
                type="number"
                min={SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN}
                max={SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX}
                step={1}
                value={selectorRetryMinutes}
                onChange={(event) =>
                  applyProfileJson({
                    ...profileJson,
                    selectorSettings: {
                      ...profileJson.selectorSettings,
                      noInstrumentRetryMinutes: normalizeSelectorRetryMinutesInput(event.target.value),
                    },
                  })
                }
                disabled={disabled}
                style={inputStyle}
              />
              <div style={helperStyle}>
                When the selector returns no tradable instruments, the orchestrator retries after this interval. Allowed
                range: {SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN}-{SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX} minutes.
              </div>
            </Field>
          </Section>
        ) : null}
        <StringListField
          label="Method Checklist"
          value={profileJson.method.checklist}
          disabled={disabled}
          placeholder="One checklist item per line"
          helper="The main reasoning steps this role should follow."
          onChange={(value) => applyProfileJson({ ...profileJson, method: { ...profileJson.method, checklist: value } })}
        />
        <StringListField
          label="Required Evidence"
          value={profileJson.method.requiredEvidence}
          disabled={disabled}
          placeholder="One evidence requirement per line"
          helper="Short tokens or phrases for evidence this role should not skip."
          onChange={(value) =>
            applyProfileJson({ ...profileJson, method: { ...profileJson.method, requiredEvidence: value } })
          }
        />
        <StringListField
          label="Avoid"
          value={profileJson.method.avoid}
          disabled={disabled}
          placeholder="One avoid rule per line"
          helper="Patterns or failure modes this role should avoid."
          onChange={(value) => applyProfileJson({ ...profileJson, method: { ...profileJson.method, avoid: value } })}
        />
        <Section label="Output Contract">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <Field label="Format">
              <select
                value={profileJson.output.format ?? ""}
                onChange={(event) =>
                  applyProfileJson({
                    ...profileJson,
                    output: {
                      ...profileJson.output,
                      format:
                        event.target.value === ""
                          ? undefined
                          : (event.target.value as AiRoleProfileDocument["output"]["format"]),
                    },
                  })
                }
                disabled={disabled}
                style={inputStyle}
              >
                <option value="">Default</option>
                {OUTPUT_FORMAT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Min words">
              <input
                type="number"
                value={profileJson.output.minWords ?? ""}
                onChange={(event) =>
                  applyProfileJson({
                    ...profileJson,
                    output: {
                      ...profileJson.output,
                      minWords: event.target.value === "" ? null : Number(event.target.value),
                    },
                  })
                }
                disabled={disabled}
                placeholder="Optional"
                style={inputStyle}
              />
            </Field>
            <Field label="Max words">
              <input
                type="number"
                value={profileJson.output.maxWords ?? ""}
                onChange={(event) =>
                  applyProfileJson({
                    ...profileJson,
                    output: {
                      ...profileJson.output,
                      maxWords: event.target.value === "" ? null : Number(event.target.value),
                    },
                  })
                }
                disabled={disabled}
                placeholder="Optional"
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <StringListField
              label="Required sections"
              value={profileJson.output.requiredSections}
              disabled={disabled}
              placeholder="One section name per line"
              helper="Used when you want the output to follow a fixed structure."
              onChange={(value) =>
                applyProfileJson({ ...profileJson, output: { ...profileJson.output, requiredSections: value } })
              }
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Terminal action">
              <input
                type="text"
                value={profileJson.output.terminalAction ?? ""}
                onChange={(event) =>
                  applyProfileJson({
                    ...profileJson,
                    output: { ...profileJson.output, terminalAction: event.target.value },
                  })
                }
                disabled={disabled}
                placeholder="Optional final action or output rule"
                style={inputStyle}
              />
            </Field>
          </div>
        </Section>
        <details style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--surface2)" }}>
          <summary style={{ cursor: "pointer", color: "var(--text2)", fontSize: 13 }}>Advanced JSON</summary>
          <div style={{ marginTop: 12 }}>
            <textarea
              value={jsonDraft}
              onChange={(event) => {
                setJsonDraft(event.target.value);
                setJsonError(null);
              }}
              onBlur={() => {
                if (!disabled) flushJson();
              }}
              disabled={disabled}
              spellCheck={false}
              rows={14}
              placeholder={'{\n  "version": 1\n}'}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
            {jsonError ? <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 4 }}>{jsonError}</div> : null}
            <div style={helperStyle}>Unknown keys are preserved. Tab away to validate and sync the JSON editor.</div>
          </div>
        </details>
      </div>
    </Card>
  );
};

const StringListField = ({
  label,
  value,
  disabled,
  placeholder,
  helper,
  onChange,
}: {
  label: string;
  value: string[];
  disabled: boolean;
  placeholder: string;
  helper: string;
  onChange: (value: string[]) => void;
}) => (
  <Field label={label}>
    <textarea
      value={value.join("\n")}
      onChange={(event) => onChange(toStringList(event.target.value))}
      disabled={disabled}
      rows={4}
      placeholder={placeholder}
      style={{ ...inputStyle, resize: "vertical", minHeight: 90 }}
    />
    <div style={helperStyle}>{helper}</div>
  </Field>
);

const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "grid", gap: 8 }}>
    <div style={{ fontSize: 12, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
    {children}
  </div>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, color: "var(--text3)" }}>{label}</div>
    {children}
  </div>
);

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
} as const;

const helperStyle = {
  fontSize: 11,
  color: "var(--text3)",
  marginTop: 4,
  lineHeight: 1.5,
} as const;

function updateToolPolicy(
  profileJson: AiRoleProfileDocument,
  toolKey: string,
  nextPolicy: AiRoleProfileDocument["toolPolicy"][string],
): AiRoleProfileDocument {
  return {
    ...profileJson,
    toolPolicy: {
      ...profileJson.toolPolicy,
      [toolKey]: nextPolicy,
    },
  };
}

function normalizeProfileJson(profileJson: AiRoleProfileDocument): AiRoleProfileDocument {
  const next = cloneProfileJson(profileJson);
  next.version = AI_ROLE_PROFILE_VERSION;
  next.objective = trimToUndefined(next.objective);
  next.constraints = cleanStringList(next.constraints);

  const toolPolicy: AiRoleProfileDocument["toolPolicy"] = {};
  for (const [tool, policy] of Object.entries(next.toolPolicy ?? {})) {
    const normalizedPolicy = {
      ...policy,
      notes: trimToUndefined(policy.notes),
      mode: policy.mode,
    };
    const { mode, notes, ...rest } = normalizedPolicy;
    if (mode || notes || Object.keys(rest).length > 0) {
      toolPolicy[tool] = normalizedPolicy;
    }
  }
  next.toolPolicy = toolPolicy;

  next.method = {
    ...next.method,
    checklist: cleanStringList(next.method.checklist),
    requiredEvidence: cleanStringList(next.method.requiredEvidence),
    avoid: cleanStringList(next.method.avoid),
  };

  next.output = {
    ...next.output,
    requiredSections: cleanStringList(next.output.requiredSections),
    terminalAction: trimToUndefined(next.output.terminalAction),
    minWords: normalizeNullableInt(next.output.minWords),
    maxWords: normalizeNullableInt(next.output.maxWords),
  };

  return aiRoleProfileDocumentSchema.parse(next);
}

function cloneProfileJson(profileJson: AiRoleProfileDocument): AiRoleProfileDocument {
  return JSON.parse(JSON.stringify(profileJson)) as AiRoleProfileDocument;
}

function toStringList(value: string): string[] {
  return cleanStringList(value.split("\n"));
}

function cleanStringList(value: string[]): string[] {
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

function trimToUndefined(value?: string | null): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function normalizeNullableInt(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function normalizeSelectorRetryMinutesInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SELECTOR_NO_INSTRUMENT_RETRY_MINUTES;
  return Math.min(
    SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MAX,
    Math.max(SELECTOR_NO_INSTRUMENT_RETRY_MINUTES_MIN, Math.trunc(parsed)),
  );
}
