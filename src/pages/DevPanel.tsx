import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentLabel, Dot, PageShell } from "@/components/custom-ui";
import { fmt } from "@/lib/formatters";
import { api } from "@/lib/exva";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useSessionStore } from "@/store/sessionStore";
import type { AgentMessage, AgentRun, EventRow, LogLevel, SessionAiRole } from "@/lib/types";
import type { SessionSummary, StrategyGetResponse } from "@/lib/exva";

// ─── Extended types for spec fields not yet in schema ───────────────────────

interface ExtEventRow extends EventRow {
  cycle_id?: string | null;
  action_type?: string;
  source_component?: string | null;
  details_json?: string | null;
  related_run_id?: string | null;
  instrument_symbol?: string | null;
  instrument_class?: string | null;
}

interface ExtAgentRun extends AgentRun {
  cycle_id?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
const ROLE_FILTERS = ["all", "selector", "analyst_technical", "analyst_fundamental", "reviewer", "decision_maker", "system", "orchestrator"] as const;
type RoleFilter = typeof ROLE_FILTERS[number];

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: "#3d4f60",
  INFO: "#4da6ff",
  WARN: "#ffb733",
  ERROR: "#ff4757",
};

const LEVEL_BG: Record<LogLevel, string> = {
  DEBUG: "rgba(61,79,96,0.18)",
  INFO: "rgba(77,166,255,0.12)",
  WARN: "rgba(255,183,51,0.12)",
  ERROR: "rgba(255,71,87,0.12)",
};

const ROLE_COLOR: Record<string, string> = {
  analyst_technical: "#00e5a0",
  analyst_fundamental: "#ff7b8a",
  reviewer: "#4da6ff",
  decision_maker: "#c084fc",
  instrument_selector: "#fbbf24",
};

const ROLE_LABELS: Record<string, string> = {
  analyst_technical: "tech",
  analyst_fundamental: "fund",
  reviewer: "review",
  decision_maker: "decide",
  instrument_selector: "selector",
  system: "system",
  orchestrator: "orch",
};

const INSPECTOR_TABS = ["event", "runs", "trace", "calls", "raw"] as const;
type InspectorTab = typeof INSPECTOR_TABS[number];

// ─── Styles ──────────────────────────────────────────────────────────────────

const S = {
  monoLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    fontWeight: 700,
  },
  monoValue: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text2)",
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  },
  cardTitle: {
    fontFamily: "var(--font-mono)",
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--text3)",
    paddingBottom: 8,
    borderBottom: "1px solid var(--border)",
    marginBottom: 2,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function parseJsonSafe(s: string | null | undefined): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function formatJsonPretty(s: string | null | undefined): string {
  const parsed = parseJsonSafe(s);
  if (parsed === null) return s ?? "";
  return JSON.stringify(parsed, null, 2);
}

function roleLabelShort(role: string): string {
  return ROLE_LABELS[role] ?? role.replace("analyst_", "an/");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DataRow = ({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, minHeight: 22 }}>
    <span style={{ ...S.monoLabel, color: "var(--text3)", flexShrink: 0 }}>{label}</span>
    <span style={{ ...(mono ? S.monoValue : {}), fontSize: 11, color: "var(--text2)", textAlign: "right", wordBreak: "break-all" }}>
      {value}
    </span>
  </div>
);

const StatusChip = ({ status }: { status: string }) => {
  const color =
    status === "active" ? "#00e5a0"
    : status === "paused" ? "#ffb733"
    : status === "error" ? "#ff4757"
    : status === "stopping" ? "#ff8c42"
    : "var(--text3)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: 6, padding: "2px 8px",
      fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      color, letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      <Dot color={color} pulse={status === "active"} size={5} />
      {status}
    </span>
  );
};

const CopyButton = ({ text, label = "copy" }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handle}
      style={{
        background: copied ? "rgba(0,229,160,0.12)" : "var(--surface3)",
        border: `1px solid ${copied ? "#00e5a040" : "var(--border)"}`,
        borderRadius: 5, padding: "3px 8px",
        fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
        color: copied ? "#00e5a0" : "var(--text3)",
        letterSpacing: "0.08em", textTransform: "uppercase",
        transition: "all 0.2s",
      }}
    >
      {copied ? "copied!" : label}
    </button>
  );
};

