import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatHistoryModal } from "@/components/autopsy/ChatHistoryModal";
import { LessonsPanel } from "@/components/autopsy/LessonsPanel";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import {
  parseAutopsyStructuredJson,
  parsePhaseTracesJson,
  type AutopsyStructured,
  type ExportFormat,
  type LessonCategory,
  type LessonSeverity,
  type LessonStatus,
  type TradeAutopsyRecord,
} from "@/lib/autopsy-types";
import { HelpTooltip } from "@/components/ui";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared layout / typography classes
// ---------------------------------------------------------------------------

const overlayClass =
  "fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[var(--bg)]";

const headerClass =
  "sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6";

const bodyClass =
  "mx-auto box-border w-full max-w-[1280px] flex-1 overflow-y-auto px-6 py-5";

const columnsClass = "flex items-start gap-5";

const backBtnClass =
  "cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 font-sans text-[13px] text-[var(--text2)]";

const actionBtnClass =
  "cursor-pointer rounded-md border border-[var(--border)] bg-transparent px-3.5 py-1.5 font-sans text-[12px] text-[var(--text2)]";

const openTradeGuardClass =
  "flex h-[60vh] flex-col items-center justify-center text-center";

const emptyStateClass =
  "flex min-h-[320px] flex-col items-center justify-center rounded-[10px] border border-dashed border-[var(--border)] p-10 text-center";

const sectionCardClass =
  "overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]";

const collapsibleBtnBaseClass =
  "flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-4 py-[13px] text-left";

const sectionTitleClass =
  "text-[12px] font-bold tracking-[0.02em] text-[var(--text1)]";

const sectionToggleClass = "text-[12px] text-[var(--text3)]";

const sectionBodyClass = "border-t border-[var(--border)] px-4 pb-4 pt-3.5";

const chipBaseClass =
  "inline-block rounded px-2 py-[3px] font-mono text-[12px] font-semibold";

const fieldRowClass = "mb-2.5 flex items-start gap-2.5";

const fieldLabelClass =
  "min-w-[110px] shrink-0 pt-0.5 text-[12px] font-bold uppercase tracking-[0.07em] text-[var(--text3)]";

const fieldValueClass = "flex-1 text-[13px] leading-normal text-[var(--text1)]";

const bodyTextClass = "text-[13px] leading-[1.6] text-[var(--text2)]";

const gradeChipBaseClass =
  "flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[10px]";

const gradeBannerClass =
  "flex items-start gap-5 rounded-[10px] border border-[var(--border)] px-5 pb-[18px] pt-5";

const versionBtnBaseClass =
  "cursor-pointer rounded-md px-3 py-[5px] font-mono text-[12px]";

const exportDropdownClass =
  "absolute right-0 top-[calc(100%+4px)] z-50 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface3)] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]";

const exportOptionBtnClass =
  "block w-full cursor-pointer rounded-[5px] border-none bg-transparent px-3 py-2 text-left text-[12px] text-[var(--text1)]";

const exportBackdropClass =
  "fixed inset-0 z-[49] cursor-default border-none bg-transparent p-0";

const generateBtnClass =
  "cursor-pointer rounded-lg border border-info-border bg-info-dim px-6 py-2.5 font-sans text-[14px] font-semibold text-info";

const rightSidebarClass =
  "sticky top-[58px] flex max-h-[calc(100vh-74px)] w-[300px] shrink-0 flex-col gap-3 self-start overflow-y-auto";

const mainColumnClass = "flex min-w-0 flex-1 flex-col gap-3.5";

const metaDotClass = "text-[12px] text-[var(--text3)]";

const metaMonoClass = "font-mono text-[12px] text-[var(--text3)]";

const listItemClass = "mb-[3px] text-[12px] leading-[1.6] text-[var(--text2)]";

const listItemSpacedClass =
  "mb-[5px] text-[12px] leading-[1.6] text-[var(--text2)]";

const processItemClass =
  "mb-2.5 text-[13px] leading-[1.65] text-[var(--text2)]";

const headerDividerClass = "h-[18px] w-px shrink-0 bg-[var(--border)]";

const symbolTitleClass = "font-mono text-[16px] font-bold text-[var(--text1)]";

