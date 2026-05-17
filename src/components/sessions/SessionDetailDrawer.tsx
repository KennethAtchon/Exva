import { useEffect, useState } from "react";
import { getSearchProviderDisplayName } from "@electron/shared/catalog/search-providers";
import { Badge } from "@/components/custom-ui";
import { api, type SessionSummary } from "@/lib/exva";
import type { EventRow, InstrumentClass, ProviderAccount, SessionTemplatePayload } from "@/lib/types";
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
  const [providers, setProviders] = useState<ProviderAccount[]>([]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api
      .getEvents({ sessionId: session.id, limit: 25 })
      .then((rows) => { if (!cancelled) setRecentEvents(rows); })
      .catch(() => { if (!cancelled) setRecentEvents([]); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setCacheLoading(true);
    void api
      .getSessionInstrumentCache(session.id)
      .then((row) => { if (!cancelled) setInstrumentCache(row); })
      .catch(() => { if (!cancelled) setInstrumentCache(null); })
      .finally(() => { if (!cancelled) setCacheLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.buildTemplatePayloadFromSession(session.id),
      api.getStrategy(session.id).then((res) => res.providers),
    ])
      .then(([result, providerList]) => {
        if (!cancelled) { setPayload(result); setProviders(providerList); }
      })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session]);

  if (!session) return null;

  return (
    <Dialog open={!!session} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden border-border bg-transparent p-0 sm:max-w-[620px]">
        <div style={panelStyle}>
          {/* Header */}
          <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text1)", letterSpacing: "-0.01em" }}>
                {session.name}
              </h2>
              <Badge variant={statusVariant(session.status)}>{session.status}</Badge>
              {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
            </div>
            {session.objective ? (
              <div style={{ marginTop: 6, color: "var(--text2)", fontSize: 13, lineHeight: 1.55 }}>
                {session.objective}
              </div>
            ) : null}
          </div>

          {error ? <div style={errorBannerStyle}>{error}</div> : null}

          <div style={{ display: "grid", gap: 12, overflowY: "auto", maxHeight: "calc(92vh - 120px)", paddingRight: 4 }}>
            <Section title="Task Definition">
              <Row label="Instrument scope" value={session.instrumentScope} />
              <Row label="Selection mode" value={session.selectionMode === "ai_selected_universe" ? "AI selected universe" : "Manual shortlist"} />
              <Row label="Search provider" value={getSearchProviderDisplayName(session.defaultSearchProviderId)} />
              <Row label="AI picker" value={payload?.selectorSettings.aiPickerEnabled ? "Enabled" : "Disabled"} />
              {session.selectionMode === "ai_selected_universe" ? (
                <div style={{ marginTop: 4 }}>
                  <div style={rowLabelStyle}>Last AI universe selection</div>
                  <div style={{ marginTop: 6 }}>
                    {cacheLoading ? (
                      <span style={mutedStyle}>Loading cache…</span>
                    ) : instrumentCache?.instruments?.length ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "var(--text2)" }}>
                          {instrumentCache.selectedAt ? `Selected ${formatTimestamp(instrumentCache.selectedAt)}` : "—"}
                        </div>
                        {!instrumentCache.definitionHashMatches ? (
                          <Badge variant="warn">Definition changed — next start recomputes universe</Badge>
                        ) : null}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {instrumentCache.instruments.map((row) => (
                            <span key={`${row.symbol}-${row.instrumentClass}`} style={cacheChipStyle}>
                              {row.symbol} · {row.instrumentClass}
                            </span>
                          ))}
                        </div>
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
                      </div>
                    ) : (
                      <span style={mutedStyle}>No cached selection yet (selector runs when you start with AI picker on).</span>
                    )}
                  </div>
                </div>
              ) : null}
            </Section>

            <Section title="Execution Setup">
              <Row label="Execution mode" value={session.executionMode === "live_allowed" ? "Live allowed" : "Paper only"} />
              <Row
                label="Assigned brokers"
                value={
                  payload?.brokerAssignments.length
                    ? payload.brokerAssignments.map((entry) => `${entry.brokerAccountId} ($${entry.allocatedUsd.toLocaleString()})`).join(", ")
                    : "None assigned"
                }
              />
              <Row label="Routing overrides" value={formatOverrides(payload?.brokerOverridesByInstrumentClass)} />
              <Row label="Instrument classes" value={session.instrumentClasses.map(formatInstrumentClass).join(", ")} />
            </Section>

            <Section title="Risk Limits">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <StatBlock label="Total allocated" value={`$${session.totalAllocatedUsd.toLocaleString()}`} />
                <StatBlock label="Max position" value={payload ? `$${payload.strategy.maxPositionUsd.toLocaleString()}` : loading ? "…" : "—"} />
                <StatBlock label="Stop / target" value={payload ? `${payload.strategy.stopLossPct}% / ${payload.strategy.takeProfitPct}%` : loading ? "…" : "—"} />
                <StatBlock label="Daily loss / profit" value={payload ? `$${payload.strategy.dailyLossLimitUsd.toLocaleString()} / $${payload.strategy.profitTargetUsd.toLocaleString()}` : loading ? "…" : "—"} />
              </div>
            </Section>

            <Section title="AI Roles">
              {loading ? <div style={mutedStyle}>Loading…</div> : null}
              {!loading && payload?.aiRoles.length ? (() => {
                const unconnected = payload.aiRoles.filter(
                  (role) => !providers.some((p) => p.id === role.providerKey)
                );
                return (
                  <div style={{ display: "grid", gap: 6 }}>
                    {unconnected.length > 0 && (
                      <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.07)", color: "#fca5a5", fontSize: 11, marginBottom: 4 }}>
                        {unconnected.length} role{unconnected.length > 1 ? "s" : ""} not connected — session cannot start. Configure in Strategy tab.
                      </div>
                    )}
                    {payload.aiRoles.map((role) => {
                      const connected = providers.some((p) => p.id === role.providerKey);
                      const providerName = providers.find((p) => p.id === role.providerKey)?.name;
                      return (
                        <div key={role.role} style={{ ...roleRowStyle, borderColor: connected ? "var(--border)" : "rgba(248,113,113,0.25)" }}>
                          <div style={{ color: "var(--text1)", fontSize: 12, fontWeight: 600, textTransform: "capitalize" }}>
                            {formatRole(role.role)}
                          </div>
                          <div style={{ color: connected ? "var(--text3)" : "#f87171", fontSize: 11, marginTop: 2 }}>
                            {connected
                              ? `${providerName} · ${role.modelId} · ${role.promptSource === "default" ? "Default prompt" : "Session override"}`
                              : "Not connected — go to Strategy → AI Roles"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : null}
              {!loading && !payload?.aiRoles.length ? <div style={mutedStyle}>No per-role AI configuration saved yet.</div> : null}
            </Section>

            <Section title="Session Summary">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <StatBlock label="Updated" value={formatTimestamp(session.updatedAt)} />
                <StatBlock label="Runtime" value={session.uptimeMin > 0 ? `${session.uptimeMin} min` : "Inactive"} />
                <StatBlock label="Open trades" value={String(session.openTradeCount)} />
                <StatBlock label="Workspace" value={session.isFocused ? "Focused" : "Alternate context"} />
              </div>
            </Section>

            <Section title="Recent Events">
              {recentEvents.length === 0 ? (
                <div style={mutedStyle}>No recent events.</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {recentEvents.map((ev) => (
                    <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, fontSize: 12, lineHeight: 1.45 }}>
                      <span style={{ color: "var(--text3)", fontSize: 10, paddingTop: 1, whiteSpace: "nowrap" }}>
                        {formatTimestamp(ev.created_at)}
                      </span>
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
    <div style={sectionTitleStyle}>{title}</div>
    <div style={{ display: "grid", gap: 10 }}>{children}</div>
  </section>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, alignItems: "start" }}>
    <div style={rowLabelStyle}>{label}</div>
    <div style={{ color: "var(--text1)", fontSize: 13, lineHeight: 1.5 }}>{value}</div>
  </div>
);

const StatBlock = ({ label, value }: { label: string; value: string }) => (
  <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "rgba(7,10,15,0.4)" }}>
    <div style={rowLabelStyle}>{label}</div>
    <div style={{ marginTop: 4, color: "var(--text1)", fontSize: 14, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
  </div>
);

function statusVariant(status: SessionSummary["status"]): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active": return "success";
    case "paused": return "warn";
    case "archived": return "danger";
    case "stopped": return "purple";
    default: return "default";
  }
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock" ? "Stocks" : value === "crypto" ? "Crypto" : value === "futures" ? "Futures" : "Prediction Markets";
}

function formatOverrides(overrides?: Partial<Record<InstrumentClass, string>>): string {
  const entries = Object.entries(overrides ?? {}).filter(([, brokerId]) => brokerId);
  if (entries.length === 0) return "No routing overrides";
  return entries.map(([ic, brokerId]) => `${formatInstrumentClass(ic as InstrumentClass)} → ${brokerId}`).join(" · ");
}

function formatRole(role: string): string {
  return role.replaceAll("_", " ");
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const panelStyle = {
  width: 620,
  maxWidth: "96vw",
  background: "linear-gradient(180deg, rgba(13,18,25,0.99) 0%, rgba(9,13,18,0.99) 100%)",
  borderRadius: 20,
  padding: 22,
  border: "1px solid var(--border)",
} as const;

const sectionStyle = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "14px 16px",
  background: "rgba(18,26,36,0.6)",
} as const;

const sectionTitleStyle = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text3)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.14em",
  marginBottom: 12,
} as const;

const rowLabelStyle = {
  color: "var(--text3)",
  fontSize: 11,
  lineHeight: 1.5,
  paddingTop: 1,
} as const;

const roleRowStyle = {
  padding: "9px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.3)",
} as const;

const cacheChipStyle = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.4)",
  color: "var(--text2)",
  fontSize: 11,
} as const;

const mutedStyle = { color: "var(--text3)", fontSize: 13 } as const;

const errorBannerStyle = {
  marginBottom: 14,
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid rgba(248,113,113,0.30)",
  background: "rgba(248,113,113,0.07)",
  color: "#fca5a5",
  fontSize: 13,
} as const;
