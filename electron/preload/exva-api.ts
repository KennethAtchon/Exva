import type {
  AgentMessage,
  AgentRole,
  ApiCallLogEntry,
  AgentRun,
  ApprovalSummary,
  BrokerAccount,
  BrokerAccountWithState,
  BrokerCredentials,
  BrokerRoutingDefault,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  ExecutionStage,
  ExecutionStepStatus,
  ExecutionMode,
  EventRow,
  InstrumentClass,
  ProviderAccount,
  SelectionMode,
  SessionRiskConfig,
  SessionStatus,
  SessionStrategy,
  SessionTradeRules,
  SessionSelectorSettings,
  SessionTemplatePayload,
  SessionTimeframeConfig,
  SessionResearchPosture,
  Trade,
  TradeAutopsy,
  TradeDecisionPayload,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "@/lib/types";
import type {
  ExvaEventMap,
  ExvaEventName,
  ProviderModelEntry,
  SessionCreateInput,
  SessionExecutionProgressResponse,
  SessionSummary,
  StrategyGetResponse,
  UserGlobalPresetRow,
  WorkspaceViewResponse,
} from "@electron/shared/ipc/dto";

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
    summarizeAutopsy(tradeId: string): Promise<TradeAutopsy>;
    listAutopsies(tradeId: string): Promise<TradeAutopsy[]>;
  };
  session: {
    start(): Promise<SessionStatus>;
    pause(): Promise<SessionStatus>;
    resume(): Promise<SessionStatus>;
    stop(): Promise<SessionStatus>;
    getStatus(): Promise<SessionStatus>;
    getExecutionProgress(sessionId: string): Promise<SessionExecutionProgressResponse>;
    retryStep(input: { sessionId: string; cycleId: string; stage: ExecutionStage }): Promise<{ ok: true } | { ok: false; reason: string }>;
    pauseAfterCurrentStep(sessionId: string): Promise<{ ok: true }>;
    clearFailedStep(input: { sessionId: string; cycleId: string; stage: ExecutionStage }): Promise<{ ok: true } | { ok: false; reason: string }>;
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
    instrumentCacheGet(sessionId: string): Promise<{
      instruments: Array<{ symbol: string; instrumentClass: InstrumentClass }> | null;
      selectedAt: string | null;
      definitionHashMatches: boolean;
    }>;
    instrumentCacheClear(sessionId: string): Promise<{ cleared: true }>;
    getLiveReadiness(sessionId: string): Promise<{
      readyToStart: boolean;
      allChecksPassed: boolean;
      checks: Array<{ name: string; passed: boolean; requiresAck?: boolean; message?: string }>;
      acknowledgedAt: string | null;
    }>;
    acknowledgeLiveReadiness(sessionId: string): Promise<{ acknowledgedAt: string }>;
    testLiveBrokerConnection(sessionId: string): Promise<{ ok: boolean; message: string }>;
  };
  workspace: {
    getView(): Promise<WorkspaceViewResponse>;
    patchPreferences(patch: Partial<Omit<WorkspacePreferences, "id">>): Promise<WorkspacePreferences>;
  };
  brokerAccounts: {
    list(): Promise<BrokerAccountWithState[]>;
    refreshBalance(brokerAccountId: string): Promise<{ balanceUsd: number; cachedAt: string }>;
    updateSettings(input: {
      brokerAccountId: string;
      maxSessions?: number;
      allocationEnforcement?: "hard" | "warn";
      balanceRefreshIntervalMin?: number;
    }): Promise<{ ok: true }>;
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
    getResearchPosture(sessionId: string): Promise<SessionResearchPosture>;
    saveResearchPosture(input: { sessionId: string; researchPosture: Partial<SessionResearchPosture> }): Promise<{ savedAt: string }>;
    getRules(sessionId: string): Promise<SessionTradeRules>;
    saveRules(input: { sessionId: string; rules: Partial<SessionTradeRules> }): Promise<{ savedAt: string }>;
    getRiskConfig(sessionId: string): Promise<SessionRiskConfig>;
    saveRiskConfig(input: { sessionId: string; riskConfig: Partial<SessionRiskConfig> }): Promise<{ savedAt: string }>;
    getTimeframeConfig(sessionId: string): Promise<SessionTimeframeConfig>;
    saveTimeframeConfig(input: { sessionId: string; timeframe: Partial<SessionTimeframeConfig> }): Promise<{ savedAt: string }>;
    saveAiPhase(input: {
      sessionId: string;
      phase: import("@electron/shared/ai/pipeline-phase").PipelinePhase;
      providerKey?: string;
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
      promptSource?: "default" | "session_override";
      promptMarkdown?: string;
    }): Promise<{ savedAt: string }>;
    saveAiPhaseWorker(input: {
      sessionId: string;
      phase: import("@electron/shared/ai/pipeline-phase").PipelinePhase;
      workerId: string;
      providerKey?: string | null;
      modelId?: string | null;
      maxSteps?: number | null;
      spendLimitUsd?: number | null;
      promptMarkdown?: string | null;
    }): Promise<{ savedAt: string }>;
    getProviderModels(providerKey: string): Promise<{ models: ProviderModelEntry[] }>;
    globalPresets: {
      list(): Promise<{ presets: UserGlobalPresetRow[] }>;
      create(input: { name: string; preset: Record<string, unknown> }): Promise<UserGlobalPresetRow>;
      update(input: { id: string; name: string; preset: Record<string, unknown> }): Promise<{ ok: true }>;
      delete(input: { id: string }): Promise<{ ok: true }>;
    };
    getWorkspaceDefaultModel(): Promise<{ providerKey: string; modelId: string }>;
    saveWorkspaceDefaultModel(input: { providerKey: string; modelId: string }): Promise<{ savedAt: string }>;
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
    listProviders(): Promise<{ providers: ProviderAccount[] }>;
    saveProvider(input: {
      id?: string;
      name: string;
      category: "ai" | "search";
      providerType: ProviderAccount["providerType"];
      apiKey: string;
      metadata?: { baseUrl?: string };
    }): Promise<{ id: string; isConfigured: boolean }>;
    deleteProvider(input: { id: string }): Promise<{ ok: true }>;
    testProvider(input: { id: string }): Promise<{ ok: boolean; error?: string }>;
    listBrokers(): Promise<{ brokers: BrokerAccount[] }>;
    addBroker(input: {
      id?: string;
        brokerType: "alpaca" | "coinbase_advanced_trade" | "tradovate" | "polymarket" | "mock";
      name: string;
      mode: "paper" | "live";
      credentials: Record<string, string>;
    }): Promise<
      | { ok: true; id: string; supportedInstrumentClasses: InstrumentClass[] }
      | { ok: false; id: string; message: string; supportedInstrumentClasses: InstrumentClass[] }
    >;
    removeBrokerAccount(input: { id: string }): Promise<{ ok: true }>;
    testBrokerAccount(input: { id: string }): Promise<ConnectionTestResult>;
    testBrokerEphemeral(input: {
      brokerType: "alpaca" | "coinbase_advanced_trade" | "tradovate" | "polymarket" | "mock";
      mode: "paper" | "live";
      credentials: Record<string, string>;
    }): Promise<ConnectionTestResult>;
    routingGet(): Promise<{ routing: BrokerRoutingDefault[] }>;
    routingUpdate(input: {
      routing: Array<{ instrumentClass: InstrumentClass; defaultBrokerAccountId: string }>;
    }): Promise<{ savedAt: string }>;
  };
  developer: {
    getSettings(): Promise<{
      settings: {
        defaultEventMinLevel: string;
        defaultTimeWindowMinutes: number;
        defaultSourceFilters: string[];
        includePromptsInExports: boolean;
        includeToolPayloadsInExports: boolean;
      };
      effectiveLogLevel: string;
      activeOverrides: Array<{
        id: string;
        scopeType: string;
        scopeId: string | null;
        mainLogLevel: string;
        eventMinLevel: string;
        expiresAt: string | null;
        createdAt: string;
      }>;
      logDirectory: string;
    }>;
    updateSettings(patch: {
      defaultEventMinLevel?: string;
      defaultTimeWindowMinutes?: number;
      defaultSourceFilters?: string[];
      includePromptsInExports?: boolean;
      includeToolPayloadsInExports?: boolean;
    }): Promise<{ settings: unknown }>;
    setLogLevel(input: {
      scopeType: string;
      scopeId?: string;
      mainLogLevel: string;
      eventMinLevel: string;
      durationMinutes?: number;
      untilStopped?: boolean;
    }): Promise<{ overrideId: string; effectiveLogLevel: string; expiresAt: string | null }>;
    stopLogOverride(input: { overrideId: string }): Promise<{ stopped: true; effectiveLogLevel: string }>;
    getScopeDiagnostics(input: { scope: { type: string; id?: string } }): Promise<unknown>;
    exportDebugBundle(input: {
      scope: { type: string; id?: string };
      includePrompts: boolean;
      includeToolPayloads: boolean;
      timeWindowMinutes: number;
    }): Promise<{
      path: string;
      sizeBytes: number;
      includedSections: string[];
      redactionCount: number;
      warnings: string[];
    }>;
    openPath(input: { kind: string; path?: string }): Promise<{ opened: true }>;
    listEventsV2(input: {
      scope?: { type: string; id?: string };
      minLevel?: string;
      sourceTypes?: string[];
      search?: string;
      timeWindowMinutes?: number;
      cursor?: string | null;
      limit: number;
    }): Promise<{ events: EventRow[]; nextCursor: string | null; queryMs: number }>;
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
    getAgentTracesByCycle(cycleId: string): Promise<AgentRun[]>;
    getMessagesByCycle(cycleId: string): Promise<AgentMessage[]>;
    getApiCallLog(filters: { sessionId: string; cycleId?: string | null; tradeId?: string | null }): Promise<ApiCallLogEntry[]>;
    subscribe<K extends ExvaEventName>(name: K, handler: (payload: ExvaEventMap[K]) => void): () => void;
  };
}
