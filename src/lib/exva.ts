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
  ExecutionMode,
  EventRow,
  InstrumentClass,
  ProviderAccount,
  SessionRiskConfig,
  SessionTradeRules,
  SessionStrategy,
  SessionStatus,
  SessionTemplatePayload,
  SessionTimeframeConfig,
  SessionResearchPosture,
  SessionAiSettings,
  Trade,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "./types";
import type { AIPhaseTrace } from "@electron/shared/ai/ai-phase-trace";
import type { PhaseRuntimeSummary } from "@electron/shared/ai/ai-phase";
import type {
  ExperienceSummary,
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
import type {
  AddLessonInput,
  AutopsyLesson,
  ExportFormat,
  ExportResult,
  PeriodAutopsyAddLessonInput,
  PeriodAutopsyLessonsListInput,
  PeriodAutopsyListInput,
  PeriodAutopsyPreview,
  PeriodAutopsyPromoteLessonInput,
  PeriodAutopsyRecord,
  PeriodAutopsyRunInput,
  TradeAutopsyRecord,
  UpdateLessonInput,
} from "@electron/shared/domain/autopsy";
import type {
  SessionSignalDelivery,
  SignalSourceRecord,
} from "@electron/shared/domain";

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
  getDashboardStats: (): Promise<DashboardStats> =>
    bridge().dashboard.getStats(),
  getCostBreakdown: (dateRange?: string): Promise<CostBreakdown> =>
    bridge().dashboard.getCostBreakdown(dateRange ?? "today"),

  listApprovals: (filters?: {
    status?: "pending" | "approved" | "rejected";
  }): Promise<{
    workspaceViewMode: WorkspaceViewMode;
    approvals: ApprovalSummary[];
  }> => bridge().approvals.list(filters),
  decideApproval: (input: {
    id: string;
    decision: "approved" | "rejected";
    decisionNote?: string;
  }): Promise<{ status: "approved" | "rejected"; resolvedAt: string }> =>
    bridge().approvals.decide(input),

  getActiveTrades: (filters?: {
    sessionId?: string;
    brokerAccountId?: string;
    symbolContains?: string;
    instrumentType?: InstrumentClass;
    executionMode?: ExecutionMode;
    includeAllEnvironments?: boolean;
  }): Promise<Trade[]> => bridge().trades.listActive(filters),
  getTradeDetail: (tradeId: string): Promise<TradeDetail> =>
    bridge().trades.getDetail(tradeId),
  forceCloseTrade: (tradeId: string): Promise<void> =>
    bridge().trades.forceClose(tradeId),
  approveTrade: async (tradeId: string, approved: boolean): Promise<void> => {
    await bridge().trades.approve(tradeId, approved);
  },

  startSession: (): Promise<SessionStatus> => bridge().session.start(),
  pauseSession: (): Promise<SessionStatus> => bridge().session.pause(),
  resumeSession: (): Promise<SessionStatus> => bridge().session.resume(),
  stopSession: (): Promise<SessionStatus> => bridge().session.stop(),
  forceStopSession: (): Promise<SessionStatus> => bridge().session.forceStop(),
  getSessionExecutionProgress: (
    sessionId: string,
  ): Promise<SessionExecutionProgressResponse> =>
    bridge().session.getExecutionProgress(sessionId),
  retrySessionStep: (input: {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
  }) => bridge().session.retryStep(input),
  pauseSessionAfterCurrentStep: (sessionId: string): Promise<{ ok: true }> =>
    bridge().session.pauseAfterCurrentStep(sessionId),
  clearFailedSessionStep: (input: {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
  }) => bridge().session.clearFailedStep(input),
  listSessions: (filters?: {
    status?: SessionStatus;
    instrumentClass?: InstrumentClass;
    search?: string;
    includeArchived?: boolean;
    executionMode?: ExecutionMode;
    includeAllEnvironments?: boolean;
  }): Promise<{
    workspaceViewMode: WorkspaceViewMode;
    focusedSessionId: string | null;
    sessions: SessionSummary[];
  }> => bridge().session.list(filters),
  listExperiences: (): Promise<ExperienceSummary[]> =>
    bridge().experiences.list(),
  createSession: (input: SessionCreateInput) => bridge().session.create(input),
  updateSession: (id: string, input: SessionCreateInput) =>
    bridge().session.update(id, input),
  focusSession: (id: string) => bridge().session.focus(id),
  goGlobal: () => bridge().session.goGlobal(),
  archiveSession: (id: string) => bridge().session.archive(id),
  duplicateSession: (sourceId: string, name: string) =>
    bridge().session.duplicate(sourceId, name),
  getSessionInstrumentCache: (sessionId: string) =>
    bridge().session.instrumentCacheGet(sessionId),
  clearSessionInstrumentCache: (sessionId: string) =>
    bridge().session.instrumentCacheClear(sessionId),

  getWorkspaceView: (): Promise<WorkspaceViewResponse> =>
    bridge().workspace.getView(),
  patchWorkspacePreferences: (
    patch: Partial<Omit<WorkspacePreferences, "id">>,
  ) => bridge().workspace.patchPreferences(patch),

  listBrokerAccountState: (): Promise<BrokerAccountWithState[]> =>
    bridge().brokerAccounts.list(),
  refreshBrokerBalance: (
    brokerAccountId: string,
  ): Promise<{ balanceUsd: number; cachedAt: string }> =>
    bridge().brokerAccounts.refreshBalance(brokerAccountId),
  updateBrokerAccountSettings: (input: {
    brokerAccountId: string;
    maxSessions?: number;
    allocationEnforcement?: "hard" | "warn";
    balanceRefreshIntervalMin?: number;
    mockScenarioKind?:
      | import("@electron/shared/domain/mock-scenario").MockScenarioKind
      | null;
  }) => bridge().brokerAccounts.updateSettings(input),

  listTemplates: (filters?: {
    search?: string;
    instrumentClass?: InstrumentClass;
  }) => bridge().templates.list(filters),
  createTemplate: (input: {
    name: string;
    description?: string;
    sourceSessionId?: string;
    payload: SessionTemplatePayload;
  }) => bridge().templates.create(input),
  deleteTemplate: (id: string) => bridge().templates.delete(id),
  useTemplate: (id: string) => bridge().templates.use(id),
  buildTemplatePayloadFromSession: (
    sessionId: string,
  ): Promise<SessionTemplatePayload> =>
    bridge().templates.buildPayloadFromSession(sessionId),

  getStrategy: (sessionId: string): Promise<StrategyGetResponse> =>
    bridge().strategy.get(sessionId),
  getStrategyResearchPosture: (
    sessionId: string,
  ): Promise<SessionResearchPosture> =>
    bridge().strategy.getResearchPosture(sessionId),
  saveStrategyResearchPosture: (input: {
    sessionId: string;
    researchPosture: Partial<SessionResearchPosture>;
  }) => bridge().strategy.saveResearchPosture(input),
  getTradeRules: (sessionId: string): Promise<SessionTradeRules> =>
    bridge().strategy.getRules(sessionId),
  saveTradeRules: (input: {
    sessionId: string;
    rules: Partial<SessionTradeRules>;
  }) => bridge().strategy.saveRules(input),
  getStrategyRiskConfig: (sessionId: string): Promise<SessionRiskConfig> =>
    bridge().strategy.getRiskConfig(sessionId),
  saveStrategyRiskConfig: (input: {
    sessionId: string;
    riskConfig: Partial<SessionRiskConfig>;
  }) => bridge().strategy.saveRiskConfig(input),
  getStrategyTimeframeConfig: (
    sessionId: string,
  ): Promise<SessionTimeframeConfig> =>
    bridge().strategy.getTimeframeConfig(sessionId),
  saveStrategyTimeframeConfig: (input: {
    sessionId: string;
    timeframe: Partial<SessionTimeframeConfig>;
  }) => bridge().strategy.saveTimeframeConfig(input),
  saveStrategyAiSettings: (input: {
    sessionId: string;
    aiSettings: Partial<SessionAiSettings>;
  }) => bridge().strategy.saveAiSettings(input),
  saveStrategyAiPhase: (input: {
    sessionId: string;
    phase: import("@electron/shared/ai/ai-phase").PipelinePhase;
    providerKey?: string;
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    reasoningLevel?: "off" | "auto" | "low" | "medium" | "high" | "max";
    promptSource?: "default" | "session_override";
    promptMarkdown?: string;
  }) => bridge().strategy.saveAiPhase(input),
  saveStrategyAiPhaseWorker: (input: {
    sessionId: string;
    phase: import("@electron/shared/ai/ai-phase").PipelinePhase;
    workerId: string;
    providerKey?: string | null;
    modelId?: string | null;
    maxSteps?: number | null;
    spendLimitUsd?: number | null;
    promptMarkdown?: string | null;
  }) => bridge().strategy.saveAiPhaseWorker(input),
  getStrategyProviderModels: (
    providerKey: string,
  ): Promise<{ models: ProviderModelEntry[] }> =>
    bridge().strategy.getProviderModels(providerKey),

  listGlobalPresets: (): Promise<{ presets: UserGlobalPresetRow[] }> =>
    bridge().strategy.globalPresets.list(),
  createGlobalPreset: (input: {
    name: string;
    preset: Record<string, unknown>;
  }): Promise<UserGlobalPresetRow> =>
    bridge().strategy.globalPresets.create(input),
  updateGlobalPreset: (input: {
    id: string;
    name: string;
    preset: Record<string, unknown>;
  }): Promise<{ ok: true }> => bridge().strategy.globalPresets.update(input),
  deleteGlobalPreset: (input: { id: string }): Promise<{ ok: true }> =>
    bridge().strategy.globalPresets.delete(input),
  getWorkspaceDefaultModel: (): Promise<{
    providerKey: string;
    modelId: string;
    reasoningLevel: import("@electron/shared/ai/ai-phase").ReasoningLevel;
  }> => bridge().strategy.getWorkspaceDefaultModel(),
  saveWorkspaceDefaultModel: (input: {
    providerKey: string;
    modelId: string;
    reasoningLevel?: import("@electron/shared/ai/ai-phase").ReasoningLevel;
  }): Promise<{ savedAt: string }> =>
    bridge().strategy.saveWorkspaceDefaultModel(input),

  getStrategyConfig: (): Promise<SessionStrategy> =>
    bridge().config.getStrategy(),
  saveStrategyConfig: (cfg: SessionStrategy): Promise<void> =>
    bridge().config.saveStrategy(cfg),

  listSignalSources: (): Promise<{
    sources: Array<
      SignalSourceRecord & {
        runtimeStatus: string;
        runtimeLastError: string | null;
        attachedSessionCount: number;
        attachedSessionNames: string[];
        lastPollAt: string | null;
        lastPollResult: {
          detected: number;
          passed: number;
          dropped: number;
          errors: string[];
        } | null;
        lastSignalAt: string | null;
        lastSignalTicker: string | null;
        recentActivity: Array<{
          at: string;
          kind: "ok" | "error" | "drop";
          summary: string;
        }>;
      }
    >;
  }> => bridge().signals.listSources(),
  createSignalSource: (input: {
    type: "edgar_8k" | "web_search" | "manual" | "prediction_event";
    name: string;
    description?: string | null;
    config?: Record<string, unknown>;
  }) => bridge().signals.createSource(input),
  updateSignalSource: (input: {
    id: string;
    name?: string;
    description?: string | null;
    enabled?: boolean;
    config?: Record<string, unknown>;
  }) => bridge().signals.updateSource(input),
  deleteSignalSource: (id: string) => bridge().signals.deleteSource(id),
  enableSignalSource: (id: string) => bridge().signals.enableSource(id),
  disableSignalSource: (id: string) => bridge().signals.disableSource(id),
  testSignalSource: (
    id: string,
  ): Promise<{
    result: {
      detected: number;
      passed: number;
      dropped: number;
      errors: string[];
    };
  }> => bridge().signals.testSource(id),
  listSessionSignalEvents: (input: {
    sessionId: string;
    statusBucket?: "pending" | "completed" | "dropped";
    limit?: number;
  }): Promise<{
    rows: Array<{
      delivery: SessionSignalDelivery;
      event: Record<string, unknown>;
      source: Record<string, unknown>;
    }>;
  }> => bridge().signals.listSessionEvents(input),
  listSessionSignalDeadLetters: (input: {
    sessionId: string;
    reason?:
      | "unsupported_by_experience"
      | "unsupported_by_signal_source"
      | "unsupported_by_assigned_broker"
      | "no_compatible_broker_route";
    limit?: number;
  }) => bridge().signals.listSessionDeadLetters(input),
  replaySessionSignalDeadLetter: (deadLetterId: string) =>
    bridge().signals.replaySignalDeadLetter({ deadLetterId }),
  getSessionSignalSubscriptions: (sessionId: string) =>
    bridge().signals.getSessionSubscriptions(sessionId),
  setSessionSignalSubscriptions: (input: {
    sessionId: string;
    sourceIds: string[];
  }) => bridge().signals.setSessionSubscriptions(input),
  getSessionSignalReadiness: (input: {
    sessionId: string;
    instrumentScope: string;
  }): Promise<{
    readiness:
      | "armed"
      | "manual_only"
      | "waiting_for_source_enable"
      | "no_inputs";
  }> => bridge().signals.getSessionReadiness(input),

  addBrokerAccount: (creds: BrokerCredentials): Promise<ConnectionTestResult> =>
    bridge().accounts.saveBroker(creds),
  testBrokerConnection: (): Promise<ConnectionTestResult> =>
    bridge().accounts.testBroker(),
  removeBrokerAccount: (): Promise<void> => bridge().accounts.removeBroker(),
  saveApiKey: (keyType: string, value: string): Promise<void> =>
    bridge().accounts.saveApiKey(keyType, value),
  listProviders: (): Promise<{ providers: ProviderAccount[] }> =>
    bridge().accounts.listProviders(),
  saveProvider: (input: {
    id?: string;
    name: string;
    category: "ai" | "search";
    providerType: ProviderAccount["providerType"];
    apiKey: string;
    metadata?: { baseUrl?: string };
  }): Promise<{ id: string; isConfigured: boolean }> =>
    bridge().accounts.saveProvider(input),
  deleteProvider: (id: string): Promise<{ ok: true }> =>
    bridge().accounts.deleteProvider({ id }),
  testProvider: (id: string): Promise<{ ok: boolean; error?: string }> =>
    bridge().accounts.testProvider({ id }),

  listBrokerAccounts: (): Promise<{ brokers: BrokerAccount[] }> =>
    bridge().accounts.listBrokers(),
  registerBrokerAccount: (input: {
    id?: string;
    brokerType:
      | "alpaca"
      | "coinbase_advanced_trade"
      | "tradovate"
      | "polymarket"
      | "mock";
    name: string;
    mode: "paper" | "live";
    credentials: Record<string, string>;
    mockScenarioKind?: import("@electron/shared/domain/mock-scenario").MockScenarioKind;
  }) => bridge().accounts.addBroker(input),
  deleteBrokerAccount: (id: string) =>
    bridge().accounts.removeBrokerAccount({ id }),
  testSavedBrokerAccount: (id: string): Promise<ConnectionTestResult> =>
    bridge().accounts.testBrokerAccount({ id }),
  testBrokerCredentials: (input: {
    brokerType:
      | "alpaca"
      | "coinbase_advanced_trade"
      | "tradovate"
      | "polymarket"
      | "mock";
    mode: "paper" | "live";
    credentials: Record<string, string>;
  }): Promise<ConnectionTestResult> =>
    bridge().accounts.testBrokerEphemeral(input),
  getBrokerRoutingDefaults: (): Promise<{ routing: BrokerRoutingDefault[] }> =>
    bridge().accounts.routingGet(),
  saveBrokerRoutingDefaults: (routing: BrokerRoutingDefault[]) =>
    bridge().accounts.routingUpdate({ routing }),

  getLiveReadiness: (
    sessionId: string,
  ): Promise<{
    readyToStart: boolean;
    allChecksPassed: boolean;
    checks: Array<{
      name: string;
      passed: boolean;
      requiresAck?: boolean;
      message?: string;
    }>;
    acknowledgedAt: string | null;
  }> => bridge().session.getLiveReadiness(sessionId),
  acknowledgeLiveReadiness: (
    sessionId: string,
  ): Promise<{ acknowledgedAt: string }> =>
    bridge().session.acknowledgeLiveReadiness(sessionId),
  testLiveBrokerConnection: (
    sessionId: string,
  ): Promise<{ ok: boolean; message: string }> =>
    bridge().session.testLiveBrokerConnection(sessionId),

  getEvents: (filters?: {
    minLevel?: string;
    agentType?: AgentRole;
    search?: string;
    limit?: number;
    sessionId?: string;
  }): Promise<EventRow[]> => bridge().events.list(filters),
  getAgentTraces: (tradeId: string): Promise<AgentRun[]> =>
    bridge().events.getAgentTraces(tradeId),
  getAgentTracesByCycle: (cycleId: string): Promise<AgentRun[]> =>
    bridge().events.getAgentTracesByCycle(cycleId),
  getMessagesByCycle: (cycleId: string): Promise<AgentMessage[]> =>
    bridge().events.getMessagesByCycle(cycleId),
  getApiCallLog: (filters: {
    sessionId: string;
    cycleId?: string | null;
    tradeId?: string | null;
  }): Promise<ApiCallLogEntry[]> => bridge().events.getApiCallLog(filters),

  summarizeTradeAutopsy: (tradeId: string): Promise<TradeAutopsyRecord> =>
    bridge().autopsy.summarize(tradeId),
  listTradeAutopsies: (tradeId: string): Promise<TradeAutopsyRecord[]> =>
    bridge().autopsy.list(tradeId),
  listAutopsyLessons: (autopsyId: string): Promise<AutopsyLesson[]> =>
    bridge().autopsy.listLessons(autopsyId),
  addAutopsyLesson: (input: AddLessonInput): Promise<AutopsyLesson> =>
    bridge().autopsy.addLesson(input),
  updateAutopsyLesson: (input: UpdateLessonInput): Promise<{ ok: true }> =>
    bridge().autopsy.updateLesson(input),
  exportTradeAutopsy: (
    autopsyId: string,
    format: ExportFormat,
  ): Promise<ExportResult> => bridge().autopsy.export(autopsyId, format),
  runPeriodAutopsy: (
    input: PeriodAutopsyRunInput,
  ): Promise<PeriodAutopsyRecord> => bridge().autopsy.period.run(input),
  listPeriodAutopsies: (
    input: PeriodAutopsyListInput,
  ): Promise<{ items: PeriodAutopsyRecord[]; total: number }> =>
    bridge().autopsy.period.list(input),
  getPeriodAutopsy: (periodAutopsyId: string): Promise<PeriodAutopsyRecord> =>
    bridge().autopsy.period.get({ periodAutopsyId }),
  previewPeriodAutopsy: (
    input: PeriodAutopsyRunInput,
  ): Promise<PeriodAutopsyPreview> => bridge().autopsy.period.preview(input),
  listPeriodAutopsyLessons: (
    input: PeriodAutopsyLessonsListInput,
  ): Promise<AutopsyLesson[]> => bridge().autopsy.period.lessons.list(input),
  updatePeriodAutopsyLesson: (
    input: UpdateLessonInput,
  ): Promise<{ ok: true }> => bridge().autopsy.period.lessons.update(input),
  addPeriodAutopsyLesson: (
    input: PeriodAutopsyAddLessonInput,
  ): Promise<AutopsyLesson> => bridge().autopsy.period.lessons.add(input),
  promoteTradeLessonToPeriodLedger: (
    input: PeriodAutopsyPromoteLessonInput,
  ): Promise<AutopsyLesson> => bridge().autopsy.period.lessons.promote(input),
  exportPeriodAutopsy: (
    periodAutopsyId: string,
    format: ExportFormat,
  ): Promise<ExportResult> =>
    bridge().autopsy.period.export({ periodAutopsyId, format }),
};

export async function listenEvent<K extends ExvaEventName>(
  name: K,
  handler: (payload: ExvaEventMap[K]) => void,
): Promise<() => void> {
  return bridge().events.subscribe(name, handler);
}

export type {
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
export type { AIPhaseTrace, PhaseRuntimeSummary };
