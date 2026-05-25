import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatHistoryModal } from "@/components/autopsy/ChatHistoryModal";
import { LessonsPanel } from "@/components/autopsy/LessonsPanel";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import type {
  AutopsyLesson,
  AutopsyStructured,
  ExportFormat,
  LessonStatus,
  QualityGrade,
  TradeAutopsyRecord,
} from "@/lib/autopsy-types";
import type { Trade } from "@/lib/types";

// ---------------------------------------------------------------------------
// Grade styling
// ---------------------------------------------------------------------------

const GRADE_STYLE: Record<
  string,
  { color: string; glow: string; bg: string }
> = {
  "A+": { color: "#34d399", glow: "rgba(52,211,153,0.25)", bg: "rgba(52,211,153,0.08)" },
  A: { color: "#34d399", glow: "rgba(52,211,153,0.2)", bg: "rgba(52,211,153,0.06)" },
  B: { color: "#60a5fa", glow: "rgba(96,165,250,0.2)", bg: "rgba(96,165,250,0.06)" },
  C: { color: "#fbbf24", glow: "rgba(251,191,36,0.2)", bg: "rgba(251,191,36,0.06)" },
  D: { color: "#f97316", glow: "rgba(249,115,22,0.2)", bg: "rgba(249,115,22,0.06)" },
  F: { color: "#f87171", glow: "rgba(248,113,113,0.2)", bg: "rgba(248,113,113,0.06)" },
};

const PHASE_LABEL: Record<string, string> = {
  thesis: "Thesis",
  execution: "Execution",
  behavioral: "Behavioral",
  market_context: "Market",
  synthesis: "Synthesis",
};

