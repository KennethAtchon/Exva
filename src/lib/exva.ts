import type {
  AgentMessage,
  AgentRole,
  ApiCallLogEntry,
  AgentRun,
  ApprovalSummary,
  BrokerAccount,
  BrokerCredentials,
  BrokerRoutingDefault,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  ExecutionMode,
  EventRow,
  InstrumentClass,
  ProviderAccount,
  SelectionMode,
  SessionAiRole,
  SessionRiskConfig,
  SessionSelectorSettings,
  SessionTradeRules,
  SessionStrategy,
  SessionStatus,
  SessionTemplatePayload,
  SessionTimeframeConfig,
  SessionAiRoleProfile,
  SessionResearchPosture,
  Trade,
  TradeAutopsy,
  TradeDecisionPayload,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "./types";

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
  researchPosture: SessionResearchPosture;
  aiRoleProfiles: SessionAiRoleProfile[];
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiRoles: SessionAiRole[];
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
}

export interface UserGlobalPresetRow {
  id: string;
  name: string;
  createdAt: number;
  presetJson: string;
}

export interface ProviderModelEntry {
  id: string;
  label: string;
  maxContextTokens: number;
}

const hasExva =
  typeof window !== "undefined" &&
  typeof window.exva === "object" &&
  window.exva !== null;

function bridge() {
  if (!hasExva) {
    throw new Error(
      "EXVA bridge unavailable. Run `bun run dev` / `bun run start` (Electron host) instead of the renderer-only dev server.",
    );
  }
  const exva = window.exva;
  if (!exva) {
    throw new Error("EXVA bridge unavailable.");
  }
  return exva;
}