const warningBannerBaseClass =
  "rounded-lg px-[14px] py-2.5 text-[12px] leading-normal";

// ---------------------------------------------------------------------------
// Grade styling (dynamic colors only)
// ---------------------------------------------------------------------------

const GRADE_STYLE: Record<string, { color: string; glow: string; bg: string }> =
  {
    "A+": {
      color: "var(--color-success)",
      glow: "var(--color-success-border)",
      bg: "var(--color-success-dim)",
    },
    A: {
      color: "var(--color-success)",
      glow: "var(--color-success-border)",
      bg: "var(--color-success-dim)",
    },
    B: {
      color: "var(--color-info)",
      glow: "var(--color-info-border)",
      bg: "var(--color-info-dim)",
    },
    C: {
      color: "var(--color-warning)",
      glow: "var(--color-warning-border)",
      bg: "var(--color-warning-dim)",
    },
    D: {
      color: "var(--color-orange)",
      glow: "var(--color-orange-border)",
      bg: "var(--color-orange-dim)",
    },
    F: {
      color: "var(--color-error)",
      glow: "var(--color-error-border)",
      bg: "var(--color-error-dim)",
    },
  };

function ClientDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(
      new Date(iso).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    );
  }, [iso]);

  return <span>{text ?? iso.slice(0, 10)}</span>;
}