// ---------------------------------------------------------------------------
// Collapsible section card
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  children,
  defaultOpen = true,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "13px 16px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          borderLeft: accent ? `3px solid ${accent}` : "3px solid transparent",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text1)",
            letterSpacing: "0.02em",
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div
          style={{
            padding: "0 16px 16px",
            borderTop: "1px solid var(--border)",
            paddingTop: 14,
          }}
        >
          {children}
        </div>
      )}
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
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: 4,
        background: bg ?? "var(--surface3)",
        color: color ?? "var(--text2)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
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
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        marginBottom: 10,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "var(--text3)",
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          minWidth: 110,
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, fontSize: 13, color: "var(--text1)", lineHeight: 1.5 }}>
        {children}
      </div>
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
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: gs.bg,
        padding: "20px 20px 18px",
        display: "flex",
        gap: 20,
        alignItems: "flex-start",
      }}
    >
      {/* Grade chip */}
      <div
        style={{
          flexShrink: 0,
          width: 72,
          height: 72,
          borderRadius: 10,
          background: `radial-gradient(circle at center, ${gs.glow} 0%, transparent 70%)`,
          border: `2px solid ${gs.color}44`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 36,
            fontWeight: 800,
            color: gs.color,
            lineHeight: 1,
            textShadow: `0 0 20px ${gs.glow}`,
          }}
        >
          {g}
        </span>
      </div>

      {/* Right side */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Score + meta */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 20,
              fontWeight: 700,
              color: gs.color,
            }}
          >
            {autopsy.qualityScore?.toFixed(0) ?? "—"}/100
          </span>
          <span style={{ color: "var(--text3)", fontSize: 12 }}>·</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {autopsy.modelId}
          </span>
          <span style={{ color: "var(--text3)", fontSize: 12 }}>·</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {new Date(autopsy.createdAt).toLocaleString()}
          </span>
          <span style={{ color: "var(--text3)", fontSize: 12 }}>·</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {phaseCount} phases
          </span>
        </div>

        {/* Executive summary */}
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.65,
          }}
        >
          {structured.executiveSummary}
        </p>
      </div>
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
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {autopsies.map((a, i) => {
        const active = a.id === selected;
        const date = new Date(a.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              border: `1px solid ${active ? "rgba(96,165,250,0.5)" : "var(--border)"}`,
              background: active ? "rgba(96,165,250,0.12)" : "transparent",
              color: active ? "#60a5fa" : "var(--text3)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            v{autopsies.length - i} · {date}
            {active && (
              <span style={{ marginLeft: 6, opacity: 0.7, fontSize: 9 }}>●</span>
            )}
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
  const styles =
    tone === "success"
      ? {
          background: "rgba(52,211,153,0.08)",
          border: "1px solid rgba(52,211,153,0.25)",
          color: "#6ee7b7",
          prefix: "✓",
        }
      : tone === "error"
        ? {
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
            color: "#fca5a5",
            prefix: "✕",
          }
        : {
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.25)",
            color: "#fcd34d",
            prefix: "⚠",
          };
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 8,
        background: styles.background,
        border: styles.border,
        fontSize: 12,
        color: styles.color,
        lineHeight: 1.5,
      }}
    >
      {styles.prefix} {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section cards — all content sections
// ---------------------------------------------------------------------------

function ThesisCard({ d }: { d: AutopsyStructured["thesisReview"] }) {
  return (
    <SectionCard title="Thesis Review" accent="#60a5fa">
      <FieldRow label="Valid Thesis">
        <Chip
          label={d.valid === true ? "Yes" : d.valid === false ? "No" : "Uncertain"}
          color={d.valid === true ? "#34d399" : d.valid === false ? "#f87171" : "#fbbf24"}
          bg={d.valid === true ? "rgba(52,211,153,0.12)" : d.valid === false ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.12)"}
        />
      </FieldRow>
      <FieldRow label="Confirm. Bias">
        <Chip
          label={d.confirmatoryBias ? "Detected" : "None"}
          color={d.confirmatoryBias ? "#fbbf24" : "#34d399"}
          bg={d.confirmatoryBias ? "rgba(251,191,36,0.12)" : "rgba(52,211,153,0.12)"}
        />
      </FieldRow>
      <FieldRow label="Analysis">
        <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          {d.analysis}
        </span>
      </FieldRow>
      {d.ignoredCounterSignals.length > 0 && (
        <FieldRow label="Ignored Signals">
          <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
            {d.ignoredCounterSignals.map((s, i) => (
              <li
                key={i}
                style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.6, marginBottom: 3 }}
              >
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
    early: "#fbbf24",
    good: "#34d399",
    late: "#f97316",
    unknown: "var(--text3)",
  };
  const sizingColor: Record<string, string> = {
    oversized: "#f87171",
    appropriate: "#34d399",
    undersized: "#fbbf24",
    unknown: "var(--text3)",
  };

  return (
    <SectionCard title="Execution Quality" accent="#34d399">
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
        <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          {d.exitManagement}
        </span>
      </FieldRow>
      {d.slippage && (
        <FieldRow label="Slippage">
          <span style={{ fontSize: 13, color: "#fbbf24" }}>{d.slippage}</span>
        </FieldRow>
      )}
    </SectionCard>
  );
}

function BehavioralCard({ flags }: { flags: AutopsyStructured["behavioralFlags"] }) {
  const sevColor: Record<string, string> = {
    low: "var(--text3)",
    medium: "#60a5fa",
    high: "#fbbf24",
    critical: "#f87171",
  };

  return (
    <SectionCard title="Behavioral Flags" accent="#fbbf24">
      {flags.length === 0 ? (
        <span style={{ fontSize: 13, color: "var(--text3)" }}>
          No behavioral flags detected.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {flags.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                borderRadius: 7,
                background: "var(--surface2)",
                borderLeft: `3px solid ${sevColor[f.severity]}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 5,
                }}
              >
                <Chip
                  label={f.flag.replace(/_/g, " ").toUpperCase()}
                  color={sevColor[f.severity]}
                  bg={`${sevColor[f.severity]}18`}
                />
                <span
                  style={{
                    fontSize: 10,
                    color: sevColor[f.severity],
                    fontFamily: "var(--font-mono)",
                    textTransform: "uppercase",
                  }}
                >
                  {f.severity}
                </span>
              </div>
              <span style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.55 }}>
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
    good_conditions: "#34d399",
    neutral: "#60a5fa",
    poor_conditions: "#f87171",
  };
  const suitLabel: Record<string, string> = {
    good_conditions: "Good",
    neutral: "Neutral",
    poor_conditions: "Poor",
  };

  return (
    <SectionCard title="Market Context" accent="#a78bfa">
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
        <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          {d.macro}
        </span>
      </FieldRow>
      <FieldRow label="Volatility">
        <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          {d.volatility}
        </span>
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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              color: "#34d399",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            ✓ What Worked
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {worked.map((w, i) => (
              <li
                key={i}
                style={{
                  fontSize: 12,
                  color: "var(--text2)",
                  lineHeight: 1.6,
                  marginBottom: 5,
                }}
              >
                {w}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div
            style={{
              fontSize: 10,
              color: "#f87171",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            ✗ What Failed
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 14px" }}>
            {failed.map((f, i) => (
              <li
                key={i}
                style={{
                  fontSize: 12,
                  color: "var(--text2)",
                  lineHeight: 1.6,
                  marginBottom: 5,
                }}
              >
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
    <SectionCard title="Root Cause" accent="#f87171">
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--text2)",
          lineHeight: 1.65,
        }}
      >
        {text}
      </p>
    </SectionCard>
  );
}

function ProcessImprovementsCard({ items }: { items: string[] }) {
  return (
    <SectionCard title="Process Improvements">
      <ol style={{ margin: 0, padding: "0 0 0 18px" }}>
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              fontSize: 13,
              color: "var(--text2)",
              lineHeight: 1.65,
              marginBottom: i < items.length - 1 ? 10 : 0,
            }}
          >
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
      <div
        style={{
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--surface2)",
          padding: "14px 16px",
          height: 120,
        }}
      />
    );

  const rows: [string, string][] = [
    ["Symbol", trade.instrumentSymbol],
    ["Side", trade.side],
    ["Status", trade.status],
    ["Strategy", trade.strategy],
    ["Entry", trade.entry_price != null ? fmt.usd(trade.entry_price) : "—"],
    ["Stop", trade.stop_loss_price != null ? fmt.usd(trade.stop_loss_price) : "—"],
    ["Target", trade.take_profit_price != null ? fmt.usd(trade.take_profit_price) : "—"],
    ["Size", fmt.usd(trade.position_size_usd, 0)],
  ];

  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "11px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10,
          color: "var(--text3)",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Trade Details
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(([k, v]) => (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{k}</span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text1)",
                fontFamily: "var(--font-mono)",
                fontWeight: 500,
              }}
            >
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
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={actionBtnStyle}
      >
        ↓ Export
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              zIndex: 50,
              background: "var(--surface3)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 4,
              minWidth: 160,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
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
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 5,
                  border: "none",
                  background: "transparent",
                  color: "var(--text1)",
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
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
  const [selectedAutopsyId, setSelectedAutopsyId] = useState<string | null>(null);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: autopsies = [], isLoading: autopsiesLoading } = useQuery({
    queryKey: ["autopsies", tradeId],
    queryFn: () => api.listTradeAutopsies(tradeId),
  });

  const { data: lessons = [] } = useQuery({
    queryKey: ["autopsy-lessons", selectedAutopsyId],
    queryFn: () =>
      selectedAutopsyId ? api.listAutopsyLessons(selectedAutopsyId) : [],
    enabled: !!selectedAutopsyId,
  });

  useEffect(() => {
    if (autopsies.length > 0 && !selectedAutopsyId) {
      setSelectedAutopsyId(autopsies[0]!.id);
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

  // Resolve selected autopsy
  const autopsy = autopsies.find((a) => a.id === selectedAutopsyId) ?? null;

  // Parse structured JSON
  const structured: AutopsyStructured | null = autopsy
    ? (() => {
        try {
          return JSON.parse(autopsy.summaryStructuredJson) as AutopsyStructured;
        } catch {
          return null;
        }
      })()
    : null;

  // Phase count
  const phaseCount = autopsy
    ? (() => {
        try {
          const traces = JSON.parse(autopsy.phaseTracesJson) as unknown[];
          return traces.length;
        } catch {
          return 0;
        }
      })()
    : 0;

  const isTradeOpen = trade?.status === "open";
  const hasAutopsies = autopsies.length > 0;
  const isGenerating = generateMutation.isPending;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={overlay}>
      {/* Sticky header */}
      <div style={headerStyle}>
        {/* Left */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={backBtnStyle}>
            ← Back
          </button>
          <div
            style={{
              width: 1,
              height: 18,
              background: "var(--border)",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text1)",
              }}
            >
              {trade?.instrumentSymbol ?? "—"}
            </span>
            {trade && (
              <span
                style={{
                  padding: "2px 7px",
                  borderRadius: 4,
                  background:
                    trade.side === "BUY"
                      ? "rgba(52,211,153,0.15)"
                      : "rgba(248,113,113,0.15)",
                  color: trade.side === "BUY" ? "#34d399" : "#f87171",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                }}
              >
                {trade.side}
              </span>
            )}
            {trade && trade.final_pnl_usd != null && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color:
                    trade.final_pnl_usd >= 0 ? "#34d399" : "#f87171",
                  fontWeight: 600,
                }}
              >
                {fmt.pnl(trade.final_pnl_usd)}
              </span>
            )}
          </div>
        </div>

        {/* Right: action bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasAutopsies && (
            <button
              onClick={() => setChatHistoryOpen(true)}
              style={actionBtnStyle}
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
              style={{
                ...actionBtnStyle,
                background: isGenerating
                  ? "rgba(96,165,250,0.1)"
                  : "rgba(96,165,250,0.15)",
                borderColor: "rgba(96,165,250,0.4)",
                color: "#60a5fa",
                opacity: isGenerating ? 0.7 : 1,
              }}
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

      {/* Body */}
      <div style={bodyStyle}>
        {/* Open trade guard */}
        {isTradeOpen ? (
          <div style={openTradeGuard}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>
              🔒
            </div>
            <div
              style={{ fontSize: 15, color: "var(--text1)", fontWeight: 600 }}
            >
              Autopsy is only available for closed trades.
            </div>
            <div
              style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}
            >
              Close this position first to generate an autopsy.
            </div>
          </div>
        ) : (
          <div style={columnsStyle}>
            {/* MAIN COLUMN */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Warnings */}
              {exportToast && (
                <WarningBanner message={exportToast} tone="success" />
              )}
              {exportError && <WarningBanner message={exportError} tone="error" />}
              {autopsy?.isFallback && (
                <WarningBanner message="LLM unavailable — this autopsy used fallback summarization." />
              )}

              {/* Version selector */}
              {autopsies.length > 1 && selectedAutopsyId && (
                <VersionSelector
                  autopsies={autopsies}
                  selected={selectedAutopsyId}
                  onSelect={setSelectedAutopsyId}
                />
              )}

              {/* Empty state */}
              {!autopsiesLoading && autopsies.length === 0 && (
                <div style={emptyStateStyle}>
                  <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.25 }}>
                    ⚕
                  </div>
                  <div
                    style={{
                      fontSize: 16,
                      color: "var(--text1)",
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    No autopsy generated yet.
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text3)",
                      marginBottom: 20,
                    }}
                  >
                    Generate an autopsy to get structured analysis of this trade.
                  </div>
                  <button
                    disabled={isGenerating}
                    onClick={() => generateMutation.mutate()}
                    style={{
                      padding: "10px 24px",
                      borderRadius: 8,
                      border: "1px solid rgba(96,165,250,0.4)",
                      background: "rgba(96,165,250,0.15)",
                      color: "#60a5fa",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {isGenerating ? "Generating…" : "Generate Autopsy"}
                  </button>
                </div>
              )}

              {/* Autopsy content */}
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
            </div>

            {/* RIGHT SIDEBAR */}
            <div
              style={{
                width: 300,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                position: "sticky",
                top: 58,
                alignSelf: "flex-start",
                maxHeight: "calc(100vh - 74px)",
                overflowY: "auto",
              }}
            >
              <TradeMetaCard trade={trade} />
              <LessonsPanel
                lessons={lessons}
                onStatusChange={handleStatusChange}
              />
            </div>
          </div>
        )}
      </div>

      {/* Chat history modal */}
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  background: "var(--bg)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 24px",
  height: 56,
  borderBottom: "1px solid var(--border)",
  background: "var(--surface)",
  flexShrink: 0,
  position: "sticky",
  top: 0,
  zIndex: 10,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "20px 24px",
  maxWidth: 1280,
  width: "100%",
  margin: "0 auto",
  boxSizing: "border-box",
};

const columnsStyle: CSSProperties = {
  display: "flex",
  gap: 20,
  alignItems: "flex-start",
};

const backBtnStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
};

const actionBtnStyle: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text2)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-sans)",
};

const openTradeGuard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "60vh",
  textAlign: "center",
};

const emptyStateStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 320,
  textAlign: "center",
  borderRadius: 10,
  border: "1px dashed var(--border)",
  padding: 40,
};
