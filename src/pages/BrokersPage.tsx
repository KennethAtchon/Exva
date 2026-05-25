import { useEffect, useMemo, useReducer } from "react";
import { Badge, Card, PageShell } from "@/components/custom-ui";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";
import type { BrokerAccountWithState } from "@/lib/types";
import { fmt } from "@/lib/formatters";
import { useExvaEvent } from "@/hooks/useExvaEvent";
import { useWorkspaceStore } from "@/store/workspaceStore";

function formatIsoDateTime(isoLike: string): string {
  const match = isoLike.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return isoLike;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6] ?? "00"}`;
}

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type BrokersDraft = {
  maxSessions: number;
  allocationEnforcement: "hard" | "warn";
  balanceRefreshIntervalMin: number;
};

type BrokersUiState = {
  brokers: BrokerAccountWithState[];
  loading: boolean;
  error: string | null;
  expandedBrokerId: string | null;
  savingBrokerId: string | null;
  settingsDrafts: Record<string, BrokersDraft>;
};

// ---------------------------------------------------------------------------
// BrokerSettingsPanel
// ---------------------------------------------------------------------------

const BrokerSettingsPanel = ({
  brokerId,
  draft,
  settingsDrafts,
  isSaving,
  onDraftChange,
  onReset,
  onSave,
}: {
  brokerId: string;
  draft: BrokersDraft;
  settingsDrafts: Record<string, BrokersDraft>;
  isSaving: boolean;
  onDraftChange: (next: Record<string, BrokersDraft>) => void;
  onReset: () => void;
  onSave: () => void;
}) => (
  <div style={settingsPanelStyle}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>Max sessions</span>
        <input
          type="number"
          min={1}
          max={50}
          value={String(draft.maxSessions)}
          onChange={(event) =>
            onDraftChange({
              ...settingsDrafts,
              [brokerId]: {
                ...draft,
                maxSessions: Number(event.target.value) || 1,
              },
            })
          }
          style={inputStyle}
        />
      </label>
      <label style={fieldStyle}>
        <span style={fieldLabelStyle}>Allocation enforcement</span>
        <select
          value={draft.allocationEnforcement}
          onChange={(event) =>
            onDraftChange({
              ...settingsDrafts,
              [brokerId]: {
                ...draft,
                allocationEnforcement: event.target.value as "hard" | "warn",
              },
            })
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
            onDraftChange({
              ...settingsDrafts,
              [brokerId]: {
                ...draft,
                balanceRefreshIntervalMin: Number(event.target.value) || 1,
              },
            })
          }
          style={inputStyle}
        />
      </label>
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <Button
        variant="outline"
        className="border-border bg-[var(--surface2)] text-[var(--text2)]"
        onClick={onReset}
      >
        Reset
      </Button>
      <Button
        className="bg-[var(--accent)] text-white"
        disabled={isSaving}
        onClick={onSave}
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// BrokerCard
// ---------------------------------------------------------------------------

const BrokerCard = ({
  broker,
  draft,
  settingsDrafts,
  isExpanded,
  isSaving,
  onRefresh,
  onToggleExpand,
  onDraftChange,
  onReset,
  onSave,
  onJumpToSession,
}: {
  broker: BrokerAccountWithState;
  draft: BrokersDraft;
  settingsDrafts: Record<string, BrokersDraft>;
  isExpanded: boolean;
  isSaving: boolean;
  onRefresh: () => void;
  onToggleExpand: () => void;
  onDraftChange: (next: Record<string, BrokersDraft>) => void;
  onReset: () => void;
  onSave: () => void;
  onJumpToSession?: (sessionId: string) => void;
}) => {
  const allocationPct =
    broker.balanceCacheUsd && broker.balanceCacheUsd > 0
      ? Math.min((broker.totalAllocatedUsd / broker.balanceCacheUsd) * 100, 100)
      : 0;

  return (
    <Card style={{ padding: 20 }}>
      <div style={{ display: "grid", gap: 14 }}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "var(--text1)",
                }}
              >
                {broker.name}
              </div>
              <Badge variant="default">{broker.brokerType}</Badge>
              {broker.sessions.length > 1 ? (
                <Badge variant="warn">
                  Shared · {broker.sessions.length} sessions
                </Badge>
              ) : null}
              {broker.atSessionCap ? (
                <Badge variant="danger">At capacity</Badge>
              ) : null}
              {broker.isOverAllocated ? (
                <Badge variant="danger">Over-allocated</Badge>
              ) : null}
              {broker.isStale ? (
                <Badge variant="warn">Stale balance</Badge>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 8,
                color: "var(--text3)",
                fontSize: 12,
              }}
            >
              Balance{" "}
              {broker.balanceCacheUsd != null
                ? fmt.usd(broker.balanceCacheUsd)
                : "—"}
              {broker.balanceCachedAt
                ? ` · updated ${formatIsoDateTime(broker.balanceCachedAt)}`
                : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="outline"
              className="border-border bg-[var(--surface2)] text-[var(--text2)]"
              onClick={onRefresh}
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              className="border-border bg-[var(--surface2)] text-[var(--text2)]"
              onClick={onToggleExpand}
            >
              {isExpanded ? "Hide Settings" : "Settings"}
            </Button>
          </div>
        </div>

        {/* Allocation bar */}
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--text3)",
            }}
          >
            <span>Allocated {fmt.usd(broker.totalAllocatedUsd)}</span>
            <span>
              Free{" "}
              {broker.freeCapitalUsd != null
                ? fmt.usd(broker.freeCapitalUsd)
                : "—"}
            </span>
          </div>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: "var(--surface3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${allocationPct}%`,
                height: "100%",
                borderRadius: 999,
                background: broker.isOverAllocated
                  ? "#f87171"
                  : "var(--accent)",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              color: "var(--text3)",
            }}
          >
            <span>
              {broker.activeSessionCount} / {broker.maxSessions} active sessions
            </span>
            <span>{allocationPct.toFixed(1)}% used</span>
          </div>
        </div>

        {/* Attached sessions */}
        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text3)",
            }}
          >
            Attached sessions
          </div>
          {broker.sessions.length === 0 ? (
            <div style={{ color: "var(--text3)", fontSize: 12 }}>
              No active or paused sessions are using this broker.
            </div>
          ) : (
            broker.sessions.map((session) => (
              <div key={session.sessionId} style={sessionRowStyle}>
                <div>
                  <div
                    style={{
                      color: "var(--text1)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {session.sessionName}
                  </div>
                  <div
                    style={{
                      color: "var(--text3)",
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {session.status} · allocated {fmt.usd(session.allocatedUsd)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-border bg-[var(--surface2)] text-[var(--text2)]"
                  onClick={() => onJumpToSession?.(session.sessionId)}
                >
                  Jump
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Settings panel */}
        {isExpanded ? (
          <BrokerSettingsPanel
            brokerId={broker.id}
            draft={draft}
            settingsDrafts={settingsDrafts}
            isSaving={isSaving}
            onDraftChange={onDraftChange}
            onReset={onReset}
            onSave={onSave}
          />
        ) : null}
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// BrokersPage
// ---------------------------------------------------------------------------

export const BrokersPage = ({
  onJumpToSession,
}: {
  onJumpToSession?: (sessionId: string) => Promise<void> | void;
}) => {
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);
  const [ui, dispatch] = useReducer(mergeReducer<BrokersUiState>, {
    brokers: [],
    loading: false,
    error: null,
    expandedBrokerId: null,
    savingBrokerId: null,
    settingsDrafts: {},
  });

  const load = async () => {
    dispatch({ loading: true, error: null });
    try {
      const rows = await api.listBrokerAccountState();
      const nextDrafts = { ...ui.settingsDrafts };
      for (const broker of rows) {
        nextDrafts[broker.id] ??= {
          maxSessions: broker.maxSessions,
          allocationEnforcement: broker.allocationEnforcement,
          balanceRefreshIntervalMin: broker.balanceRefreshIntervalMin,
        };
      }
      dispatch({ brokers: rows, settingsDrafts: nextDrafts });
    } catch (loadError) {
      dispatch({
        error:
          loadError instanceof Error
            ? loadError.message
            : "Failed to load broker accounts.",
      });
    } finally {
      dispatch({ loading: false });
    }
  };

  useEffect(() => {
    dispatch({ expandedBrokerId: null });
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [environmentMode]);

  useExvaEvent(
    "broker_balance_updated",
    ({ brokerAccountId, balanceUsd, cachedAt }) => {
      dispatch({
        brokers: ui.brokers.map((broker) =>
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
      });
    },
  );

  const visibleBrokers = useMemo(
    () => ui.brokers.filter((b) => b.mode === environmentMode),
    [ui.brokers, environmentMode],
  );

  const totalBalanceUsd = useMemo(
    () =>
      visibleBrokers.reduce(
        (sum, broker) => sum + (broker.balanceCacheUsd ?? 0),
        0,
      ),
    [visibleBrokers],
  );

  return (
    <PageShell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text3)",
            }}
          >
            Broker Topology
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: 28 }}>Brokers</h1>
          <p
            style={{
              marginTop: 8,
              color: "var(--text3)",
              fontSize: 13,
              maxWidth: 700,
            }}
          >
            Real broker balances, active session sharing, and per-broker
            allocation policy now live in one place.
          </p>
        </div>
        <Card style={{ minWidth: 220, padding: 18 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text3)",
            }}
          >
            Tracked balance
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text1)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt.usd(totalBalanceUsd)}
          </div>
          <div style={{ marginTop: 4, color: "var(--text3)", fontSize: 12 }}>
            {visibleBrokers.length} broker account
            {visibleBrokers.length === 1 ? "" : "s"}
          </div>
        </Card>
      </div>

      {ui.error ? <div style={errorBannerStyle}>{ui.error}</div> : null}

      {ui.loading && visibleBrokers.length === 0 ? (
        <div style={emptyStateStyle}>Loading broker balances…</div>
      ) : null}
      {!ui.loading && visibleBrokers.length === 0 ? (
        <div style={emptyStateStyle}>
          No {environmentMode} broker accounts configured yet.
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14 }}>
        {visibleBrokers.map((broker) => {
          const draft = ui.settingsDrafts[broker.id] ?? {
            maxSessions: broker.maxSessions,
            allocationEnforcement: broker.allocationEnforcement,
            balanceRefreshIntervalMin: broker.balanceRefreshIntervalMin,
          };

          return (
            <BrokerCard
              key={broker.id}
              broker={broker}
              draft={draft}
              settingsDrafts={ui.settingsDrafts}
              isExpanded={ui.expandedBrokerId === broker.id}
              isSaving={ui.savingBrokerId === broker.id}
              onRefresh={async () => {
                try {
                  await api.refreshBrokerBalance(broker.id);
                } catch (refreshError) {
                  dispatch({
                    error:
                      refreshError instanceof Error
                        ? refreshError.message
                        : "Failed to refresh balance.",
                  });
                }
              }}
              onToggleExpand={() =>
                dispatch({
                  expandedBrokerId:
                    ui.expandedBrokerId === broker.id ? null : broker.id,
                })
              }
              onDraftChange={(next) => dispatch({ settingsDrafts: next })}
              onReset={() =>
                dispatch({
                  settingsDrafts: {
                    ...ui.settingsDrafts,
                    [broker.id]: {
                      maxSessions: broker.maxSessions,
                      allocationEnforcement: broker.allocationEnforcement,
                      balanceRefreshIntervalMin:
                        broker.balanceRefreshIntervalMin,
                    },
                  },
                })
              }
              onSave={async () => {
                dispatch({ savingBrokerId: broker.id, error: null });
                try {
                  await api.updateBrokerAccountSettings({
                    brokerAccountId: broker.id,
                    ...draft,
                  });
                  await load();
                  dispatch({ expandedBrokerId: null });
                } catch (saveError) {
                  dispatch({
                    error:
                      saveError instanceof Error
                        ? saveError.message
                        : "Failed to save broker settings.",
                  });
                } finally {
                  dispatch({ savingBrokerId: null });
                }
              }}
              onJumpToSession={(sessionId) => void onJumpToSession?.(sessionId)}
            />
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
  fontSize: 12,
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
