import type {
  AgentRole,
  AgentRun,
  ApprovalSummary,
  BrokerCredentials,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  ExecutionMode,
  EventRow,
  InstrumentClass,
  ProviderAccount,
  SelectionMode,
  SessionAiRole,
  SessionStatus,
  SessionStrategy,
  SessionSelectorSettings,
  SessionTemplatePayload,
  Trade,
  TradeDecisionPayload,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "@/lib/types";

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
  uptimeMin: number;
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

export interface StrategyGetResponse {
  strategy: SessionStrategy;
  aiRoles: SessionAiRole[];
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
}

export interface ProviderModelEntry {
  id: string;
  label: string;
  maxContextTokens: number;
}

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: { approvalId: string; tradeId: string; status: "approved" | "rejected" };
  session_started: {};
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export interface ExvaApi {
  dashboard: {
    getStats(): Promise<DashboardStats>;
    getCostBreakdown(dateRange?: string): Promise<CostBreakdown>;
  };
  approvals: {
    list(filters?: { status?: "pending" | "approved" | "rejected" }): Promise<{
      workspaceViewMode: WorkspaceViewMode;
      approvals: ApprovalSummary[];
    }>;
    decide(input: {
      id: string;
      decision: "approved" | "rejected";
      decisionNote?: string;
    }): Promise<{ status: "approved" | "rejected"; resolvedAt: string }>;
  };
  trades: {
    listActive(filters?: {
      sessionId?: string;
      brokerAccountId?: string;
      symbolContains?: string;
      instrumentType?: InstrumentClass;
      executionMode?: ExecutionMode;
    }): Promise<Trade[]>;
    getDetail(tradeId: string): Promise<TradeDetail>;
    forceClose(tradeId: string): Promise<void>;
    approve(tradeId: string, approved: boolean): Promise<void>;
  };
  session: {
    start(): Promise<SessionStatus>;
    pause(): Promise<SessionStatus>;
    resume(): Promise<SessionStatus>;
    stop(): Promise<SessionStatus>;
    getStatus(): Promise<SessionStatus>;
    list(filters?: {
      status?: SessionStatus;
      instrumentClass?: InstrumentClass;
      search?: string;
      includeArchived?: boolean;
    }): Promise<{ workspaceViewMode: WorkspaceViewMode; focusedSessionId: string | null; sessions: SessionSummary[] }>;
    create(input: SessionCreateInput): Promise<{ id: string; status: "draft" }>;
    update(id: string, input: SessionCreateInput): Promise<{ savedAt: string }>;
    focus(id: string): Promise<{ workspaceViewMode: "session"; focusedSessionId: string }>;
    goGlobal(): Promise<{ workspaceViewMode: "global"; focusedSessionId: null }>;
    archive(id: string): Promise<{ archived: true }>;
    duplicate(sourceId: string, name: string): Promise<{ id: string; status: "draft" }>;
  };
  workspace: {
    getView(): Promise<WorkspaceViewResponse>;
    patchPreferences(patch: Partial<Omit<WorkspacePreferences, "id">>): Promise<WorkspacePreferences>;
  };
  templates: {
    list(filters?: { search?: string; instrumentClass?: InstrumentClass }): Promise<{
      templates: Array<{
        id: string;
        name: string;
        description: string | null;
        sourceSessionId: string | null;
        sourceSessionName: string | null;
        instrumentClasses: InstrumentClass[];
        updatedAt: string;
      }>;
    }>;
    create(input: {
      name: string;
      description?: string;
      sourceSessionId?: string;
      payload: SessionTemplatePayload;
    }): Promise<{ id: string; updatedAt: string }>;
    delete(id: string): Promise<{ deleted: true }>;
    use(id: string): Promise<{ payload: SessionTemplatePayload; clearedFields: string[] }>;
    buildPayloadFromSession(sessionId: string): Promise<SessionTemplatePayload>;
  };
  strategy: {
    get(sessionId: string): Promise<StrategyGetResponse>;
    save(input: { sessionId: string; strategy: Partial<SessionStrategy>; aiRoles: SessionAiRole[] }): Promise<{ savedAt: string }>;
    getProviderModels(providerKey: string): Promise<{ models: ProviderModelEntry[] }>;
    resetPrompt(role: AgentRole): Promise<{ promptMarkdown: string; promptAssetPath: string }>;
  };
  config: {
    getStrategy(): Promise<SessionStrategy>;
    saveStrategy(config: SessionStrategy): Promise<void>;
  };
  accounts: {
    saveBroker(credentials: BrokerCredentials): Promise<ConnectionTestResult>;
    testBroker(): Promise<ConnectionTestResult>;
    removeBroker(): Promise<void>;
    saveApiKey(keyType: string, value: string): Promise<void>;
  };
  events: {
    list(filters?: {
      minLevel?: string;
      agentType?: AgentRole;
      search?: string;
      limit?: number;
      sessionId?: string;
    }): Promise<EventRow[]>;
    getAgentTraces(tradeId: string): Promise<AgentRun[]>;
    subscribe<K extends ExvaEventName>(name: K, handler: (payload: ExvaEventMap[K]) => void): () => void;
  };
}
