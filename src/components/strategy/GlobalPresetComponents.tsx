import { useReducer, useState } from "react";
import type {
  ResearchPosturePresetId,
  RiskPresetId,
  TimeframePresetId,
  TradeRulesPresetId,
} from "../../../electron/shared/domain";
import {
  RESEARCH_POSTURE_PRESETS,
  RISK_PRESETS,
  TIMEFRAME_PRESETS,
  TRADE_RULE_PRESETS,
} from "../../../electron/shared/presets";
import type { GlobalStrategyPreset } from "../../../electron/shared/presets";
import type { UserGlobalPresetRow } from "@/lib/exva";
import { ShadcnSelect } from "@/components/custom-ui";

export type { UserGlobalPresetRow };

export interface UserGlobalPresetInput {
  name: string;
  posturePresetId: ResearchPosturePresetId;
  rulesPresetId: TradeRulesPresetId;
  riskPresetId: RiskPresetId;
  timeframePresetId: TimeframePresetId;
}

const presetCardStyle = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "16px 16px 14px",
  borderRadius: 14,
  transition: "border-color 0.15s, box-shadow 0.15s",
} as const;

const presetBadgeStyle = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.3,
  padding: "3px 8px",
  borderRadius: 999,
  color: "var(--text2)",
  whiteSpace: "nowrap" as const,
} as const;

const applyPresetButtonStyle = {
  marginTop: 2,
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(59,130,246,0.4)",
  fontSize: 12,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  transition: "background 0.12s",
  letterSpacing: 0.3,
} as const;

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(0,0,0,0.65)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
} as const;

const modalPanelStyle = {
  width: "100%",
  maxWidth: 460,
  background:
    "linear-gradient(145deg, rgba(22,32,50,0.98), rgba(14,22,38,0.97))",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 16,
  padding: "24px 24px 20px",
  boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.1)",
  display: "flex",
  flexDirection: "column",
  gap: 18,
} as const;

function labelize(id: string): string {
  return id
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function parseUserPreset(p: UserGlobalPresetRow): GlobalStrategyPreset {
  const j = JSON.parse(p.presetJson) as Omit<
    GlobalStrategyPreset,
    "id" | "label"
  >;
  return { id: p.id, label: p.name, ...j } as GlobalStrategyPreset;
}

// ─── GlobalPresetCard ─────────────────────────────────────────────────────────

interface GlobalPresetCardProps {
  preset: GlobalStrategyPreset;
  isApplied: boolean;
  isBuiltIn: boolean;
  disabled: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function GlobalPresetCard({
  preset,
  isApplied,
  isBuiltIn,
  disabled,
  onApply,
  onEdit,
  onDelete,
}: GlobalPresetCardProps) {
  const [hovered, setHovered] = useState(false);
  const [applyHover, setApplyHover] = useState(false);

  const badges = [
    {
      label: labelize(preset.posturePresetId),
      color: "rgba(99,102,241,0.18)",
      border: "rgba(99,102,241,0.32)",
    },
    {
      label: labelize(preset.rulesPresetId),
      color: "rgba(16,185,129,0.14)",
      border: "rgba(16,185,129,0.28)",
    },
    {
      label: labelize(preset.riskPresetId),
      color: "rgba(245,158,11,0.14)",
      border: "rgba(245,158,11,0.28)",
    },
    {
      label: labelize(preset.timeframePresetId),
      color: "rgba(59,130,246,0.14)",
      border: "rgba(59,130,246,0.28)",
    },
  ];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...presetCardStyle,
        border: isApplied
          ? "1px solid rgba(59,130,246,0.45)"
          : hovered
            ? "1px solid rgba(255,255,255,0.1)"
            : "1px solid var(--border)",
        background: isApplied
          ? "linear-gradient(145deg, rgba(30,41,59,0.95), rgba(15,23,42,0.9))"
          : "linear-gradient(145deg, rgba(22,32,46,0.9), rgba(14,22,36,0.85))",
        boxShadow: isApplied
          ? "0 0 0 1px rgba(59,130,246,0.2), 0 4px 16px rgba(59,130,246,0.1)"
          : hovered
            ? "0 4px 20px rgba(0,0,0,0.3)"
            : "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {isApplied && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background:
              "linear-gradient(90deg, transparent, rgba(59,130,246,0.7), transparent)",
            borderRadius: "14px 14px 0 0",
          }}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text1)",
              lineHeight: 1.3,
            }}
          >
            {preset.label}
          </div>
          {preset.description && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                marginTop: 3,
                lineHeight: 1.45,
              }}
            >
              {preset.description}
            </div>
          )}
        </div>
        {!isBuiltIn && hovered && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0, marginTop: 1 }}>
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                title="Edit preset"
                style={iconBtnStyle}
              >
                <PencilIcon />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                title="Delete preset"
                style={{ ...iconBtnStyle, color: "rgba(248,113,113,0.8)" }}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {badges.map((b) => (
          <span
            key={b.label}
            style={{
              ...presetBadgeStyle,
              background: b.color,
              border: `1px solid ${b.border}`,
            }}
          >
            {b.label}
          </span>
        ))}
      </div>

      {preset.summaryBullets?.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          {preset.summaryBullets.slice(0, 3).map((b) => (
            <div
              key={b}
              style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
            >
              <span
                style={{
                  color: "var(--text3)",
                  fontSize: 12,
                  marginTop: 2,
                  flexShrink: 0,
                }}
              >
                ▸
              </span>
              <span
                style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}
              >
                {b}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onApply}
        onMouseEnter={() => setApplyHover(true)}
        onMouseLeave={() => setApplyHover(false)}
        style={{
          ...applyPresetButtonStyle,
          background: isApplied
            ? "rgba(59,130,246,0.08)"
            : applyHover && !disabled
              ? "rgba(59,130,246,0.22)"
              : "rgba(59,130,246,0.14)",
          color: isApplied ? "rgba(147,197,253,0.9)" : "rgba(191,219,254,0.95)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isApplied ? (
          <>
            <CheckIcon size={12} />
            Applied
          </>
        ) : (
          "Apply Preset"
        )}
      </button>
    </div>
  );
}

