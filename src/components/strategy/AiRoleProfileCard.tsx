import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { Card, SectionTitle } from "@/components/custom-ui";
import type { AgentRole, SessionAiRoleProfile, SelectionMode } from "@/lib/types";

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
  onPatch: (role: AgentRole, patch: Partial<Pick<SessionAiRoleProfile, "operatingPresetId" | "notes" | "operatingSpec">>) => void;
}) => {
  const profile = profiles.find((p) => p.role === activeRole);
  const [specDraft, setSpecDraft] = useState("");
  const [specError, setSpecError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setSpecDraft(JSON.stringify(profile.operatingSpec ?? {}, null, 2));
    setSpecError(null);
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

  const flushSpec = () => {
    try {
      const parsed: Record<string, unknown> = specDraft.trim() === "" ? {} : (JSON.parse(specDraft) as Record<string, unknown>);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setSpecError("Operating spec must be a JSON object.");
        return;
      }
      setSpecError(null);
      onPatch(activeRole, { operatingSpec: parsed });
    } catch {
      setSpecError("Invalid JSON.");
    }
  };

  return (
    <Card>
      <SectionTitle>Role operating profiles</SectionTitle>
      <p style={{ marginTop: 8, fontSize: 12, color: "var(--text3)", lineHeight: 1.55 }}>
        Per-role operating brief: preset id, notes, and optional JSON for structured hints (tools emphasis, output shape).
        Uses the same role tabs as AI Roles so model settings and operating brief stay aligned.
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
        <Field label="Operating preset id">
          <input
            type="text"
            value={profile.operatingPresetId}
            onChange={(event) => onPatch(activeRole, { operatingPresetId: event.target.value })}
            disabled={disabled}
            placeholder="default"
            style={inputStyle}
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={profile.notes}
            onChange={(event) => onPatch(activeRole, { notes: event.target.value })}
            disabled={disabled}
            rows={5}
            placeholder="How this role should behave: tone, tools emphasis, output shape…"
            style={{ ...inputStyle, resize: "vertical", minHeight: 100 }}
          />
        </Field>
        <Field label="Operating spec (JSON object)">
          <textarea
            value={specDraft}
            onChange={(event) => {
              setSpecDraft(event.target.value);
              setSpecError(null);
            }}
            onBlur={() => {
              if (!disabled) flushSpec();
            }}
            disabled={disabled}
            spellCheck={false}
            rows={12}
            placeholder={'{\n  "output": "bullets",\n  "tools": ["web", "market_data"]\n}'}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 12 }}
          />
          {specError ? (
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 4 }}>{specError}</div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
              Tab away or save to persist parsed JSON. Empty object is allowed.
            </div>
          )}
        </Field>
      </div>
    </Card>
  );
};

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