const JsonBlock = ({ data, label }: { data: string | null | undefined; label: string }) => {
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;
  const pretty = formatJsonPretty(data);
  const preview = pretty.slice(0, 2000);
  const needsTrunc = pretty.length > 2000;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ ...S.monoLabel, color: "var(--text3)", fontSize: 9 }}>{label}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <CopyButton text={pretty} label="copy" />
          {needsTrunc && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{ background: "transparent", border: "none", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", cursor: "pointer" }}
            >
              {expanded ? "collapse" : `show full (${(pretty.length / 1000).toFixed(1)}k)`}
            </button>
          )}
        </div>
      </div>
      <pre style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 6, padding: "10px 12px",
        fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--text2)", lineHeight: 1.6,
        overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
        maxHeight: expanded ? "none" : 200, overflow: expanded ? "auto" : "hidden",
      }}>
        {needsTrunc && !expanded ? preview + "\n…" : pretty}
      </pre>
    </div>
  );
};

// ─── Diagnostics Cards ───────────────────────────────────────────────────────

const RuntimeIdentityCard = ({
  session,
  stats,
  cycleState,
  viewMode,
}: {
  session: SessionSummary | null;
  stats: import("@/lib/types").DashboardStats | null;
  cycleState: string;
  viewMode: string;
}) => (
  <div style={S.card}>
    <div style={S.cardTitle}>Runtime Identity</div>
    <DataRow label="runtime" value="Electron / TypeScript" />
    <DataRow label="session id" value={session?.id ?? <span style={{ color: "var(--text3)" }}>—</span>} />
    <DataRow label="session" value={session?.name ?? <span style={{ color: "var(--text3)" }}>No session focused</span>} />
    <DataRow label="status" value={session ? <StatusChip status={session.status} /> : <span style={{ color: "var(--text3)" }}>—</span>} mono={false} />
    <DataRow label="mode" value={viewMode} />
    <DataRow label="uptime" value={stats ? fmt.uptime(stats.session_uptime_min) : "—"} />
    <DataRow label="cycle" value={
      <span style={{ color: cycleState.startsWith("active") || cycleState.startsWith("step") ? "#00e5a0" : cycleState.startsWith("failed") ? "#ff4757" : "var(--text2)" }}>
        {cycleState}
      </span>
    } />
  </div>
);