export const api = {
  getDashboardStats: (): Promise<DashboardStats> => bridge().dashboard.getStats(),
  getCostBreakdown: (dateRange?: string): Promise<CostBreakdown> =>
    bridge().dashboard.getCostBreakdown(dateRange ?? "today"),

  listApprovals: (filters?: { status?: "pending" | "approved" | "rejected" }): Promise<{
    workspaceViewMode: WorkspaceViewMode;
    approvals: ApprovalSummary[];
  }> => bridge().approvals.list(filters),
  decideApproval: (input: {
    id: string;
    decision: "approved" | "rejected";
    decisionNote?: string;
  }): Promise<{ status: "approved" | "rejected"; resolvedAt: string }> => bridge().approvals.decide(input),

  getActiveTrades: (filters?: {
    sessionId?: string;
    brokerAccountId?: string;
    symbolContains?: string;
    instrumentType?: InstrumentClass;
    executionMode?: ExecutionMode;
  }): Promise<Trade[]> => bridge().trades.listActive(filters),
  getTradeDetail: (tradeId: string): Promise<TradeDetail> => bridge().trades.getDetail(tradeId),
  forceCloseTrade: (tradeId: string): Promise<void> => bridge().trades.forceClose(tradeId),
  summarizeTradeAutopsy: (tradeId: string): Promise<TradeAutopsy> => bridge().trades.summarizeAutopsy(tradeId),
  listTradeAutopsies: (tradeId: string): Promise<TradeAutopsy[]> => bridge().trades.listAutopsies(tradeId),
  approveTrade: async (tradeId: string, approved: boolean): Promise<void> => {
    await bridge().trades.approve(tradeId, approved);
  },

  startSession: (): Promise<SessionStatus> => bridge().session.start(),
  pauseSession: (): Promise<SessionStatus> => bridge().session.pause(),
  resumeSession: (): Promise<SessionStatus> => bridge().session.resume(),
  stopSession: (): Promise<SessionStatus> => bridge().session.stop(),
  listSessions: (filters?: {
    status?: SessionStatus;
    instrumentClass?: InstrumentClass;
    search?: string;
    includeArchived?: boolean;
  }): Promise<{ workspaceViewMode: WorkspaceViewMode; focusedSessionId: string | null; sessions: SessionSummary[] }> =>
    bridge().session.list(filters),
  createSession: (input: SessionCreateInput) => bridge().session.create(input),
  updateSession: (id: string, input: SessionCreateInput) => bridge().session.update(id, input),
  focusSession: (id: string) => bridge().session.focus(id),
  goGlobal: () => bridge().session.goGlobal(),
  archiveSession: (id: string) => bridge().session.archive(id),
  duplicateSession: (sourceId: string, name: string) => bridge().session.duplicate(sourceId, name),
  getSessionInstrumentCache: (sessionId: string) => bridge().session.instrumentCacheGet(sessionId),
  clearSessionInstrumentCache: (sessionId: string) => bridge().session.instrumentCacheClear(sessionId),

  getWorkspaceView: (): Promise<WorkspaceViewResponse> => bridge().workspace.getView(),
  patchWorkspacePreferences: (patch: Partial<Omit<WorkspacePreferences, "id">>) =>
    bridge().workspace.patchPreferences(patch),

  listTemplates: (filters?: { search?: string; instrumentClass?: InstrumentClass }) =>
    bridge().templates.list(filters),
  createTemplate: (input: { name: string; description?: string; sourceSessionId?: string; payload: SessionTemplatePayload }) =>
    bridge().templates.create(input),
  deleteTemplate: (id: string) => bridge().templates.delete(id),
  useTemplate: (id: string) => bridge().templates.use(id),
  buildTemplatePayloadFromSession: (sessionId: string): Promise<SessionTemplatePayload> =>
    bridge().templates.buildPayloadFromSession(sessionId),

  getStrategy: (sessionId: string): Promise<StrategyGetResponse> => bridge().strategy.get(sessionId),
  getStrategyResearchPosture: (sessionId: string): Promise<SessionResearchPosture> =>
    bridge().strategy.getResearchPosture(sessionId),
  saveStrategyResearchPosture: (input: { sessionId: string; researchPosture: Partial<SessionResearchPosture> }) =>
    bridge().strategy.saveResearchPosture(input),
  getTradeRules: (sessionId: string): Promise<SessionTradeRules> => bridge().strategy.getRules(sessionId),
  saveTradeRules: (input: { sessionId: string; rules: Partial<SessionTradeRules> }) =>
    bridge().strategy.saveRules(input),
  getStrategyRiskConfig: (sessionId: string): Promise<SessionRiskConfig> => bridge().strategy.getRiskConfig(sessionId),
  saveStrategyRiskConfig: (input: { sessionId: string; riskConfig: Partial<SessionRiskConfig> }) =>
    bridge().strategy.saveRiskConfig(input),
  getStrategyTimeframeConfig: (sessionId: string): Promise<SessionTimeframeConfig> =>
    bridge().strategy.getTimeframeConfig(sessionId),
  saveStrategyTimeframeConfig: (input: { sessionId: string; timeframe: Partial<SessionTimeframeConfig> }) =>
    bridge().strategy.saveTimeframeConfig(input),
  saveStrategyAiRoles: (input: { sessionId: string; aiRoles: SessionAiRole[] }) => bridge().strategy.saveAiRoles(input),
  saveStrategyAiRoleProfiles: (input: {
    sessionId: string;
    aiRoleProfiles: Array<{
      role: AgentRole;
      profileJson?: SessionAiRoleProfile["profileJson"];
    }>;
  }) => bridge().strategy.saveAiRoleProfiles(input),
  getStrategyProviderModels: (providerKey: string): Promise<{ models: ProviderModelEntry[] }> =>
    bridge().strategy.getProviderModels(providerKey),
  resetStrategyPrompt: (role: AgentRole) => bridge().strategy.resetPrompt(role),

  listGlobalPresets: (): Promise<{ presets: UserGlobalPresetRow[] }> => bridge().strategy.globalPresets.list(),
  createGlobalPreset: (input: { name: string; preset: Record<string, unknown> }): Promise<UserGlobalPresetRow> =>
    bridge().strategy.globalPresets.create(input),
  updateGlobalPreset: (input: { id: string; name: string; preset: Record<string, unknown> }): Promise<{ ok: true }> =>
    bridge().strategy.globalPresets.update(input),
  deleteGlobalPreset: (input: { id: string }): Promise<{ ok: true }> =>
    bridge().strategy.globalPresets.delete(input),
  getWorkspaceDefaultModel: (): Promise<{ providerKey: string; modelId: string }> =>
    bridge().strategy.getWorkspaceDefaultModel(),
  saveWorkspaceDefaultModel: (input: { providerKey: string; modelId: string }): Promise<{ savedAt: string }> =>
    bridge().strategy.saveWorkspaceDefaultModel(input),

  getStrategyConfig: (): Promise<SessionStrategy> => bridge().config.getStrategy(),
  saveStrategyConfig: (cfg: SessionStrategy): Promise<void> => bridge().config.saveStrategy(cfg),

  addBrokerAccount: (creds: BrokerCredentials): Promise<ConnectionTestResult> =>
    bridge().accounts.saveBroker(creds),
  testBrokerConnection: (): Promise<ConnectionTestResult> => bridge().accounts.testBroker(),
  removeBrokerAccount: (): Promise<void> => bridge().accounts.removeBroker(),
  saveApiKey: (keyType: string, value: string): Promise<void> =>
    bridge().accounts.saveApiKey(keyType, value),
  listProviders: (): Promise<{ providers: ProviderAccount[] }> => bridge().accounts.listProviders(),
  saveProvider: (input: {
    id?: string;
    name: string;
    category: "ai" | "search";
    providerType: ProviderAccount["providerType"];
    apiKey: string;
    metadata?: { baseUrl?: string };
  }): Promise<{ id: string; isConfigured: boolean }> => bridge().accounts.saveProvider(input),
  deleteProvider: (id: string): Promise<{ ok: true }> => bridge().accounts.deleteProvider({ id }),
  testProvider: (id: string): Promise<{ ok: boolean; error?: string }> => bridge().accounts.testProvider({ id }),

  listBrokerAccounts: (): Promise<{ brokers: BrokerAccount[] }> => bridge().accounts.listBrokers(),
  registerBrokerAccount: (input: {
    id?: string;
      brokerType: "alpaca" | "coinbase_advanced_trade" | "tradovate" | "polymarket" | "mock";
    name: string;
    mode: "paper" | "live";
    credentials: Record<string, string>;
  }) => bridge().accounts.addBroker(input),
  deleteBrokerAccount: (id: string) => bridge().accounts.removeBrokerAccount({ id }),
  testSavedBrokerAccount: (id: string): Promise<ConnectionTestResult> =>
    bridge().accounts.testBrokerAccount({ id }),
  testBrokerCredentials: (input: {
      brokerType: "alpaca" | "coinbase_advanced_trade" | "tradovate" | "polymarket" | "mock";
    mode: "paper" | "live";
    credentials: Record<string, string>;
  }): Promise<ConnectionTestResult> => bridge().accounts.testBrokerEphemeral(input),
  getBrokerRoutingDefaults: (): Promise<{ routing: BrokerRoutingDefault[] }> => bridge().accounts.routingGet(),
  saveBrokerRoutingDefaults: (routing: BrokerRoutingDefault[]) =>
    bridge().accounts.routingUpdate({ routing }),

  getEvents: (filters?: {
    minLevel?: string;
    agentType?: AgentRole;
    search?: string;
    limit?: number;
    sessionId?: string;
  }): Promise<EventRow[]> => bridge().events.list(filters),
  getAgentTraces: (tradeId: string): Promise<AgentRun[]> => bridge().events.getAgentTraces(tradeId),
  getAgentTracesByCycle: (cycleId: string): Promise<AgentRun[]> => bridge().events.getAgentTracesByCycle(cycleId),
  getMessagesByCycle: (cycleId: string): Promise<AgentMessage[]> => bridge().events.getMessagesByCycle(cycleId),
  getApiCallLog: (filters: { sessionId: string; cycleId?: string | null; tradeId?: string | null }): Promise<ApiCallLogEntry[]> =>
    bridge().events.getApiCallLog(filters),
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
  | "research_phase_started"
  | "research_phase_step"
  | "research_phase_complete"
  | "research_phase_failed"
  | "stats_update"
  | "notification";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: { approvalId: string; tradeId: string; status: "approved" | "rejected" };
  session_started: Record<string, never>;
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  research_phase_started: { sessionId: string; phase: string; cycleId: string };
  research_phase_step: { sessionId: string; phase: string; message: string; cycleId: string };
  research_phase_complete: { sessionId: string; phase: string; cycleId: string; instrumentCount: number };
  research_phase_failed: { sessionId: string; phase: string; cycleId: string; error: string };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export async function listenEvent<K extends ExvaEventName>(
  name: K,
  handler: (payload: ExvaEventMap[K]) => void,
): Promise<() => void> {
  return bridge().events.subscribe(name, handler);
}

export { hasExva };
export const showMock = false;
