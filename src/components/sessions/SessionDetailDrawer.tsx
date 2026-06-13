import { useEffect, useReducer, useState } from "react";
import { getSearchProviderDisplayName } from "@electron/shared/instruments/search-providers";
import { Badge } from "@/components/custom-ui";
import { api, listenEvent, type SessionSummary } from "@/lib/exva";
import type {
  EventRow,
  InstrumentClass,
  SessionTemplatePayload,
} from "@/lib/types";
import { Button, Dialog, DialogContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  SessionExecutionProgress,
  deriveProgress,
  type SessionProgressState,
} from "./SessionExecutionProgress";

type InstrumentCacheView = {
  instruments: Array<{ symbol: string; instrumentClass: string }> | null;
  selectedAt: string | null;
  definitionHashMatches: boolean;
};

// ---------------------------------------------------------------------------
// SessionInfoGrid — metadata sections (Task Definition, Execution Setup, Risk Limits)
// ---------------------------------------------------------------------------

const SessionInfoGrid = ({
  session,
  payload,
  loading,
  instrumentCache,
  cacheLoading,
  cacheAction,
  onClearCache,
}: {
  session: SessionSummary;
  payload: SessionTemplatePayload | null;
  loading: boolean;
  instrumentCache: InstrumentCacheView | null;
  cacheLoading: boolean;
  cacheAction: string | null;
  onClearCache: () => void;
}) => (
  <>
    <Section title="Task Definition">
      <Row label="Manual tickers" value={session.instrumentScope} />
      <Row
        label="Search provider"
        value={getSearchProviderDisplayName(session.defaultSearchProviderId)}
      />
      {payload?.selectorSettings.aiPickerEnabled ? (
        <div className="mt-1">
          <div className={rowLabelClass}>Last AI universe selection</div>
          <div className="mt-1.5">
            {cacheLoading ? (
              <span className={mutedClass}>Loading cache…</span>
            ) : instrumentCache?.instruments?.length ? (
              <div className="grid gap-2">
                <div className="text-[12px] text-[var(--text2)]">
                  {instrumentCache.selectedAt
                    ? `Selected ${formatTimestamp(instrumentCache.selectedAt)}`
                    : "—"}
                </div>
                {!instrumentCache.definitionHashMatches ? (
                  <Badge variant="warn">
                    Definition changed: next start recomputes universe
                  </Badge>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {instrumentCache.instruments.map((row) => (
                    <span
                      key={`${row.symbol}-${row.instrumentClass}`}
                      className={cacheChipClass}
                    >
                      {row.symbol} · {row.instrumentClass}
                    </span>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={onClearCache}
                  disabled={
                    session.status === "active" || session.status === "paused"
                  }
                  variant="outline"
                  className="self-start border-border bg-[var(--surface2)] text-xs text-[var(--text2)]"
                >
                  Re-run selector on next start
                </Button>
                {cacheAction ? (
                  <div className="text-[12px] text-[var(--text3)]">
                    {cacheAction}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className={mutedClass}>
                No cached selection yet (selector runs when you start with AI
                picker on).
              </span>
            )}
          </div>
        </div>
      ) : null}
    </Section>

    <Section title="Execution Setup">
      <Row
        label="Execution mode"
        value={
          session.executionMode === "live_allowed"
            ? "Live allowed"
            : "Paper only"
        }
      />
      <Row
        label="Assigned brokers"
        value={
          payload?.brokerAssignments.length
            ? payload.brokerAssignments
                .map(
                  (entry) =>
                    `${entry.brokerAccountId} ($${entry.allocatedUsd.toLocaleString()})`,
                )
                .join(", ")
            : "None assigned"
        }
      />
      <Row
        label="Routing overrides"
        value={formatOverrides(payload?.brokerOverridesByInstrumentClass)}
      />
      <Row
        label="Instrument classes"
        value={session.instrumentClasses.map(formatInstrumentClass).join(", ")}
      />
    </Section>

    <Section title="Risk Limits">
      <div className="grid grid-cols-2 gap-3">
        <StatBlock
          label="Total allocated"
          value={`$${session.totalAllocatedUsd.toLocaleString()}`}
        />
        <StatBlock
          label="Max position"
          value={
            payload
              ? `$${payload.strategy.maxPositionUsd.toLocaleString()}`
              : loading
                ? "…"
                : "—"
          }
        />
        <StatBlock
          label="Stop / target"
          value={
            payload
              ? `${payload.strategy.stopLossPct}% / ${payload.strategy.takeProfitPct}%`
              : loading
                ? "…"
                : "—"
          }
        />
        <StatBlock
          label="Daily loss / profit"
          value={
            payload
              ? `$${payload.strategy.dailyLossLimitUsd.toLocaleString()} / $${payload.strategy.profitTargetUsd.toLocaleString()}`
              : loading
                ? "…"
                : "—"
          }
        />
      </div>
    </Section>
  </>
);

// ---------------------------------------------------------------------------
// SessionDetailDrawer
// ---------------------------------------------------------------------------

export const SessionDetailDrawer = ({
  session,
  onClose,
}: {
  session: SessionSummary | null;
  onClose: () => void;
}) => {
  type State = {
    payload: SessionTemplatePayload | null;
    loading: boolean;
    error: string | null;
    recentEvents: EventRow[];
    instrumentCache: InstrumentCacheView | null;
    cacheLoading: boolean;
    cacheAction: string | null;
    executionProgress: SessionProgressState | null;
    researchFailure: string | null;
  };
  type Action =
    | { type: "resetExecutionState" }
    | {
        type: "setExecutionProgress";
        executionProgress: SessionProgressState | null;
      }
    | { type: "setResearchFailure"; researchFailure: string | null }
    | { type: "setRecentEvents"; recentEvents: EventRow[] }
    | { type: "cacheLoadStart" }
    | { type: "cacheLoadSuccess"; instrumentCache: InstrumentCacheView | null }
    | { type: "cacheLoadEnd" }
    | { type: "setCacheAction"; cacheAction: string | null }
    | { type: "payloadLoadStart" }
    | { type: "payloadLoadSuccess"; payload: SessionTemplatePayload }
    | { type: "payloadLoadError"; error: string };

  const initialState: State = {
    payload: null,
    loading: false,
    error: null,
    recentEvents: [],
    instrumentCache: null,
    cacheLoading: false,
    cacheAction: null,
    executionProgress: null,
    researchFailure: null,
  };

  function reducer(state: State, action: Action): State {
    switch (action.type) {
      case "resetExecutionState":
        return { ...state, executionProgress: null, researchFailure: null };
      case "setExecutionProgress":
        return { ...state, executionProgress: action.executionProgress };
      case "setResearchFailure":
        return { ...state, researchFailure: action.researchFailure };
      case "setRecentEvents":
        return { ...state, recentEvents: action.recentEvents };
      case "cacheLoadStart":
        return { ...state, cacheLoading: true, cacheAction: null };
      case "cacheLoadSuccess":
        return { ...state, instrumentCache: action.instrumentCache };
      case "cacheLoadEnd":
        return { ...state, cacheLoading: false };
      case "setCacheAction":
        return { ...state, cacheAction: action.cacheAction };
      case "payloadLoadStart":
        return { ...state, loading: true, error: null };
      case "payloadLoadSuccess":
        return { ...state, payload: action.payload, loading: false };
      case "payloadLoadError":
        return { ...state, error: action.error, loading: false };
      default:
        return state;
    }
  }

  const [state, dispatch] = useReducer(reducer, initialState);
  const [activeTab, setActiveTab] = useState<"summary" | "signals">("summary");
  const [signalFilter, setSignalFilter] = useState<
    "all" | "pending" | "completed" | "dropped"
  >("all");
  const [signalRows, setSignalRows] = useState<
    Awaited<ReturnType<typeof api.listSessionSignalEvents>>["rows"]
  >([]);
  const [deadLetterRows, setDeadLetterRows] = useState<
    Awaited<ReturnType<typeof api.listSessionSignalDeadLetters>>["rows"]
  >([]);
  const [replayingDeadLetterId, setReplayingDeadLetterId] = useState<
    string | null
  >(null);
  const [deadLetterFilter, setDeadLetterFilter] = useState<
    | "all"
    | "unsupported_by_experience"
    | "unsupported_by_signal_source"
    | "unsupported_by_assigned_broker"
    | "no_compatible_broker_route"
  >("all");
  const {
    payload,
    loading,
    error,
    recentEvents,
    instrumentCache,
    cacheLoading,
    cacheAction,
    executionProgress,
    researchFailure,
  } = state;

  const refreshExecutionProgress = async (sessionId: string) => {
    try {
      const result = await api.getSessionExecutionProgress(sessionId);
      if (!result.cycleId) {
        dispatch({ type: "setExecutionProgress", executionProgress: null });
        return;
      }
      dispatch({
        type: "setExecutionProgress",
        executionProgress:
          deriveProgress(
            result.steps,
            result.cycleId,
            null,
            result.openTradeCount,
            result.monitoringActive,
          ) ?? null,
      });
    } catch {
      dispatch({ type: "setExecutionProgress", executionProgress: null });
    }
  };

  useEffect(() => {
    if (!session) return;
    void refreshExecutionProgress(session.id);
    let cancelled = false;
    const cleanup: Array<() => void> = [];
    const events = [
      "step:started",
      "step:succeeded",
      "step:failed",
      "step:retrying",
      "research_phase_failed",
    ] as const;

    void Promise.all(
      events.map((eventName) =>
        listenEvent(eventName, (payload) => {
          const data = payload as {
            sessionId?: string;
            phase?: string;
            error?: string;
          };
          if (cancelled || data.sessionId !== session.id) return;
          if (eventName === "research_phase_failed") {
            dispatch({
              type: "setResearchFailure",
              researchFailure: `${data.phase ?? "research"} failed: ${data.error ?? "unknown error"}`,
            });
          }
          void refreshExecutionProgress(session.id);
        }),
      ),
    ).then((unsubs) => cleanup.push(...unsubs));

    return () => {
      cancelled = true;
      for (const unsub of cleanup) unsub();
      dispatch({ type: "resetExecutionState" });
    };
  }, [session]);

  useEffect(() => {
    if (!session || activeTab !== "signals") return;
    let cancelled = false;
    const loadSignals = async () => {
      try {
        const [deliveries, deadLetters] = await Promise.all([
          api.listSessionSignalEvents({
            sessionId: session.id,
            statusBucket: signalFilter === "all" ? undefined : signalFilter,
            limit: 50,
          }),
          api.listSessionSignalDeadLetters({
            sessionId: session.id,
            reason: deadLetterFilter === "all" ? undefined : deadLetterFilter,
            limit: 50,
          }),
        ]);
        if (!cancelled) {
          setSignalRows(deliveries.rows);
          setDeadLetterRows(deadLetters.rows);
        }
      } catch {
        if (!cancelled) {
          setSignalRows([]);
          setDeadLetterRows([]);
        }
      }
    };
    void loadSignals();
    const unsubA = listenEvent("signal_received", () => void loadSignals());
    const unsubB = listenEvent(
      "signal_delivery_updated",
      () => void loadSignals(),
    );
    const unsubC = listenEvent(
      "signal_dead_lettered",
      () => void loadSignals(),
    );
    return () => {
      cancelled = true;
      void unsubA.then((u) => u());
      void unsubB.then((u) => u());
      void unsubC.then((u) => u());
    };
  }, [session, activeTab, signalFilter, deadLetterFilter]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void api
      .getEvents({ sessionId: session.id, limit: 25 })
      .then((rows) => {
        if (!cancelled) {
          dispatch({ type: "setRecentEvents", recentEvents: rows });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "setRecentEvents", recentEvents: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    dispatch({ type: "cacheLoadStart" });
    void api
      .getSessionInstrumentCache(session.id)
      .then((row) => {
        if (!cancelled) {
          dispatch({ type: "cacheLoadSuccess", instrumentCache: row });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "cacheLoadSuccess", instrumentCache: null });
        }
      })
      .finally(() => {
        if (!cancelled) dispatch({ type: "cacheLoadEnd" });
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    dispatch({ type: "payloadLoadStart" });
    void api
      .buildTemplatePayloadFromSession(session.id)
      .then((result) => {
        if (!cancelled) {
          dispatch({ type: "payloadLoadSuccess", payload: result });
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) {
          dispatch({ type: "payloadLoadError", error: loadError.message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleClearCache = async () => {
    if (!session) return;
    if (session.status === "active" || session.status === "paused") {
      dispatch({
        type: "setCacheAction",
        cacheAction: "Stop the session before clearing the selector cache.",
      });
      return;
    }
    dispatch({ type: "setCacheAction", cacheAction: null });
    try {
      await api.clearSessionInstrumentCache(session.id);
      const next = await api.getSessionInstrumentCache(session.id);
      dispatch({ type: "cacheLoadSuccess", instrumentCache: next });
      dispatch({
        type: "setCacheAction",
        cacheAction: "Cache cleared. Selector will run on next session start.",
      });
    } catch (err) {
      dispatch({
        type: "setCacheAction",
        cacheAction: err instanceof Error ? err.message : "Clear failed",
      });
    }
  };

  if (!session) return null;

  return (
    <Dialog open={!!session} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden border-border bg-transparent p-0 sm:max-w-[620px]">
        <div className={panelClass}>
          {/* Header */}
          <div className="mb-[18px] border-b border-[var(--border)] pb-[18px]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="m-0 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text1)]">
                {session.name}
              </h2>
              <Badge variant={statusVariant(session.status)}>
                {session.status}
              </Badge>
              {session.isFocused ? <Badge variant="blue">focused</Badge> : null}
            </div>
            {session.objective ? (
              <div className="mt-1.5 text-[13px] leading-[1.55] text-[var(--text2)]">
                {session.objective}
              </div>
            ) : null}
          </div>

          {error ? <div className={errorBannerClass}>{error}</div> : null}

          <div className="grid max-h-[calc(92vh-120px)] gap-3 overflow-y-auto pr-1">
            <div className="flex gap-2">
              <Button
                variant={activeTab === "summary" ? "default" : "outline"}
                onClick={() => setActiveTab("summary")}
              >
                Summary
              </Button>
              <Button
                variant={activeTab === "signals" ? "default" : "outline"}
                onClick={() => setActiveTab("signals")}
              >
                Signals
              </Button>
            </div>
            {activeTab === "signals" ? (
              <Section title="Signals">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["all", "All"],
                      ["pending", "Pending"],
                      ["completed", "Completed"],
                      ["dropped", "Dropped"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      variant={signalFilter === value ? "default" : "outline"}
                      onClick={() => setSignalFilter(value)}
                      className="h-8 text-xs"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="self-center text-[11px] uppercase tracking-[0.08em] text-[var(--text3)]">
                    Dead letters
                  </span>
                  {(
                    [
                      ["all", "All"],
                      ["unsupported_by_experience", "Experience"],
                      ["unsupported_by_signal_source", "Source"],
                      ["unsupported_by_assigned_broker", "Broker"],
                      ["no_compatible_broker_route", "Route"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      variant={
                        deadLetterFilter === value ? "default" : "outline"
                      }
                      onClick={() => setDeadLetterFilter(value)}
                      className="h-8 text-xs"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                {signalRows.length === 0 && deadLetterRows.length === 0 ? (
                  <div className={mutedClass}>
                    No signals received yet for this session.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {signalRows.map((row) => (
                      <div
                        key={row.delivery.id}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-[var(--text1)]">
                              {(row.event.ticker as string) ?? "—"}
                            </div>
                            <div className="text-[12px] text-[var(--text3)]">
                              {(row.source.name as string) ?? "Source"}
                              {(row.event.companyName as string | null)
                                ? ` · ${String(row.event.companyName)}`
                                : ""}
                            </div>
                          </div>
                          <Badge
                            variant={signalStatusVariant(row.delivery.status)}
                          >
                            {signalStatusLabel(
                              row.delivery.status,
                              row.delivery.dropReason,
                            )}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--text3)]">
                          {formatTimestamp(row.delivery.enqueuedAt)}
                          {row.delivery.status === "queued"
                            ? ` · #${row.delivery.queuePositionAtEnqueue} in queue`
                            : ""}
                        </div>
                        {row.event.documentUrl ? (
                          <a
                            href={String(row.event.documentUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[12px] text-[var(--accent)]"
                          >
                            Open document
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {deadLetterRows.map((row) => (
                      <div
                        key={row.deadLetter.id}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[12px] font-semibold text-[var(--text1)]">
                              {row.deadLetter.ticker}
                            </div>
                            <div className="text-[12px] text-[var(--text3)]">
                              {(row.source.name as string) ?? "Source"} · Not
                              delivered
                            </div>
                          </div>
                          <Badge variant="default">
                            {deadLetterReasonLabel(row.deadLetter.reason)}
                          </Badge>
                        </div>
                        <div className="mt-1 text-[12px] text-[var(--text3)]">
                          {formatTimestamp(row.deadLetter.createdAt)}
                          {row.deadLetter.replayedAt ? " · Replayed" : ""}
                        </div>
                        {!row.deadLetter.replayedAt ? (
                          <Button
                            variant="outline"
                            className="mt-2 h-7 text-xs"
                            disabled={
                              replayingDeadLetterId === row.deadLetter.id
                            }
                            onClick={async () => {
                              setReplayingDeadLetterId(row.deadLetter.id);
                              try {
                                await api.replaySessionSignalDeadLetter(
                                  row.deadLetter.id,
                                );
                                const res = await api.listSessionSignalEvents({
                                  sessionId: session.id,
                                  limit: 50,
                                });
                                setSignalRows(res.rows);
                                const deadLetters =
                                  await api.listSessionSignalDeadLetters({
                                    sessionId: session.id,
                                    limit: 50,
                                  });
                                setDeadLetterRows(deadLetters.rows);
                              } finally {
                                setReplayingDeadLetterId(null);
                              }
                            }}
                          >
                            {replayingDeadLetterId === row.deadLetter.id
                              ? "Replaying..."
                              : "Replay"}
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            ) : null}
            {activeTab === "summary" ? (
              <>
                <SessionInfoGrid
                  session={session}
                  payload={payload}
                  loading={loading}
                  instrumentCache={instrumentCache}
                  cacheLoading={cacheLoading}
                  cacheAction={cacheAction}
                  onClearCache={() => void handleClearCache()}
                />

                {(executionProgress || researchFailure) && (
                  <Section title="Execution Progress">
                    {executionProgress ? (
                      <SessionExecutionProgress
                        sessionId={session.id}
                        progress={executionProgress}
                        onRetry={() => undefined}
                        onViewTrace={() => undefined}
                        onPauseAfterStep={() => undefined}
                      />
                    ) : (
                      <span className={mutedClass}>
                        No active execution cycle.
                      </span>
                    )}
                    {researchFailure ? (
                      <div className="mt-2 text-[12px] leading-[1.45] text-error">
                        {researchFailure}
                      </div>
                    ) : null}
                  </Section>
                )}

                <Section title="Session Summary">
                  <div className="grid grid-cols-2 gap-3">
                    <StatBlock
                      label="Updated"
                      value={formatTimestamp(session.updatedAt)}
                    />
                    <StatBlock
                      label="Runtime"
                      value={
                        session.uptimeMin > 0
                          ? `${session.uptimeMin} min`
                          : "Inactive"
                      }
                    />
                    <StatBlock
                      label="Open trades"
                      value={String(session.openTradeCount)}
                    />
                    <StatBlock
                      label="Workspace"
                      value={
                        session.isFocused ? "Focused" : "Alternate context"
                      }
                    />
                  </div>
                </Section>

                <Section title="Recent Events">
                  {recentEvents.length === 0 ? (
                    <div className={mutedClass}>No recent events.</div>
                  ) : (
                    <div className="grid gap-1.5">
                      {recentEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="grid grid-cols-[auto_1fr] gap-2.5 text-[12px] leading-[1.45]"
                        >
                          <span className="whitespace-nowrap pt-px text-[12px] text-[var(--text3)]">
                            {formatTimestamp(ev.created_at)}
                          </span>
                          <span
                            className={cn(
                              ev.level === "ERROR"
                                ? "text-error"
                                : "text-[var(--text2)]",
                            )}
                          >
                            {ev.message}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className={sectionClass}>
    <div className={sectionTitleClass}>{title}</div>
    <div className="grid gap-2.5">{children}</div>
  </section>
);

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-[140px_1fr] items-start gap-2">
    <div className={rowLabelClass}>{label}</div>
    <div className="text-[13px] leading-normal text-[var(--text1)]">
      {value}
    </div>
  </div>
);

const StatBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5">
    <div className={rowLabelClass}>{label}</div>
    <div className="mt-1 text-[14px] font-semibold tabular-nums text-[var(--text1)]">
      {value}
    </div>
  </div>
);

function statusVariant(
  status: SessionSummary["status"],
): "default" | "success" | "warn" | "danger" | "purple" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warn";
    case "attention_required":
      return "danger";
    case "archived":
      return "danger";
    case "stopped":
      return "purple";
    default:
      return "default";
  }
}

function deadLetterReasonLabel(reason: string): string {
  switch (reason) {
    case "unsupported_by_experience":
      return "Unsupported by experience";
    case "unsupported_by_signal_source":
      return "Unsupported by source";
    case "unsupported_by_assigned_broker":
      return "No broker for class";
    case "no_compatible_broker_route":
      return "No broker route";
    default:
      return "Not delivered";
  }
}

function signalStatusLabel(status: string, dropReason: string | null): string {
  if (status === "waiting_for_resume") return "Waiting for resume";
  if (status === "processing") return "Evaluating";
  if (status === "triggered") return "Triggered cycle";
  if (status === "traded") return "Trade opened";
  if (status === "rejected") return "Rejected in review";
  if (status === "dropped")
    return dropReason ? `Dropped (${dropReason})` : "Dropped";
  if (status === "expired") return "Expired while paused";
  return "Queued";
}

function signalStatusVariant(
  status: string,
): "default" | "success" | "warn" | "danger" | "purple" {
  if (status === "triggered" || status === "traded") return "success";
  if (status === "waiting_for_resume") return "warn";
  if (status === "expired") return "purple";
  if (status === "dropped") return "danger";
  return "default";
}

function formatInstrumentClass(value: InstrumentClass): string {
  return value === "stock"
    ? "Stocks"
    : value === "crypto"
      ? "Crypto"
      : value === "futures"
        ? "Futures"
        : "Prediction Markets";
}

function formatOverrides(
  overrides?: Partial<Record<InstrumentClass, string>>,
): string {
  const entries = Object.entries(overrides ?? {}).filter(
    ([, brokerId]) => brokerId,
  );
  if (entries.length === 0) return "No routing overrides";
  return entries
    .map(
      ([ic, brokerId]) =>
        `${formatInstrumentClass(ic as InstrumentClass)} → ${brokerId}`,
    )
    .join(" · ");
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

const panelClass =
  "w-[620px] max-w-[96vw] rounded-[20px] border border-[var(--border)] bg-[var(--surface)] p-[22px]";

const sectionClass =
  "rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5";

const sectionTitleClass =
  "mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--text3)]";

const rowLabelClass = "pt-px text-[12px] leading-normal text-[var(--text3)]";

const cacheChipClass =
  "rounded-full border border-[var(--border)] bg-[var(--chip)] px-2 py-[3px] text-[12px] text-[var(--text2)]";

const mutedClass = "text-[13px] text-[var(--text3)]";

const errorBannerClass =
  "mb-3.5 rounded-[10px] border border-error-border bg-error-dim px-[14px] py-[11px] text-[13px] text-error";