const AiRoleMatrixCard = ({ roles, loading }: { roles: SessionAiRole[]; loading: boolean }) => {
  const allRoles: Array<{ role: string; label: string }> = [
    { role: "instrument_selector", label: "selector" },
    { role: "analyst_technical", label: "tech" },
    { role: "analyst_fundamental", label: "fund" },
    { role: "reviewer", label: "review" },
    { role: "decision_maker", label: "decide" },
  ];
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>AI Role Matrix</div>
      {loading ? (
        <div style={{ color: "var(--text3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>loading…</div>
      ) : roles.length === 0 ? (
        <div style={{ color: "var(--text3)", fontSize: 11, fontFamily: "var(--font-mono)" }}>No session focused</div>
      ) : (
        allRoles.map(({ role, label }) => {
          const r = roles.find((x) => x.role === role);
          const accent = ROLE_COLOR[role] ?? "var(--text3)";
          return (
            <div key={role} style={{ display: "flex", alignItems: "flex-start", gap: 8, paddingBottom: 7, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ ...S.monoLabel, color: accent, width: 54, flexShrink: 0, fontSize: 9 }}>{label}</span>
              {r ? (
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)" }}>
                    {r.providerKey} · {r.modelId}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", marginTop: 1 }}>
                    {r.promptSource === "session_override" ? "custom prompt" : "default prompt"}
                  </div>
                </div>
              ) : (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>not configured</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

const ExecutionCard = ({ session, stats }: { session: SessionSummary | null; stats: import("@/lib/types").DashboardStats | null }) => (
  <div style={S.card}>
    <div style={S.cardTitle}>Execution</div>
    <DataRow label="exec mode" value={session?.executionMode ?? "—"} />
    <DataRow label="search" value={session?.defaultSearchProviderId ?? <span style={{ color: "var(--text3)" }}>workspace default</span>} />
    <DataRow label="open trades" value={stats?.open_trades ?? "—"} />
    <DataRow label="daily spend" value={stats ? fmt.usd(stats.daily_api_spend, 4) : "—"} />
    <DataRow label="selection" value={session?.selectionMode?.replace("_", " ") ?? "—"} />
  </div>
);

const StreamCard = ({
  events,
  filtered,
  streamHealthy,
  lastEventAt,
  onCopySnapshot,
}: {
  events: ExtEventRow[];
  filtered: ExtEventRow[];
  streamHealthy: boolean;
  lastEventAt: string | null;
  onCopySnapshot: () => void;
}) => (
  <div style={S.card}>
    <div style={S.cardTitle}>Logging & Stream</div>
    <DataRow label="stream" value={
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Dot color={streamHealthy ? "#00e5a0" : "#ffb733"} pulse={streamHealthy} size={5} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: streamHealthy ? "#00e5a0" : "#ffb733" }}>
          {streamHealthy ? "live" : "delayed · polling fallback"}
        </span>
      </span>
    } mono={false} />
    <DataRow label="last event" value={lastEventAt ? fmt.time(lastEventAt) : "—"} />
    <DataRow label="shown / total" value={`${filtered.length} / ${events.length}`} />
    <DataRow label="db" value="SQLite · exva.db" />
    <div style={{ marginTop: 4 }}>
      <button
        onClick={onCopySnapshot}
        style={{
          width: "100%", padding: "7px 0",
          background: "var(--surface3)", border: "1px solid var(--border)",
          borderRadius: 6, fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
          color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase",
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        Copy Diagnostics Snapshot
      </button>
    </div>
  </div>
);

// ─── Event Timeline ───────────────────────────────────────────────────────────

const EventTimeline = ({
  events,
  selectedId,
  onSelect,
  minLevel,
  setMinLevel,
  roleFilter,
  setRoleFilter,
  search,
  setSearch,
  filtered,
}: {
  events: ExtEventRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  minLevel: LogLevel;
  setMinLevel: (l: LogLevel) => void;
  roleFilter: RoleFilter;
  setRoleFilter: (r: RoleFilter) => void;
  search: string;
  setSearch: (s: string) => void;
  filtered: ExtEventRow[];
}) => (
  <div style={{
    flex: 1, display: "flex", flexDirection: "column",
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: 12, overflow: "hidden", minWidth: 0,
  }}>
    {/* Toolbar */}
    <div style={{
      padding: "12px 14px", borderBottom: "1px solid var(--border)",
      display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", flexShrink: 0,
      background: "var(--surface2)",
    }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search events, errors, trade IDs, cycle IDs…"
        style={{
          background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "6px 11px", color: "var(--text1)",
          fontSize: 11, outline: "none", fontFamily: "var(--font-mono)", width: 280,
        }}
      />
      {/* Level filters */}
      <div style={{ display: "flex", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)", overflow: "hidden" }}>
        {LEVELS.map((l) => (
          <button
            key={l}
            onClick={() => setMinLevel(l)}
            style={{
              padding: "5px 9px", fontSize: 10, cursor: "pointer",
              background: minLevel === l ? LEVEL_BG[l] : "transparent",
              border: "none",
              color: minLevel === l ? LEVEL_COLOR[l] : "var(--text3)",
              fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.05em",
              transition: "all 0.12s",
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {/* Role filters */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {(["all", "selector", "analyst_technical", "analyst_fundamental", "reviewer", "decision_maker"] as RoleFilter[]).map((r) => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            style={{
              padding: "4px 8px", fontSize: 9, borderRadius: 5, cursor: "pointer",
              background: roleFilter === r ? "var(--surface3)" : "transparent",
              border: `1px solid ${roleFilter === r ? "var(--text3)" : "var(--border)"}`,
              color: roleFilter === r
                ? ROLE_COLOR[r] ?? "var(--text2)"
                : "var(--text3)",
              fontFamily: "var(--font-mono)", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              transition: "all 0.12s",
            }}
          >
            {roleLabelShort(r)}
          </button>
        ))}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <Dot color={filtered.length > 0 ? "#00e5a0" : "var(--text3)"} size={5} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>
          {filtered.length} / {events.length}
        </span>
      </div>
    </div>

    {/* Rows */}
    <div style={{ flex: 1, overflowY: "auto" }}>
      {filtered.map((ev) => {
        const isSelected = ev.id === selectedId;
        const lc = LEVEL_COLOR[ev.level];
        return (
          <div
            key={ev.id}
            onClick={() => onSelect(ev.id)}
            style={{
              display: "grid",
              gridTemplateColumns: "46px 46px auto 1fr",
              gap: 0,
              padding: "8px 14px",
              cursor: "pointer",
              background: isSelected ? "var(--surface2)" : "transparent",
              borderBottom: "1px solid rgba(255,255,255,0.025)",
              borderLeft: `2px solid ${isSelected ? lc : lc + "44"}`,
              transition: "background 0.1s",
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
              {fmt.time(ev.created_at)}
            </span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800,
              color: lc, letterSpacing: "0.05em",
            }}>
              {ev.level}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 5, paddingRight: 10 }}>
              {ev.agent_type && <AgentLabel type={ev.agent_type} />}
              {/* new extended fields */}
              {(ev as ExtEventRow).instrument_symbol && (
                <span style={{
                  fontSize: 9, fontFamily: "var(--font-mono)", color: "#fbbf24",
                  background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)",
                  borderRadius: 4, padding: "1px 5px",
                }}>
                  {(ev as ExtEventRow).instrument_symbol}
                </span>
              )}
              {(ev as ExtEventRow).trade_id && (
                <span style={{
                  fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)",
                  background: "var(--surface3)", borderRadius: 4, padding: "1px 5px",
                }}>
                  {(ev as ExtEventRow).trade_id!.slice(0, 8)}…
                </span>
              )}
              {(ev as ExtEventRow).cycle_id && (
                <span style={{
                  fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text3)",
                  background: "var(--surface3)", borderRadius: 4, padding: "1px 5px",
                }}>
                  cyc·{(ev as ExtEventRow).cycle_id!.slice(0, 6)}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: isSelected ? "var(--text1)" : "var(--text2)", lineHeight: 1.45, minWidth: 0 }}>
              {(ev as ExtEventRow).action_type && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#4da6ff", marginRight: 6, fontWeight: 700 }}>
                  [{(ev as ExtEventRow).action_type}]
                </span>
              )}
              {ev.message}
            </span>
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div style={{ padding: "56px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text3)" }}>
            {events.length === 0 ? "No developer events yet" : "No events match these filters"}
          </div>
        </div>
      )}
    </div>
  </div>
);

// ─── Inspector ────────────────────────────────────────────────────────────────

const EventDetailTab = ({ ev }: { ev: ExtEventRow }) => {
  const copyPayload = JSON.stringify(ev, null, 2);
  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 800,
          color: LEVEL_COLOR[ev.level], letterSpacing: "0.06em",
          background: LEVEL_BG[ev.level], padding: "3px 7px", borderRadius: 4,
        }}>
          {ev.level}
        </span>
        {ev.agent_type && <AgentLabel type={ev.agent_type} />}
        {ev.action_type && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#4da6ff", background: "rgba(77,166,255,0.1)", padding: "3px 7px", borderRadius: 4, fontWeight: 700 }}>
            {ev.action_type}
          </span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <CopyButton text={copyPayload} label="copy event" />
        </div>
      </div>

      {/* Timestamp */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>
        {ev.created_at.replace("T", " ").replace("Z", " UTC")}
      </div>

      {/* Identity block */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
        {ev.session_id && <DataRow label="session" value={ev.session_id} />}
        {ev.trade_id && <DataRow label="trade" value={ev.trade_id} />}
        {ev.cycle_id && <DataRow label="cycle" value={ev.cycle_id} />}
        {ev.related_run_id && <DataRow label="run" value={ev.related_run_id} />}
        {ev.instrument_symbol && <DataRow label="symbol" value={ev.instrument_symbol} />}
        {ev.instrument_class && <DataRow label="class" value={ev.instrument_class} />}
        {ev.source_component && <DataRow label="source" value={ev.source_component} />}
      </div>

      {/* Message */}
      <div style={{ fontSize: 12, color: "var(--text1)", lineHeight: 1.6, padding: "10px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
        {ev.message}
      </div>

      {/* Linked counts */}
      {(ev.trade_id || ev.cycle_id) && (
        <div style={{ display: "flex", gap: 6 }}>
          {ev.trade_id && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", background: "var(--surface3)", borderRadius: 4, padding: "3px 7px" }}>
              has trade
            </span>
          )}
          {ev.cycle_id && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", background: "var(--surface3)", borderRadius: 4, padding: "3px 7px" }}>
              has cycle
            </span>
          )}
          {ev.related_run_id && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", background: "var(--surface3)", borderRadius: 4, padding: "3px 7px" }}>
              has run
            </span>
          )}
        </div>
      )}

      {/* Structured detail */}
      {ev.details_json && <JsonBlock data={ev.details_json} label="detail payload" />}
    </div>
  );
};

const AgentRunsTab = ({ runs, loading }: { runs: ExtAgentRun[]; loading: boolean }) => {
  const totalTokens = runs.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);
  const totalCost = runs.reduce((s, r) => s + r.cost_usd, 0);
  const totalDuration = runs.reduce((s, r) => s + r.duration_ms, 0);

  if (loading) return (
    <div style={{ padding: "32px 16px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
      loading runs…
    </div>
  );

  if (runs.length === 0) return (
    <div style={{ padding: "32px 16px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
        No agent run was recorded for this failure.
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)", marginTop: 6 }}>
        This error occurred before AI execution.
      </div>
    </div>
  );

  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Summary bar */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 8, background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 7, padding: "8px 12px",
      }}>
        {[
          ["runs", runs.length.toString()],
          ["tokens", fmt.tokens(totalTokens)],
          ["cost", fmt.usd(totalCost, 4)],
          ["duration", fmt.duration(totalDuration)],
        ].map(([label, value]) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text1)", fontWeight: 700, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      {runs.map((r) => {
        const accent = ROLE_COLOR[r.agent_type] ?? "var(--text3)";
        const copyPayload = JSON.stringify(r, null, 2);
        return (
          <RunCard key={r.id} run={r} accent={accent} copyPayload={copyPayload} />
        );
      })}
    </div>
  );
};

const RunCard = ({ run, accent, copyPayload }: { run: ExtAgentRun; accent: string; copyPayload: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1px solid var(--border)`, borderRadius: 8, overflow: "hidden", borderLeft: `2px solid ${accent}` }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "9px 12px", background: "var(--surface2)",
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
        }}
      >
        <AgentLabel type={run.agent_type} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>
          {run.provider_key} · {run.model}
        </span>
        <span style={{
          fontSize: 9, fontFamily: "var(--font-mono)", padding: "2px 6px",
          borderRadius: 4, background: run.finish_reason === "stop" ? "rgba(0,229,160,0.1)" : "rgba(255,71,87,0.1)",
          color: run.finish_reason === "stop" ? "#00e5a0" : "#ff4757",
          border: `1px solid ${run.finish_reason === "stop" ? "#00e5a030" : "#ff475730"}`,
        }}>
          {run.finish_reason}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
            {fmt.tokens(run.input_tokens + run.output_tokens)} · {fmt.usd(run.cost_usd, 4)} · {fmt.duration(run.duration_ms)}
          </span>
          <CopyButton text={copyPayload} label="copy run" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)" }}>{open ? "▲" : "▼"}</span>
        </div>
      </div>
      {open && (
        <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text2)", lineHeight: 1.6, fontStyle: "italic" }}>
            {run.output_text ? `"${run.output_text.slice(0, 500)}${run.output_text.length > 500 ? "…" : ""}"` : "No output text"}
          </div>
          {run.cycle_id && (
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
              cycle: {run.cycle_id}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MessageTraceTab = ({ messages, loading }: { messages: AgentMessage[]; loading: boolean }) => {
  if (loading) return (
    <div style={{ padding: "32px 16px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
      loading trace…
    </div>
  );
  if (messages.length === 0) return (
    <div style={{ padding: "32px 16px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
      No message trace recorded
    </div>
  );
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
      {messages.map((m) => {
        const fullPayload = JSON.stringify(m, null, 2);
        return (
          <div key={m.id} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", borderLeft: `2px solid ${ROLE_COLOR[m.role] ?? "var(--text3)"}` }}>
            <div style={{ padding: "8px 12px", background: "var(--surface2)", display: "flex", alignItems: "center", gap: 8 }}>
              <AgentLabel type={m.role} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)" }}>
                {m.provider_key} · {m.model_id}
              </span>
              {m.output_schema_name && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#4da6ff" }}>
                  {m.output_schema_name}
                </span>
              )}
              {m.parse_fallback && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#ffb733", background: "rgba(255,183,51,0.1)", padding: "2px 5px", borderRadius: 3 }}>
                  parse fallback
                </span>
              )}
              <div style={{ marginLeft: "auto" }}>
                <CopyButton text={fullPayload} label="copy trace" />
              </div>
            </div>
            <div style={{ padding: "10px 12px", background: "var(--bg)" }}>
              <JsonBlock data={m.output_json} label="output" />
              <JsonBlock data={m.tool_calls_json} label="tool calls" />
              <JsonBlock data={m.thinking_json} label="thinking" />
              <JsonBlock data={m.messages_json} label="prompt messages" />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ExternalCallsTab = () => (
  <div style={{ padding: "32px 16px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)" }}>
    No external calls recorded for this selection.
  </div>
);

const RawJsonTab = ({ ev }: { ev: ExtEventRow }) => {
  const pretty = JSON.stringify(ev, null, 2);
  return (
    <div style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <CopyButton text={pretty} label="copy raw" />
      </div>
      <pre style={{
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
        padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--text2)", lineHeight: 1.65, overflowX: "auto", whiteSpace: "pre-wrap",
      }}>
        {pretty}
      </pre>
    </div>
  );
};

const InspectorPanel = ({
  sel,
  selRuns,
  selMessages,
  runsLoading,
  messagesLoading,
}: {
  sel: ExtEventRow | null;
  selRuns: ExtAgentRun[];
  selMessages: AgentMessage[];
  runsLoading: boolean;
  messagesLoading: boolean;
}) => {
  const [tab, setTab] = useState<InspectorTab>("event");

  const TAB_CONFIG: Array<{ id: InspectorTab; label: string }> = [
    { id: "event", label: "Event" },
    { id: "runs", label: `Runs${selRuns.length ? ` (${selRuns.length})` : ""}` },
    { id: "trace", label: `Trace${selMessages.length ? ` (${selMessages.length})` : ""}` },
    { id: "calls", label: "External" },
    { id: "raw", label: "Raw" },
  ];

  if (!sel) {
    return (
      <div style={{ padding: "20px 18px" }}>
        <div style={{ ...S.cardTitle, marginBottom: 16 }}>Inspector</div>
        <div style={{
          padding: "18px 16px", background: "var(--bg)", border: "1px solid var(--border)",
          borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text3)",
          lineHeight: 1.6, textAlign: "center",
        }}>
          Select an event, cycle, trade, or run
          <br />to inspect full trace data
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tabs */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--surface2)", flexShrink: 0,
      }}>
        {TAB_CONFIG.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: "9px 14px", border: "none",
              background: "transparent",
              borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`,
              color: tab === id ? "var(--text1)" : "var(--text3)",
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
              letterSpacing: "0.05em", cursor: "pointer",
              transition: "color 0.12s, border-color 0.12s",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "event" && <EventDetailTab ev={sel} />}
        {tab === "runs" && <AgentRunsTab runs={selRuns} loading={runsLoading} />}
        {tab === "trace" && <MessageTraceTab messages={selMessages} loading={messagesLoading} />}
        {tab === "calls" && <ExternalCallsTab />}
        {tab === "raw" && <RawJsonTab ev={sel} />}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const DevPanel = () => {
  const [events, setEvents] = useState<ExtEventRow[]>([]);
  const [minLevel, setMinLevel] = useState<LogLevel>("DEBUG");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selRuns, setSelRuns] = useState<ExtAgentRun[]>([]);
  const [selMessages, setSelMessages] = useState<AgentMessage[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [cycleState, setCycleState] = useState("idle");
  const [focusedSession, setFocusedSession] = useState<SessionSummary | null>(null);
  const [strategy, setStrategy] = useState<StrategyGetResponse | null>(null);
  const [viewMode, setViewMode] = useState<string>("global");
  const [streamHealthy, setStreamHealthy] = useState(true);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stats = useSessionStore((s) => s.stats);

  // Load session + strategy overview
  useEffect(() => {
    api.listSessions().then(({ sessions, workspaceViewMode, focusedSessionId }) => {
      setViewMode(workspaceViewMode);
      const focused = sessions.find((s) => s.id === focusedSessionId) ?? null;
      setFocusedSession(focused);
      if (focused) {
        api.getStrategy(focused.id).then(setStrategy).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Load events
  useEffect(() => {
    api.getEvents({ limit: 500, sessionId: focusedSession?.id }).then((evs) => setEvents(evs as ExtEventRow[])).catch(() => {});
  }, [focusedSession?.id]);

  // Stream health watchdog
  const resetStreamTimer = useCallback(() => {
    setStreamHealthy(true);
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(() => setStreamHealthy(false), 15_000);
  }, []);

  useEffect(() => { resetStreamTimer(); return () => { if (streamTimerRef.current) clearTimeout(streamTimerRef.current); }; }, []);

  useExvaEvent("agent_event", (ev) => {
    setEvents((prev) => [ev as ExtEventRow, ...prev].slice(0, 500));
    setLastEventAt(new Date().toISOString());
    resetStreamTimer();
  });

  useExvaEvent("research_phase_started", (ev) => { setCycleState(`started: ${ev.phase}`); resetStreamTimer(); });
  useExvaEvent("research_phase_step", (ev) => { setCycleState(`step: ${ev.message}`); resetStreamTimer(); });
  useExvaEvent("research_phase_complete", (ev) => { setCycleState(`complete: ${ev.phase} (${ev.instrumentCount})`); resetStreamTimer(); });
  useExvaEvent("research_phase_failed", (ev) => { setCycleState(`failed: ${ev.error}`); resetStreamTimer(); });

  useExvaEvent("session_status_changed", ({ sessionId, status }) => {
    if (focusedSession?.id === sessionId) {
      setFocusedSession((prev) => prev ? { ...prev, status } : prev);
    }
  });

  // Load inspector data when selection changes
  const sel = selectedId ? (events.find((e) => e.id === selectedId) as ExtEventRow | undefined) ?? null : null;

  useEffect(() => {
    if (!sel?.trade_id) {
      setSelRuns([]);
      setSelMessages([]);
      return;
    }
    setRunsLoading(true);
    setMessagesLoading(true);
    api.getAgentTraces(sel.trade_id)
      .then((runs) => setSelRuns(runs as ExtAgentRun[]))
      .catch(() => setSelRuns([]))
      .finally(() => setRunsLoading(false));
    api.getTradeDetail(sel.trade_id)
      .then((detail) => setSelMessages(detail.messages ?? []))
      .catch(() => setSelMessages([]))
      .finally(() => setMessagesLoading(false));
  }, [sel?.trade_id]);

  const filtered = useMemo(() => events.filter((ev) => {
    if (LEVELS.indexOf(ev.level) < LEVELS.indexOf(minLevel)) return false;
    if (roleFilter !== "all") {
      const agentType = ev.agent_type ?? "";
      if (roleFilter === "selector" && agentType !== "instrument_selector") return false;
      if (roleFilter !== "selector" && agentType !== roleFilter) return false;
    }
    if (search && !ev.message.toLowerCase().includes(search.toLowerCase()) &&
      !(ev.trade_id ?? "").includes(search) &&
      !((ev as ExtEventRow).cycle_id ?? "").includes(search)) return false;
    return true;
  }), [events, minLevel, roleFilter, search]);

  const handleCopySnapshot = () => {
    const snapshot = {
      timestamp: new Date().toISOString(),
      runtime: "Electron / TypeScript",
      viewMode,
      session: focusedSession ? {
        id: focusedSession.id,
        name: focusedSession.name,
        status: focusedSession.status,
        executionMode: focusedSession.executionMode,
      } : null,
      stats: stats ? {
        openTrades: stats.open_trades,
        dailySpend: stats.daily_api_spend,
        uptimeMin: stats.session_uptime_min,
      } : null,
      aiRoles: strategy?.aiRoles ?? [],
      cycleState,
      streamHealthy,
      eventCount: events.length,
    };
    copyText(JSON.stringify(snapshot, null, 2));
  };

  const aiRoles = strategy?.aiRoles.map((r) => ({
    ...r,
    sessionId: focusedSession?.id ?? "",
  })) ?? [];

  return (
    <PageShell>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text1)", margin: 0, letterSpacing: "-0.02em" }}>
            Developer
          </h1>
          <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 3, fontFamily: "var(--font-mono)" }}>
            Focused session observability, traces, and diagnostics
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {focusedSession ? (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
              color: "var(--text2)", background: "var(--surface2)",
              border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px",
            }}>
              {focusedSession.name}
            </span>
          ) : (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text3)",
              background: "var(--surface2)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "4px 10px",
            }}>
              No session focused
            </span>
          )}
          {focusedSession && <StatusChip status={focusedSession.status} />}
          {!streamHealthy && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "rgba(255,183,51,0.1)", border: "1px solid rgba(255,183,51,0.3)",
              borderRadius: 6, padding: "4px 10px",
              fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, color: "#ffb733",
              letterSpacing: "0.06em",
            }}>
              <Dot color="#ffb733" pulse size={5} />
              Live stream delayed · polling fallback active
            </span>
          )}
        </div>
      </div>

      {/* Diagnostics Grid 2×2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, flexShrink: 0 }}>
        <RuntimeIdentityCard session={focusedSession} stats={stats} cycleState={cycleState} viewMode={viewMode} />
        <AiRoleMatrixCard roles={aiRoles} loading={!strategy && !!focusedSession} />
        <ExecutionCard session={focusedSession} stats={stats} />
        <StreamCard
          events={events}
          filtered={filtered}
          streamHealthy={streamHealthy}
          lastEventAt={lastEventAt}
          onCopySnapshot={handleCopySnapshot}
        />
      </div>

      {/* Split view */}
      <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>
        {/* Timeline — 60% */}
        <div style={{ flex: "0 0 60%", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <EventTimeline
            events={events}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
            minLevel={minLevel}
            setMinLevel={setMinLevel}
            roleFilter={roleFilter}
            setRoleFilter={setRoleFilter}
            search={search}
            setSearch={setSearch}
            filtered={filtered}
          />
        </div>
        {/* Inspector — 40% */}
        <div style={{
          flex: "0 0 40%", flexShrink: 0,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
        }}>
          <InspectorPanel
            sel={sel}
            selRuns={selRuns}
            selMessages={selMessages}
            runsLoading={runsLoading}
            messagesLoading={messagesLoading}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text3)", flexShrink: 0, letterSpacing: "0.06em" }}>
        Select an event, cycle, trade, or run to inspect full trace data
      </div>
    </PageShell>
  );
};
