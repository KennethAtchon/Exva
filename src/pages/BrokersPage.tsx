import { useEffect, useMemo, useReducer } from "react";
import { Badge, Card, PageShell } from "@/components/custom-ui";
import { Button } from "@/components/ui";
import { api } from "@/lib/exva";
import type { BrokerAccountWithState } from "@/lib/types";
import { fmt } from "@/lib/formatters";
import { cn } from "@/lib/utils";
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
  <div className={settingsPanelClass}>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      <label className={fieldClass}>
        <span className={fieldLabelClass}>Max sessions</span>
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
          className={inputClass}
        />
      </label>
      <label className={fieldClass}>
        <span className={fieldLabelClass}>Allocation enforcement</span>
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
          className={inputClass}
        >
          <option value="hard">Hard block</option>
          <option value="warn">Warn only</option>
        </select>
      </label>
      <label className={fieldClass}>
        <span className={fieldLabelClass}>Refresh interval (min)</span>
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
          className={inputClass}
        />
      </label>
    </div>
    <div className="flex justify-end gap-2">
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
    <Card className="p-5">
      <div className="grid gap-3.5">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[18px] font-bold text-[var(--text1)]">
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
            <div className="mt-2 text-[12px] text-[var(--text3)]">
              Balance{" "}
              {broker.balanceCacheUsd != null
                ? fmt.usd(broker.balanceCacheUsd)
                : "—"}
              {broker.balanceCachedAt
                ? ` · updated ${formatIsoDateTime(broker.balanceCachedAt)}`
                : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
        <div className="grid gap-2">
          <div className="flex justify-between text-[12px] text-[var(--text3)]">
            <span>Allocated {fmt.usd(broker.totalAllocatedUsd)}</span>
            <span>
              Free{" "}
              {broker.freeCapitalUsd != null
                ? fmt.usd(broker.freeCapitalUsd)
                : "—"}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface3)]">
            <div
              className={cn(
                "h-full rounded-full",
                broker.isOverAllocated ? "bg-error" : "bg-[var(--accent)]",
              )}
              style={{ width: `${allocationPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[12px] text-[var(--text3)]">
            <span>
              {broker.activeSessionCount} / {broker.maxSessions} active sessions
            </span>
            <span>{allocationPct.toFixed(1)}% used</span>
          </div>
        </div>

        {/* Attached sessions */}
        <div className="grid gap-2">
          <div className="text-[12px] uppercase tracking-[0.1em] text-[var(--text3)]">
            Attached sessions
          </div>
          {broker.sessions.length === 0 ? (
            <div className="text-[12px] text-[var(--text3)]">
              No active or paused sessions are using this broker.
            </div>
          ) : (
            broker.sessions.map((session) => (
              <div key={session.sessionId} className={sessionRowClass}>
                <div>
                  <div className="text-[13px] font-semibold text-[var(--text1)]">
                    {session.sessionName}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[var(--text3)]">
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-[0.14em] text-[var(--text3)]">
            Broker Topology
          </div>
          <h1 className="m-0 mt-2.5 text-[28px]">Brokers</h1>
          <p className="mt-2 max-w-[700px] text-[13px] text-[var(--text3)]">
            Real broker balances, active session sharing, and per-broker
            allocation policy now live in one place.
          </p>
        </div>
        <Card className="min-w-[220px] p-[18px]">
          <div className="text-[12px] uppercase tracking-[0.12em] text-[var(--text3)]">
            Tracked balance
          </div>
          <div className="mt-1.5 text-[24px] font-bold tabular-nums text-[var(--text1)]">
            {fmt.usd(totalBalanceUsd)}
          </div>
          <div className="mt-1 text-[12px] text-[var(--text3)]">
            {visibleBrokers.length} broker account
            {visibleBrokers.length === 1 ? "" : "s"}
          </div>
        </Card>
      </div>

      {ui.error ? <div className={errorBannerClass}>{ui.error}</div> : null}

      {ui.loading && visibleBrokers.length === 0 ? (
        <div className={emptyStateClass}>Loading broker balances…</div>
      ) : null}
      {!ui.loading && visibleBrokers.length === 0 ? (
        <div className={emptyStateClass}>
          No {environmentMode} broker accounts configured yet.
        </div>
      ) : null}

      <div className="grid gap-3.5">
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

const emptyStateClass =
  "rounded-2xl border border-dashed border-[var(--border)] p-[22px] text-center text-[var(--text3)]";

const errorBannerClass =
  "rounded-xl border border-error-border bg-error-dim p-3 px-3.5 text-[13px] text-error";

const sessionRowClass =
  "flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3";

const settingsPanelClass =
  "grid gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-3.5";

const fieldClass = "grid gap-1.5";
const fieldLabelClass =
  "text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text3)]";
const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-[11px] py-[9px] text-[13px] text-[var(--text1)]";
