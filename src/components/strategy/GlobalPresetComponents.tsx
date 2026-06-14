import { useState } from "react";
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
import { HelpTooltip } from "@/components/ui";
import { cn } from "@/lib/utils";

export type { UserGlobalPresetRow };

export interface UserGlobalPresetInput {
  name: string;
  posturePresetId: ResearchPosturePresetId;
  rulesPresetId: TradeRulesPresetId;
  riskPresetId: RiskPresetId;
  timeframePresetId: TimeframePresetId;
}

const presetCardClass =
  "relative flex flex-col gap-3 rounded-[14px] px-4 pb-3.5 pt-4 transition-[border-color,box-shadow] duration-150";

const presetBadgeClass =
  "whitespace-nowrap rounded-full px-2 py-[3px] text-[12px] font-semibold tracking-[0.3px] text-[var(--text2)]";

const applyPresetButtonClass =
  "mt-0.5 flex w-full items-center justify-center gap-[5px] rounded-lg border border-info-border px-3 py-2 text-[12px] font-bold tracking-[0.3px] transition-colors duration-[120ms]";

const modalOverlayClass =
  "fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(0,0,0,0.65)] p-6 backdrop-blur-[4px]";

const modalPanelClass =
  "flex w-full max-w-[460px] flex-col gap-[18px] rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 pb-5 pt-6 shadow-[0_24px_64px_rgba(0,0,0,0.4)]";

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
  state: "applied" | "available";
  source: "built_in" | "user";
  disabled: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function GlobalPresetCard({
  preset,
  state,
  source,
  disabled,
  onApply,
  onEdit,
  onDelete,
}: GlobalPresetCardProps) {
  const [hovered, setHovered] = useState(false);
  const [applyHover, setApplyHover] = useState(false);
  const isApplied = state === "applied";
  const canManagePreset = source === "user" && hovered;

  const badges = [
    {
      label: labelize(preset.posturePresetId),
      color: "var(--color-market-dim)",
      border: "var(--color-market-border)",
    },
    {
      label: labelize(preset.rulesPresetId),
      color: "var(--color-success-dim)",
      border: "var(--color-success-border)",
    },
    {
      label: labelize(preset.riskPresetId),
      color: "var(--color-warning-dim)",
      border: "var(--color-warning-border)",
    },
    {
      label: labelize(preset.timeframePresetId),
      color: "var(--color-info-dim)",
      border: "var(--color-info-border)",
    },
  ];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        presetCardClass,
        isApplied
          ? "border border-info-border bg-[var(--surface2)] shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          : hovered
            ? "border border-[var(--border)] bg-[var(--surface2)] shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
            : "border border-[var(--border)] bg-[var(--surface2)] shadow-[0_2px_8px_rgba(0,0,0,0.06)]",
      )}
    >
      {isApplied && (
        <div className="absolute left-0 right-0 top-0 h-0.5 rounded-t-[14px] bg-[linear-gradient(90deg,transparent,var(--color-info),transparent)]" />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="text-[14px] font-bold leading-[1.3] text-[var(--text1)]">
            {preset.label}
          </div>
          {preset.description && (
            <div className="mt-[3px] text-[12px] leading-[1.45] text-[var(--text3)]">
              {preset.description}
            </div>
          )}
        </div>
        {canManagePreset && (
          <div className="mt-px flex shrink-0 gap-1">
            {onEdit && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  aria-label="Edit preset"
                  className={iconBtnClass}
                >
                  <PencilIcon />
                </button>
                <HelpTooltip
                  topic="Edit preset"
                  body="Update the saved preset's label, description, and combined strategy values."
                />
              </>
            )}
            {onDelete && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  aria-label="Delete preset"
                  className={cn(iconBtnClass, "text-error")}
                >
                  <TrashIcon />
                </button>
                <HelpTooltip
                  topic="Delete preset"
                  body="Removes this saved preset so it can no longer be applied to sessions."
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-[5px]">
        {badges.map((b) => (
          <span
            key={b.label}
            className={presetBadgeClass}
            style={{
              background: b.color,
              border: `1px solid ${b.border}`,
            }}
          >
            {b.label}
          </span>
        ))}
      </div>

      {preset.summaryBullets?.length > 0 && (
        <div className="grid gap-1">
          {preset.summaryBullets.slice(0, 3).map((b) => (
            <div key={b} className="flex items-start gap-1.5">
              <span className="mt-0.5 shrink-0 text-[12px] text-[var(--text3)]">
                ▸
              </span>
              <span className="text-[12px] leading-normal text-[var(--text3)]">
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
        className={cn(
          applyPresetButtonClass,
          isApplied
            ? "bg-info-dim text-info"
            : applyHover && !disabled
              ? "bg-info-dim text-info"
              : "bg-info-dim text-info",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        )}
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="m-0 text-[15px] font-semibold tracking-[0.2px] text-[var(--text1)]">
            Global Presets
          </h2>
          <p className="m-0 mt-[3px] text-[12px] text-[var(--text3)]">
            Apply a preset to configure all sections at once.
          </p>
        </div>
        <button
          type="button"
          onClick={onCreatePreset}
          disabled={disabled}
          className={cn(
            createBtnClass,
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          + Create Preset
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {builtInPresets.map((preset) => (
          <GlobalPresetCard
            key={preset.id}
            preset={preset}
            state={isApplied(preset) ? "applied" : "available"}
            source="built_in"
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
              state={isApplied(presetForCallbacks) ? "applied" : "available"}
              source="user"
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
  const [form, setForm] = useState<PresetFormState>({
    name: initial?.name ?? "",
    posturePresetId: initial?.posturePresetId ?? "edgar_catalyst",
    rulesPresetId: initial?.rulesPresetId ?? "catalyst_entry",
    riskPresetId: initial?.riskPresetId ?? "moderate",
    timeframePresetId: initial?.timeframePresetId ?? "swing",
  });
  const patchForm = (patch: Partial<PresetFormState>) =>
    setForm((state) => ({ ...state, ...patch }));

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
      className={modalOverlayClass}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="presentation"
        className={modalPanelClass}
      >
        <div>
          <h2 className="m-0 text-[16px] font-semibold text-[var(--text1)]">
            {isEdit ? "Edit Global Preset" : "Create Global Preset"}
          </h2>
          <p className="m-0 mt-1 text-[12px] text-[var(--text3)]">
            Name this preset and choose sub-presets for each section.
          </p>
        </div>

        <div className="h-px bg-[var(--border)]" />

        <div className="grid gap-3.5">
          <ModalField label="Preset name">
            <input
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              placeholder="e.g. My Swing Setup"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              className={modalInputClass}
            />
          </ModalField>
          <ModalField label="Style (posture)">
            <ShadcnSelect
              value={form.posturePresetId}
              onValueChange={(v) =>
                patchForm({ posturePresetId: v as ResearchPosturePresetId })
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
                patchForm({ rulesPresetId: v as TradeRulesPresetId })
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
                patchForm({ riskPresetId: v as RiskPresetId })
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
                patchForm({ timeframePresetId: v as TimeframePresetId })
              }
              options={TIMEFRAME_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </ModalField>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              saveBtnBaseClass,
              canSave
                ? "cursor-pointer bg-[var(--accent)] text-[hsl(var(--primary-foreground))]"
                : "cursor-not-allowed bg-[var(--surface3)] text-[var(--text3)]",
            )}
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
  <div className="grid gap-1.5">
    <div className="text-[12px] font-semibold uppercase tracking-[0.4px] text-[var(--text3)]">
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

const iconBtnClass =
  "flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface2)] p-0 text-[var(--text3)]";

const modalInputClass =
  "box-border w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] py-[9px] text-[13px] text-[var(--text1)] outline-none";

const cancelBtnClass =
  "cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-4 py-[9px] text-[13px] font-semibold text-[var(--text2)]";

const saveBtnBaseClass =
  "rounded-lg border-none px-5 py-[9px] text-[13px] font-bold";

const createBtnClass =
  "cursor-pointer rounded-lg border border-info-border bg-info-dim px-3.5 py-[7px] text-[12px] font-bold tracking-[0.3px] text-info";
