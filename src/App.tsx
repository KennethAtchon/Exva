import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { RuntimeEventToast } from "./components/RuntimeEventToast";
import { Shell } from "./components/shell";
import type { PageKey } from "./lib/nav";
import { LiveReadinessModal } from "./components/sessions/LiveReadinessModal";
import { DashboardHub } from "./hubs/DashboardHub";
import { SessionsHub } from "./hubs/SessionsHub";
import { SignalsHub } from "./hubs/SignalsHub";
import { ResearchHub } from "./hubs/ResearchHub";
import { SettingsHub } from "./hubs/SettingsHub";
import { AssistantHub } from "./hubs/AssistantHub";
import { TradeDetail } from "./pages/TradeDetail";
import { AutopsyPage } from "./hubs/panels/trade-autopsy-panel";
import { DocsPage } from "./pages/DocsPage";
import { AssistantSlideOver } from "./components/control/AssistantSlideOver";
import {
  CommandPalette,
  type PaletteAction,
} from "./components/CommandPalette";
import { useControlStore } from "./store/controlStore";
import { useSessionStore } from "./store/sessionStore";
import { useTradeStore } from "./store/tradeStore";
import { useWorkspaceStore } from "./store/workspaceStore";
import { api, type SessionSummary } from "./lib/exva";
import { executionModeForEnvironment } from "./lib/environment-mode";
import { useExvaEvent } from "./hooks/useExvaEvent";
import { usePolling } from "./hooks/usePolling";
import type { SessionStatus } from "@/lib/types";
import type { DevPanelFocus } from "./hubs/panels/dev-panel";
import {
  confirm,
  DialogHost,
  focusRingClass,
  promptText,
} from "@/components/ui/confirm-dialog";

interface LiveReadinessReport {
  readyToStart: boolean;
  allChecksPassed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    requiresAck?: boolean;
    message?: string;
  }>;
  acknowledgedAt: string | null;
}

const mergeReducer = <S,>(s: S, u: Partial<S>): S => ({ ...s, ...u });

type AppUiState = {
  page: PageKey;
  sessionsStatusFilter: SessionStatus | "all";
  sessionsTab: "run" | "trades" | "config";
  researchTab: "scorecards" | "autopsies" | "costs" | "lab" | "attribution";
  settingsTab: "accounts" | "brokers" | "developer";
  signalsTab: "overview" | "instruments" | "doctor";
  docsSlug: string | null;
  devPanelFocus: DevPanelFocus | null;
  loadError: string | null;
  sessionActionPending: boolean;
  liveReadinessSession: SessionSummary | null;
  liveReadinessReport: LiveReadinessReport | null;
  autopsyTradeId: string | null;
  periodAutopsyScope: "global" | "session";
  periodAutopsySessionId: string | null;
  periodAutopsyId: string | null;
};

