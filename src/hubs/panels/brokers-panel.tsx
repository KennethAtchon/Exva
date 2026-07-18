import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Badge, Card } from "@/components/custom-ui";
import { Button, HelpTooltip } from "@/components/ui";
import { api } from "@/lib/exva";
import type { BrokerAccountWithState } from "@/lib/types";
import { EmptyState } from "@/components/ui/primitives";
import { PanelLoading } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/format";
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
      <div className={fieldClass}>
        <span className={fieldLabelClass}>
          Max sessions{" "}
          <HelpTooltip
            topic="Max sessions"
            body="Caps how many sessions can use this broker at the same time."
          />
        </span>
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
      </div>
      <div className={fieldClass}>
        <span className={fieldLabelClass}>
          Allocation enforcement{" "}
          <HelpTooltip
            topic="Allocation enforcement"
            body="Hard block prevents over-allocation. Warn only allows it but highlights the risk."
          />
        </span>
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
      </div>
      <div className={fieldClass}>
        <span className={fieldLabelClass}>
          Refresh interval (min){" "}
          <HelpTooltip
            topic="Refresh interval"
            body="How often Exva polls this broker for fresh balance information."
          />
        </span>
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
      </div>
    </div>
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={onReset}>
        Reset
      </Button>
      <Button variant="primary" size="sm" disabled={isSaving} onClick={onSave}>
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
  onResetPaperBalance,
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
  onResetPaperBalance?: () => void;
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
  const showPaperReset =
    broker.mode === "paper" &&
    (broker.brokerType === "polymarket" || broker.brokerType === "kraken");

  return (
    <div className={brokerRowCardClass}>
      <div className={brokerRowHeaderClass}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={brokerRowTitleClass}>{broker.name}</div>
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
            <HelpTooltip glossaryId="broker-connection-health" />
          </div>
          <div className={brokerRowMetaClass}>
            Balance{" "}
            {broker.balanceCacheUsd != null
              ? fmt.usd(broker.balanceCacheUsd)
              : "—"}
            {broker.balanceCachedAt
              ? ` · updated ${formatIsoDateTime(broker.balanceCachedAt)}`
              : ""}
          </div>
        </div>
        <div className={brokerRowActionsClass}>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          {showPaperReset && onResetPaperBalance ? (
            <Button variant="secondary" size="sm" onClick={onResetPaperBalance}>
              Reset paper balance
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={onToggleExpand}>
            {isExpanded ? "Hide settings" : "Settings"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-3.5">
        <div className="grid gap-2">
          <div className="flex justify-between font-mono text-caption text-text3">
            <span>Allocated {fmt.usd(broker.totalAllocatedUsd)}</span>
            <span>
              Free{" "}
              {broker.freeCapitalUsd != null
                ? fmt.usd(broker.freeCapitalUsd)
                : "—"}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-surface3">
            <div
              className={cn(
                "h-full rounded-sm",
                broker.isOverAllocated ? "bg-error" : "bg-primary",
              )}
              style={{ width: `${allocationPct}%` }}
            />
          </div>
          <div className="flex justify-between font-mono text-caption text-text3">
            <span>
              {broker.activeSessionCount} / {broker.maxSessions} active sessions
            </span>
            <span>
              {formatPercent(allocationPct, 1, { asRatio: false })} used
            </span>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="font-mono text-micro uppercase tracking-wider text-text3">
            Attached sessions
          </div>
          {broker.sessions.length === 0 ? (
            <div className="font-sans text-caption text-text3">
              No active or paused sessions are using this broker.
            </div>
          ) : (
            broker.sessions.map((session) => (
              <div key={session.sessionId} className={sessionRowClass}>
                <div>
                  <div className="font-sans text-label text-text1">
                    {session.sessionName}
                  </div>
                  <div className="mt-0.5 font-mono text-caption text-text3">
                    {session.status} · allocated {fmt.usd(session.allocatedUsd)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onJumpToSession?.(session.sessionId)}
                >
                  Jump
                </Button>
              </div>
            ))
          )}
        </div>

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
    </div>
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

  const settingsDraftsRef = useRef(ui.settingsDrafts);

  useEffect(() => {
    settingsDraftsRef.current = ui.settingsDrafts;
  }, [ui.settingsDrafts]);

  const load = useCallback(async () => {
    dispatch({ loading: true, error: null });
    try {
      const rows = await api.listBrokerAccountState();
      const nextDrafts = { ...settingsDraftsRef.current };
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
  }, []);

  useEffect(() => {
    dispatch({ expandedBrokerId: null });
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [environmentMode, load]);

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
    <div className="hub-panel-body flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-micro uppercase tracking-wider text-text3">
            Broker topology
          </div>
          <h1 className="m-0 mt-2 font-sans text-title text-text1">Brokers</h1>
          <p className="mt-2 max-w-lg font-sans text-body text-text3">
            Real broker balances, active session sharing, and per-broker
            allocation policy in one place.
          </p>
        </div>
        <Card className="min-w-52 p-4">
          <div className="font-mono text-micro uppercase tracking-wider text-text3">
            Tracked balance
          </div>
          <div className="mt-1.5 font-mono text-stat tabular-nums text-text1">
            {fmt.usd(totalBalanceUsd)}
          </div>
          <div className="mt-1 font-sans text-caption text-text3">
            {visibleBrokers.length} broker account
            {visibleBrokers.length === 1 ? "" : "s"}
          </div>
        </Card>
      </div>

      {ui.error ? <div className={errorBannerClass}>{ui.error}</div> : null}

      {ui.loading && visibleBrokers.length === 0 ? <PanelLoading /> : null}
      {!ui.loading && visibleBrokers.length === 0 ? (
        <EmptyState
          centered
          title={`No ${environmentMode} broker accounts configured yet`}
          message="Connect brokers on the Accounts page first. Sessions need assigned broker accounts before they can launch."
        />
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
              onResetPaperBalance={async () => {
                try {
                  await api.resetPaperBalance({ brokerAccountId: broker.id });
                  await load();
                } catch (resetError) {
                  dispatch({
                    error:
                      resetError instanceof Error
                        ? resetError.message
                        : "Failed to reset paper balance.",
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
    </div>
  );
};

const errorBannerClass =
  "rounded-sm border border-error-border bg-error-dim p-3 font-sans text-body text-error";

const sessionRowClass =
  "flex items-center justify-between gap-3 rounded-sm border border-border bg-surface2 px-3.5 py-2.5";

const settingsPanelClass =
  "grid gap-3 rounded-sm border border-border bg-surface2 p-3.5";

const fieldClass = "grid gap-1.5";
const fieldLabelClass =
  "font-mono text-micro uppercase tracking-wider text-text3";
const inputClass =
  "h-8 w-full rounded-sm border border-border bg-surface2 px-3 font-sans text-body text-text1";

const brokerRowCardClass =
  "overflow-hidden rounded-sm border border-border bg-surface";
const brokerRowHeaderClass =
  "flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3.5";
const brokerRowTitleClass = "font-sans text-head text-text1";
const brokerRowMetaClass = "mt-1 font-mono text-caption text-text3";
const brokerRowActionsClass = "flex shrink-0 flex-wrap gap-2";
