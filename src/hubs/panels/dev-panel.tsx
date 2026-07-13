import {
  type Reducer,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AgentLabel, Dot } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import type {
  AgentMessage,
  AgentRun,
  EventRow,
  EventSourceType,
  LogLevel,
} from "@/lib/types";
import type {
  AIPhaseTrace,
  SessionSummary,
  SessionExecutionProgressResponse,
} from "@/lib/exva";
import type { EffectivePipelineConfig } from "@electron/shared/ai/effective-ai-phase-config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DevPanelFocus {
  sessionId: string;
  cycleId: string;
  stage: string;
}

type ScopeType =
  | "global"
  | "session"
  | "cycle"
  | "trade"
  | "provider"
  | "broker";
interface ActiveScope {
  type: ScopeType;
  id?: string;
  label?: string;
}

type InspectorTab =
  | "overview"
  | "execution"
  | "config"
  | "trace"
  | "graph"
  | "calls"
  | "raw";
type TimeWindow = 15 | 60 | 360 | 1440 | 0;

interface ExtEventRow extends EventRow {
  cycle_id?: string | null;
}
interface ExtAgentRun extends AgentRun {
  cycle_id?: string | null;
}

interface ScopeDiagnostics {
  scopeLabel: string;
  session?: SessionSummary | null;
  activeCycleId?: string | null;
  executionProgress?: SessionExecutionProgressResponse;
  pipelineConfig?: EffectivePipelineConfig | null;
  pipelineConfigError?: string | null;
  counts: {
    events: number;
    errors: number;
    warnings: number;
    agentRuns: number;
    externalCalls: number;
    failedSteps: number;
  };
  latestError?: { message: string; createdAt: string; eventId: string } | null;
}

interface ExportBundleResult {
  path: string;
  sizeBytes: number;
  includedSections: string[];
  redactionCount: number;
  warnings: string[];
}

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

function developerApi() {
  return window.exva?.developer;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
type PinoLevel = (typeof LOG_LEVELS)[number];
const TIME_WINDOWS: Array<{ value: TimeWindow; label: string }> = [
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 360, label: "6h" },
  { value: 1440, label: "24h" },
  { value: 0, label: "All" },
];
const SOURCE_TYPES = [
  "session",
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
  "broker",
  "capital",
  "preflight",
  "orchestrator",
];

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "var(--color-log-debug)",
  INFO: "var(--color-log-info)",
  WARN: "var(--color-log-warn)",
  ERROR: "var(--color-log-error)",
  CRITICAL: "var(--color-log-error)",
};
const LEVEL_BG: Record<LogLevel, string> = {
  DEBUG: "color-mix(in srgb, var(--color-log-debug) 20%, transparent)",
  INFO: "var(--color-info-dim)",
  WARN: "var(--color-warning-dim)",
  ERROR: "var(--color-error-dim)",
  CRITICAL: "var(--color-error-dim)",
};
const ROLE_COLOR: Record<string, string> = {
  technical: "var(--color-success)",
  fundamental: "var(--color-error)",
  review: "var(--color-info)",
  decision: "var(--color-market)",
  selector: "var(--color-warning)",
  orchestrator: "var(--color-orange)",
  preflight: "var(--color-warning)",
  capital: "var(--color-success)",
  broker: "var(--color-info)",
  session: "var(--text3)",
};

// ─── Shared class bundles ─────────────────────────────────────────────────────