export default function App() {
  const [ui, dispatchUi] = useReducer(mergeReducer<AppUiState>, {
    page: "dashboard",
    sessionsStatusFilter: "all",
    sessionsTab: "run",
    researchTab: "scorecards",
    settingsTab: "accounts",
    signalsTab: "overview",
    docsSlug: null,
    devPanelFocus: null,
    loadError: null,
    sessionActionPending: false,
    liveReadinessSession: null,
    liveReadinessReport: null,
    autopsyTradeId: null,
    periodAutopsyScope: "global",
    periodAutopsySessionId: null,
    periodAutopsyId: null,
  });
  const [sinkAlarm, setSinkAlarm] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const loadErrorRef = useRef<string | null>(null);
  loadErrorRef.current = ui.loadError;
  const status = useSessionStore((s) => s.status);
  const setStatus = useSessionStore((s) => s.setStatus);
  const stats = useSessionStore((s) => s.stats);
  const setStats = useSessionStore((s) => s.setStats);

  const setTrades = useTradeStore((s) => s.setTrades);
  const selectedId = useTradeStore((s) => s.selectedId);
  const setSelected = useTradeStore((s) => s.setSelected);
  const loadWorkspaceView = useWorkspaceStore((s) => s.loadWorkspaceView);
  const viewMode = useWorkspaceStore((s) => s.viewMode);
  const focusedSessionId = useWorkspaceStore((s) => s.focusedSessionId);
  const environmentMode = useWorkspaceStore((s) => s.environmentMode);

  const reloadTrades = useCallback(() => {
    return api
      .getActiveTrades({
        executionMode: executionModeForEnvironment(environmentMode),
      })
      .then(setTrades)
      .catch((err) => {
        if (!loadErrorRef.current) {
          dispatchUi({
            loadError:
              err instanceof Error ? err.message : "Failed to load trades.",
          });
        }
      });
  }, [environmentMode, setTrades]);

  const reloadStats = useCallback(() => {
    return api
      .getDashboardStats()
      .then((next) => {
        setStats(next);
        setStatus(next.session_status);
        dispatchUi({ loadError: null });
      })
      .catch((err) => {
        if (!loadErrorRef.current) {
          dispatchUi({
            loadError:
              err instanceof Error
                ? err.message
                : "Failed to load dashboard stats.",
          });
        }
      });
  }, [setStats, setStatus]);

  useEffect(() => {
    void reloadStats();
    void reloadTrades();
    void loadWorkspaceView();
  }, [loadWorkspaceView, reloadStats, reloadTrades]);

  useEffect(() => {
    useControlStore.getState().setUiContext({
      route: ui.page,
      selectedSessionId: focusedSessionId,
    });
  }, [ui.page, focusedSessionId]);

  useEffect(() => {
    void reloadStats();
    if (ui.page === "sessions" && ui.sessionsTab === "trades") return;
    void reloadTrades();
  }, [
    focusedSessionId,
    ui.page,
    ui.sessionsTab,
    reloadStats,
    reloadTrades,
    viewMode,
  ]);

  useEffect(() => {
    void reloadStats();
    void reloadTrades();
  }, [environmentMode, reloadStats, reloadTrades]);

  useEffect(() => {
    const ops = window.exva?.ops;
    if (!ops) return;
    void ops
      .getNotificationRouting()
      .then((routing) => {
        setSinkAlarm(
          !routing.ntfyConfigured &&
            !routing.telegramConfigured &&
            !routing.smtpConfigured,
        );
      })
      .catch(() => setSinkAlarm(false));
  }, [ui.page]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          scope: "global" | "session";
          sessionId: string | null;
          periodAutopsyId: string | null;
        }>
      ).detail;
      if (!detail) return;
      dispatchUi({
        page: "research",
        researchTab: "autopsies",
        periodAutopsyScope: detail.scope,
        periodAutopsySessionId: detail.sessionId,
        periodAutopsyId: detail.periodAutopsyId,
      });
      setSelected(null);
    };
    window.addEventListener("exva:navigate-autopsy", listener as EventListener);
    return () => {
      window.removeEventListener(
        "exva:navigate-autopsy",
        listener as EventListener,
      );
    };
  }, [setSelected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useExvaEvent("stats_update", () => {
    void reloadStats();
  });
  useExvaEvent("trade_opened", () => {
    void reloadTrades();
  });
  useExvaEvent("trade_closed", () => {
    void reloadTrades();
  });
  useExvaEvent("session_status_changed", () => {
    void reloadStats();
  });

  usePolling(
    async () => {
      const next = await api.getDashboardStats();
      setStats(next);
      setStatus(next.session_status);
    },
    5000,
    status !== "idle",
  );

  const handleSession = async (
    action: "start" | "pause" | "resume" | "stop" | "forceStop",
  ) => {
    if (ui.sessionActionPending) return;
    dispatchUi({ sessionActionPending: true, loadError: null });
    try {
      if (action === "start" || action === "resume") {
        const sessions = await api.listSessions({ includeArchived: false });
        const focused = sessions.sessions.find(
          (session) => session.id === focusedSessionId,
        );
        if (
          focused?.executionMode === "live_allowed" &&
          environmentMode === "live"
        ) {
          const readiness = await api.getLiveReadiness(focused.id);
          if (!readiness.readyToStart || !readiness.acknowledgedAt) {
            dispatchUi({
              liveReadinessReport: readiness,
              liveReadinessSession: focused,
            });
            return;
          }
        }
        setStatus(
          action === "start"
            ? await api.startSession()
            : await api.resumeSession(),
        );
      } else if (action === "pause") {
        setStatus(await api.pauseSession());
      } else if (action === "stop") {
        setStatus(await api.stopSession());
      } else if (action === "forceStop") {
        const ok = await confirm({
          title: "Force stop session?",
          description:
            "Force stop will end automated exit management for open positions. Continue?",
          confirmLabel: "Force stop",
          variant: "destructive",
        });
        if (!ok) return;
        setStatus(await api.forceStopSession());
      }
    } catch (error) {
      dispatchUi({
        loadError:
          error instanceof Error ? error.message : "Session action failed.",
      });
    } finally {
      dispatchUi({ sessionActionPending: false });
    }
  };

  const paletteActions: PaletteAction[] = [
    {
      id: "session.start",
      title: "Start focused session",
      keywords: "start resume run",
      scope: "session",
      run: () => void handleSession("start"),
    },
    {
      id: "session.pause",
      title: "Pause focused session",
      keywords: "pause",
      scope: "session",
      run: () => void handleSession("pause"),
    },
    {
      id: "session.stop",
      title: "Stop focused session",
      keywords: "stop",
      scope: "session",
      destructive: true,
      run: () => void handleSession("stop"),
    },
    {
      id: "kill.pause-all",
      title: "Pause all sessions",
      keywords: "pause all kill emergency",
      scope: "global",
      destructive: true,
      run: async () => {
        await api.killSwitchPauseAll();
      },
    },
    {
      id: "kill.flatten",
      title: "Flatten everything…",
      keywords: "flatten close all emergency",
      scope: "global",
      destructive: true,
      run: async () => {
        const confirmation = await promptText({
          title: "Flatten everything?",
          description:
            "Type FLATTEN to market-close every open position. This cannot be undone.",
          placeholder: "FLATTEN",
          matchValue: "FLATTEN",
          confirmLabel: "Flatten all",
        });
        if (confirmation) await api.killSwitchFlattenAll(confirmation);
      },
    },
    {
      id: "research.backtest",
      title: "Open Backtest Lab",
      keywords: "backtest lab research",
      scope: "global",
      run: () => dispatchUi({ page: "research", researchTab: "lab" }),
    },
    {
      id: "signals.doctor",
      title: "Open Data Doctor",
      keywords: "data doctor gaps coverage",
      scope: "global",
      run: () => dispatchUi({ page: "signals", signalsTab: "doctor" }),
    },
    {
      id: "briefing.assemble",
      title: "Assemble morning briefing",
      keywords: "briefing digest morning",
      scope: "global",
      run: async () => {
        await api.briefingAssemble();
        dispatchUi({ page: "dashboard" });
      },
    },
    {
      id: "equity.snapshot",
      title: "Take equity snapshot now",
      keywords: "equity snapshot curve",
      scope: "global",
      run: async () => {
        await api.equitySnapshotNow();
      },
    },
    {
      id: "ops.test-alarm",
      title: "Trigger test alarm",
      keywords: "alarm test supervisor",
      scope: "dev",
      run: async () => {
        await window.exva?.ops?.triggerTestAlarm({ kind: "heartbeat_stale" });
      },
    },
    {
      id: "ops.backup",
      title: "Run database backup now",
      keywords: "backup folder database",
      scope: "global",
      run: async () => {
        await window.exva?.ops?.runBackupNow();
      },
    },
    {
      id: "settings.accounts",
      title: "Open accounts & notifications",
      keywords: "settings accounts notifications sinks",
      scope: "global",
      run: () => dispatchUi({ page: "settings", settingsTab: "accounts" }),
    },
    {
      id: "assistant.open",
      title: "Open assistant",
      keywords: "assistant chat control",
      scope: "global",
      run: () => useControlStore.getState().toggleSlideOver(),
    },
    {
      id: "assistant.full",
      title: "Open assistant full page",
      keywords: "assistant chat control hub full",
      scope: "global",
      run: () => dispatchUi({ page: "assistant" }),
    },
    {
      id: "session.create-template",
      title: "Create session from template…",
      keywords: "create session preset template",
      scope: "global",
      run: () => dispatchUi({ page: "sessions", sessionsTab: "run" }),
    },
    {
      id: "dev.inject-signal",
      title: "Inject debug signal (dev)",
      keywords: "debug inject signal",
      scope: "dev",
      run: async () => {
        if (!focusedSessionId) return;
        await api.debugInjectSignal(focusedSessionId);
      },
    },
  ];

  const pageEl = () => {
    switch (ui.page) {
      case "dashboard":
        return <DashboardHub />;
      case "sessions":
        return (
          <SessionsHub
            initialTab={ui.sessionsTab}
            initialStatusFilter={ui.sessionsStatusFilter}
            onInitialStatusFilterApplied={() =>
              dispatchUi({ sessionsStatusFilter: "all" })
            }
            onGoToAccounts={() =>
              dispatchUi({ page: "settings", settingsTab: "accounts" })
            }
            onViewTrace={(sessionId, cycleId, stage) => {
              dispatchUi({
                devPanelFocus: { sessionId, cycleId, stage },
                page: "settings",
                settingsTab: "developer",
              });
            }}
            onViewAutopsy={(tradeId) => dispatchUi({ autopsyTradeId: tradeId })}
          />
        );
      case "signals":
        return <SignalsHub initialTab={ui.signalsTab} />;
      case "research":
        return (
          <ResearchHub
            initialTab={ui.researchTab}
            periodAutopsyScope={ui.periodAutopsyScope}
            periodAutopsySessionId={ui.periodAutopsySessionId}
            periodAutopsyId={ui.periodAutopsyId}
            onReviewTrade={(tradeId) => dispatchUi({ autopsyTradeId: tradeId })}
          />
        );
      case "assistant":
        return <AssistantHub />;
      case "settings":
        return (
          <SettingsHub
            initialTab={ui.settingsTab}
            sinkAlarm={sinkAlarm}
            devPanelFocus={ui.devPanelFocus}
            onDevFocusConsumed={() => dispatchUi({ devPanelFocus: null })}
            onJumpToSession={async (sessionId) => {
              await api.focusSession(sessionId);
              await loadWorkspaceView();
              dispatchUi({ page: "sessions", sessionsTab: "run" });
            }}
          />
        );
      case "docs":
        return <DocsPage />;
    }
  };

  return (
    <Shell
      activePage={ui.page}
      onNavigate={(p) => {
        dispatchUi({
          page: p,
          sessionsStatusFilter:
            p !== "sessions" ? "all" : ui.sessionsStatusFilter,
          sessionsTab: p === "sessions" ? ui.sessionsTab : "run",
          researchTab: p === "research" ? ui.researchTab : "scorecards",
          settingsTab: p === "settings" ? ui.settingsTab : "accounts",
        });
        setSelected(null);
      }}
      onNavigateToAttentionSessions={() => {
        dispatchUi({
          sessionsStatusFilter: "attention_required",
          page: "sessions",
          sessionsTab: "run",
        });
        setSelected(null);
      }}
      attentionCountOnDashboard
      settingsAlarm={sinkAlarm}
      sessionStatus={status}
      onSessionAction={handleSession}
      sessionActionPending={ui.sessionActionPending}
      stats={stats}
      onOpenPalette={() => setPaletteOpen(true)}
    >
      {ui.loadError && (
        <div className="flex items-center justify-between gap-3 border-b border-error-border bg-error-dim px-6 py-2 font-mono text-caption text-error">
          <span>{ui.loadError}</span>
          <button
            type="button"
            className="shrink-0 underline"
            onClick={() => {
              dispatchUi({ loadError: null });
              void reloadStats();
              void reloadTrades();
              void loadWorkspaceView();
            }}
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex flex-1 flex-col overflow-hidden">{pageEl()}</div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
        navigate={(target) => {
          if (target.tradeId) {
            setSelected(target.tradeId);
            dispatchUi({ page: target.page ?? "dashboard" });
            return;
          }
          if (target.sessionId) {
            void api
              .focusSession(target.sessionId)
              .then(() => loadWorkspaceView());
          }
          dispatchUi({
            page: target.page ?? ui.page,
            settingsTab:
              (target.settingsTab as AppUiState["settingsTab"]) ??
              ui.settingsTab,
            researchTab:
              (target.researchTab as AppUiState["researchTab"]) ??
              ui.researchTab,
            signalsTab:
              (target.signalsTab as AppUiState["signalsTab"]) ?? ui.signalsTab,
            docsSlug: target.docsSlug ?? ui.docsSlug,
          });
        }}
      />
      <RuntimeEventToast />
      {selectedId && (
        <TradeDetail
          tradeId={selectedId}
          onClose={() => setSelected(null)}
          onViewAutopsy={(tradeId) => {
            dispatchUi({ autopsyTradeId: tradeId });
            setSelected(null);
          }}
        />
      )}
      {ui.autopsyTradeId && (
        <AutopsyPage
          tradeId={ui.autopsyTradeId}
          trade={null}
          onClose={() => dispatchUi({ autopsyTradeId: null })}
        />
      )}
      <DialogHost />
      <button
        type="button"
        title="Assistant (⌘K → Open assistant)"
        aria-label="Open assistant"
        onClick={() => useControlStore.getState().toggleSlideOver()}
        className={`fixed bottom-10 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-popover transition-opacity duration-hover hover:opacity-90 ${focusRingClass}`}
      >
        <Sparkles className="h-5 w-5" />
      </button>
      <AssistantSlideOver
        onOpenFullView={() => dispatchUi({ page: "assistant" })}
      />
      {ui.liveReadinessSession && ui.liveReadinessReport ? (
        <LiveReadinessModal
          sessionId={ui.liveReadinessSession.id}
          report={ui.liveReadinessReport}
          onAcknowledged={async () => {
            dispatchUi({
              liveReadinessReport: null,
              liveReadinessSession: null,
            });
            try {
              setStatus(await api.startSession());
            } catch (error) {
              dispatchUi({
                loadError:
                  error instanceof Error
                    ? error.message
                    : "Failed to start session.",
              });
            }
          }}
          onCancel={() => {
            dispatchUi({
              liveReadinessReport: null,
              liveReadinessSession: null,
            });
          }}
        />
      ) : null}
    </Shell>
  );
}
