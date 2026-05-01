import type {
  AgentRole,
  AgentRun,
  BrokerCredentials,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  ExecutionMode,
  EventRow,
  InstrumentClass,
  SelectionMode,
  SessionConfig,
  SessionStatus,
  SessionTemplatePayload,
  Trade,
  TradeDecisionPayload,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "./types";
import { MOCK } from "./mock";

export interface SessionSummary {
  id: string;
  name: string;
  objective: string;
  status: SessionStatus;
  isFocused: boolean;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  capitalLimitUsd: number;
  executionMode: ExecutionMode;
  brokerCount: number;
  openTradeCount: number;
  updatedAt: string;
}

export interface WorkspaceViewResponse {
  workspaceViewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  preferences: WorkspacePreferences;
}

export interface SessionCreateInput {
  name: string;
  objective: string;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  selectorSettings: {
    aiPickerEnabled: boolean;
  };
  capitalLimitUsd: number;
  executionMode: ExecutionMode;
  brokerAccountIds: string[];
  brokerOverridesByInstrumentClass?: Partial<Record<InstrumentClass, string | null>>;
}

const SHOW_MOCK = false;

const hasExva =
  typeof window !== "undefined" &&
  typeof window.exva === "object" &&
  window.exva !== null;

const showMock = SHOW_MOCK;

function bridgeUnavailableError(): Error {
  return new Error(
    "EXVA bridge unavailable and mock data is disabled. Start the app with `npm run dev`/`npm start` instead of `npm run dev:renderer`, or set SHOW_MOCK to true.",
  );
}

async function call<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  if (showMock) return fallback;
  if (!hasExva) throw bridgeUnavailableError();
  return operation();
}