const devClass = {
  mono9: "font-mono text-[12px] tracking-[0.08em]",
  mono10: "font-mono text-[12px]",
  mono11: "font-mono text-[12px]",
  label:
    "font-mono text-[12px] font-extrabold tracking-[0.12em] uppercase text-[var(--text3)]",
  sectionTitle:
    "font-mono text-[8px] font-extrabold tracking-[0.16em] uppercase text-[var(--text3)] px-3 pt-2.5 pb-1",
  copyBtnBase:
    "rounded px-[7px] py-[2px] font-mono text-[12px] tracking-[0.08em] font-bold cursor-pointer transition-[background,border-color,color] duration-150",
  statusChipBase:
    "inline-flex items-center gap-1 rounded-[5px] px-[7px] py-[2px] font-mono text-[12px] tracking-[0.08em] font-bold",
  scopeItemBtn:
    "flex w-full items-center gap-2 border-0 py-[7px] pl-3.5 pr-3 text-left cursor-pointer transition-[background,border-color] duration-100",
  stripBtnBase:
    "flex items-center gap-[5px] rounded-[5px] px-2.5 py-[5px] font-mono text-[12px] tracking-[0.08em] font-bold transition-[background,border-color,opacity] duration-[120ms]",
  eventTimelineOuter:
    "flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]",
  eventRowBtnBase:
    "flex w-full cursor-pointer items-start gap-2 border-0 border-b border-b-white/[0.022] px-3.5 py-[7px] text-left transition-[background] duration-[80ms]",
  preBlockWithMax:
    "max-h-[420px] overflow-x-auto whitespace-pre-wrap rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] tracking-[0.08em] leading-[1.65] text-[var(--text2)]",
  preBlock:
    "overflow-x-auto whitespace-pre-wrap rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] tracking-[0.08em] leading-[1.65] text-[var(--text2)]",
  runCardHeaderBtn:
    "flex w-full cursor-pointer items-center gap-1.5 border-0 bg-[var(--surface2)] px-2.5 py-2 text-left",
  inspectorTabBtnBase:
    "cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 py-2 font-mono text-[12px] font-bold tracking-[0.05em] transition-[color,border-color] duration-100",
  debugCaptureBtnBase:
    "flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--color-info-border)] bg-[var(--color-info-dim)] px-4 py-[7px] font-mono text-[12px] font-bold tracking-[0.08em] text-[var(--color-info)]",
  toggleTrackBase:
    "relative h-[18px] w-9 cursor-pointer rounded-[9px] border-0 transition-[background] duration-200",
  toggleThumbBase:
    "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] duration-200",
  exportDrawer:
    "fixed bottom-5 right-5 z-20 flex w-[360px] flex-col gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)]",
  exportActionBtn:
    "flex-1 cursor-pointer rounded-[5px] border border-[var(--border)] bg-[var(--surface3)] py-1.5 font-mono text-[12px] font-bold tracking-[0.08em] text-[var(--text2)]",
  toastContainer:
    "pointer-events-none fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 flex-col gap-1.5",
  streamBadgeBase:
    "inline-flex items-center gap-1 rounded-[5px] px-2 py-[3px] font-mono text-[12px] tracking-[0.08em]",
  headerBtnBase:
    "flex items-center gap-[5px] rounded-md px-2.5 py-[5px] font-mono text-[12px] font-bold tracking-[0.08em] transition-[background,border-color,opacity] duration-[120ms]",
  searchInput:
    "flex-1 rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-[5px] text-[var(--text1)] outline-none shadow-none focus:shadow-[0_0_0_2px_var(--accent)]",
  scopeRail:
    "flex w-[210px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)]",
  scopeRailHeader:
    "shrink-0 border-b border-[var(--border)] px-3.5 pb-2 pt-3.5",
  actionStrip:
    "flex shrink-0 flex-col gap-2 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-2",
  actionStripRow: "flex flex-wrap items-center gap-2.5",
  filterGroup:
    "flex overflow-hidden rounded-[5px] border border-[var(--border)] bg-[var(--bg)]",
  statPill:
    "flex items-center gap-1 rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-2 py-[3px]",
  timelineSearchBar:
    "flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface2)] px-3 py-2",
  tabPadding: "flex flex-col gap-2 px-3.5 py-3",
  sectionCard:
    "flex flex-col gap-1.5 rounded-[7px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2",
  sectionCardTitle:
    "mb-0.5 border-b border-[var(--border)] pb-[5px] font-mono text-[12px] font-extrabold tracking-[0.12em] uppercase text-[var(--text3)]",
  dataRow: "flex min-h-5 items-start justify-between gap-3",
  emptyState:
    "px-5 py-9 text-center font-mono text-[12px] leading-relaxed tracking-[0.08em] text-[var(--text3)]",
  inspectorPanel:
    "flex flex-col overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)]",
  inspectorTabBar:
    "flex shrink-0 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface2)]",
  mainColumn: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
  devHeader:
    "flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface2)] px-4 py-2.5",
  mainSplit: "flex min-h-0 flex-1 gap-2.5 overflow-hidden p-2.5",
  timelineColumn: "flex min-w-0 basis-[60%] flex-col",
  inspectorColumn: "flex min-w-0 basis-[calc(40%-10px)] flex-col",
  devFooter:
    "flex shrink-0 items-center gap-4 border-t border-[var(--border)] bg-[var(--surface2)] px-4 py-1",
  rootLayout: "flex min-h-0 flex-1 overflow-hidden",
  skeletonRow:
    "flex h-9 items-center gap-2.5 border-b border-b-[var(--border)] px-3.5",
  skeletonBar: "h-2 rounded-[3px] bg-[var(--surface3)] opacity-60",
  modalOverlay:
    "fixed inset-0 z-[1000] flex items-center justify-center bg-black/70",
  modalPanel:
    "flex w-[420px] flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-5",
  closeBtn: "cursor-pointer border-0 bg-transparent text-[var(--text3)]",
  fieldGroup: "flex flex-col gap-1.5",
  toggleRow: "flex items-center justify-between",
  scopeFooter: "border-t border-[var(--border)] py-2",
  lifecycleDivider: "mx-0.5 h-5 w-px bg-[var(--border)]",
  loadMoreWrap: "flex justify-center px-3.5 py-3",
  loadMoreBtn:
    "cursor-pointer rounded-[5px] border border-[var(--border)] bg-[var(--surface3)] px-4 py-1.5 font-mono text-[12px] font-bold tracking-[0.08em] text-[var(--text2)]",
  collapsibleBody:
    "font-mono text-[12px] leading-relaxed text-[var(--text2)] whitespace-pre-wrap break-words",
  expandBtn:
    "mt-1 cursor-pointer border-0 bg-transparent font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]",
  logSelect:
    "cursor-pointer rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-1.5 py-[3px] font-mono text-[12px] tracking-[0.08em] text-[var(--text2)]",
  filterChipBtn:
    "cursor-pointer rounded px-[7px] py-[2px] font-mono text-[12px] tracking-[0.08em] font-bold",
  windowBtn:
    "cursor-pointer border-0 px-2 py-1 font-mono text-[12px] tracking-[0.08em] font-bold",
  levelBtn:
    "cursor-pointer border-0 px-2 py-[3px] font-mono text-[12px] tracking-[0.08em] font-bold",
  scopeLabelTitle:
    "font-mono text-[12px] font-extrabold tracking-[0.05em] text-[var(--text3)]",
  devTitle: "text-sm font-extrabold tracking-tight text-[var(--text1)]",
  scopeSubtitle:
    "mt-0.5 font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]",
  modalTitle:
    "font-mono text-[12px] font-extrabold tracking-[0.05em] text-[var(--text1)]",
  modalScopeBox:
    "rounded-md border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1.5 font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]",
  modalCancelBtn:
    "cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface3)] px-4 py-[7px] font-mono text-[12px] font-bold tracking-[0.08em] text-[var(--text2)]",
  captureDurationBtn:
    "cursor-pointer rounded-[5px] px-3 py-[5px] font-mono text-[12px] tracking-[0.08em] font-bold",
  captureSelect:
    "w-full rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-2 py-[5px] font-mono text-[12px] text-[var(--text1)]",
  traceConfirmBtn:
    "cursor-pointer rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-dim)] px-2.5 py-1 font-mono text-[12px] font-bold tracking-[0.08em] text-[var(--color-warning)]",
  eventLevelBtn:
    "flex-1 cursor-pointer border-0 px-1 py-[5px] font-mono text-[12px] tracking-[0.08em] font-bold",
  exportSectionChip:
    "rounded-[3px] bg-[var(--surface3)] px-[5px] py-[2px] font-mono text-[12px] tracking-[0.08em] text-[var(--text2)]",
  exportHeaderRow: "flex items-center justify-between",
  statGridCell:
    "rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-center",
  executionStepCard: "rounded-md px-2.5 py-2",
  runCardShell: "overflow-hidden rounded-[7px] border border-[var(--border)]",
  runCardBody: "border-t border-[var(--border)] bg-[var(--bg)] px-3 py-2.5",
  phaseGraphHeader:
    "flex items-center justify-between bg-[var(--surface2)] px-2.5 py-[7px]",
  phaseGraphBody: "flex flex-col gap-2 bg-[var(--bg)] px-3 py-2.5",
  workerCard:
    "rounded-[5px] border border-[var(--border)] bg-[var(--surface)] px-[9px] py-[7px]",
  apiCallCard:
    "rounded-[5px] border border-[var(--border)] bg-[var(--bg)] px-[9px] py-[7px]",
  phaseGraphShell:
    "overflow-hidden rounded-[7px] border border-[var(--border)]",
  rawTabHeader: "mb-1.5 flex justify-end",
  flex1Scroll: "flex-1 overflow-y-auto",
  flex1: "flex-1",
  mlAutoFlex: "ml-auto flex items-center gap-1.5",
  mlAutoFlexGap: "ml-auto flex gap-1.5",
  flexWrapGap: "flex flex-wrap items-center gap-2",
  flexGap: "flex gap-1.5",
  flexColGap: "flex flex-col gap-2",
  flexColGapSm: "flex flex-col gap-1.5",
  grid3: "grid grid-cols-3 gap-1.5",
  grid4: "grid grid-cols-4 gap-1.5",
  centerEmpty: "px-6 py-12 text-center",
  iconMuted: "text-xs opacity-50",
  scopeItemLabel: "min-w-0 flex-1",
  scopeItemTitle:
    "overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px]",
  noFocusedSession:
    "px-3.5 py-1.5 font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]",
  sessionCount:
    "px-3.5 py-1 font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]",
  skeletonGroup: "flex gap-1.5",
  controlsCluster: "ml-auto flex items-center gap-1.5",
  sourceFilterRow: "flex flex-wrap gap-1",
  eventSourceRow: "flex shrink-0 flex-wrap items-center gap-1",
  stepHeaderRow: "flex items-center justify-between gap-2",
  workerHeaderRow: "flex items-center justify-between gap-2",
  apiCallHeaderRow: "flex flex-wrap items-center gap-2",
  configHeaderRow: "mb-1.5 flex items-center justify-between",
  modalActions: "flex justify-end gap-2",
  exportChipRow: "flex flex-wrap gap-1.5",
  exportActions: "flex gap-1.5",
  toggleList: "flex flex-col gap-2",
  captureDurationRow: "flex flex-wrap gap-1.5",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function copyText(t: string) {
  navigator.clipboard.writeText(t).catch(() => {});
}

function parseJsonSafe(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parsePhaseTrace(
  m: AgentMessage | null | undefined,
): AIPhaseTrace | null {
  const p = parseJsonSafe(m?.tool_calls_json) as AIPhaseTrace | null;
  if (!p || typeof p !== "object") return null;
  if (
    p.version !== 1 ||
    !p.phase ||
    !Array.isArray(p.workers) ||
    !Array.isArray(p.frontiers)
  )
    return null;
  return p;
}

function summarizeEventSource(ev: ExtEventRow): string {
  const msg = ev.message;
  if (msg.startsWith("[stage:")) return "stage";
  if (msg.startsWith("[worker:")) return "worker";
  if (msg.startsWith("[execution]")) return "execution";
  return ev.agent_type ?? "system";
}

export function formatEventsForClipboard(events: ExtEventRow[]): string {
  const lines = events.map((ev) => {
    const source = ev.agent_type ?? summarizeEventSource(ev);
    const refs = [ev.session_id, ev.cycle_id, ev.trade_id]
      .filter(Boolean)
      .join(" · ");
    return [
      `${ev.created_at} [${ev.level}] [${source}] ${ev.message}`,
      refs ? `refs: ${refs}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    `Developer Workbench Events (${events.length})`,
    "",
    lines.join("\n\n"),
    "",
    "Raw JSON",
    JSON.stringify(events, null, 2),
  ].join("\n");
}

function useToasts() {
  const [toasts, setToasts] = useState<
    Array<{ id: string; msg: string; kind: "ok" | "err" }>
  >([]);
  const show = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, msg, kind }]);
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }, []);
  return { toasts, show };
}

// ─── Atom components ──────────────────────────────────────────────────────────

const CopyBtn = ({
  text,
  label = "copy",
}: {
  text: string;
  label?: string;
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={devClass.copyBtnBase}
      style={{
        background: copied ? "var(--color-success-dim)" : "var(--surface3)",
        border: `1px solid ${copied ? "var(--color-success-border)" : "var(--border)"}`,
        color: copied ? "var(--color-success)" : "var(--text3)",
      }}
    >
      {copied ? "copied!" : label}
    </button>
  );
};

const StatusChip = ({ status }: { status: string }) => {
  const c =
    status === "active"
      ? "var(--color-success)"
      : status === "paused"
        ? "var(--color-warning)"
        : status === "error"
          ? "var(--color-error)"
          : status === "stopping"
            ? "var(--color-orange)"
            : "var(--text3)";
  return (
    <span
      className={devClass.statusChipBase}
      style={{
        background: `${c}18`,
        border: `1px solid ${c}44`,
        color: c,
      }}
    >
      <Dot color={c} pulse={status === "active"} size={4} />
      {status}
    </span>
  );
};

const SkeletonRow = () => (
  <div className={devClass.skeletonRow}>
    {[48, 40, 80, 200].map((w) => (
      <div key={w} className={devClass.skeletonBar} style={{ width: w }} />
    ))}
  </div>
);

const Spinner = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" className="animate-spin">
    <circle
      cx="6"
      cy="6"
      r="4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="14 6"
    />
  </svg>
);

const CollapsibleText = ({
  text,
  collapseAt = 700,
}: {
  text: string | null | undefined;
  collapseAt?: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (!text)
    return (
      <span className={cn(devClass.mono9, "text-[var(--text3)]")}>n/a</span>
    );
  const needs = text.length > collapseAt;
  return (
    <div>
      <div className={devClass.collapsibleBody}>
        {needs && !expanded ? text.slice(0, collapseAt) + "…" : text}
      </div>
      {needs && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className={devClass.expandBtn}
        >
          {expanded
            ? "collapse"
            : `show all (${(text.length / 1000).toFixed(1)}k)`}
        </button>
      )}
    </div>
  );
};

// ─── Scope Rail ───────────────────────────────────────────────────────────────

const ScopeRailItem = ({
  scope,
  label,
  subLabel,
  status,
  icon,
  activeScope,
  onScopeChange,
}: {
  scope: ActiveScope;
  label: string;
  subLabel?: string;
  status?: string;
  icon?: string;
  activeScope: ActiveScope;
  onScopeChange: (scope: ActiveScope) => void;
}) => {
  const isActive =
    activeScope.type === scope.type && activeScope.id === scope.id;
  const c = isActive ? "var(--accent)" : "transparent";
  return (
    <button
      type="button"
      onClick={() => onScopeChange(scope)}
      className={devClass.scopeItemBtn}
      style={{
        borderLeft: `2px solid ${c}`,
        background: isActive ? "var(--color-info-dim)" : "transparent",
      }}
    >
      {icon && <span className={devClass.iconMuted}>{icon}</span>}
      <div className={devClass.scopeItemLabel}>
        <div
          className={cn(
            devClass.scopeItemTitle,
            isActive ? "font-bold text-[var(--text1)]" : "text-[var(--text2)]",
          )}
        >
          {label}
        </div>
        {subLabel && (
          <div className={cn(devClass.mono9, "mt-px text-[var(--text3)]")}>
            {subLabel}
          </div>
        )}
      </div>
      {status && <StatusChip status={status} />}
    </button>
  );
};

const ScopeRail = ({
  activeScope,
  onScopeChange,
  sessions,
  focusedSessionId,
}: {
  activeScope: ActiveScope;
  onScopeChange: (scope: ActiveScope) => void;
  sessions: SessionSummary[];
  focusedSessionId: string | null;
}) => {
  const focused = sessions.find((s) => s.id === focusedSessionId) ?? null;
  const others = sessions.filter(
    (s) => s.id !== focusedSessionId && s.status !== "archived",
  );

  return (
    <div className={devClass.scopeRail}>
      <div className={devClass.scopeRailHeader}>
        <div className={devClass.scopeLabelTitle}>SCOPE</div>
      </div>

      <ScopeRailItem
        scope={{ type: "global" }}
        label="Global workspace"
        icon="◈"
        activeScope={activeScope}
        onScopeChange={onScopeChange}
      />

      <div className={devClass.sectionTitle}>Session</div>
      {focused ? (
        <ScopeRailItem
          scope={{ type: "session", id: focused.id, label: focused.name }}
          label={focused.name}
          subLabel="focused"
          status={focused.status}
          activeScope={activeScope}
          onScopeChange={onScopeChange}
        />
      ) : (
        <div className={cn(devClass.noFocusedSession)}>No focused session</div>
      )}

      {others.length > 0 && (
        <>
          <div className={devClass.sectionTitle}>Active sessions</div>
          {others.slice(0, 6).map((s) => (
            <ScopeRailItem
              key={s.id}
              scope={{ type: "session", id: s.id, label: s.name }}
              label={s.name}
              status={s.status}
              activeScope={activeScope}
              onScopeChange={onScopeChange}
            />
          ))}
        </>
      )}

      <div className={devClass.flex1} />
      <div className={devClass.scopeFooter}>
        <div className={devClass.sessionCount}>
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
};

// ─── Action Strip ─────────────────────────────────────────────────────────────

const StripBtn = ({
  label,
  disabled,
  loading,
  onClick,
  color = "var(--text3)",
}: {
  label: string;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
  color?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || loading}
    className={devClass.stripBtnBase}
    style={{
      background: disabled ? "transparent" : `${color}14`,
      border: `1px solid ${disabled ? "var(--border)" : color + "44"}`,
      cursor: disabled ? "default" : "pointer",
      color: disabled ? "var(--text3)" : color,
      opacity: disabled ? 0.4 : 1,
    }}
  >
    {loading && <Spinner />}
    {label}
  </button>
);

const ActionStrip = ({
  diagnostics,
  diagnosticsLoading,
  timeWindow,
  setTimeWindow,
  minLevel,
  setMinLevel,
  sourceFilters,
  setSourceFilters,
  effectiveLogLevel,
  onSetLogLevel,
  logLevelLoading,
  activeScope,
}: {
  diagnostics: ScopeDiagnostics | null;
  diagnosticsLoading: boolean;
  timeWindow: TimeWindow;
  setTimeWindow: (v: TimeWindow) => void;
  minLevel: LogLevel;
  setMinLevel: (v: LogLevel) => void;
  sourceFilters: string[];
  setSourceFilters: (v: string[]) => void;
  effectiveLogLevel: string;
  onSetLogLevel: (level: PinoLevel) => void;
  logLevelLoading: boolean;
  activeScope: ActiveScope;
}) => {
  const progress = diagnostics?.executionProgress;
  const failedSteps =
    progress?.steps.filter((s) => s.status === "failed") ?? [];
  const retryableStep = failedSteps.find((s) => s.retryable) ?? null;
  const failedNonRetryable = failedSteps.find((s) => !s.retryable) ?? null;
  const sess = diagnostics?.session;
  const canRetry = !!retryableStep && !!sess;
  const canClear = !!failedNonRetryable && !!sess;
  const canPause = sess?.status === "active";
  const isSessionScope = activeScope.type === "session";

  return (
    <div className={devClass.actionStrip}>
      {/* Row 1: Status + Controls */}
      <div className={devClass.actionStripRow}>
        {/* Status cards */}
        {diagnosticsLoading ? (
          <div className={devClass.skeletonGroup}>
            {[80, 60, 100].map((w) => (
              <div
                key={w}
                className="h-6 rounded-[5px] bg-[var(--surface3)]"
                style={{ width: w }}
              />
            ))}
          </div>
        ) : diagnostics ? (
          <>
            <StatPill label="events" value={diagnostics.counts.events} />
            <StatPill
              label="errors"
              value={diagnostics.counts.errors}
              color="var(--color-error)"
            />
            <StatPill
              label="warns"
              value={diagnostics.counts.warnings}
              color="var(--color-warning)"
            />
            <StatPill label="runs" value={diagnostics.counts.agentRuns} />
            <StatPill label="calls" value={diagnostics.counts.externalCalls} />
            {diagnostics.counts.failedSteps > 0 && (
              <StatPill
                label="failed steps"
                value={diagnostics.counts.failedSteps}
                color="var(--color-error)"
              />
            )}
          </>
        ) : (
          <span className={cn(devClass.mono9, "text-[var(--text3)]")}>n/a</span>
        )}

        <div className={devClass.controlsCluster}>
          {/* Log level */}
          <span className={devClass.label}>log</span>
          <select
            value={effectiveLogLevel}
            onChange={(e) => onSetLogLevel(e.target.value as PinoLevel)}
            disabled={logLevelLoading}
            className={devClass.logSelect}
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          {/* Time window */}
          <span className={devClass.label}>window</span>
          <div className={devClass.filterGroup}>
            {TIME_WINDOWS.map((tw) => (
              <button
                key={tw.value}
                onClick={() => setTimeWindow(tw.value)}
                className={devClass.windowBtn}
                style={{
                  background:
                    timeWindow === tw.value
                      ? "var(--color-info-dim)"
                      : "transparent",
                  color:
                    timeWindow === tw.value
                      ? "var(--color-info)"
                      : "var(--text3)",
                }}
              >
                {tw.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Source filters + step controls */}
      <div className={devClass.flexWrapGap}>
        {/* Level filter */}
        <div className={devClass.filterGroup}>
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setMinLevel(l)}
              className={devClass.levelBtn}
              style={{
                background: minLevel === l ? LEVEL_BG[l] : "transparent",
                color: minLevel === l ? LEVEL_COLOR[l] : "var(--text3)",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Source filters */}
        <div className={devClass.sourceFilterRow}>
          {SOURCE_TYPES.map((src) => {
            const on =
              sourceFilters.includes(src) || sourceFilters.length === 0;
            const c = ROLE_COLOR[src] ?? "var(--text2)";
            return (
              <button
                key={src}
                className={devClass.filterChipBtn}
                onClick={() => {
                  if (sourceFilters.length === 0) {
                    setSourceFilters(SOURCE_TYPES.filter((s) => s !== src));
                  } else if (sourceFilters.includes(src)) {
                    const next = sourceFilters.filter((s) => s !== src);
                    setSourceFilters(
                      next.length === SOURCE_TYPES.length - 1 && next.length > 0
                        ? []
                        : next,
                    );
                  } else {
                    const next = [...sourceFilters, src];
                    setSourceFilters(
                      next.length === SOURCE_TYPES.length ? [] : next,
                    );
                  }
                }}
                style={{
                  background: on ? `${c}18` : "transparent",
                  border: `1px solid ${on ? c + "44" : "var(--border)"}`,
                  color: on ? c : "var(--text3)",
                }}
              >
                {src}
              </button>
            );
          })}
        </div>

        {isSessionScope && (
          <LifecycleButtons
            diagnostics={diagnostics}
            retryableStep={retryableStep}
            failedNonRetryable={failedNonRetryable}
            capabilities={{
              retry: canRetry ? "enabled" : "disabled",
              pause: canPause ? "enabled" : "disabled",
              clear: canClear ? "enabled" : "disabled",
            }}
          />
        )}
      </div>
    </div>
  );
};

// ─── Lifecycle Buttons ────────────────────────────────────────────────────────

type ExecutionStep = SessionExecutionProgressResponse["steps"][number];
type LifecycleActionAvailability = "enabled" | "disabled";
type LifecycleCapabilities = {
  retry: LifecycleActionAvailability;
  pause: LifecycleActionAvailability;
  clear: LifecycleActionAvailability;
};

const LifecycleButtons = ({
  diagnostics,
  retryableStep,
  failedNonRetryable,
  capabilities,
}: {
  diagnostics: ScopeDiagnostics | null;
  retryableStep: ExecutionStep | null;
  failedNonRetryable: ExecutionStep | null;
  capabilities: LifecycleCapabilities;
}) => {
  const qc = useQueryClient();
  const progress = diagnostics?.executionProgress;
  const canRetry = capabilities.retry === "enabled";
  const canPause = capabilities.pause === "enabled";
  const canClear = capabilities.clear === "enabled";

  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!retryableStep || !diagnostics?.session?.id || !progress?.cycleId)
        return;
      const cycleId = progress.cycleId;
      return api.retrySessionStep({
        sessionId: diagnostics.session.id,
        cycleId,
        stage: retryableStep.stage,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scope-diagnostics"] }),
  });

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!diagnostics?.session?.id) return;
      return api.pauseSessionAfterCurrentStep(diagnostics.session.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scope-diagnostics"] }),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (
        !failedNonRetryable ||
        !diagnostics?.session?.id ||
        !progress?.cycleId
      )
        return;
      const cycleId = progress.cycleId;
      return api.clearFailedSessionStep({
        sessionId: diagnostics.session.id,
        cycleId,
        stage: failedNonRetryable.stage,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scope-diagnostics"] }),
  });

  return (
    <>
      <div className={devClass.lifecycleDivider} />
      <StripBtn
        label="Retry Failed Step"
        disabled={!canRetry}
        loading={retryMutation.isPending}
        onClick={() => retryMutation.mutate()}
        color="var(--color-success)"
      />
      <StripBtn
        label="Pause After Step"
        disabled={!canPause}
        loading={pauseMutation.isPending}
        onClick={() => pauseMutation.mutate()}
        color="var(--color-warning)"
      />
      <StripBtn
        label="Clear Failed"
        disabled={!canClear}
        loading={clearMutation.isPending}
        onClick={() => clearMutation.mutate()}
        color="var(--color-error)"
      />
    </>
  );
};

const StatPill = ({
  label,
  value,
  color = "var(--text2)",
}: {
  label: string;
  value: number;
  color?: string;
}) => (
  <div className={devClass.statPill}>
    <span className={cn(devClass.mono9, "text-[var(--text3)]")}>{label}</span>
    <span className={cn(devClass.mono9, "font-extrabold")} style={{ color }}>
      {value}
    </span>
  </div>
);

// ─── Event Timeline ───────────────────────────────────────────────────────────

const EventTimeline = ({
  events,
  filtered,
  selectedId,
  onSelect,
  search,
  setSearch,
  loading,
  hasMore,
  onLoadMore,
}: {
  events: ExtEventRow[];
  filtered: ExtEventRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const copyAllText = useMemo(
    () => formatEventsForClipboard(filtered),
    [filtered],
  );

  return (
    <div className={devClass.eventTimelineOuter}>
      {/* Search bar */}
      <div className={devClass.timelineSearchBar}>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, id, symbol, provider, error…"
          className={cn(devClass.searchInput, devClass.mono10)}
        />
        {loading && <Spinner />}
        <span className={cn(devClass.mono9, "shrink-0 text-[var(--text3)]")}>
          {filtered.length}/{events.length}
        </span>
        <CopyBtn text={copyAllText} label="copy all events" />
      </div>

      {/* Event rows */}
      <div className={devClass.flex1Scroll}>
        {loading &&
          events.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}

        {!loading && filtered.length === 0 && (
          <div className={devClass.centerEmpty}>
            <div className={cn(devClass.mono10, "text-[var(--text3)]")}>
              {events.length === 0
                ? "No developer events have been recorded yet."
                : "No events match these filters."}
            </div>
            {events.length === 0 && (
              <div className={cn(devClass.mono9, "mt-1.5 text-[var(--text3)]")}>
                Start a session or run a diagnostic to create events.
              </div>
            )}
          </div>
        )}

        {filtered.map((ev) => {
          const sel = ev.id === selectedId;
          const lc = LEVEL_COLOR[ev.level];
          const rc = ROLE_COLOR[ev.agent_type ?? ""] ?? "var(--text3)";
          return (
            <button
              type="button"
              key={ev.id}
              onClick={() => onSelect(ev.id)}
              className={devClass.eventRowBtnBase}
              style={{
                background: sel ? "var(--surface2)" : "transparent",
                borderLeft: `2px solid ${sel ? lc : lc + "44"}`,
              }}
            >
              <span
                className={cn(
                  devClass.mono9,
                  "w-[50px] shrink-0 text-[var(--text3)]",
                )}
              >
                {fmt.time(ev.created_at)}
              </span>
              <span
                className={cn(
                  devClass.mono9,
                  "w-[44px] shrink-0 font-extrabold tracking-[0.05em]",
                )}
                style={{ color: lc }}
              >
                {ev.level}
              </span>
              <div className={devClass.eventSourceRow}>
                {ev.agent_type && (
                  <span
                    className={cn(
                      devClass.mono9,
                      "rounded-[3px] px-[5px] py-px font-bold",
                    )}
                    style={{
                      color: rc,
                      background: `${rc}18`,
                    }}
                  >
                    {ev.agent_type}
                  </span>
                )}
                {ev.cycle_id && (
                  <span className="rounded-[3px] bg-[var(--surface3)] px-1 py-px font-mono text-[12px] tracking-[0.08em] text-[var(--text3)]">
                    cyc·{String(ev.cycle_id).slice(0, 5)}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  devClass.mono10,
                  "min-w-0 flex-1 truncate leading-snug",
                  sel ? "text-[var(--text1)]" : "text-[var(--text2)]",
                )}
              >
                <span className="mr-[5px] font-mono text-[12px] tracking-[0.08em] text-[var(--color-info-border)]">
                  [{summarizeEventSource(ev)}]
                </span>
                {ev.message}
              </span>
            </button>
          );
        })}

        {hasMore && (
          <div className={devClass.loadMoreWrap}>
            <button onClick={onLoadMore} className={devClass.loadMoreBtn}>
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Inspector Tabs ───────────────────────────────────────────────────────────

const OverviewTab = ({ diag }: { diag: ScopeDiagnostics | null }) => {
  if (!diag) return <EmptyState msg="Select a scope to inspect diagnostics." />;
  const sess = diag.session;
  return (
    <div className={devClass.tabPadding}>
      <SectionCard title="Scope">
        <DataRow label="scope" value={diag.scopeLabel} />
        {sess && (
          <>
            <DataRow label="session" value={sess.name} />
            <DataRow
              label="status"
              value={<StatusChip status={sess.status} />}
              mono={false}
            />
            <DataRow label="mode" value={sess.executionMode} />
            <DataRow label="cycle" value={diag.activeCycleId ?? "—"} />
          </>
        )}
      </SectionCard>
      <SectionCard title="Counts">
        <DataRow label="events" value={diag.counts.events} />
        <DataRow
          label="errors"
          value={
            <span
              className={
                diag.counts.errors > 0 ? "text-error" : "text-[var(--text2)]"
              }
            >
              {diag.counts.errors}
            </span>
          }
          mono={false}
        />
        <DataRow
          label="warnings"
          value={
            <span
              className={
                diag.counts.warnings > 0
                  ? "text-warning"
                  : "text-[var(--text2)]"
              }
            >
              {diag.counts.warnings}
            </span>
          }
          mono={false}
        />
        <DataRow label="agent runs" value={diag.counts.agentRuns} />
        <DataRow label="ext calls" value={diag.counts.externalCalls} />
        <DataRow
          label="failed steps"
          value={
            <span
              className={
                diag.counts.failedSteps > 0
                  ? "text-error"
                  : "text-[var(--text2)]"
              }
            >
              {diag.counts.failedSteps}
            </span>
          }
          mono={false}
        />
      </SectionCard>
      {diag.latestError && (
        <SectionCard title="Latest Error">
          <div className={cn(devClass.mono9, "leading-normal text-error")}>
            {diag.latestError.message}
          </div>
          <div className={cn(devClass.mono9, "mt-1 text-[var(--text3)]")}>
            {fmt.time(diag.latestError.createdAt)}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

const ExecutionTab = ({
  diag,
  sessionId,
}: {
  diag: ScopeDiagnostics | null;
  sessionId: string | null | undefined;
}) => {
  const steps = diag?.executionProgress?.steps ?? [];
  if (!sessionId || steps.length === 0)
    return <EmptyState msg="No execution steps found for this scope." />;
  return (
    <div className={cn(devClass.tabPadding, "gap-1.5")}>
      {diag?.executionProgress?.cycleId && (
        <div className={cn(devClass.mono9, "mb-1 text-[var(--text3)]")}>
          Cycle: {diag.executionProgress.cycleId}
        </div>
      )}
      {steps.map((step) => {
        const c =
          step.status === "succeeded"
            ? "var(--color-success)"
            : step.status === "failed"
              ? "var(--color-error)"
              : step.status === "running"
                ? "var(--color-info)"
                : "var(--text3)";
        return (
          <div
            key={step.stage}
            className={cn(devClass.executionStepCard, "bg-[var(--bg)]")}
            style={{
              border: `1px solid ${c}40`,
              borderLeft: `2px solid ${c}`,
            }}
          >
            <div className={devClass.stepHeaderRow}>
              <span
                className={cn(devClass.mono9, "font-extrabold")}
                style={{ color: c }}
              >
                {step.stage}
              </span>
              <span className={devClass.mono9} style={{ color: c }}>
                {step.status}
              </span>
            </div>
            {step.attempt > 0 && (
              <div className={cn(devClass.mono9, "mt-1 text-[var(--text3)]")}>
                attempt {step.attempt}
              </div>
            )}
            {step.lastErrorMessage && (
              <div
                className={cn(devClass.mono9, "mt-1 leading-normal text-error")}
              >
                {step.lastErrorMessage}
              </div>
            )}
            {step.outcome && (
              <div className={cn(devClass.mono9, "mt-1 text-[var(--text3)]")}>
                outcome: {step.outcome}
              </div>
            )}
            {step.nextRetryAt && (
              <div className={cn(devClass.mono9, "mt-0.5 text-warning")}>
                retry at {fmt.time(step.nextRetryAt)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const PipelineConfigTab = ({ diag }: { diag: ScopeDiagnostics | null }) => {
  const config = diag?.pipelineConfig;
  if (!diag?.session)
    return (
      <EmptyState msg="Select a session scope to inspect effective pipeline config." />
    );
  if (!config)
    return (
      <EmptyState
        msg={
          diag.pipelineConfigError ?? "Effective pipeline config unavailable."
        }
      />
    );
  const pretty = JSON.stringify(config, null, 2);
  return (
    <div className={devClass.tabPadding}>
      {diag.pipelineConfigError && (
        <SectionCard title="Validation Error">
          <div
            className={cn(
              devClass.mono9,
              "whitespace-pre-wrap leading-normal text-error",
            )}
          >
            {diag.pipelineConfigError}
          </div>
        </SectionCard>
      )}
      <div className={devClass.grid4}>
        {[
          ["pipeline", config.pipelineId],
          ["stages", String(config.stages.length)],
          ["workers", String(config.workers.length)],
          ["engines", String(config.engines.length)],
        ].map(([label, value]) => (
          <div key={label} className={devClass.statGridCell}>
            <div className={cn(devClass.mono9, "text-[var(--text3)]")}>
              {label}
            </div>
            <div
              className={cn(
                devClass.mono10,
                "mt-0.5 font-bold text-[var(--text1)]",
              )}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
      {config.planStages?.length ? (
        <SectionCard title="cycle plan stages">
          {config.planStages.map((stage) => (
            <DataRow
              key={stage.id}
              label={stage.id}
              value={[
                stage.kind,
                stage.phase,
                stage.engineIds?.join(", "),
                stage.inputBuilderIds?.join(", "),
                stage.failurePolicy,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </SectionCard>
      ) : null}
      {config.stages.map((stage) => (
        <SectionCard key={stage.id} title={`${stage.id} · ${stage.variantKey}`}>
          <DataRow
            label="mode"
            value={`${stage.schedulingMode} · max ${stage.maxConcurrency}`}
          />
          <DataRow label="budget" value={fmt.usd(stage.phaseSpendCapUsd, 4)} />
          {stage.inputBuilders?.length ? (
            <DataRow
              label="input builders"
              value={stage.inputBuilders.join(", ")}
            />
          ) : null}
          {stage.cachePolicy ? (
            <DataRow label="cache policy" value={stage.cachePolicy} />
          ) : null}
          <DataRow
            label="workers"
            value={stage.workers.map((w) => w.workerId).join(", ")}
          />
        </SectionCard>
      ))}
      <div>
        <div className={devClass.configHeaderRow}>
          <span className={devClass.label}>resolved config</span>
          <CopyBtn text={pretty} label="copy config" />
        </div>
        <pre className={devClass.preBlockWithMax}>{pretty}</pre>
      </div>
    </div>
  );
};

const AITraceTab = ({
  runs,
  loading,
}: {
  runs: ExtAgentRun[];
  loading: boolean;
}) => {
  if (loading) return <EmptyState msg="Loading agent runs…" />;
  if (runs.length === 0)
    return <EmptyState msg="No agent runs for this selection." />;

  const total = { tokens: 0, cost: 0, ms: 0 };
  runs.forEach((r) => {
    total.tokens += r.input_tokens + r.output_tokens;
    total.cost += r.cost_usd;
    total.ms += r.duration_ms;
  });

  return (
    <div className={devClass.tabPadding}>
      <div className={devClass.grid3}>
        {[
          ["runs", String(runs.length)],
          ["tokens", fmt.tokens(total.tokens)],
          ["cost", fmt.usd(total.cost, 4)],
        ].map(([l, v]) => (
          <div key={l} className={devClass.statGridCell}>
            <div className={cn(devClass.mono9, "text-[var(--text3)]")}>{l}</div>
            <div
              className={cn(
                devClass.mono10,
                "mt-0.5 font-bold text-[var(--text1)]",
              )}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
      {runs.map((r) => {
        const accent = ROLE_COLOR[r.agent_type] ?? "var(--text3)";
        return <RunCard key={r.id} run={r} accent={accent} />;
      })}
    </div>
  );
};

const RunCard = ({ run, accent }: { run: ExtAgentRun; accent: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={devClass.runCardShell}
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={devClass.runCardHeaderBtn}
      >
        <AgentLabel type={run.agent_type as EventSourceType} />
        <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
          {run.provider_key} · {run.model}
        </span>
        <span
          className={cn(
            devClass.mono9,
            "rounded-[3px] px-[5px] py-px font-bold",
            run.finish_reason === "stop"
              ? "bg-success-dim text-success"
              : "bg-error-dim text-error",
          )}
        >
          {run.finish_reason}
        </span>
        <div className={devClass.mlAutoFlex}>
          <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
            {fmt.tokens(run.input_tokens + run.output_tokens)} ·{" "}
            {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
          </span>
          <CopyBtn text={JSON.stringify(run, null, 2)} label="copy" />
          <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </button>
      {open && (
        <div className={devClass.runCardBody}>
          <CollapsibleText
            text={run.output_text ? `"${run.output_text}"` : null}
          />
        </div>
      )}
    </div>
  );
};

const PhaseGraphTab = ({
  messages,
  loading,
}: {
  messages: AgentMessage[];
  loading: boolean;
}) => {
  const traces = messages.reduce<Array<{ m: AgentMessage; t: AIPhaseTrace }>>(
    (acc, message) => {
      const trace = parsePhaseTrace(message);
      if (trace) {
        acc.push({ m: message, t: trace });
      }
      return acc;
    },
    [],
  );
  if (loading) return <EmptyState msg="Loading phase graph…" />;
  if (traces.length === 0)
    return <EmptyState msg="Phase graph metadata unavailable." />;
  return (
    <div className={cn(devClass.tabPadding, "gap-2.5")}>
      {traces.map(({ m, t }) => (
        <div key={m.id} className={devClass.phaseGraphShell}>
          <div className={devClass.phaseGraphHeader}>
            <div className={devClass.flexGap}>
              <span
                className={cn(devClass.mono9, "font-extrabold")}
                style={{ color: ROLE_COLOR[t.phase] ?? "var(--text2)" }}
              >
                {t.phase}
              </span>
              <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
                {t.schedulingMode}
              </span>
              <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
                {t.frontiers.length} frontiers · {t.workers.length} workers
              </span>
            </div>
            <CopyBtn text={JSON.stringify(t, null, 2)} />
          </div>
          <div className={devClass.phaseGraphBody}>
            {t.workers.map((w) => (
              <div key={w.workerId} className={devClass.workerCard}>
                <div className={devClass.workerHeaderRow}>
                  <span
                    className={cn(devClass.mono9, "font-extrabold")}
                    style={{ color: ROLE_COLOR[t.phase] ?? "var(--text2)" }}
                  >
                    {w.workerId}
                  </span>
                  <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
                    {w.status}
                  </span>
                </div>
                <DataRow
                  label="model"
                  value={`${w.providerKey} · ${w.modelId}`}
                />
                <DataRow
                  label="cost/dur"
                  value={`${fmt.usd(w.costUsd ?? 0, 4)} · ${fmt.duration(w.durationMs ?? 0)}`}
                />
                {w.dependsOn.length > 0 && (
                  <DataRow label="deps" value={w.dependsOn.join(", ")} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const ExternalCallsTab = ({
  sessionId,
  cycleId,
  tradeId,
}: {
  sessionId?: string | null;
  cycleId?: string | null;
  tradeId?: string | null;
}) => {
  const { data: calls = [], isLoading } = useQuery({
    queryKey: ["api-calls", sessionId, cycleId, tradeId],
    queryFn: () => {
      if (!sessionId) {
        throw new Error("sessionId is required for API call log");
      }
      return api.getApiCallLog({
        sessionId,
        cycleId: cycleId ?? null,
        tradeId: tradeId ?? null,
      });
    },
    enabled: !!sessionId,
  });
  if (!sessionId)
    return (
      <EmptyState msg="Select a session-scoped event to see external calls." />
    );
  if (isLoading) return <EmptyState msg="Loading external calls…" />;
  if (calls.length === 0)
    return <EmptyState msg="No external API calls recorded." />;
  return (
    <div className={cn(devClass.tabPadding, "gap-1.5")}>
      {calls.map((c) => (
        <div key={c.id} className={devClass.apiCallCard}>
          <div className={devClass.apiCallHeaderRow}>
            <span
              className={cn(
                devClass.mono9,
                "font-bold",
                c.status === "ok" ? "text-success" : "text-error",
              )}
            >
              {c.status.toUpperCase()}
            </span>
            <span className={cn(devClass.mono9, "text-[var(--text2)]")}>
              {c.provider}
            </span>
            <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
              {c.call_type}
            </span>
            <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
              {c.latency_ms}ms
            </span>
            {c.cost_usd != null && (
              <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
                {fmt.usd(c.cost_usd, 4)}
              </span>
            )}
            {c.from_cache && (
              <span className={cn(devClass.mono9, "text-info")}>cached</span>
            )}
          </div>
          <div
            className={cn(devClass.mono9, "mt-1 break-all text-[var(--text3)]")}
          >
            {c.endpoint}
          </div>
        </div>
      ))}
    </div>
  );
};

const RawTab = ({ ev }: { ev: ExtEventRow }) => {
  const pretty = JSON.stringify(ev, null, 2);
  return (
    <div className={devClass.tabPadding}>
      <div className={devClass.rawTabHeader}>
        <CopyBtn text={pretty} label="copy raw" />
      </div>
      <pre className={devClass.preBlock}>{pretty}</pre>
    </div>
  );
};

const InspectorPanel = ({
  sel,
  selRuns,
  selMessages,
  runsLoading,
  messagesLoading,
  diagnostics,
  activeScope,
}: {
  sel: ExtEventRow | null;
  selRuns: ExtAgentRun[];
  selMessages: AgentMessage[];
  runsLoading: boolean;
  messagesLoading: boolean;
  diagnostics: ScopeDiagnostics | null;
  activeScope: ActiveScope;
}) => {
  const [tab, setTab] = useState<InspectorTab>("overview");

  const TABS: Array<{ id: InspectorTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "execution", label: "Execution" },
    { id: "config", label: "Config" },
    {
      id: "trace",
      label: `AI Trace${selRuns.length > 0 ? ` (${selRuns.length})` : ""}`,
    },
    { id: "graph", label: "Graph" },
    { id: "calls", label: "External" },
    { id: "raw", label: "Raw" },
  ];

  return (
    <div className={devClass.inspectorPanel}>
      {/* Tab bar */}
      <div className={devClass.inspectorTabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={devClass.inspectorTabBtnBase}
            style={{
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              color: tab === t.id ? "var(--text1)" : "var(--text3)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={devClass.flex1Scroll}>
        {tab === "overview" && <OverviewTab diag={diagnostics} />}
        {tab === "execution" && (
          <ExecutionTab
            diag={diagnostics}
            sessionId={activeScope.type === "session" ? activeScope.id : null}
          />
        )}
        {tab === "config" && <PipelineConfigTab diag={diagnostics} />}
        {tab === "trace" && <AITraceTab runs={selRuns} loading={runsLoading} />}
        {tab === "graph" && (
          <PhaseGraphTab messages={selMessages} loading={messagesLoading} />
        )}
        {tab === "calls" && sel && (
          <ExternalCallsTab
            sessionId={sel.session_id}
            cycleId={sel.cycle_id}
            tradeId={sel.trade_id}
          />
        )}
        {tab === "calls" && !sel && (
          <EmptyState msg="Select an event to view external calls." />
        )}
        {tab === "raw" && sel && <RawTab ev={sel} />}
        {tab === "raw" && !sel && (
          <EmptyState msg="Select an event to view raw payload." />
        )}
      </div>
    </div>
  );
};

// ─── Debug Capture Modal ──────────────────────────────────────────────────────

const captureFormReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

const CaptureFormFields = ({
  form,
  dispatchForm,
}: {
  form: CaptureFormState;
  dispatchForm: (u: Partial<CaptureFormState>) => void;
}) => (
  <>
    {/* Duration */}
    <FieldGroup label="Duration">
      <div className={devClass.captureDurationRow}>
        {([5, 15, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => dispatchForm({ duration: d, untilStopped: false })}
            className={devClass.captureDurationBtn}
            style={{
              background:
                form.duration === d && !form.untilStopped
                  ? "var(--color-info-dim)"
                  : "var(--surface3)",
              border: `1px solid ${form.duration === d && !form.untilStopped ? "var(--color-info-border)" : "var(--border)"}`,
              color:
                form.duration === d && !form.untilStopped
                  ? "var(--color-info)"
                  : "var(--text2)",
            }}
          >
            {d}m
          </button>
        ))}
        <button
          onClick={() => dispatchForm({ untilStopped: true, duration: null })}
          className={devClass.captureDurationBtn}
          style={{
            background: form.untilStopped
              ? "var(--color-warning-dim)"
              : "var(--surface3)",
            border: `1px solid ${form.untilStopped ? "var(--color-warning-border)" : "var(--border)"}`,
            color: form.untilStopped ? "var(--color-warning)" : "var(--text2)",
          }}
        >
          Until stopped
        </button>
      </div>
    </FieldGroup>

    {/* Main log level */}
    <FieldGroup label="Main log level">
      <select
        value={form.mainLevel}
        onChange={(e) =>
          dispatchForm({ mainLevel: e.target.value as PinoLevel })
        }
        className={devClass.captureSelect}
      >
        {LOG_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {form.mainLevel === "trace" && !form.traceConfirm && (
        <div className="mt-1.5">
          <div className={cn(devClass.mono9, "mb-1 text-warning")}>
            Trace logs can include large payload metadata and may slow the app.
          </div>
          <button
            onClick={() => dispatchForm({ traceConfirm: true })}
            className={devClass.traceConfirmBtn}
          >
            Confirm trace level
          </button>
        </div>
      )}
    </FieldGroup>

    {/* Event min level */}
    <FieldGroup label="Event min level">
      <div className={devClass.filterGroup}>
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => dispatchForm({ eventLevel: l })}
            className={devClass.eventLevelBtn}
            style={{
              background: form.eventLevel === l ? LEVEL_BG[l] : "transparent",
              color: form.eventLevel === l ? LEVEL_COLOR[l] : "var(--text3)",
            }}
          >
            {l}
          </button>
        ))}
      </div>
    </FieldGroup>

    {/* Toggles */}
    <div className={devClass.toggleList}>
      <Toggle
        label="Include prompt messages"
        checked={form.includePrompts}
        onChange={(v) => dispatchForm({ includePrompts: v })}
      />
      <Toggle
        label="Include tool payloads"
        checked={form.includeTools}
        onChange={(v) => dispatchForm({ includeTools: v })}
      />
    </div>

    {/* Safety note */}
    <div className={cn(devClass.mono9, "leading-normal text-[var(--text3)]")}>
      Secrets are redacted before export. API keys and authorization headers are
      never shown.
    </div>

    {form.error && (
      <div className={cn(devClass.mono9, "text-error")}>{form.error}</div>
    )}
  </>
);

type CaptureFormState = {
  duration: 5 | 15 | 30 | null;
  untilStopped: boolean;
  mainLevel: PinoLevel;
  eventLevel: LogLevel;
  includePrompts: boolean;
  includeTools: boolean;
  traceConfirm: boolean;
  error: string | null;
};

const DebugCaptureModal = ({
  activeScope,
  onClose,
  onStarted,
}: {
  activeScope: ActiveScope;
  onClose: () => void;
  onStarted: (overrideId: string, expiresAt: string | null) => void;
}) => {
  const qc = useQueryClient();
  const [form, dispatchForm] = useReducer(
    captureFormReducer<CaptureFormState>,
    {
      duration: 15,
      untilStopped: false,
      mainLevel: "debug",
      eventLevel: "DEBUG",
      includePrompts: false,
      includeTools: true,
      traceConfirm: false,
      error: null,
    },
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (form.mainLevel === "trace" && !form.traceConfirm)
        throw new Error("Trace logging requires confirmation.");
      const developer = developerApi();
      if (!developer) {
        throw new Error("Developer API unavailable.");
      }
      return developer.setLogLevel({
        scopeType: activeScope.type,
        scopeId: activeScope.id,
        mainLogLevel: form.mainLevel,
        eventMinLevel: form.eventLevel,
        durationMinutes: form.untilStopped ? undefined : (form.duration ?? 15),
        untilStopped: form.untilStopped,
      });
    },
    onSuccess: (res) => {
      if (res) onStarted(res.overrideId, res.expiresAt);
      qc.invalidateQueries({ queryKey: ["scope-diagnostics"] });
    },
    onError: (err: Error) => dispatchForm({ error: err.message }),
  });

  return (
    <div
      role="presentation"
      className={devClass.modalOverlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={devClass.modalPanel} role="dialog" aria-modal="true">
        <div className={devClass.exportHeaderRow}>
          <div className={devClass.modalTitle}>CAPTURE DEBUG WINDOW</div>
          <button
            onClick={onClose}
            className={cn(devClass.closeBtn, "text-sm")}
          >
            ✕
          </button>
        </div>

        <div className={devClass.modalScopeBox}>
          Scope: {activeScope.label ?? activeScope.type}
        </div>

        <CaptureFormFields form={form} dispatchForm={dispatchForm} />

        {/* Actions */}
        <div className={devClass.modalActions}>
          <button onClick={onClose} className={devClass.modalCancelBtn}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              (form.mainLevel === "trace" && !form.traceConfirm)
            }
            className={devClass.debugCaptureBtnBase}
            style={{ opacity: mutation.isPending ? 0.7 : 1 }}
          >
            {mutation.isPending && <Spinner />}
            {mutation.isPending ? "Starting…" : "Start Capture"}
          </button>
        </div>
      </div>
    </div>
  );
};

const FieldGroup = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className={devClass.fieldGroup}>
    <div className={devClass.label}>{label}</div>
    {children}
  </div>
);

const Toggle = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <div className={devClass.toggleRow}>
    <span className={cn(devClass.mono10, "text-[var(--text2)]")}>{label}</span>
    <button
      onClick={() => onChange(!checked)}
      className={devClass.toggleTrackBase}
      style={{
        background: checked ? "var(--accent)" : "var(--surface3)",
      }}
    >
      <div
        className={devClass.toggleThumbBase}
        style={{
          left: checked ? 18 : 2,
          background: checked
            ? "hsl(var(--primary-foreground))"
            : "var(--text3)",
        }}
      />
    </button>
  </div>
);

// ─── Export Result Drawer ─────────────────────────────────────────────────────

const ExportResultDrawer = ({
  result,
  onClose,
}: {
  result: ExportBundleResult;
  onClose: () => void;
}) => (
  <div className={devClass.exportDrawer}>
    <div className={devClass.exportHeaderRow}>
      <span className={cn(devClass.mono9, "font-extrabold text-success")}>
        Debug bundle exported.
      </span>
      <button onClick={onClose} className={devClass.closeBtn}>
        ✕
      </button>
    </div>
    <div className={cn(devClass.mono9, "break-all text-[var(--text3)]")}>
      {result.path}
    </div>
    <div className={devClass.exportChipRow}>
      {result.includedSections.map((s) => (
        <span key={s} className={devClass.exportSectionChip}>
          {s}
        </span>
      ))}
    </div>
    <div className={cn(devClass.mono9, "text-[var(--text3)]")}>
      {result.redactionCount} field{result.redactionCount !== 1 ? "s" : ""}{" "}
      redacted · {(result.sizeBytes / 1024).toFixed(0)} KB
    </div>
    {result.warnings.map((w) => (
      <div key={w} className={cn(devClass.mono9, "text-warning")}>
        {w}
      </div>
    ))}
    <div className={devClass.exportActions}>
      <button
        onClick={() =>
          developerApi()?.openPath({
            kind: "debugBundle",
            path: result.path,
          })
        }
        className={devClass.exportActionBtn}
      >
        Reveal in Finder
      </button>
      <button
        onClick={() => copyText(result.path)}
        className={devClass.exportActionBtn}
      >
        Copy Path
      </button>
    </div>
  </div>
);

// ─── Toast container ──────────────────────────────────────────────────────────

const ToastContainer = ({
  toasts,
}: {
  toasts: Array<{ id: string; msg: string; kind: "ok" | "err" }>;
}) => (
  <div className={devClass.toastContainer}>
    {toasts.map((t) => (
      <div
        key={t.id}
        className={cn(
          devClass.mono9,
          "rounded-lg px-4 py-2 font-bold backdrop-blur-sm",
          t.kind === "ok"
            ? "border border-success-border bg-success-dim text-success"
            : "border border-error-border bg-error-dim text-error",
        )}
      >
        {t.msg}
      </div>
    ))}
  </div>
);

// ─── Shared sub-components ────────────────────────────────────────────────────

const SectionCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className={devClass.sectionCard}>
    <div className={devClass.sectionCardTitle}>{title}</div>
    {children}
  </div>
);

const DataRow = ({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) => (
  <div className={devClass.dataRow}>
    <span className={cn(devClass.mono9, "shrink-0 text-[var(--text3)]")}>
      {label}
    </span>
    <span
      className={cn(
        mono && devClass.mono9,
        "break-all text-right text-[12px] text-[var(--text2)]",
      )}
    >
      {value}
    </span>
  </div>
);

const EmptyState = ({ msg }: { msg: string }) => (
  <div className={devClass.emptyState}>{msg}</div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const DevPanel = ({
  focus,
  onFocusConsumed,
}: {
  focus?: DevPanelFocus | null;
  onFocusConsumed?: () => void;
}) => {
  type FilterState = {
    timeWindow: TimeWindow;
    minLevel: LogLevel;
    sourceFilters: string[];
    search: string;
    debouncedSearch: string;
  };
  type DevDataState = {
    events: ExtEventRow[];
    hasMore: boolean;
    selectedId: string | null;
    streamHealthy: boolean;
  };
  type UiState = {
    activeScope: ActiveScope;
    showCapture: boolean;
    captureActive: { overrideId: string; expiresAt: string | null } | null;
    exportResult: ExportBundleResult | null;
    exportLoading: boolean;
    effectiveLogLevel: string;
    logLevelLoading: boolean;
  };

  // Filter state
  const [filterState, dispatchFilter] = useReducer<
    Reducer<FilterState, Partial<FilterState>>
  >(mergeReducer, {
    timeWindow: 60,
    minLevel: "DEBUG",
    sourceFilters: [],
    search: "",
    debouncedSearch: "",
  });
  const searchRef = useRef<string>("");

  // Data/stream state
  const [dataState, dispatchData] = useReducer<
    Reducer<DevDataState, Partial<DevDataState>>
  >(mergeReducer, {
    events: [],
    hasMore: false,
    selectedId: null,
    streamHealthy: true,
  });
  // Ref for functional-update patterns on events
  const dataStateRef = useRef(dataState);
  dataStateRef.current = dataState;

  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UI state
  const [uiState, dispatchUi] = useReducer<Reducer<UiState, Partial<UiState>>>(
    mergeReducer,
    {
      activeScope: { type: "global" },
      showCapture: false,
      captureActive: null,
      exportResult: null,
      exportLoading: false,
      effectiveLogLevel: "info",
      logLevelLoading: false,
    },
  );

  const { toasts, show: showToast } = useToasts();
  const focusAppliedRef = useRef(false);
  const onFocusConsumedRef = useRef(onFocusConsumed);
  onFocusConsumedRef.current = onFocusConsumed;
  const qc = useQueryClient();

  // Debounce search
  useEffect(() => {
    searchRef.current = filterState.search;
    const t = setTimeout(() => {
      if (searchRef.current === filterState.search)
        dispatchFilter({ debouncedSearch: filterState.search });
    }, 250);
    return () => clearTimeout(t);
  }, [filterState.search]);

  // Sessions list
  const { data: sessionOverview } = useQuery({
    queryKey: ["devpanel-session-overview"],
    queryFn: () => api.listSessions({ includeAllEnvironments: true }),
    refetchInterval: 8000,
  });
  const sessions = useMemo(
    () => sessionOverview?.sessions ?? [],
    [sessionOverview?.sessions],
  );
  const focusedSessionId = sessionOverview?.focusedSessionId ?? null;

  // Auto-set focused session as default scope when data arrives
  useEffect(() => {
    if (focusedSessionId && uiState.activeScope.type === "global") {
      const focused = sessions.find((s) => s.id === focusedSessionId);
      if (focused) {
        dispatchUi({
          activeScope: {
            type: "session",
            id: focused.id,
            label: focused.name,
          },
        });
      }
    }
  }, [focusedSessionId]); // eslint-disable-line

  // Handle DevPanel focus injection from other pages
  useEffect(() => {
    if (!focus || focusAppliedRef.current) return;
    focusAppliedRef.current = true;
    const sess = sessions.find((s) => s.id === focus.sessionId);
    if (sess) {
      dispatchUi({
        activeScope: { type: "session", id: sess.id, label: sess.name },
      });
      dispatchFilter({ search: focus.cycleId });
    }
    onFocusConsumedRef.current?.();
  }, [focus, sessions]);

  // Load developer settings
  useEffect(() => {
    (async () => {
      try {
        const res = await developerApi()?.getSettings();
        if (res) dispatchUi({ effectiveLogLevel: res.effectiveLogLevel });
      } catch {
        /* developer settings unavailable outside Electron host */
      }
    })();
  }, []);

  // Scope diagnostics
  const { data: diagnostics, isLoading: diagnosticsLoading } =
    useQuery<ScopeDiagnostics>({
      queryKey: [
        "scope-diagnostics",
        uiState.activeScope.type,
        uiState.activeScope.id,
      ],
      queryFn: async () => {
        const res = await developerApi()?.getScopeDiagnostics({
          scope: { type: uiState.activeScope.type, id: uiState.activeScope.id },
        });
        return res as ScopeDiagnostics;
      },
      enabled: !!developerApi(),
      refetchInterval: 5000,
    });

  // Load events when scope or filters change
  const loadEvents = useCallback(
    async (cursor?: string | null) => {
      try {
        const sessionId =
          uiState.activeScope.type === "session"
            ? uiState.activeScope.id
            : undefined;
        const fetched = (await api.getEvents({
          sessionId,
          minLevel: filterState.minLevel,
          search: filterState.debouncedSearch || undefined,
          limit: 200,
        })) as ExtEventRow[];
        dispatchData({
          events: cursor
            ? [...dataStateRef.current.events, ...fetched]
            : fetched,
          hasMore: fetched.length === 200,
        });
      } catch {
        /* event stream fetch failed; keep existing rows */
      }
    },
    [uiState.activeScope, filterState.minLevel, filterState.debouncedSearch],
  );

  useEffect(() => {
    dispatchData({ events: [] });
    void loadEvents(null);
  }, [loadEvents]);

  // Stream health watchdog
  const resetStreamTimer = useCallback(() => {
    dispatchData({ streamHealthy: true });
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(
      () => dispatchData({ streamHealthy: false }),
      15_000,
    );
  }, []);

  useEffect(() => {
    resetStreamTimer();
    return () => {
      if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    };
  }, [resetStreamTimer]);

  useExvaEvent("agent_event", (ev) => {
    const extEv = ev as ExtEventRow;
    const scopeMatch =
      uiState.activeScope.type === "global" ||
      (uiState.activeScope.type === "session" &&
        extEv.session_id === uiState.activeScope.id);
    if (scopeMatch) {
      dispatchData({
        events: [extEv, ...dataStateRef.current.events].slice(0, 500),
      });
    }
    resetStreamTimer();
  });

  // Inspector data
  const sel = dataState.selectedId
    ? ((dataState.events.find((e) => e.id === dataState.selectedId) ??
        null) as ExtEventRow | null)
    : null;
  const inspectorTradeId = sel?.trade_id ?? null;
  const inspectorCycleId = sel?.cycle_id ?? null;

  const { data: selRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ["inspector-runs", inspectorTradeId, inspectorCycleId],
    queryFn: () => {
      if (inspectorTradeId) {
        return api.getAgentTraces(inspectorTradeId) as Promise<ExtAgentRun[]>;
      }
      if (inspectorCycleId) {
        return api.getAgentTracesByCycle(inspectorCycleId) as Promise<
          ExtAgentRun[]
        >;
      }
      return Promise.resolve([] as ExtAgentRun[]);
    },
    enabled: !!(inspectorTradeId || inspectorCycleId),
  });

  const { data: selMessages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["inspector-messages", inspectorTradeId, inspectorCycleId],
    queryFn: async () => {
      if (inspectorTradeId) {
        const d = await api.getTradeDetail(inspectorTradeId);
        return d.messages ?? [];
      }
      if (inspectorCycleId) {
        return api.getMessagesByCycle(inspectorCycleId);
      }
      return [];
    },
    enabled: !!(inspectorTradeId || inspectorCycleId),
  });

  // Filtered events (client-side for UI filtering while server loads)
  const filtered = useMemo(() => {
    let list = dataState.events;
    if (LEVELS.indexOf(filterState.minLevel) > 0) {
      list = list.filter(
        (ev) =>
          LEVELS.indexOf(ev.level) >= LEVELS.indexOf(filterState.minLevel),
      );
    }
    if (filterState.sourceFilters.length > 0) {
      list = list.filter(
        (ev) =>
          !ev.agent_type || filterState.sourceFilters.includes(ev.agent_type),
      );
    }
    if (filterState.debouncedSearch) {
      const q = filterState.debouncedSearch.toLowerCase();
      list = list.filter(
        (ev) =>
          ev.message.toLowerCase().includes(q) ||
          (ev.trade_id ?? "").includes(q) ||
          (ev.cycle_id ?? "").includes(q) ||
          (ev.session_id ?? "").includes(q),
      );
    }
    return list;
  }, [
    dataState.events,
    filterState.minLevel,
    filterState.sourceFilters,
    filterState.debouncedSearch,
  ]);

  // Handle scope change
  const handleScopeChange = (scope: ActiveScope) => {
    dispatchUi({ activeScope: scope });
    dispatchData({ selectedId: null });
    dispatchFilter({ search: "", debouncedSearch: "" });
    qc.invalidateQueries({ queryKey: ["scope-diagnostics"] });
  };

  // Log level change
  const handleSetLogLevel = async (level: PinoLevel) => {
    dispatchUi({ logLevelLoading: true });
    try {
      const developer = developerApi();
      if (!developer) {
        throw new Error("Developer API unavailable.");
      }
      await developer.setLogLevel({
        scopeType: "global",
        mainLogLevel: level,
        eventMinLevel: filterState.minLevel,
        untilStopped: true,
      });
      dispatchUi({ effectiveLogLevel: level });
      showToast(`Log level set to ${level}`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to set log level",
        "err",
      );
    } finally {
      dispatchUi({ logLevelLoading: false });
    }
  };

  // Export bundle
  const handleExport = async () => {
    dispatchUi({ exportLoading: true });
    try {
      const developer = developerApi();
      if (!developer) {
        throw new Error("Developer API unavailable.");
      }
      const res = await developer.exportDebugBundle({
        scope: { type: uiState.activeScope.type, id: uiState.activeScope.id },
        includePrompts: false,
        includeToolPayloads: true,
        timeWindowMinutes: filterState.timeWindow,
      });
      if (res) {
        dispatchUi({ exportResult: res });
        if (res.sizeBytes > 25 * 1024 * 1024) {
          showToast(
            "Bundle is large (>25 MB). Consider narrowing scope.",
            "err",
          );
        }
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Debug bundle export failed.",
        "err",
      );
    } finally {
      dispatchUi({ exportLoading: false });
    }
  };

  // Build scope label
  const scopeLabel =
    uiState.activeScope.type === "global"
      ? "Global workspace"
      : `${uiState.activeScope.type.charAt(0).toUpperCase() + uiState.activeScope.type.slice(1)}: ${uiState.activeScope.label ?? uiState.activeScope.id ?? ""}`;

  return (
    <div className={devClass.rootLayout}>
      {/* Scope Rail */}
      <ScopeRail
        activeScope={uiState.activeScope}
        onScopeChange={handleScopeChange}
        sessions={sessions}
        focusedSessionId={focusedSessionId}
      />

      {/* Main content */}
      <div className={devClass.mainColumn}>
        {/* Header */}
        <div className={devClass.devHeader}>
          <div>
            <div className={devClass.devTitle}>Developer Workbench</div>
            <div className={devClass.scopeSubtitle}>{scopeLabel}</div>
          </div>

          {/* Stream health badge */}
          <div className="ml-2">
            {dataState.streamHealthy ? (
              <span className="inline-flex items-center gap-1 rounded-[5px] border border-success-border bg-success-dim px-2 py-[3px] font-mono text-[12px] tracking-[0.08em] text-success">
                <Dot color="var(--color-success)" pulse size={4} /> Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-[5px] border border-warning-border bg-warning-dim px-2 py-[3px] font-mono text-[12px] tracking-[0.08em] text-warning">
                <Dot color="var(--color-warning)" pulse size={4} /> Delayed ·
                polling
              </span>
            )}
          </div>

          {uiState.captureActive && (
            <span className="inline-flex items-center gap-1 rounded-[5px] border border-market-border bg-market-dim px-2 py-[3px] font-mono text-[12px] tracking-[0.08em] text-market">
              <Dot color="var(--color-market)" pulse size={4} />
              Capture active
              {uiState.captureActive.expiresAt
                ? ` · ends ${fmt.time(uiState.captureActive.expiresAt)}`
                : ""}
            </span>
          )}

          <div className={devClass.mlAutoFlexGap}>
            <HeaderBtn
              label="Capture Debug Window"
              disabled={!!uiState.captureActive}
              onClick={() => dispatchUi({ showCapture: true })}
              color="var(--color-market)"
            />
            <HeaderBtn
              label="Export Debug Bundle"
              disabled={uiState.exportLoading}
              loading={uiState.exportLoading}
              onClick={handleExport}
              color="var(--color-info)"
            />
            <HeaderBtn
              label="Open Logs Folder"
              onClick={() =>
                developerApi()?.openPath({
                  kind: "logsDirectory",
                })
              }
              color="var(--text3)"
            />
          </div>
        </div>

        {/* Action Strip */}
        <ActionStrip
          diagnostics={diagnostics ?? null}
          diagnosticsLoading={diagnosticsLoading}
          timeWindow={filterState.timeWindow}
          setTimeWindow={(v) => dispatchFilter({ timeWindow: v })}
          minLevel={filterState.minLevel}
          setMinLevel={(v) => dispatchFilter({ minLevel: v })}
          sourceFilters={filterState.sourceFilters}
          setSourceFilters={(v) => dispatchFilter({ sourceFilters: v })}
          effectiveLogLevel={uiState.effectiveLogLevel}
          onSetLogLevel={handleSetLogLevel}
          logLevelLoading={uiState.logLevelLoading}
          activeScope={uiState.activeScope}
        />

        {/* Main split */}
        <div className={devClass.mainSplit}>
          {/* Timeline — 60% */}
          <div className={devClass.timelineColumn}>
            <EventTimeline
              events={dataState.events}
              filtered={filtered}
              selectedId={dataState.selectedId}
              onSelect={(id) =>
                dispatchData({
                  selectedId: id === dataState.selectedId ? null : id,
                })
              }
              search={filterState.search}
              setSearch={(s) => dispatchFilter({ search: s })}
              loading={false}
              hasMore={dataState.hasMore}
              onLoadMore={() =>
                loadEvents(
                  dataState.events.length > 0
                    ? dataState.events[dataState.events.length - 1].id
                    : null,
                )
              }
            />
          </div>

          {/* Inspector — 40% */}
          <div className={devClass.inspectorColumn}>
            <InspectorPanel
              sel={sel}
              selRuns={selRuns as ExtAgentRun[]}
              selMessages={selMessages}
              runsLoading={runsLoading}
              messagesLoading={messagesLoading}
              diagnostics={diagnostics ?? null}
              activeScope={uiState.activeScope}
            />
          </div>
        </div>

        {/* Footer */}
        <div className={devClass.devFooter}>
          <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
            {filtered.length} events
          </span>
          <DevOpsFooter />
        </div>
      </div>

      {/* Modals */}
      {uiState.showCapture && (
        <DebugCaptureModal
          activeScope={uiState.activeScope}
          onClose={() => dispatchUi({ showCapture: false })}
          onStarted={(overrideId, expiresAt) => {
            dispatchUi({
              showCapture: false,
              captureActive: { overrideId, expiresAt },
            });
            showToast("Debug capture started.");
          }}
        />
      )}

      {uiState.exportResult && (
        <ExportResultDrawer
          result={uiState.exportResult}
          onClose={() => dispatchUi({ exportResult: null })}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
};

// ─── Header button ────────────────────────────────────────────────────────────

const HeaderBtn = ({
  label,
  disabled = false,
  loading = false,
  onClick,
  color = "var(--text2)",
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  color?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    className={devClass.headerBtnBase}
    style={{
      background: `${color}10`,
      border: `1px solid ${color}30`,
      color,
      cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
    }}
  >
    {loading && <Spinner />}
    {label}
  </button>
);

const ALARM_KINDS = [
  "heartbeat_stale",
  "consecutive_skip",
  "data_freshness",
  "daily_loss",
  "drawdown",
  "drift",
  "ai_spend",
  "websocket_feed_degraded",
  "backup_failed",
  "parity_check_failed",
] as const;

function DevOpsFooter() {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    void window.exva?.ops?.getBackupStatus().then((res) => {
      setLastBackup(res.lastBackup?.backedUpAt ?? null);
    });
  }, []);

  return (
    <div className="ml-auto flex max-w-[70%] flex-col items-end gap-1">
      <span className={cn(devClass.mono9, "text-[var(--text3)]")}>
        SQLite · last backup{" "}
        {lastBackup ? new Date(lastBackup).toLocaleString() : "never"}
      </span>
      <div className="flex flex-wrap justify-end gap-1">
        {ALARM_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={cn(
              devClass.mono9,
              "cursor-pointer rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--text3)]",
            )}
            title={`Trigger test alarm: ${kind}`}
            onClick={async () => {
              await window.exva?.ops?.triggerTestAlarm({ kind });
              setMsg(`fired ${kind}`);
            }}
          >
            {kind}
          </button>
        ))}
      </div>
      {msg ? (
        <span className={cn(devClass.mono9, "text-[var(--text3)]")}>{msg}</span>
      ) : null}
    </div>
  );
}
