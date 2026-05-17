import { useEffect, useMemo, useState } from "react";
import { Badge, Card, PageShell } from "@/components/custom-ui";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";
import type { BrokerAccountWithState } from "@/lib/types";
import { fmt } from "@/lib/formatters";
import { useExvaEvent } from "@/hooks/useExvaEvent";

export const BrokersPage = ({
  onJumpToSession,
}: {
  onJumpToSession?: (sessionId: string) => Promise<void> | void;
}) => {
  const [brokers, setBrokers] = useState<BrokerAccountWithState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBrokerId, setExpandedBrokerId] = useState<string | null>(null);
  const [savingBrokerId, setSavingBrokerId] = useState<string | null>(null);
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, {
    maxSessions: number;
    allocationEnforcement: "hard" | "warn";
    balanceRefreshIntervalMin: number;
  }>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.listBrokerAccountState();
      setBrokers(rows);
      setSettingsDrafts((current) => {
        const next = { ...current };
        for (const broker of rows) {
          next[broker.id] ??= {
            maxSessions: broker.maxSessions,
            allocationEnforcement: broker.allocationEnforcement,
            balanceRefreshIntervalMin: broker.balanceRefreshIntervalMin,
          };
        }
        return next;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load broker accounts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useExvaEvent("broker_balance_updated", ({ brokerAccountId, balanceUsd, cachedAt }) => {
    setBrokers((current) =>
      current.map((broker) =>
        broker.id === brokerAccountId
          ? {
              ...broker,
              balanceCacheUsd: balanceUsd,
              balanceCachedAt: cachedAt,
              isStale: false,
              freeCapitalUsd: balanceUsd - broker.totalAllocatedUsd,
              isOverAllocated: balanceUsd - broker.totalAllocatedUsd < 0,
            }
          : broker,
      ),
    );
  });

  const totalBalanceUsd = useMemo(
    () => brokers.reduce((sum, broker) => sum + (broker.balanceCacheUsd ?? 0), 0),
    [brokers],
  );

  return (
    <PageShell>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text3)" }}>Broker Topology</div>
          <h1 style={{ margin: "10px 0 0", fontSize: 28 }}>Brokers</h1>
          <p style={{ marginTop: 8, color: "var(--text3)", fontSize: 13, maxWidth: 700 }}>
            Real broker balances, active session sharing, and per-broker allocation policy now live in one place.
          </p>
        </div>
        <Card style={{ minWidth: 220, padding: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>Tracked balance</div>
          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700, color: "var(--text1)", fontVariantNumeric: "tabular-nums" }}>
            {fmt.usd(totalBalanceUsd)}
          </div>
          <div style={{ marginTop: 4, color: "var(--text3)", fontSize: 12 }}>{brokers.length} broker account{brokers.length === 1 ? "" : "s"}</div>
        </Card>
      </div>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}

      {loading && brokers.length === 0 ? <div style={emptyStateStyle}>Loading broker balances...</div> : null}
      {!loading && brokers.length === 0 ? <div style={emptyStateStyle}>No broker accounts configured yet.</div> : null}

      <div style={{ display: "grid", gap: 14 }}>
        {brokers.map((broker) => {
          const draft = settingsDrafts[broker.id] ?? {
            maxSessions: broker.maxSessions,
            allocationEnforcement: broker.allocationEnforcement,
            balanceRefreshIntervalMin: broker.balanceRefreshIntervalMin,
          };
          const allocationPct =
            broker.balanceCacheUsd && broker.balanceCacheUsd > 0
              ? Math.min((broker.totalAllocatedUsd / broker.balanceCacheUsd) * 100, 100)
              : 0;

          return (
            <Card key={broker.id} style={{ padding: 20 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text1)" }}>{broker.name}</div>
                      <Badge variant={broker.mode === "live" ? "danger" : "blue"}>{broker.mode}</Badge>
                      <Badge variant="default">{broker.brokerType}</Badge>
                      {broker.sessions.length > 1 ? <Badge variant="warn">Shared · {broker.sessions.length} sessions</Badge> : null}
                      {broker.atSessionCap ? <Badge variant="danger">At capacity</Badge> : null}
                      {broker.isOverAllocated ? <Badge variant="danger">Over-allocated</Badge> : null}
                      {broker.isStale ? <Badge variant="warn">Stale balance</Badge> : null}
                    </div>
                    <div style={{ marginTop: 8, color: "var(--text3)", fontSize: 12 }}>
                      Balance {broker.balanceCacheUsd != null ? fmt.usd(broker.balanceCacheUsd) : "—"}
                      {broker.balanceCachedAt ? ` · updated ${new Date(broker.balanceCachedAt).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button
                      variant="outline"
                      className="border-border bg-[var(--surface2)] text-[var(--text2)]"
                      onClick={async () => {
                        try {
                          await api.refreshBrokerBalance(broker.id);
                        } catch (refreshError) {
                          setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh balance.");
                        }
                      }}
                    >
                      Refresh
                    </Button>
                    <Button
                      variant="outline"
                      className="border-border bg-[var(--surface2)] text-[var(--text2)]"
                      onClick={() => setExpandedBrokerId((current) => (current === broker.id ? null : broker.id))}
                    >
                      {expandedBrokerId === broker.id ? "Hide Settings" : "Settings"}
                    </Button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)" }}>
                    <span>Allocated {fmt.usd(broker.totalAllocatedUsd)}</span>
                    <span>Free {broker.freeCapitalUsd != null ? fmt.usd(broker.freeCapitalUsd) : "—"}</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: "var(--surface3)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${allocationPct}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: broker.isOverAllocated ? "#f87171" : "var(--accent)",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text3)" }}>
                    <span>{broker.activeSessionCount} / {broker.maxSessions} active sessions</span>
                    <span>{allocationPct.toFixed(1)}% used</span>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text3)" }}>Attached sessions</div>
                  {broker.sessions.length === 0 ? (
                    <div style={{ color: "var(--text3)", fontSize: 12 }}>No active or paused sessions are using this broker.</div>
                  ) : (
                    broker.sessions.map((session) => (
                      <div key={session.sessionId} style={sessionRowStyle}>
                        <div>
                          <div style={{ color: "var(--text1)", fontSize: 13, fontWeight: 600 }}>{session.sessionName}</div>
                          <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 2 }}>
                            {session.status} · allocated {fmt.usd(session.allocatedUsd)}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="border-border bg-[var(--surface2)] text-[var(--text2)]"
                          onClick={() => void onJumpToSession?.(session.sessionId)}
                        >
                          Jump
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {expandedBrokerId === broker.id ? (
                  <div style={settingsPanelStyle}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Max sessions</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={String(draft.maxSessions)}
                          onChange={(event) =>
                            setSettingsDrafts((current) => ({
                              ...current,
                              [broker.id]: { ...draft, maxSessions: Number(event.target.value) || 1 },
                            }))
                          }
                          style={inputStyle}
                        />
                      </label>
                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Allocation enforcement</span>
                        <select
                          value={draft.allocationEnforcement}
                          onChange={(event) =>
                            setSettingsDrafts((current) => ({
                              ...current,
                              [broker.id]: {
                                ...draft,
                                allocationEnforcement: event.target.value as "hard" | "warn",
                              },
                            }))
                          }
                          style={inputStyle}
                        >
                          <option value="hard">Hard block</option>
                          <option value="warn">Warn only</option>
                        </select>
                      </label>
                      <label style={fieldStyle}>
                        <span style={fieldLabelStyle}>Refresh interval (min)</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={String(draft.balanceRefreshIntervalMin)}
                          onChange={(event) =>
                            setSettingsDrafts((current) => ({
                              ...current,
                              [broker.id]: { ...draft, balanceRefreshIntervalMin: Number(event.target.value) || 1 },
                            }))
                          }
                          style={inputStyle}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <Button
                        variant="outline"
                        className="border-border bg-[var(--surface2)] text-[var(--text2)]"
                        onClick={() =>
                          setSettingsDrafts((current) => ({
                            ...current,
                            [broker.id]: {
                              maxSessions: broker.maxSessions,
                              allocationEnforcement: broker.allocationEnforcement,
                              balanceRefreshIntervalMin: broker.balanceRefreshIntervalMin,
                            },
                          }))
                        }
                      >
                        Reset
                      </Button>
                      <Button
                        className="bg-[var(--accent)] text-white"
                        disabled={savingBrokerId === broker.id}
                        onClick={async () => {
                          setSavingBrokerId(broker.id);
                          setError(null);
                          try {
                            await api.updateBrokerAccountSettings({ brokerAccountId: broker.id, ...draft });
                            await load();
                            setExpandedBrokerId(null);
                          } catch (saveError) {
                            setError(saveError instanceof Error ? saveError.message : "Failed to save broker settings.");
                          } finally {
                            setSavingBrokerId(null);
                          }
                        }}
                      >
                        {savingBrokerId === broker.id ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
};

const emptyStateStyle = {
  border: "1px dashed var(--border)",
  borderRadius: 16,
  padding: 22,
  color: "var(--text3)",
  textAlign: "center" as const,
};

const errorBannerStyle = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.34)",
  background: "rgba(248,113,113,0.08)",
  color: "#fca5a5",
  fontSize: 13,
};

const sessionRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "12px 14px",
  background: "rgba(7,10,15,0.28)",
};

const settingsPanelStyle = {
  display: "grid",
  gap: 12,
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 14,
  background: "rgba(7,10,15,0.34)",
};

const fieldStyle = { display: "grid", gap: 6 };
const fieldLabelStyle = {
  color: "var(--text3)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
};
const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "rgba(7,10,15,0.5)",
  color: "var(--text1)",
  fontSize: 13,
} as const;
