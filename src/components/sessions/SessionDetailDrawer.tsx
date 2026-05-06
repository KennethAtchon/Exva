import { useEffect, useState } from "react";
import { Badge } from "@/components/custom-ui";
import { api, type SessionSummary } from "@/lib/exva";
import type { EventRow, InstrumentClass, SessionTemplatePayload } from "@/lib/types";
import { Button, Dialog, DialogContent } from "@/components/ui";

type InstrumentCacheView = {
  instruments: Array<{ symbol: string; instrumentClass: string }> | null;
  selectedAt: string | null;
  definitionHashMatches: boolean;
};

export const SessionDetailDrawer = ({ session, onClose }: { session: SessionSummary | null; onClose: () => void }) => {
  const [payload, setPayload] = useState<SessionTemplatePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentEvents, setRecentEvents] = useState<EventRow[]>([]);
  const [instrumentCache, setInstrumentCache] = useState<InstrumentCacheView | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheAction, setCacheAction] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api
      .getEvents({ sessionId: session.id, limit: 25 })
      .then((rows) => {
        if (!cancelled) setRecentEvents(rows);
      })
      .catch(() => {
        if (!cancelled) setRecentEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setCacheLoading(true);
    void api
      .getSessionInstrumentCache(session.id)
      .then((row) => {
        if (!cancelled) setInstrumentCache(row);
      })
      .catch(() => {
        if (!cancelled) setInstrumentCache(null);
      })
      .finally(() => {
        if (!cancelled) setCacheLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .buildTemplatePayloadFromSession(session.id)
      .then((result) => {
        if (!cancelled) setPayload(result);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  return (
    <Dialog open={!!session} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-auto border-border bg-transparent p-0 sm:max-w-[460px]">
      <div style={drawerStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{session.name}</h2>
              <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
              {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
            </div>
            <div style={{ marginTop: 8, color: "var(--text2)", fontSize: 13, lineHeight: 1.5 }}>{session.objective}</div>
          </div>
          <Button onClick={onClose} variant="ghost" className="h-auto p-1 text-[var(--text3)]">✕</Button>
        </div>

        {error ? <div style={errorBannerStyle}>{error}</div> : null}

        <div style={{ display: "grid", gap: 14 }}>
          <Section title="Task Definition">
            <MetricRow label="Instrument scope" value={session.instrumentScope} />
            <MetricRow label="Selection mode" value={session.selectionMode === "ai_selected_universe" ? "AI selected universe" : "Manual shortlist"} />
            <MetricRow label="Search provider override" value={session.defaultSearchProviderId ?? "Workspace default"} />
            <MetricRow label="AI picker" value={payload?.selectorSettings.aiPickerEnabled ? "Enabled" : "Disabled"} />
            {session.selectionMode === "ai_selected_universe" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ color: "var(--text3)", fontSize: 11 }}>Last selection (AI universe)</div>
                {cacheLoading ? (
                  <div style={mutedTextStyle}>Loading cache…</div>
                ) : instrumentCache?.instruments?.length ? (
                  <>
                    <div style={{ fontSize: 12, color: "var(--text2)" }}>
                      {instrumentCache.selectedAt ? `Selected at ${formatTimestamp(instrumentCache.selectedAt)}` : "—"}
                    </div>
                    {!instrumentCache.definitionHashMatches ? (
                      <Badge variant="warn">Definition changed — next start recomputes universe</Badge>
                    ) : null}
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text1)", fontSize: 13 }}>
                      {instrumentCache.instruments.map((row) => (
                        <li key={`${row.symbol}-${row.instrumentClass}`}>
                          {row.symbol} · {row.instrumentClass}
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      onClick={async () => {
                        if (!session) return;
                        if (session.status === "active" || session.status === "paused") {
                          setCacheAction("Stop the session before clearing the selector cache.");
                          return;
                        }
                        setCacheAction(null);
                        try {
                          await api.clearSessionInstrumentCache(session.id);
                          const next = await api.getSessionInstrumentCache(session.id);
                          setInstrumentCache(next);
                          setCacheAction("Cache cleared. Selector will run on next session start.");
                        } catch (err) {
                          setCacheAction(err instanceof Error ? err.message : "Clear failed");
                        }
                      }}
                      disabled={session.status === "active" || session.status === "paused"}
                      variant="outline"
                      className="self-start border-border bg-[var(--surface2)] text-xs text-[var(--text2)]"
                    >
                      Re-run selector on next start
                    </Button>
                    {cacheAction ? <div style={{ fontSize: 12, color: "var(--text3)" }}>{cacheAction}</div> : null}
                  </>
                ) : (
                  <div style={mutedTextStyle}>No cached selection yet (selector runs when you start with AI picker on).</div>
                )}
              </div>
            ) : null}
          </Section>

          <Section title="Execution Setup">
            <MetricRow label="Execution mode" value={session.executionMode === "live_allowed" ? "Live allowed" : "Paper only"} />
            <MetricRow label="Assigned brokers" value={payload?.brokerAssignments.map((entry) => entry.brokerAccountId).join(", ") || "None assigned"} />
            <MetricRow label="Routing overrides" value={formatOverrides(payload?.brokerOverridesByInstrumentClass)} />
            <MetricRow label="Instrument classes" value={session.instrumentClasses.map(formatInstrumentClass).join(", ")} />
          </Section>

          <Section title="Risk Limits">
            <MetricRow label="Capital limit" value={`$${session.capitalLimitUsd.toLocaleString()}`} />
            <MetricRow label="Max position" value={payload ? `$${payload.strategy.maxPositionUsd.toLocaleString()}` : loading ? "Loading..." : "Unavailable"} />
            <MetricRow label="Stop / target" value={payload ? `${payload.strategy.stopLossPct}% stop · ${payload.strategy.takeProfitPct}% target` : loading ? "Loading..." : "Unavailable"} />
            <MetricRow label="Daily loss / profit target" value={payload ? `$${payload.strategy.dailyLossLimitUsd.toLocaleString()} / $${payload.strategy.profitTargetUsd.toLocaleString()}` : loading ? "Loading..." : "Unavailable"} />
          </Section>

          <Section title="AI Roles">
            {loading ? <div style={mutedTextStyle}>Loading role summary...</div> : null}
            {!loading && payload?.aiRoles.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {payload.aiRoles.map((role) => (
                  <div key={role.role} style={roleCardStyle}>
                    <div style={{ color: "var(--text1)", fontWeight: 600 }}>{formatRole(role.role)}</div>
                    <div style={{ marginTop: 4, color: "var(--text3)", fontSize: 12 }}>
                      {role.providerKey || "Unassigned provider"} · {role.modelId || "No model"} · {role.promptSource === "default" ? "Default prompt" : "Session override"}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {!loading && !payload?.aiRoles.length ? <div style={mutedTextStyle}>No per-role AI configuration saved yet.</div> : null}
          </Section>

          <Section title="Session summary">
            <TimelineItem label="Updated" value={formatTimestamp(session.updatedAt)} />
            <TimelineItem label="Runtime" value={session.uptimeMin > 0 ? `Active for ${session.uptimeMin} minutes` : "No active runtime"} />
            <TimelineItem label="Workspace context" value={session.isFocused ? "Driving the focused workspace" : "Available as alternate context"} />
            <TimelineItem label="Open trades" value={`${session.openTradeCount} currently open`} />
          </Section>

          <Section title="Recent events">
            {recentEvents.length === 0 ? (
              <div style={mutedTextStyle}>No recent events for this session.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                {recentEvents.map((ev) => (
                  <div key={ev.id} style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
                    <span style={{ color: "var(--text3)", fontSize: 10, marginRight: 8 }}>{formatTimestamp(ev.created_at)}</span>
                    <span style={{ color: ev.level === "ERROR" ? "#f87171" : "var(--text2)" }}>{ev.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={sectionStyle}>
    <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 12 }}>{title}</div>
    <div style={{ display: "grid", gap: 10 }}>{children}</div>
  </section>
);

const MetricRow = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "grid", gap: 4 }}>
    <div style={{ color: "var(--text3)", fontSize: 11 }}>{label}</div>
    <div style={{ color: "var(--text1)", fontSize: 14, lineHeight: 1.5 }}>{value}</div>
  </div>
);

const TimelineItem = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, alignItems: "start" }}>
    <div style={{ color: "var(--text3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
    <div style={{ color: "var(--text2)", fontSize: 13 }}>{value}</div>
  </div>
);

function statusVariant(status: SessionSummary["status"]): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "archived":
      return "danger";
    case "stopped":
      return "purple";
    default:
      return "default";
  }
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock" ? "Stocks" : value === "crypto" ? "Crypto" : value === "futures" ? "Futures" : "Prediction Markets";
}

function formatOverrides(overrides?: Partial<Record<InstrumentClass, string>>): string {
  const entries = Object.entries(overrides ?? {}).filter(([, brokerId]) => brokerId);
  if (entries.length === 0) return "No routing overrides";
  return entries.map(([instrumentClass, brokerId]) => `${formatInstrumentClass(instrumentClass as InstrumentClass)} → ${brokerId}`).join(" · ");
}

function formatRole(role: string): string {
  return role.replaceAll("_", " ");
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const drawerStyle = { width: 460, maxWidth: "100vw", minHeight: "100%", overflow: "auto", background: "linear-gradient(180deg, rgba(13,18,25,0.99), rgba(9,13,18,0.99))", borderLeft: "1px solid var(--border)", padding: 22, boxShadow: "-16px 0 40px rgba(2,6,23,0.42)" } as const;
const sectionStyle = { border: "1px solid var(--border)", borderRadius: 16, padding: 16, background: "rgba(18,26,36,0.72)" } as const;
const roleCardStyle = { border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "rgba(7,10,15,0.34)" } as const;
const mutedTextStyle = { color: "var(--text3)", fontSize: 13 } as const;
const errorBannerStyle = { marginBottom: 16, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.34)", background: "rgba(248,113,113,0.08)", color: "#fca5a5", fontSize: 13 } as const;