// ─── GlobalPresetGrid ─────────────────────────────────────────────────────────

interface GlobalPresetGridProps {
  builtInPresets: GlobalStrategyPreset[];
  userPresets: UserGlobalPresetRow[];
  currentPosturePresetId: string;
  currentRulesPresetId: string;
  currentRiskPresetId: string;
  currentTimeframePresetId: string;
  disabled: boolean;
  onApply: (preset: GlobalStrategyPreset) => void;
  onCreatePreset: () => void;
  onEditPreset: (preset: UserGlobalPresetRow) => void;
  onDeletePreset: (id: string) => void;
}

export function GlobalPresetGrid({
  builtInPresets,
  userPresets,
  currentPosturePresetId,
  currentRulesPresetId,
  currentRiskPresetId,
  currentTimeframePresetId,
  disabled,
  onApply,
  onCreatePreset,
  onEditPreset,
  onDeletePreset,
}: GlobalPresetGridProps) {
  const isApplied = (p: GlobalStrategyPreset) =>
    p.posturePresetId === currentPosturePresetId &&
    p.rulesPresetId === currentRulesPresetId &&
    p.riskPresetId === currentRiskPresetId &&
    p.timeframePresetId === currentTimeframePresetId;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text1)",
              letterSpacing: 0.2,
            }}
          >
            Global Presets
          </h2>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text3)" }}>
            Apply a preset to configure all sections at once.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreatePreset}
          disabled={disabled}
          style={createBtnStyle(disabled)}
        >
          + Create Preset
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {builtInPresets.map((preset) => (
          <GlobalPresetCard
            key={preset.id}
            preset={preset}
            isApplied={isApplied(preset)}
            isBuiltIn
            disabled={disabled}
            onApply={() => onApply(preset)}
          />
        ))}
        {userPresets.map((up) => {
          let parsed: GlobalStrategyPreset | null = null;
          try {
            parsed = parseUserPreset(up);
          } catch {
            return null;
          }
          if (!parsed) return null;
          const presetForCallbacks = parsed;
          return (
            <GlobalPresetCard
              key={up.id}
              preset={presetForCallbacks}
              isApplied={isApplied(presetForCallbacks)}
              isBuiltIn={false}
              disabled={disabled}
              onApply={() => onApply(presetForCallbacks)}
              onEdit={() => onEditPreset(up)}
              onDelete={() => onDeletePreset(up.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── CreateEditGlobalPresetModal ──────────────────────────────────────────────

interface CreateEditGlobalPresetModalProps {
  open: boolean;
  initial?: Partial<UserGlobalPresetInput>;
  onSave: (input: UserGlobalPresetInput) => void;
  onClose: () => void;
}

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type PresetFormState = {
  name: string;
  posturePresetId: ResearchPosturePresetId;
  rulesPresetId: TradeRulesPresetId;
  riskPresetId: RiskPresetId;
  timeframePresetId: TimeframePresetId;
};

export function CreateEditGlobalPresetModal({
  open,
  initial,
  onSave,
  onClose,
}: CreateEditGlobalPresetModalProps) {
  const isEdit = Boolean(initial?.name);
  const [form, dispatchForm] = useReducer(mergeReducer<PresetFormState>, {
    name: initial?.name ?? "",
    posturePresetId: initial?.posturePresetId ?? "trend_hunt",
    rulesPresetId: initial?.rulesPresetId ?? "breakout_long",
    riskPresetId: initial?.riskPresetId ?? "moderate",
    timeframePresetId: initial?.timeframePresetId ?? "swing",
  });

  if (!open) return null;

  const canSave = form.name.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: form.name.trim(),
      posturePresetId: form.posturePresetId,
      rulesPresetId: form.rulesPresetId,
      riskPresetId: form.riskPresetId,
      timeframePresetId: form.timeframePresetId,
    });
  };

  return (
    <div
      onClick={onClose}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClose();
        }
      }}
      style={modalOverlayStyle}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="presentation"
        style={modalPanelStyle}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text1)",
            }}
          >
            {isEdit ? "Edit Global Preset" : "Create Global Preset"}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text3)" }}>
            Name this preset and choose sub-presets for each section.
          </p>
        </div>

        <div style={{ height: 1, background: "var(--border)" }} />

        <div style={{ display: "grid", gap: 14 }}>
          <ModalField label="Preset name">
            <input
              value={form.name}
              onChange={(e) => dispatchForm({ name: e.target.value })}
              placeholder="e.g. My Swing Setup"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              style={modalInputStyle}
            />
          </ModalField>
          <ModalField label="Style (posture)">
            <ShadcnSelect
              value={form.posturePresetId}
              onValueChange={(v) =>
                dispatchForm({ posturePresetId: v as ResearchPosturePresetId })
              }
              options={RESEARCH_POSTURE_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </ModalField>
          <ModalField label="Rules">
            <ShadcnSelect
              value={form.rulesPresetId}
              onValueChange={(v) =>
                dispatchForm({ rulesPresetId: v as TradeRulesPresetId })
              }
              options={TRADE_RULE_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </ModalField>
          <ModalField label="Risk">
            <ShadcnSelect
              value={form.riskPresetId}
              onValueChange={(v) =>
                dispatchForm({ riskPresetId: v as RiskPresetId })
              }
              options={RISK_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </ModalField>
          <ModalField label="Timeframe">
            <ShadcnSelect
              value={form.timeframePresetId}
              onValueChange={(v) =>
                dispatchForm({ timeframePresetId: v as TimeframePresetId })
              }
              options={TIMEFRAME_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </ModalField>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              ...saveBtnBaseStyle,
              background: canSave ? "var(--accent)" : "var(--surface3)",
              color: canSave ? "#fff" : "var(--text3)",
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {isEdit ? "Save Changes" : "Create Preset"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ModalField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div
      style={{
        fontSize: 12,
        color: "var(--text3)",
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
    {children}
  </div>
);

const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="2,8 6,12 14,4" />
  </svg>
);

const PencilIcon = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 2l3 3-9 9H2v-3L11 2z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="2,4 14,4" />
    <path d="M5 4V2h6v2" />
    <path d="M3 4l1 10h8l1-10" />
  </svg>
);

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text3)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};

const modalInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text1)",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface2)",
  color: "var(--text2)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const saveBtnBaseStyle: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 8,
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const createBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid rgba(59,130,246,0.35)",
  background: "rgba(59,130,246,0.1)",
  color: "rgba(147,197,253,0.9)",
  fontSize: 12,
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
  letterSpacing: 0.3,
});