// ---------------------------------------------------------------------------
// Collapsible section card
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  children,
  defaultOpen = true,
  accent,
  helpBody,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: string;
  helpBody?: string;
}) {
  const [open, setOpen] = useState(() => defaultOpen ?? false);

  return (
    <div className={sectionCardClass}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(collapsibleBtnBaseClass, "flex-1")}
          style={{
            borderLeft: accent
              ? `3px solid ${accent}`
              : "3px solid transparent",
          }}
        >
          <span className={sectionTitleClass}>{title}</span>
          <span className={sectionToggleClass}>{open ? "▲" : "▼"}</span>
        </button>
        {helpBody ? <HelpTooltip topic={title} body={helpBody} /> : null}
      </div>
      {open && <div className={sectionBodyClass}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline chips
// ---------------------------------------------------------------------------

function Chip({
  label,
  color,
  bg,
}: {
  label: string;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      className={chipBaseClass}
      style={{
        background: bg ?? "var(--surface3)",
        color: color ?? "var(--text2)",
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field row inside section cards
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={fieldRowClass}>
      <span className={fieldLabelClass}>{label}</span>
      <div className={fieldValueClass}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade banner
// ---------------------------------------------------------------------------

function GradeBanner({
  autopsy,
  structured,
  phaseCount,
}: {
  autopsy: TradeAutopsyRecord;
  structured: AutopsyStructured;
  phaseCount: number;
}) {
  const g = autopsy.qualityGrade ?? "—";
  const gs = GRADE_STYLE[g] ?? {
    color: "var(--text3)",
    glow: "transparent",
    bg: "var(--surface2)",
  };

  return (
    <div className={gradeBannerClass} style={{ background: gs.bg }}>
      <div
        className={gradeChipBaseClass}
        style={{
          background: `radial-gradient(circle at center, ${gs.glow} 0%, transparent 70%)`,
          border: `2px solid ${gs.color}44`,
        }}
      >
        <span
          className="font-mono text-[36px] font-extrabold leading-none"
          style={{
            color: gs.color,
            textShadow: `0 0 20px ${gs.glow}`,
          }}
        >
          {g}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
          <span
            className="font-mono text-[20px] font-bold"
            style={{ color: gs.color }}
          >
            {autopsy.qualityScore?.toFixed(0) ?? "—"}/100
          </span>
          <span className={metaDotClass}>·</span>
          <span className={metaMonoClass}>{autopsy.modelId}</span>
          <span className={metaDotClass}>·</span>
          <span className={metaMonoClass}>
            <ClientDateTime iso={autopsy.createdAt} />
          </span>
          <span className={metaDotClass}>·</span>
          <span className={metaMonoClass}>{phaseCount} phases</span>
        </div>

        <p className="m-0 text-[13px] leading-[1.65] text-[var(--text2)]">
          {structured.executiveSummary}
        </p>
      </div>
    </div>
  );
}

function LegacySummaryCard({ autopsy }: { autopsy: TradeAutopsyRecord }) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-5 py-[18px]">
      <div className="mb-2.5 text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--text3)]">
        Legacy Autopsy Summary
      </div>
      <div className="mb-3 font-mono text-[12px] text-[var(--text3)]">
        {autopsy.modelId} · <ClientDateTime iso={autopsy.createdAt} /> · grade{" "}
        {autopsy.qualityGrade ?? "N/A"}
      </div>
      <p className="m-0 text-[13px] leading-[1.65] text-[var(--text2)]">
        {autopsy.summary}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version selector
// ---------------------------------------------------------------------------

function VersionSelector({
  autopsies,
  selected,
  onSelect,
}: {
  autopsies: TradeAutopsyRecord[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (autopsies.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {autopsies.map((a, i) => {
        const active = a.id === selected;
        const date = a.createdAt.slice(0, 10);
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={cn(
              versionBtnBaseClass,
              active
                ? "border border-info-border bg-info-dim text-info"
                : "border border-[var(--border)] bg-transparent text-[var(--text3)]",
            )}
          >
            v{autopsies.length - i} · {date}
            {active && <span className="ml-1.5 text-[12px] opacity-70">●</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warning banners
// ---------------------------------------------------------------------------

function WarningBanner({
  message,
  tone = "warning",
}: {
  message: string;
  tone?: "warning" | "success" | "error";
}) {
  const prefix = tone === "success" ? "✓" : tone === "error" ? "✕" : "⚠";

  return (
    <div
      className={cn(
        warningBannerBaseClass,
        tone === "success" &&
          "border border-success-border bg-success-dim text-success",
        tone === "error" &&
          "border border-error-border bg-error-dim text-error",
        tone === "warning" &&
          "border border-warning-border bg-warning-dim text-warning",
      )}
    >
      {prefix} {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section cards — all content sections
// ---------------------------------------------------------------------------

function ThesisCard({ d }: { d: AutopsyStructured["thesisReview"] }) {
  return (
    <SectionCard
      title="Thesis Review"
      accent="var(--color-info)"
      helpBody="Revisits whether the original thesis was valid and whether the review was distorted by confirmation bias or ignored counter-signals."
    >
      <FieldRow label="Valid Thesis">
        <Chip
          label={
            d.valid === true ? "Yes" : d.valid === false ? "No" : "Uncertain"
          }
          color={
            d.valid === true
              ? "var(--color-success)"
              : d.valid === false
                ? "var(--color-error)"
                : "var(--color-warning)"
          }
          bg={
            d.valid === true
              ? "var(--color-success-dim)"
              : d.valid === false
                ? "var(--color-error-dim)"
                : "var(--color-warning-dim)"
          }
        />
      </FieldRow>
      <FieldRow label="Confirm. Bias">
        <Chip
          label={d.confirmatoryBias ? "Detected" : "None"}
          color={
            d.confirmatoryBias ? "var(--color-warning)" : "var(--color-success)"
          }
          bg={
            d.confirmatoryBias
              ? "var(--color-warning-dim)"
              : "var(--color-success-dim)"
          }
        />
      </FieldRow>
      <FieldRow label="Analysis">
        <span className={bodyTextClass}>{d.analysis}</span>
      </FieldRow>
      {d.ignoredCounterSignals.length > 0 && (
        <FieldRow label="Ignored Signals">
          <ul className="m-0 pl-4">
            {d.ignoredCounterSignals.map((s) => (
              <li key={s} className={listItemClass}>
                {s}
              </li>
            ))}
          </ul>
        </FieldRow>
      )}
    </SectionCard>
  );
}

function ExecutionCard({ d }: { d: AutopsyStructured["executionQuality"] }) {
  const timingColor: Record<string, string> = {
    early: "var(--color-warning)",
    good: "var(--color-success)",
    late: "var(--color-orange)",
    unknown: "var(--text3)",
  };
  const sizingColor: Record<string, string> = {
    oversized: "var(--color-error)",
    appropriate: "var(--color-success)",
    undersized: "var(--color-warning)",
    unknown: "var(--text3)",
  };

  return (
    <SectionCard
      title="Execution Quality"
      accent="var(--color-success)"
      helpBody="Assesses entry timing, sizing, exit management, and slippage once the trade moved from idea to execution."
    >
      <FieldRow label="Entry Timing">
        <Chip
          label={d.entryTiming}
          color={timingColor[d.entryTiming]}
          bg={`${timingColor[d.entryTiming]}20`}
        />
      </FieldRow>
      <FieldRow label="Sizing">
        <Chip
          label={d.sizingAdequacy}
          color={sizingColor[d.sizingAdequacy]}
          bg={`${sizingColor[d.sizingAdequacy]}20`}
        />
      </FieldRow>
      <FieldRow label="Exit Mgmt">
        <span className={bodyTextClass}>{d.exitManagement}</span>
      </FieldRow>
      {d.slippage && (
        <FieldRow label="Slippage">
          <span className="text-[13px] text-warning">{d.slippage}</span>
        </FieldRow>
      )}
    </SectionCard>
  );
}

function BehavioralCard({
  flags,
}: {
  flags: AutopsyStructured["behavioralFlags"];
}) {
  const sevColor: Record<string, string> = {
    low: "var(--text3)",
    medium: "var(--color-info)",
    high: "var(--color-warning)",
    critical: "var(--color-error)",
  };

  return (
    <SectionCard
      title="Behavioral Flags"
      accent="var(--color-warning)"
      helpBody="Highlights process mistakes or behavior patterns the autopsy detected, along with their severity."
    >
      {flags.length === 0 ? (
        <span className="text-[13px] text-[var(--text3)]">
          No behavioral flags detected.
        </span>
      ) : (
        <div className="flex flex-col gap-2.5">
          {flags.map((f) => (
            <div
              key={`${f.flag}-${f.severity}-${f.description}`}
              className="rounded-[7px] bg-[var(--surface2)] px-3 py-2.5"
              style={{ borderLeft: `3px solid ${sevColor[f.severity]}` }}
            >
              <div className="mb-[5px] flex items-center gap-2">
                <Chip
                  label={f.flag.replace(/_/g, " ").toUpperCase()}
                  color={sevColor[f.severity]}
                  bg={`${sevColor[f.severity]}18`}
                />
                <span
                  className="font-mono text-[12px] uppercase"
                  style={{ color: sevColor[f.severity] }}
                >
                  {f.severity}
                </span>
              </div>
              <span className="text-[12px] leading-[1.55] text-[var(--text2)]">
                {f.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function MarketContextCard({ d }: { d: AutopsyStructured["marketContext"] }) {
  const suitColor: Record<string, string> = {
    good_conditions: "var(--color-success)",
    neutral: "var(--color-info)",
    poor_conditions: "var(--color-error)",
  };
  const suitLabel: Record<string, string> = {
    good_conditions: "Good",
    neutral: "Neutral",
    poor_conditions: "Poor",
  };

  return (
    <SectionCard
      title="Market Context"
      accent="var(--color-market)"
      helpBody="Summarizes the broader regime, volatility, and suitability of the environment for this trade."
    >
      <FieldRow label="Regime">
        <Chip label={d.regime} />
      </FieldRow>
      <FieldRow label="Suitability">
        <Chip
          label={suitLabel[d.suitability] ?? d.suitability}
          color={suitColor[d.suitability]}
          bg={`${suitColor[d.suitability]}18`}
        />
      </FieldRow>
      <FieldRow label="Macro">
        <span className={bodyTextClass}>{d.macro}</span>
      </FieldRow>
      <FieldRow label="Volatility">
        <span className={bodyTextClass}>{d.volatility}</span>
      </FieldRow>
    </SectionCard>
  );
}

function WhatWorkedFailedCard({
  worked,
  failed,
}: {
  worked: string[];
  failed: string[];
}) {
  return (
    <SectionCard title="What Worked / What Failed">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-success">
            ✓ What Worked
          </div>
          <ul className="m-0 pl-3.5">
            {worked.map((w) => (
              <li key={w} className={listItemSpacedClass}>
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-error">
            ✗ What Failed
          </div>
          <ul className="m-0 pl-3.5">
            {failed.map((f) => (
              <li key={f} className={listItemSpacedClass}>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SectionCard>
  );
}

function RootCauseCard({ text }: { text: string }) {
  return (
    <SectionCard
      title="Root Cause"
      accent="var(--color-error)"
      helpBody="States the main reason the trade succeeded or failed instead of listing every surrounding detail again."
    >
      <p className="m-0 text-[13px] leading-[1.65] text-[var(--text2)]">
        {text}
      </p>
    </SectionCard>
  );
}

function ProcessImprovementsCard({ items }: { items: string[] }) {
  return (
    <SectionCard
      title="Process Improvements"
      helpBody="Actionable changes to the process, not just observations about what happened."
    >
      <ol className="m-0 pl-[18px]">
        {items.map((item) => (
          <li key={item} className={processItemClass}>
            {item}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Trade meta card (sidebar)
// ---------------------------------------------------------------------------

function TradeMetaCard({ trade }: { trade: Trade | null }) {
  if (!trade)
    return (
      <div className="h-[120px] rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5" />
    );

  const rows: [string, string][] = [
    ["Symbol", trade.instrumentSymbol],
    ["Side", trade.side],
    ["Status", trade.status],
    ["Strategy", trade.strategy],
    ["Entry", trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"],
    [
      "Stop",
      trade.stop_loss_price != null ? fmt.usd(trade.stop_loss_price) : "—",
    ],
    [
      "Target",
      trade.take_profit_price != null ? fmt.usd(trade.take_profit_price) : "—",
    ],
    ["Size", fmt.usd(trade.position_size_usd, 0)],
  ];

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-3.5 py-[11px] text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--text3)]">
        Trade Details
      </div>
      <div className="flex flex-col gap-2 px-3.5 py-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--text3)]">{k}</span>
            <span className="font-mono text-[12px] font-medium text-[var(--text1)]">
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export dropdown
// ---------------------------------------------------------------------------

function ExportDropdown({
  autopsyId,
  onExported,
  onError,
}: {
  autopsyId: string;
  onExported: (filename: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    setOpen(false);
    try {
      const result = await api.exportTradeAutopsy(autopsyId, format);
      if ("cancelled" in result && result.cancelled) return;
      if ("error" in result && result.error) {
        onError(result.error);
        return;
      }
      if ("filename" in result) {
        onExported(result.filename);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={actionBtnClass}>
        ↓ Export
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close export menu"
            className={exportBackdropClass}
            onClick={() => setOpen(false)}
          />
          <div className={exportDropdownClass}>
            {[
              { label: "Markdown (.md)", format: "markdown" },
              { label: "JSON (.json)", format: "json" },
              { label: "PDF (.pdf)", format: "pdf" },
            ].map(({ label, format }) => (
              <button
                key={format}
                onClick={() => {
                  void handleExport(format as ExportFormat);
                }}
                className={exportOptionBtnClass}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutopsyPage
// ---------------------------------------------------------------------------

export function AutopsyPage({
  tradeId,
  trade,
  onClose,
}: {
  tradeId: string;
  trade: Trade | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedAutopsyId, setSelectedAutopsyId] = useState<string | null>(
    null,
  );
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: autopsies = [], isLoading: autopsiesLoading } = useQuery({
    queryKey: ["autopsies", tradeId],
    queryFn: () => api.listTradeAutopsies(tradeId),
  });

  const { data: tradeDetail } = useQuery({
    queryKey: ["trade-detail", tradeId],
    queryFn: () => api.getTradeDetail(tradeId),
    enabled: trade == null,
  });

  const { data: lessons = [] } = useQuery({
    queryKey: ["autopsy-lessons", selectedAutopsyId],
    queryFn: () =>
      selectedAutopsyId ? api.listAutopsyLessons(selectedAutopsyId) : [],
    enabled: !!selectedAutopsyId,
  });

  useEffect(() => {
    const latestAutopsyId = autopsies[0]?.id;
    if (latestAutopsyId && !selectedAutopsyId) {
      setSelectedAutopsyId(latestAutopsyId);
    }
  }, [autopsies, selectedAutopsyId]);

  const generateMutation = useMutation({
    mutationFn: () => api.summarizeTradeAutopsy(tradeId),
    onSuccess: (record) => {
      setSelectedAutopsyId(record.id);
      void queryClient.invalidateQueries({ queryKey: ["autopsies", tradeId] });
    },
  });

  const handleStatusChange = useCallback(
    async (lessonId: string, status: LessonStatus) => {
      await api.updateAutopsyLesson({ lessonId, status });
      void queryClient.invalidateQueries({
        queryKey: ["autopsy-lessons", selectedAutopsyId],
      });
    },
    [queryClient, selectedAutopsyId],
  );

  const resolvedTrade = trade ?? tradeDetail?.trade ?? null;

  const handleAddLesson = useCallback(
    async (draft: {
      lesson: string;
      severity: LessonSeverity;
      category: LessonCategory;
      proposedFix: string;
    }) => {
      if (!selectedAutopsyId) {
        throw new Error("Select an autopsy before adding a lesson.");
      }
      if (!resolvedTrade?.sessionId) {
        throw new Error("Trade session is unavailable for this autopsy.");
      }
      await api.addAutopsyLesson({
        autopsyId: selectedAutopsyId,
        tradeId,
        sessionId: resolvedTrade.sessionId,
        lesson: draft.lesson,
        severity: draft.severity,
        category: draft.category,
        proposedFix: draft.proposedFix,
      });
      await queryClient.invalidateQueries({
        queryKey: ["autopsy-lessons", selectedAutopsyId],
      });
    },
    [queryClient, resolvedTrade?.sessionId, selectedAutopsyId, tradeId],
  );

  const autopsy = autopsies.find((a) => a.id === selectedAutopsyId) ?? null;

  const structured: AutopsyStructured | null = autopsy
    ? parseAutopsyStructuredJson(autopsy.summaryStructuredJson)
    : null;

  const phaseCount = autopsy
    ? parsePhaseTracesJson(autopsy.phaseTracesJson).length
    : 0;

  const isTradeOpen = resolvedTrade?.status === "open";
  const hasAutopsies = autopsies.length > 0;
  const isGenerating = generateMutation.isPending;

  return (
    <div className={overlayClass}>
      <div className={headerClass}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className={backBtnClass}>
            ← Back
          </button>
          <div className={headerDividerClass} />
          <div className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">
              Trade Review
            </div>
            <div className="flex items-center gap-2">
              <span className={symbolTitleClass}>
                {resolvedTrade?.instrumentSymbol ?? "—"}
              </span>
              {resolvedTrade && (
                <span
                  className="rounded px-[7px] py-0.5 font-mono text-[12px] font-semibold"
                  style={{
                    background:
                      resolvedTrade.side === "BUY"
                        ? "var(--color-success-dim)"
                        : "var(--color-error-dim)",
                    color:
                      resolvedTrade.side === "BUY"
                        ? "var(--color-success)"
                        : "var(--color-error)",
                  }}
                >
                  {resolvedTrade.side}
                </span>
              )}
              {resolvedTrade && resolvedTrade.final_pnl_usd != null && (
                <span
                  className="font-mono text-[13px] font-semibold"
                  style={{
                    color:
                      resolvedTrade.final_pnl_usd >= 0
                        ? "var(--color-success)"
                        : "var(--color-error)",
                  }}
                >
                  {fmt.pnl(resolvedTrade.final_pnl_usd)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasAutopsies && (
            <button
              onClick={() => setChatHistoryOpen(true)}
              className={actionBtnClass}
            >
              View Chat History
            </button>
          )}
          {hasAutopsies && selectedAutopsyId && (
            <ExportDropdown
              autopsyId={selectedAutopsyId}
              onExported={(filename) => {
                setExportError(null);
                setExportToast(`Autopsy exported to ${filename}`);
                window.setTimeout(() => setExportToast(null), 3000);
              }}
              onError={(message) => {
                setExportToast(null);
                setExportError(`Export failed: ${message}`);
              }}
            />
          )}
          {!isTradeOpen && (
            <button
              disabled={isGenerating}
              onClick={() => generateMutation.mutate()}
              className={cn(
                actionBtnClass,
                "border-info-border bg-info-dim text-info",
                isGenerating && "opacity-70",
              )}
            >
              {isGenerating
                ? "Generating…"
                : hasAutopsies
                  ? "Regenerate"
                  : "Generate Autopsy"}
            </button>
          )}
        </div>
      </div>

      <div className={bodyClass}>
        {isTradeOpen ? (
          <div className={openTradeGuardClass}>
            <div className="mb-3 text-[32px] opacity-40">🔒</div>
            <div className="text-[15px] font-semibold text-[var(--text1)]">
              Autopsy is only available for closed trades.
            </div>
            <div className="mt-1.5 text-[13px] text-[var(--text3)]">
              Close this position first to generate an autopsy.
            </div>
          </div>
        ) : (
          <div className={columnsClass}>
            <div className={mainColumnClass}>
              {exportToast && (
                <WarningBanner message={exportToast} tone="success" />
              )}
              {exportError && (
                <WarningBanner message={exportError} tone="error" />
              )}
              {autopsy?.isFallback && (
                <WarningBanner message="LLM unavailable — this autopsy used fallback summarization." />
              )}
              {autopsy && !structured && (
                <WarningBanner message="Structured details are unavailable for this autopsy version. Showing the saved summary only." />
              )}

              {autopsies.length > 1 && selectedAutopsyId && (
                <VersionSelector
                  autopsies={autopsies}
                  selected={selectedAutopsyId}
                  onSelect={setSelectedAutopsyId}
                />
              )}

              {!autopsiesLoading && autopsies.length === 0 && (
                <div className={emptyStateClass}>
                  <div className="mb-3.5 text-[40px] opacity-25">⚕</div>
                  <div className="mb-1.5 text-[16px] font-semibold text-[var(--text1)]">
                    No autopsy generated yet.
                  </div>
                  <div className="mb-5 text-[13px] text-[var(--text3)]">
                    Generate an autopsy to get structured analysis of this
                    trade.
                  </div>
                  <button
                    disabled={isGenerating}
                    onClick={() => generateMutation.mutate()}
                    className={cn(
                      generateBtnClass,
                      isGenerating && "opacity-70",
                    )}
                  >
                    {isGenerating ? "Generating…" : "Generate Autopsy"}
                  </button>
                </div>
              )}

              {autopsy && structured && (
                <>
                  <GradeBanner
                    autopsy={autopsy}
                    structured={structured}
                    phaseCount={phaseCount}
                  />
                  <ThesisCard d={structured.thesisReview} />
                  <ExecutionCard d={structured.executionQuality} />
                  <BehavioralCard flags={structured.behavioralFlags} />
                  <MarketContextCard d={structured.marketContext} />
                  <WhatWorkedFailedCard
                    worked={structured.whatWorked}
                    failed={structured.whatFailed}
                  />
                  {structured.rootCause && (
                    <RootCauseCard text={structured.rootCause} />
                  )}
                  {structured.processImprovements.length > 0 && (
                    <ProcessImprovementsCard
                      items={structured.processImprovements}
                    />
                  )}
                </>
              )}
              {autopsy && !structured && (
                <LegacySummaryCard autopsy={autopsy} />
              )}
            </div>

            <div className={rightSidebarClass}>
              <TradeMetaCard trade={resolvedTrade} />
              <LessonsPanel
                lessons={lessons}
                onStatusChange={handleStatusChange}
                onAddLesson={handleAddLesson}
                promoteSessionId={resolvedTrade?.sessionId ?? null}
                onPromoteLesson={async (
                  lessonId,
                  targetScope,
                  targetSessionId,
                ) => {
                  await api.promoteTradeLessonToPeriodLedger({
                    lessonId,
                    targetScope,
                    targetSessionId,
                  });
                }}
              />
            </div>
          </div>
        )}
      </div>

      {chatHistoryOpen && selectedAutopsyId && (
        <ChatHistoryModal
          open={chatHistoryOpen}
          onClose={() => setChatHistoryOpen(false)}
          autopsies={autopsies}
          selectedAutopsyId={selectedAutopsyId}
          onSelectAutopsy={setSelectedAutopsyId}
        />
      )}
    </div>
  );
}
