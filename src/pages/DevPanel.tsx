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
};
const LEVEL_BG: Record<LogLevel, string> = {
  DEBUG: "color-mix(in srgb, var(--color-log-debug) 20%, transparent)",
  INFO: "var(--color-info-dim)",
  WARN: "var(--color-warning-dim)",
  ERROR: "var(--color-error-dim)",
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

// ─── Shared Styles ────────────────────────────────────────────────────────────

const S = {
  mono9: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
  } as const,
  mono10: { fontFamily: "var(--font-mono)", fontSize: 12 } as const,
  mono11: { fontFamily: "var(--font-mono)", fontSize: 12 } as const,
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--text3)",
  },
  sectionTitle: {
    fontFamily: "var(--font-mono)",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
    color: "var(--text3)",
    padding: "10px 12px 4px",
  },
  // CopyBtn base (dynamic: background, border, color)
  copyBtnBase: {
    borderRadius: 4,
    padding: "2px 7px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  } as const,
  // StatusChip base (dynamic: background, border, color)
  statusChipBase: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    borderRadius: 5,
    padding: "2px 7px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
  } as const,
  // ScopeItem button base (dynamic: borderLeft, background)
  scopeItemBtn: {
    width: "100%",
    padding: "7px 12px 7px 14px",
    border: "none",
    cursor: "pointer",
    transition: "background 0.1s, border-color 0.1s",
    display: "flex",
    alignItems: "center",
    gap: 8,
    textAlign: "left" as const,
  } as const,
  // StripBtn base (dynamic: background, border, cursor, color, opacity)
  stripBtnBase: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    borderRadius: 5,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
    transition: "background 0.12s, border-color 0.12s, opacity 0.12s",
  } as const,
  // EventTimeline outer container (all static)
  eventTimelineOuter: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    minWidth: 0,
  } as const,
  // EventRow button base (dynamic: background, borderLeft)
  eventRowBtnBase: {
    width: "100%",
    border: "none",
    display: "grid",
    gridTemplateColumns: "50px 44px 110px 1fr",
    padding: "7px 14px",
    cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.022)",
    transition: "background 0.08s",
    alignItems: "baseline",
    gap: 0,
    textAlign: "left" as const,
  } as const,
  // Pre block (config / raw tabs) with maxHeight
  preBlockWithMax: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    color: "var(--text2)",
    lineHeight: 1.65,
    overflowX: "auto" as const,
    whiteSpace: "pre-wrap" as const,
    maxHeight: 420,
  } as const,
  // Pre block (raw tab) without maxHeight
  preBlock: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    color: "var(--text2)",
    lineHeight: 1.65,
    overflowX: "auto" as const,
    whiteSpace: "pre-wrap" as const,
  } as const,
  // RunCard header button (all static)
  runCardHeaderBtn: {
    width: "100%",
    padding: "8px 10px",
    background: "var(--surface2)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    border: "none",
    textAlign: "left" as const,
  } as const,
  // InspectorPanel tab button base (dynamic: borderBottom, color)
  inspectorTabBtnBase: {
    padding: "8px 12px",
    border: "none",
    whiteSpace: "nowrap" as const,
    background: "transparent",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.05em",
    fontWeight: 700,
    cursor: "pointer",
    transition: "color 0.1s, border-color 0.1s",
  } as const,
  // DebugCapture confirm button base (dynamic: opacity)
  debugCaptureBtnBase: {
    padding: "7px 16px",
    background: "var(--color-info-dim)",
    border: "1px solid var(--color-info-border)",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
    color: "var(--color-info)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
  } as const,
  // Toggle track button base (dynamic: background)
  toggleTrackBase: {
    width: 36,
    height: 18,
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    position: "relative" as const,
    transition: "background 0.2s",
  } as const,
  // Toggle thumb base (dynamic: left, background)
  toggleThumbBase: {
    position: "absolute" as const,
    top: 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    transition: "left 0.2s",
  } as const,
  // ExportResultDrawer container (all static)
  exportDrawer: {
    position: "fixed" as const,
    bottom: 20,
    right: 20,
    width: 360,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    zIndex: 20,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  } as const,
  // Shared action button in ExportResultDrawer (all static)
  exportActionBtn: {
    flex: 1,
    padding: "6px 0",
    background: "var(--surface3)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
    color: "var(--text2)",
    cursor: "pointer",
  } as const,
  // ToastContainer outer (all static)
  toastContainer: {
    position: "fixed" as const,
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    zIndex: 30,
    pointerEvents: "none" as const,
  } as const,
  // Stream health badge base (dynamic: color, background, border)
  streamBadgeBase: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    borderRadius: 5,
    padding: "3px 8px",
  } as const,
  // HeaderBtn base (dynamic: background, border, color, cursor, opacity)
  headerBtnBase: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    letterSpacing: "0.08em",
    fontWeight: 700,
    transition: "background 0.12s, border-color 0.12s, opacity 0.12s",
  } as const,
  searchInput: {
    flex: 1,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "5px 10px",
    color: "var(--text1)",
    outline: "none",
    boxShadow: "0 0 0 0 transparent",
  } as const,
};

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
      style={{
        ...S.copyBtnBase,
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
      style={{
        ...S.statusChipBase,
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
  <div
    style={{
      height: 36,
      display: "flex",
      gap: 10,
      padding: "0 14px",
      alignItems: "center",
      borderBottom: "1px solid rgba(255,255,255,0.025)",
    }}
  >
    {[48, 40, 80, 200].map((w) => (
      <div
        key={w}
        style={{
          width: w,
          height: 8,
          borderRadius: 3,
          background: "var(--surface3)",
          opacity: 0.6,
        }}
      />
    ))}
  </div>
);

const Spinner = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    style={{ animation: "spin 0.8s linear infinite" }}
  >
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
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
    return <span style={{ ...S.mono9, color: "var(--text3)" }}>n/a</span>;
  const needs = text.length > collapseAt;
  return (
    <div>
      <div
        style={{
          ...S.mono10,
          color: "var(--text2)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {needs && !expanded ? text.slice(0, collapseAt) + "…" : text}
      </div>
      {needs && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 4,
            background: "none",
            border: "none",
            ...S.mono9,
            color: "var(--text3)",
            cursor: "pointer",
          }}
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
      style={{
        ...S.scopeItemBtn,
        borderLeft: `2px solid ${c}`,
        background: isActive ? "rgba(77,166,255,0.07)" : "transparent",
      }}
    >
      {icon && <span style={{ fontSize: 12, opacity: 0.5 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            ...S.mono10,
            color: isActive ? "var(--text1)" : "var(--text2)",
            fontWeight: isActive ? 700 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        {subLabel && (
          <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 1 }}>
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
    <div
      style={{
        width: 210,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "14px 12px 8px 14px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            ...S.mono9,
            fontWeight: 800,
            color: "var(--text3)",
            letterSpacing: "0.05em",
          }}
        >
          SCOPE
        </div>
      </div>

      <ScopeRailItem
        scope={{ type: "global" }}
        label="Global workspace"
        icon="◈"
        activeScope={activeScope}
        onScopeChange={onScopeChange}
      />

      <div style={S.sectionTitle}>Session</div>
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
        <div style={{ padding: "6px 14px", ...S.mono9, color: "var(--text3)" }}>
          No focused session
        </div>
      )}

      {others.length > 0 && (
        <>
          <div style={S.sectionTitle}>Active sessions</div>
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

      <div style={{ flex: 1 }} />
      <div style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
        <div style={{ ...S.mono9, color: "var(--text3)", padding: "4px 14px" }}>
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
    style={{
      ...S.stripBtnBase,
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
    <div
      style={{
        background: "var(--surface2)",
        borderBottom: "1px solid var(--border)",
        padding: "8px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Row 1: Status + Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {/* Status cards */}
        {diagnosticsLoading ? (
          <div style={{ display: "flex", gap: 6 }}>
            {[80, 60, 100].map((w) => (
              <div
                key={w}
                style={{
                  width: w,
                  height: 24,
                  borderRadius: 5,
                  background: "var(--surface3)",
                }}
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
          <span style={{ ...S.mono9, color: "var(--text3)" }}>n/a</span>
        )}

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          {/* Log level */}
          <span style={S.label}>log</span>
          <select
            value={effectiveLogLevel}
            onChange={(e) => onSetLogLevel(e.target.value as PinoLevel)}
            disabled={logLevelLoading}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "3px 6px",
              ...S.mono9,
              color: "var(--text2)",
              cursor: "pointer",
            }}
          >
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          {/* Time window */}
          <span style={S.label}>window</span>
          <div
            style={{
              display: "flex",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              overflow: "hidden",
            }}
          >
            {TIME_WINDOWS.map((tw) => (
              <button
                key={tw.value}
                onClick={() => setTimeWindow(tw.value)}
                style={{
                  padding: "4px 8px",
                  border: "none",
                  background:
                    timeWindow === tw.value
                      ? "var(--color-info-dim)"
                      : "transparent",
                  ...S.mono9,
                  fontWeight: 700,
                  color:
                    timeWindow === tw.value
                      ? "var(--color-info)"
                      : "var(--text3)",
                  cursor: "pointer",
                }}
              >
                {tw.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Source filters + step controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {/* Level filter */}
        <div
          style={{
            display: "flex",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {LEVELS.map((l) => (
            <button
              key={l}
              onClick={() => setMinLevel(l)}
              style={{
                padding: "3px 8px",
                border: "none",
                background: minLevel === l ? LEVEL_BG[l] : "transparent",
                ...S.mono9,
                fontWeight: 700,
                color: minLevel === l ? LEVEL_COLOR[l] : "var(--text3)",
                cursor: "pointer",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Source filters */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SOURCE_TYPES.map((src) => {
            const on =
              sourceFilters.includes(src) || sourceFilters.length === 0;
            const c = ROLE_COLOR[src] ?? "var(--text2)";
            return (
              <button
                key={src}
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
                  padding: "2px 7px",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: on ? `${c}18` : "transparent",
                  border: `1px solid ${on ? c + "44" : "var(--border)"}`,
                  ...S.mono9,
                  fontWeight: 700,
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
      <div
        style={{
          width: 1,
          height: 20,
          background: "var(--border)",
          margin: "0 2px",
        }}
      />
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
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 5,
      padding: "3px 8px",
    }}
  >
    <span style={{ ...S.mono9, color: "var(--text3)" }}>{label}</span>
    <span style={{ ...S.mono9, fontWeight: 800, color }}>{value}</span>
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

  return (
    <div style={S.eventTimelineOuter}>
      {/* Search bar */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface2)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, id, symbol, provider, error…"
          style={{ ...S.searchInput, ...S.mono10 }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 2px var(--accent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = "0 0 0 0 transparent";
          }}
        />
        {loading && <Spinner />}
        <span style={{ ...S.mono9, color: "var(--text3)", flexShrink: 0 }}>
          {filtered.length}/{events.length}
        </span>
      </div>

      {/* Event rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading &&
          events.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ ...S.mono10, color: "var(--text3)" }}>
              {events.length === 0
                ? "No developer events have been recorded yet."
                : "No events match these filters."}
            </div>
            {events.length === 0 && (
              <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 6 }}>
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
              style={{
                ...S.eventRowBtnBase,
                background: sel ? "var(--surface2)" : "transparent",
                borderLeft: `2px solid ${sel ? lc : lc + "44"}`,
              }}
            >
              <span style={{ ...S.mono9, color: "var(--text3)" }}>
                {fmt.time(ev.created_at)}
              </span>
              <span
                style={{
                  ...S.mono9,
                  fontWeight: 800,
                  color: lc,
                  letterSpacing: "0.05em",
                }}
              >
                {ev.level}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {ev.agent_type && (
                  <span
                    style={{
                      ...S.mono9,
                      fontWeight: 700,
                      color: rc,
                      background: `${rc}18`,
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}
                  >
                    {ev.agent_type}
                  </span>
                )}
                {ev.cycle_id && (
                  <span
                    style={{
                      ...S.mono9,
                      color: "var(--text3)",
                      background: "var(--surface3)",
                      borderRadius: 3,
                      padding: "1px 4px",
                    }}
                  >
                    cyc·{String(ev.cycle_id).slice(0, 5)}
                  </span>
                )}
              </div>
              <span
                style={{
                  ...S.mono10,
                  color: sel ? "var(--text1)" : "var(--text2)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    ...S.mono9,
                    color: "var(--color-info-border)",
                    marginRight: 5,
                  }}
                >
                  [{summarizeEventSource(ev)}]
                </span>
                {ev.message}
              </span>
            </button>
          );
        })}

        {hasMore && (
          <div
            style={{
              padding: "12px 14px",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <button
              onClick={onLoadMore}
              style={{
                padding: "6px 16px",
                background: "var(--surface3)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                ...S.mono9,
                fontWeight: 700,
                color: "var(--text2)",
                cursor: "pointer",
              }}
            >
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
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
              style={{
                color:
                  diag.counts.errors > 0
                    ? "var(--color-error)"
                    : "var(--text2)",
              }}
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
              style={{
                color:
                  diag.counts.warnings > 0
                    ? "var(--color-warning)"
                    : "var(--text2)",
              }}
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
              style={{
                color:
                  diag.counts.failedSteps > 0
                    ? "var(--color-error)"
                    : "var(--text2)",
              }}
            >
              {diag.counts.failedSteps}
            </span>
          }
          mono={false}
        />
      </SectionCard>
      {diag.latestError && (
        <SectionCard title="Latest Error">
          <div
            style={{ ...S.mono9, color: "var(--color-error)", lineHeight: 1.5 }}
          >
            {diag.latestError.message}
          </div>
          <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 4 }}>
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {diag?.executionProgress?.cycleId && (
        <div style={{ ...S.mono9, color: "var(--text3)", marginBottom: 4 }}>
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
            style={{
              background: "var(--bg)",
              border: `1px solid ${c}40`,
              borderRadius: 6,
              padding: "8px 10px",
              borderLeft: `2px solid ${c}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span style={{ ...S.mono9, fontWeight: 800, color: c }}>
                {step.stage}
              </span>
              <span style={{ ...S.mono9, color: c }}>{step.status}</span>
            </div>
            {step.attempt > 0 && (
              <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 4 }}>
                attempt {step.attempt}
              </div>
            )}
            {step.lastErrorMessage && (
              <div
                style={{
                  ...S.mono9,
                  color: "var(--color-error)",
                  marginTop: 4,
                  lineHeight: 1.5,
                }}
              >
                {step.lastErrorMessage}
              </div>
            )}
            {step.outcome && (
              <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 4 }}>
                outcome: {step.outcome}
              </div>
            )}
            {step.nextRetryAt && (
              <div
                style={{
                  ...S.mono9,
                  color: "var(--color-warning)",
                  marginTop: 2,
                }}
              >
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {diag.pipelineConfigError && (
        <SectionCard title="Validation Error">
          <div
            style={{
              ...S.mono9,
              color: "var(--color-error)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {diag.pipelineConfigError}
          </div>
        </SectionCard>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6,
        }}
      >
        {[
          ["pipeline", config.pipelineId],
          ["stages", String(config.stages.length)],
          ["workers", String(config.workers.length)],
          ["engines", String(config.engines.length)],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "6px 8px",
              textAlign: "center",
            }}
          >
            <div style={{ ...S.mono9, color: "var(--text3)" }}>{label}</div>
            <div
              style={{
                ...S.mono10,
                fontWeight: 700,
                color: "var(--text1)",
                marginTop: 2,
              }}
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span style={S.label}>resolved config</span>
          <CopyBtn text={pretty} label="copy config" />
        </div>
        <pre style={S.preBlockWithMax}>{pretty}</pre>
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}
      >
        {[
          ["runs", String(runs.length)],
          ["tokens", fmt.tokens(total.tokens)],
          ["cost", fmt.usd(total.cost, 4)],
        ].map(([l, v]) => (
          <div
            key={l}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "6px 8px",
              textAlign: "center",
            }}
          >
            <div style={{ ...S.mono9, color: "var(--text3)" }}>{l}</div>
            <div
              style={{
                ...S.mono10,
                fontWeight: 700,
                color: "var(--text1)",
                marginTop: 2,
              }}
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
      style={{
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
        borderLeft: `2px solid ${accent}`,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={S.runCardHeaderBtn}
      >
        <AgentLabel type={run.agent_type as EventSourceType} />
        <span style={{ ...S.mono9, color: "var(--text3)" }}>
          {run.provider_key} · {run.model}
        </span>
        <span
          style={{
            ...S.mono9,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 3,
            background:
              run.finish_reason === "stop"
                ? "var(--color-success-dim)"
                : "var(--color-error-dim)",
            color:
              run.finish_reason === "stop"
                ? "var(--color-success)"
                : "var(--color-error)",
          }}
        >
          {run.finish_reason}
        </span>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={{ ...S.mono9, color: "var(--text3)" }}>
            {fmt.tokens(run.input_tokens + run.output_tokens)} ·{" "}
            {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
          </span>
          <CopyBtn text={JSON.stringify(run, null, 2)} label="copy" />
          <span style={{ ...S.mono9, color: "var(--text3)" }}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </button>
      {open && (
        <div
          style={{
            padding: "10px 12px",
            background: "var(--bg)",
            borderTop: "1px solid var(--border)",
          }}
        >
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {traces.map(({ m, t }) => (
        <div
          key={m.id}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 7,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "7px 10px",
              background: "var(--surface2)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  ...S.mono9,
                  fontWeight: 800,
                  color: ROLE_COLOR[t.phase] ?? "var(--text2)",
                }}
              >
                {t.phase}
              </span>
              <span style={{ ...S.mono9, color: "var(--text3)" }}>
                {t.schedulingMode}
              </span>
              <span style={{ ...S.mono9, color: "var(--text3)" }}>
                {t.frontiers.length} frontiers · {t.workers.length} workers
              </span>
            </div>
            <CopyBtn text={JSON.stringify(t, null, 2)} />
          </div>
          <div
            style={{
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              background: "var(--bg)",
            }}
          >
            {t.workers.map((w) => (
              <div
                key={w.workerId}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "7px 9px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      ...S.mono9,
                      fontWeight: 800,
                      color: ROLE_COLOR[t.phase] ?? "var(--text2)",
                    }}
                  >
                    {w.workerId}
                  </span>
                  <span style={{ ...S.mono9, color: "var(--text3)" }}>
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
    <div
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {calls.map((c) => (
        <div
          key={c.id}
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "7px 9px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                ...S.mono9,
                fontWeight: 700,
                color:
                  c.status === "ok"
                    ? "var(--color-success)"
                    : "var(--color-error)",
              }}
            >
              {c.status.toUpperCase()}
            </span>
            <span style={{ ...S.mono9, color: "var(--text2)" }}>
              {c.provider}
            </span>
            <span style={{ ...S.mono9, color: "var(--text3)" }}>
              {c.call_type}
            </span>
            <span style={{ ...S.mono9, color: "var(--text3)" }}>
              {c.latency_ms}ms
            </span>
            {c.cost_usd != null && (
              <span style={{ ...S.mono9, color: "var(--text3)" }}>
                {fmt.usd(c.cost_usd, 4)}
              </span>
            )}
            {c.from_cache && (
              <span style={{ ...S.mono9, color: "var(--color-info)" }}>
                cached
              </span>
            )}
          </div>
          <div
            style={{
              ...S.mono9,
              color: "var(--text3)",
              marginTop: 4,
              wordBreak: "break-all",
            }}
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
    <div style={{ padding: "12px 14px" }}>
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}
      >
        <CopyBtn text={pretty} label="copy raw" />
      </div>
      <pre style={S.preBlock}>{pretty}</pre>
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
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface2)",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...S.inspectorTabBtnBase,
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              color: tab === t.id ? "var(--text1)" : "var(--text3)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {([5, 15, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => dispatchForm({ duration: d, untilStopped: false })}
            style={{
              padding: "5px 12px",
              borderRadius: 5,
              cursor: "pointer",
              background:
                form.duration === d && !form.untilStopped
                  ? "var(--color-info-dim)"
                  : "var(--surface3)",
              border: `1px solid ${form.duration === d && !form.untilStopped ? "var(--color-info-border)" : "var(--border)"}`,
              ...S.mono9,
              fontWeight: 700,
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
          style={{
            padding: "5px 12px",
            borderRadius: 5,
            cursor: "pointer",
            background: form.untilStopped
              ? "var(--color-warning-dim)"
              : "var(--surface3)",
            border: `1px solid ${form.untilStopped ? "var(--color-warning-border)" : "var(--border)"}`,
            ...S.mono9,
            fontWeight: 700,
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
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          padding: "5px 8px",
          ...S.mono10,
          color: "var(--text1)",
          width: "100%",
        }}
      >
        {LOG_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      {form.mainLevel === "trace" && !form.traceConfirm && (
        <div style={{ marginTop: 6 }}>
          <div
            style={{
              ...S.mono9,
              color: "var(--color-warning)",
              marginBottom: 4,
            }}
          >
            Trace logs can include large payload metadata and may slow the app.
          </div>
          <button
            onClick={() => dispatchForm({ traceConfirm: true })}
            style={{
              padding: "4px 10px",
              background: "var(--color-warning-dim)",
              border: "1px solid var(--color-warning-border)",
              borderRadius: 4,
              ...S.mono9,
              fontWeight: 700,
              color: "var(--color-warning)",
              cursor: "pointer",
            }}
          >
            Confirm trace level
          </button>
        </div>
      )}
    </FieldGroup>

    {/* Event min level */}
    <FieldGroup label="Event min level">
      <div
        style={{
          display: "flex",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => dispatchForm({ eventLevel: l })}
            style={{
              flex: 1,
              padding: "5px 4px",
              border: "none",
              background: form.eventLevel === l ? LEVEL_BG[l] : "transparent",
              ...S.mono9,
              fontWeight: 700,
              color: form.eventLevel === l ? LEVEL_COLOR[l] : "var(--text3)",
              cursor: "pointer",
            }}
          >
            {l}
          </button>
        ))}
      </div>
    </FieldGroup>

    {/* Toggles */}
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
    <div style={{ ...S.mono9, color: "var(--text3)", lineHeight: 1.5 }}>
      Secrets are redacted before export. API keys and authorization headers are
      never shown.
    </div>

    {form.error && (
      <div style={{ ...S.mono9, color: "var(--color-error)" }}>
        {form.error}
      </div>
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

  const OVERLAY: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
  const MODAL: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "20px 24px",
    width: 420,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  };

  return (
    <div
      role="presentation"
      style={OVERLAY}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={MODAL} role="dialog" aria-modal="true">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              ...S.mono9,
              fontWeight: 800,
              letterSpacing: "0.05em",
              color: "var(--text1)",
            }}
          >
            CAPTURE DEBUG WINDOW
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text3)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            ...S.mono9,
            color: "var(--text3)",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 10px",
          }}
        >
          Scope: {activeScope.label ?? activeScope.type}
        </div>

        <CaptureFormFields form={form} dispatchForm={dispatchForm} />

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 16px",
              background: "var(--surface3)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              ...S.mono9,
              fontWeight: 700,
              color: "var(--text2)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              (form.mainLevel === "trace" && !form.traceConfirm)
            }
            style={{
              ...S.debugCaptureBtnBase,
              opacity: mutation.isPending ? 0.7 : 1,
            }}
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
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div style={S.label}>{label}</div>
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
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    <span style={{ ...S.mono10, color: "var(--text2)" }}>{label}</span>
    <button
      onClick={() => onChange(!checked)}
      style={{
        ...S.toggleTrackBase,
        background: checked ? "var(--accent)" : "var(--surface3)",
      }}
    >
      <div
        style={{
          ...S.toggleThumbBase,
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
  <div style={S.exportDrawer}>
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span
        style={{ ...S.mono9, fontWeight: 800, color: "var(--color-success)" }}
      >
        Debug bundle exported.
      </span>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          color: "var(--text3)",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
    <div style={{ ...S.mono9, color: "var(--text3)", wordBreak: "break-all" }}>
      {result.path}
    </div>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {result.includedSections.map((s) => (
        <span
          key={s}
          style={{
            ...S.mono9,
            color: "var(--text2)",
            background: "var(--surface3)",
            borderRadius: 3,
            padding: "2px 5px",
          }}
        >
          {s}
        </span>
      ))}
    </div>
    <div style={{ ...S.mono9, color: "var(--text3)" }}>
      {result.redactionCount} field{result.redactionCount !== 1 ? "s" : ""}{" "}
      redacted · {(result.sizeBytes / 1024).toFixed(0)} KB
    </div>
    {result.warnings.map((w) => (
      <div key={w} style={{ ...S.mono9, color: "var(--color-warning)" }}>
        {w}
      </div>
    ))}
    <div style={{ display: "flex", gap: 6 }}>
      <button
        onClick={() =>
          developerApi()?.openPath({
            kind: "debugBundle",
            path: result.path,
          })
        }
        style={S.exportActionBtn}
      >
        Reveal in Finder
      </button>
      <button onClick={() => copyText(result.path)} style={S.exportActionBtn}>
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
  <div style={S.toastContainer}>
    {toasts.map((t) => (
      <div
        key={t.id}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          background:
            t.kind === "ok"
              ? "var(--color-success-dim)"
              : "var(--color-error-dim)",
          border: `1px solid ${t.kind === "ok" ? "var(--color-success-border)" : "var(--color-error-border)"}`,
          ...S.mono9,
          fontWeight: 700,
          color:
            t.kind === "ok" ? "var(--color-success)" : "var(--color-error)",
          backdropFilter: "blur(8px)",
        }}
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
  <div
    style={{
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: 7,
      padding: "8px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}
  >
    <div
      style={{
        ...S.label,
        paddingBottom: 5,
        borderBottom: "1px solid var(--border)",
        marginBottom: 2,
      }}
    >
      {title}
    </div>
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
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "flex-start",
      minHeight: 20,
    }}
  >
    <span style={{ ...S.mono9, color: "var(--text3)", flexShrink: 0 }}>
      {label}
    </span>
    <span
      style={{
        ...(mono ? S.mono9 : {}),
        fontSize: 12,
        color: "var(--text2)",
        textAlign: "right",
        wordBreak: "break-all",
      }}
    >
      {value}
    </span>
  </div>
);

const EmptyState = ({ msg }: { msg: string }) => (
  <div
    style={{
      padding: "36px 20px",
      textAlign: "center",
      ...S.mono9,
      color: "var(--text3)",
      lineHeight: 1.6,
    }}
  >
    {msg}
  </div>
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
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Scope Rail */}
      <ScopeRail
        activeScope={uiState.activeScope}
        onScopeChange={handleScopeChange}
        sessions={sessions}
        focusedSessionId={focusedSessionId}
      />

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--surface2)",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: "var(--text1)",
                letterSpacing: "-0.01em",
              }}
            >
              Developer Workbench
            </div>
            <div style={{ ...S.mono9, color: "var(--text3)", marginTop: 2 }}>
              {scopeLabel}
            </div>
          </div>

          {/* Stream health badge */}
          <div style={{ marginLeft: 8 }}>
            {dataState.streamHealthy ? (
              <span
                style={{
                  ...S.streamBadgeBase,
                  color: "var(--color-success)",
                  background: "var(--color-success-dim)",
                  border: "1px solid var(--color-success-border)",
                }}
              >
                <Dot color="var(--color-success)" pulse size={4} /> Live
              </span>
            ) : (
              <span
                style={{
                  ...S.streamBadgeBase,
                  color: "var(--color-warning)",
                  background: "var(--color-warning-dim)",
                  border: "1px solid var(--color-warning-border)",
                }}
              >
                <Dot color="var(--color-warning)" pulse size={4} /> Delayed ·
                polling
              </span>
            )}
          </div>

          {uiState.captureActive && (
            <span
              style={{
                ...S.streamBadgeBase,
                color: "var(--color-market)",
                background: "var(--color-market-dim)",
                border: "1px solid var(--color-market-border)",
              }}
            >
              <Dot color="var(--color-market)" pulse size={4} />
              Capture active
              {uiState.captureActive.expiresAt
                ? ` · ends ${fmt.time(uiState.captureActive.expiresAt)}`
                : ""}
            </span>
          )}

          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
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
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: 10,
            padding: "10px",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {/* Timeline — 60% */}
          <div
            style={{
              flex: "0 0 60%",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
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
          <div
            style={{
              flex: "0 0 calc(40% - 10px)",
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
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
        <div
          style={{
            padding: "4px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: 16,
            alignItems: "center",
            background: "var(--surface2)",
            flexShrink: 0,
          }}
        >
          <span style={{ ...S.mono9, color: "var(--text3)" }}>
            {filtered.length} events
          </span>
          <span
            style={{ ...S.mono9, color: "var(--text3)", marginLeft: "auto" }}
          >
            SQLite · exva.db
          </span>
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
    style={{
      ...S.headerBtnBase,
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