export const api = {
  getDashboardStats: () =>
    call<DashboardStats>(() => window.exva!.dashboard.getStats(), MOCK.stats),
  getCostBreakdown: (dateRange?: string) =>
    call<CostBreakdown>(
      () => window.exva!.dashboard.getCostBreakdown(dateRange ?? "today"),
      MOCK.costs,
    ),

  getActiveTrades: () =>
    call<Trade[]>(() => window.exva!.trades.listActive(), MOCK.trades),
  getTradeDetail: (tradeId: string) =>
    call<TradeDetail>(
      () => window.exva!.trades.getDetail(tradeId),
      {
        trade: MOCK.trades.find((trade) => trade.id === tradeId) ?? MOCK.trades[0],
        runs: MOCK.runs.filter((run) => run.trade_id === tradeId),
      },
    ),
  forceCloseTrade: (tradeId: string) =>
    call<void>(() => window.exva!.trades.forceClose(tradeId), undefined as void),
  approveTrade: (tradeId: string, approved: boolean) =>
    call<void>(() => window.exva!.trades.approve(tradeId, approved), undefined as void),

  startSession: () =>
    call<SessionStatus>(() => window.exva!.session.start(), "active"),
  pauseSession: () =>
    call<SessionStatus>(() => window.exva!.session.pause(), "paused"),
  stopSession: () =>
    call<SessionStatus>(() => window.exva!.session.stop(), "stopped"),
  listSessions: (filters?: {
    status?: SessionStatus;
    instrumentClass?: InstrumentClass;
    search?: string;
    includeArchived?: boolean;
  }) =>
    call<{ workspaceViewMode: WorkspaceViewMode; focusedSessionId: string | null; sessions: SessionSummary[] }>(
      () => window.exva!.session.list(filters),
      // TODO(phase-04): Remove this mock fallback shape once the renderer store owns
      // proper empty/global/session bootstrapping and mock mode supports sessions.
      { workspaceViewMode: "session", focusedSessionId: "default-session", sessions: [] },
    ),
  createSession: (input: SessionCreateInput) =>
    call<{ id: string; status: "draft" }>(() => window.exva!.session.create(input), {
      id: crypto.randomUUID(),
      status: "draft",
    }),
  updateSession: (id: string, input: SessionCreateInput) =>
    call<{ savedAt: string }>(() => window.exva!.session.update(id, input), { savedAt: new Date().toISOString() }),
  focusSession: (id: string) =>
    call<{ workspaceViewMode: "session"; focusedSessionId: string }>(() => window.exva!.session.focus(id), {
      workspaceViewMode: "session",
      focusedSessionId: id,
    }),
  goGlobal: () =>
    call<{ workspaceViewMode: "global"; focusedSessionId: null }>(() => window.exva!.session.goGlobal(), {
      workspaceViewMode: "global",
      focusedSessionId: null,
    }),
  archiveSession: (id: string) => call<{ archived: true }>(() => window.exva!.session.archive(id), { archived: true }),
  duplicateSession: (sourceId: string, name: string) =>
    call<{ id: string; status: "draft" }>(() => window.exva!.session.duplicate(sourceId, name), {
      id: crypto.randomUUID(),
      status: "draft",
    }),

  getWorkspaceView: () =>
    call<WorkspaceViewResponse>(() => window.exva!.workspace.getView(), {
      // TODO(phase-04): Replace this hardcoded fallback once workspace mock state is unified
      // with the sessions page and global/session navigation flows.
      workspaceViewMode: "session",
      focusedSessionId: "default-session",
      preferences: {
        id: 1,
        globalIncludeArchived: false,
        defaultSearchProviderId: null,
        capitalAllocationMode: "per_session_only",
        globalCapitalPoolUsd: null,
        updatedAt: new Date().toISOString(),
      },
    }),
  patchWorkspacePreferences: (patch: Partial<Omit<WorkspacePreferences, "id">>) =>
    call<WorkspacePreferences>(() => window.exva!.workspace.patchPreferences(patch), {
      id: 1,
      globalIncludeArchived: patch.globalIncludeArchived ?? false,
      defaultSearchProviderId: patch.defaultSearchProviderId ?? null,
      capitalAllocationMode: patch.capitalAllocationMode ?? "per_session_only",
      globalCapitalPoolUsd: patch.globalCapitalPoolUsd ?? null,
      updatedAt: new Date().toISOString(),
    }),

  listTemplates: (filters?: { search?: string; instrumentClass?: InstrumentClass }) =>
    call<{ templates: Array<{ id: string; name: string; description: string | null; sourceSessionId: string | null; sourceSessionName: string | null; instrumentClasses: InstrumentClass[]; updatedAt: string }> }>(
      () => window.exva!.templates.list(filters),
      { templates: [] },
    ),
  createTemplate: (input: { name: string; description?: string; sourceSessionId?: string; payload: SessionTemplatePayload }) =>
    call<{ id: string; updatedAt: string }>(() => window.exva!.templates.create(input), {
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    }),
  deleteTemplate: (id: string) => call<{ deleted: true }>(() => window.exva!.templates.delete(id), { deleted: true }),
  useTemplate: (id: string) =>
    call<{ payload: SessionTemplatePayload; clearedFields: string[] }>(() => window.exva!.templates.use(id), {
      // TODO(phase-04/phase-05): Replace this placeholder template payload fallback with
      // mock data sourced from full session-family state.
      payload: {
        version: 1,
        identity: {
          objective: "",
          selectionMode: "manual_shortlist",
          instrumentClasses: ["stock"],
          instrumentScope: "",
          executionMode: "paper_only",
          capitalLimitUsd: 10000,
          defaultSearchProviderId: null,
        },
        selectorSettings: { aiPickerEnabled: true },
        strategy: {
          strategyProfile: "passive_income",
          maxPositionUsd: 500,
          stopLossPct: 2,
          takeProfitPct: 4,
          maxConcurrentTrades: 3,
          researchDepth: "balanced",
          dailyLossLimitUsd: 200,
          profitTargetUsd: 1000,
          maxAiSpendUsd: 5,
          humanApprovalRequired: false,
        },
        aiRoles: [],
        brokerAssignments: [{ brokerAccountId: "default-broker" }],
        brokerOverridesByInstrumentClass: {},
      },
      clearedFields: [],
    }),

  getStrategyConfig: () =>
    call<SessionConfig>(() => window.exva!.config.getStrategy(), MOCK.config),
  saveStrategyConfig: (cfg: SessionConfig) =>
    call<void>(() => window.exva!.config.saveStrategy(cfg), undefined as void),

  addBrokerAccount: (creds: BrokerCredentials) =>
    call<ConnectionTestResult>(() => window.exva!.accounts.saveBroker(creds), {
      ok: true,
      message: "Mock broker connected",
      account_balance: 100000,
    }),
  testBrokerConnection: () =>
    call<ConnectionTestResult>(() => window.exva!.accounts.testBroker(), {
      ok: true,
      message: "Mock broker connected",
    }),
  removeBrokerAccount: () =>
    call<void>(() => window.exva!.accounts.removeBroker(), undefined as void),
  saveApiKey: (keyType: string, value: string) =>
    call<void>(() => window.exva!.accounts.saveApiKey(keyType, value), undefined as void),

  getEvents: (filters?: {
    minLevel?: string;
    agentType?: AgentRole;
    search?: string;
    limit?: number;
  }) => call<EventRow[]>(() => window.exva!.events.list(filters), MOCK.events),
  getAgentTraces: (tradeId: string) =>
    call<AgentRun[]>(
      () => window.exva!.events.getAgentTraces(tradeId),
      MOCK.runs.filter((run) => run.trade_id === tradeId),
    ),
};

export type ExvaEventName =
  | "trade_opened"
  | "trade_closed"
  | "agent_event"
  | "approval_required"
  | "approval_resolved"
  | "session_started"
  | "session_stopped"
  | "session_status_changed"
  | "trade_status_changed"
  | "selector_run_completed"
  | "stats_update"
  | "notification";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: { approvalId: string; status: "approved" | "rejected" };
  session_started: {};
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export async function listenEvent<K extends ExvaEventName>(
  name: K,
  handler: (payload: ExvaEventMap[K]) => void,
): Promise<() => void> {
  if (showMock) return () => {};
  if (!hasExva) throw bridgeUnavailableError();
  return window.exva!.events.subscribe(name, handler);
}

export { hasExva, showMock };
