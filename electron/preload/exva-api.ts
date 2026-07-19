import type {
  AgentMessage,
  AgentRole,
  ApiCallLogEntry,
  AgentRun,
  ApprovalSummary,
  BrokerAccount,
  BrokerAccountWithState,
  BrokerRoutingDefault,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  ExecutionStage,
  ExecutionMode,
  EventRow,
  InstrumentClass,
  ProviderAccount,
  SessionStatus,
  SessionTemplatePayload,
  Trade,
  TradeDetail,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "@/lib/types";
import type {
  ExvaEventMap,
  ExvaEventName,
  ExperienceSummary,
  ExperienceScorecardSummary,
  ProviderModelEntry,
  SessionCreateInput,
  SessionExecutionProgressResponse,
  SessionSummary,
  StrategyGetResponse,
  WorkspaceViewResponse,
} from "@electron/shared/ipc/dto";
import type {
  PollResult,
  SessionSignalDelivery,
  SignalSourceRecord,
} from "@electron/shared/domain";
import type {
  ControlConversation,
  ControlConversationSummary,
  ControlMessage,
  ControlScopeKind,
  ControlToolCall,
} from "@electron/shared/domain/control";
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

export interface DebugForceTradeResult {
  brokerType: string;
  brokerAccountId: string;
  instrumentClass: InstrumentClass;
  symbol: string;
  side: "BUY";
  sizeUsd: number;
  brokerOrderId: string;
  filledAvgPrice: number;
}

export interface ExvaApi {
  dashboard: {
    getStats(): Promise<DashboardStats>;
    getCostBreakdown(dateRange?: string): Promise<CostBreakdown>;
    getCalendarAttention(): Promise<{
      items: Array<{
        id: string;
        severity: "info" | "warn";
        message: string;
        scheduledAt: string;
        symbol: string | null;
        sessionId: string | null;
      }>;
    }>;
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
  autopsy: {
    summarize(tradeId: string): Promise<TradeAutopsyRecord>;
    list(tradeId: string): Promise<TradeAutopsyRecord[]>;
    listLessons(autopsyId: string): Promise<AutopsyLesson[]>;
    addLesson(input: AddLessonInput): Promise<AutopsyLesson>;
    updateLesson(input: UpdateLessonInput): Promise<{ ok: true }>;
    export(autopsyId: string, format: ExportFormat): Promise<ExportResult>;
    period: {
      run(input: PeriodAutopsyRunInput): Promise<PeriodAutopsyRecord>;
      list(input: PeriodAutopsyListInput): Promise<{
        items: PeriodAutopsyRecord[];
        total: number;
      }>;
      get(input: { periodAutopsyId: string }): Promise<PeriodAutopsyRecord>;
      preview(input: PeriodAutopsyRunInput): Promise<PeriodAutopsyPreview>;
      lessons: {
        list(input: PeriodAutopsyLessonsListInput): Promise<AutopsyLesson[]>;
        update(input: UpdateLessonInput): Promise<{ ok: true }>;
        add(input: PeriodAutopsyAddLessonInput): Promise<AutopsyLesson>;
        promote(input: PeriodAutopsyPromoteLessonInput): Promise<AutopsyLesson>;
      };
      export(input: {
        periodAutopsyId: string;
        format: ExportFormat;
      }): Promise<ExportResult>;
    };
  };
  experiences: {
    list(): Promise<ExperienceSummary[]>;
    listScorecards(): Promise<{ scorecards: ExperienceScorecardSummary[] }>;
    getScorecard(
      experienceId: string,
    ): Promise<{ scorecard: ExperienceScorecardSummary }>;
  };
  session: {
    start(): Promise<SessionStatus>;
    pause(): Promise<SessionStatus>;
    resume(): Promise<SessionStatus>;
    stop(): Promise<SessionStatus>;
    forceStop(): Promise<SessionStatus>;
    getStatus(): Promise<SessionStatus>;
    getExecutionProgress(
      sessionId: string,
    ): Promise<SessionExecutionProgressResponse>;
    retryStep(input: {
      sessionId: string;
      cycleId: string;
      stage: ExecutionStage;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
    pauseAfterCurrentStep(sessionId: string): Promise<{ ok: true }>;
    clearFailedStep(input: {
      sessionId: string;
      cycleId: string;
      stage: ExecutionStage;
    }): Promise<{ ok: true } | { ok: false; reason: string }>;
    list(filters?: {
      status?: SessionStatus;
      instrumentClass?: InstrumentClass;
      search?: string;
      includeArchived?: boolean;
    }): Promise<{
      workspaceViewMode: WorkspaceViewMode;
      focusedSessionId: string | null;
      sessions: SessionSummary[];
    }>;
    create(input: SessionCreateInput): Promise<{ id: string; status: "draft" }>;
    update(id: string, input: SessionCreateInput): Promise<{ savedAt: string }>;
    focus(
      id: string,
    ): Promise<{ workspaceViewMode: "session"; focusedSessionId: string }>;
    goGlobal(): Promise<{
      workspaceViewMode: "global";
      focusedSessionId: null;
    }>;
    archive(id: string): Promise<{ archived: true }>;
    duplicate(
      sourceId: string,
      name: string,
    ): Promise<{ id: string; status: "draft" }>;
    instrumentCacheGet(sessionId: string): Promise<{
      instruments: Array<{
        symbol: string;
        instrumentClass: InstrumentClass;
      }> | null;
      selectedAt: string | null;
      definitionHashMatches: boolean;
    }>;
    instrumentCacheClear(sessionId: string): Promise<{ cleared: true }>;
    getLiveReadiness(sessionId: string): Promise<{
      readyToStart: boolean;
      allChecksPassed: boolean;
      checks: Array<{
        name: string;
        passed: boolean;
        requiresAck?: boolean;
        message?: string;
      }>;
      acknowledgedAt: string | null;
    }>;
    acknowledgeLiveReadiness(
      sessionId: string,
    ): Promise<{ acknowledgedAt: string }>;
    testLiveBrokerConnection(
      sessionId: string,
    ): Promise<{ ok: boolean; message: string }>;
    debugInjectSignal(
      sessionId: string,
      opts?: {
        kind?:
          | "filing"
          | "market_dislocation"
          | "flow_anomaly"
          | "scan_hit"
          | "news"
          | "calendar_event"
          | "manual";
        payload?: Record<string, unknown>;
        symbol?: string;
      },
    ): Promise<{ ok: boolean }>;
    debugForceTrade(sessionId: string): Promise<DebugForceTradeResult>;
  };
  workspace: {
    getView(): Promise<WorkspaceViewResponse>;
    patchPreferences(
      patch: Partial<Omit<WorkspacePreferences, "id">>,
    ): Promise<WorkspacePreferences>;
  };
  brokerAccounts: {
    list(): Promise<BrokerAccountWithState[]>;
    refreshBalance(
      brokerAccountId: string,
    ): Promise<{ balanceUsd: number; cachedAt: string }>;
    updateSettings(input: {
      brokerAccountId: string;
      maxSessions?: number;
      allocationEnforcement?: "hard" | "warn";
      balanceRefreshIntervalMin?: number;
    }): Promise<{ ok: true }>;
    resetPaperBalance(input: {
      brokerAccountId: string;
      startingBalanceUsd?: number;
    }): Promise<{
      balanceUsd: number;
      startingBalanceUsd: number;
      cachedAt: string;
    }>;
  };
  templates: {
    list(filters?: {
      search?: string;
      instrumentClass?: InstrumentClass;
    }): Promise<{
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
    use(
      id: string,
    ): Promise<{ payload: SessionTemplatePayload; clearedFields: string[] }>;
    buildPayloadFromSession(sessionId: string): Promise<SessionTemplatePayload>;
  };
  strategy: {
    get(sessionId: string): Promise<StrategyGetResponse>;
    getProviderModels(
      providerKey: string,
    ): Promise<{ models: ProviderModelEntry[] }>;
    getWorkspaceDefaultModel(): Promise<{
      providerKey: string;
      modelId: string;
      reasoningLevel: import("@electron/shared/ai/ai-phase").ReasoningLevel;
    }>;
    saveWorkspaceDefaultModel(input: {
      providerKey: string;
      modelId: string;
      reasoningLevel?: import("@electron/shared/ai/ai-phase").ReasoningLevel;
    }): Promise<{ savedAt: string }>;
  };
  strategyConfig: {
    get(sessionId: string): Promise<{
      version: number;
      schemaVersion: number;
      doc: import("@electron/shared/domain/session-strategy-config").SessionStrategyConfigDoc;
      updatedAt: string;
    }>;
    update(input: {
      sessionId: string;
      expectedVersion: number;
      patch: Record<string, unknown>;
    }): Promise<{
      version: number;
      schemaVersion: number;
      doc: import("@electron/shared/domain/session-strategy-config").SessionStrategyConfigDoc;
      updatedAt: string;
    }>;
    applyPreset(input: {
      sessionId: string;
      presetId: string;
      expectedVersion: number;
    }): Promise<{
      version: number;
      schemaVersion: number;
      doc: import("@electron/shared/domain/session-strategy-config").SessionStrategyConfigDoc;
      updatedAt: string;
    }>;
    listPresets(kind?: string): Promise<{
      presets: Array<{
        id: string;
        name: string;
        kind: string;
        doc: unknown;
        builtin: boolean;
        updatedAt: string;
      }>;
    }>;
    savePreset(input: {
      id?: string;
      name: string;
      kind: string;
      doc: Record<string, unknown>;
      builtin?: boolean;
    }): Promise<{
      id: string;
      name: string;
      kind: string;
      doc: unknown;
      builtin: boolean;
      updatedAt: string;
    }>;
    deletePreset(input: { id: string }): Promise<{ ok: true }>;
    history(sessionId: string): Promise<{
      history: Array<{
        id: string;
        sessionId: string;
        version: number;
        doc: unknown;
        savedAt: string;
      }>;
    }>;
    rollback(input: {
      sessionId: string;
      version: number;
      expectedVersion: number;
    }): Promise<{
      version: number;
      schemaVersion: number;
      doc: import("@electron/shared/domain/session-strategy-config").SessionStrategyConfigDoc;
      updatedAt: string;
    }>;
  };
  signals: {
    listSources(): Promise<{
      sources: Array<
        SignalSourceRecord & {
          runtimeStatus: string;
          runtimeLastError: string | null;
          attachedSessionCount: number;
          attachedSessionNames: string[];
          lastPollAt: string | null;
          lastPollResult: PollResult | null;
          lastSignalAt: string | null;
          lastSignalTicker: string | null;
          recentActivity: Array<{
            at: string;
            kind: "ok" | "error" | "drop";
            summary: string;
          }>;
        }
      >;
    }>;
    createSource(input: {
      type: "edgar_8k" | "manual" | "prediction_event" | "mock";
      name: string;
      description?: string | null;
      config?: Record<string, unknown>;
    }): Promise<{ source: SignalSourceRecord }>;
    updateSource(input: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }): Promise<{ source: SignalSourceRecord }>;
    deleteSource(id: string): Promise<{ ok: true }>;
    enableSource(id: string): Promise<{ ok: true }>;
    disableSource(id: string): Promise<{ ok: true }>;
    testSource(id: string): Promise<{ result: PollResult }>;
    listSessionEvents(input: {
      sessionId: string;
      statusBucket?: "pending" | "completed" | "dropped";
      limit?: number;
    }): Promise<{
      rows: Array<{
        delivery: SessionSignalDelivery;
        event: Record<string, unknown>;
        source: Record<string, unknown>;
      }>;
    }>;
    listSessionDeadLetters(input: {
      sessionId: string;
      reason?:
        | "unsupported_by_experience"
        | "unsupported_by_signal_source"
        | "unsupported_by_assigned_broker"
        | "no_compatible_broker_route";
      limit?: number;
    }): Promise<{
      rows: Array<{
        deadLetter: import("@electron/shared/domain").SignalDeadLetter;
        event: Record<string, unknown>;
        source: Record<string, unknown>;
      }>;
    }>;
    replaySignalDeadLetter(input: {
      deadLetterId: string;
    }): Promise<{ deliveryId: string }>;
    getSessionReadiness(input: {
      sessionId: string;
      instrumentScope: string;
    }): Promise<{
      readiness:
        | "armed"
        | "manual_only"
        | "waiting_for_source_enable"
        | "no_inputs";
    }>;
  };
  accounts: {
    saveApiKey(keyType: string, value: string): Promise<void>;
    listProviders(): Promise<{ providers: ProviderAccount[] }>;
    saveProvider(input: {
      id?: string;
      name: string;
      category: "ai" | "search";
      providerType: ProviderAccount["providerType"];
      apiKey: string;
      metadata?: {
        baseUrl?: string;
        mcpToolName?: string;
        mcpAuthMode?: "bearer" | "query";
        mcpApiKeyQueryParam?: string;
      };
    }): Promise<{ id: string; isConfigured: boolean }>;
    deleteProvider(input: { id: string }): Promise<{ ok: true }>;
    testProvider(input: {
      id: string;
    }): Promise<{ ok: boolean; error?: string }>;
    listBrokers(): Promise<{ brokers: BrokerAccount[] }>;
    addBroker(input: {
      id?: string;
      brokerType:
        | "alpaca"
        | "coinbase_advanced_trade"
        | "tradovate"
        | "polymarket"
        | "kalshi"
        | "tradier"
        | "kraken"
        | "mock";
      name: string;
      mode: "paper" | "live";
      credentials: Record<string, string>;
    }): Promise<
      | { ok: true; id: string; supportedInstrumentClasses: InstrumentClass[] }
      | {
          ok: false;
          id: string;
          message: string;
          supportedInstrumentClasses: InstrumentClass[];
        }
    >;
    removeBrokerAccount(input: { id: string }): Promise<{ ok: true }>;
    testBrokerAccount(input: { id: string }): Promise<ConnectionTestResult>;
    testBrokerEphemeral(input: {
      brokerType:
        | "alpaca"
        | "coinbase_advanced_trade"
        | "tradovate"
        | "polymarket"
        | "kalshi"
        | "tradier"
        | "kraken"
        | "mock";
      mode: "paper" | "live";
      credentials: Record<string, string>;
    }): Promise<ConnectionTestResult>;
    routingGet(): Promise<{ routing: BrokerRoutingDefault[] }>;
    routingUpdate(input: {
      routing: Array<{
        instrumentClass: InstrumentClass;
        defaultBrokerAccountId: string;
      }>;
    }): Promise<{ savedAt: string }>;
  };
  control: {
    isEnabled(): Promise<{ enabled: boolean }>;
    listConversations(): Promise<{
      conversations: ControlConversationSummary[];
    }>;
    getConversation(id: string): Promise<{
      conversation: ControlConversation;
      messages: ControlMessage[];
      toolCalls: ControlToolCall[];
      streaming: boolean;
    }>;
    createConversation(input?: {
      title?: string;
      scopeKind?: ControlScopeKind;
      scopeSessionId?: string | null;
    }): Promise<{ conversation: ControlConversation }>;
    renameConversation(input: {
      id: string;
      title: string;
    }): Promise<{ ok: true }>;
    deleteConversation(id: string): Promise<{ ok: true }>;
    send(input: {
      conversationId: string;
      message: string;
      route?: string | null;
      selectedSessionId?: string | null;
    }): Promise<{ turnId: string }>;
    confirm(input: {
      conversationId: string;
      toolCallId: string;
      alwaysApprove?: boolean;
    }): Promise<{ ok: true }>;
    reject(input: {
      conversationId: string;
      toolCallId: string;
    }): Promise<{ ok: true }>;
    cancel(conversationId: string): Promise<{ ok: true }>;
    getActivity(): Promise<{ toolCalls: ControlToolCall[] }>;
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
    }): Promise<{
      overrideId: string;
      effectiveLogLevel: string;
      expiresAt: string | null;
    }>;
    stopLogOverride(input: {
      overrideId: string;
    }): Promise<{ stopped: true; effectiveLogLevel: string }>;
    getScopeDiagnostics(input: {
      scope: { type: string; id?: string };
    }): Promise<unknown>;
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
    }): Promise<{
      events: EventRow[];
      nextCursor: string | null;
      queryMs: number;
    }>;
  };
  ops: {
    getBackupStatus(): Promise<{
      lastBackup: {
        backedUpAt: string;
        sourcePath: string;
        backupPath: string;
        trigger: string;
      } | null;
      dbPath: string;
      headless: boolean;
      instanceLock: { pid: number; mode: string; startedAt: string } | null;
    }>;
    runBackupNow(): Promise<{
      ok: boolean;
      sourcePath: string;
      backupPath: string | null;
      backedUpAt: string;
      error?: string;
      skipped?: boolean;
    }>;
    getNotificationRouting(): Promise<{
      routing: {
        immediateSeverities: Array<"kill" | "error" | "warn" | "info">;
        digestHourLocal: number;
        ntfyEnabled: boolean;
        telegramEnabled: boolean;
        smtpEnabled: boolean;
      };
      ntfyConfigured: boolean;
      telegramConfigured: boolean;
      smtpConfigured: boolean;
    }>;
    updateNotificationRouting(patch: {
      immediateSeverities?: Array<"kill" | "error" | "warn" | "info">;
      digestHourLocal?: number;
      ntfyEnabled?: boolean;
      telegramEnabled?: boolean;
      smtpEnabled?: boolean;
    }): Promise<{ routing: unknown }>;
    testNotificationSink(input: {
      sink: "ntfy" | "telegram" | "smtp";
    }): Promise<{ ok: boolean; error?: string }>;
    setTelegramSecret(input: {
      botToken: string;
      chatId: string;
    }): Promise<{ ok: true }>;
    clearTelegramSecret(): Promise<{ ok: true }>;
    listAlarms(): Promise<{
      alarms: Array<{
        id: string;
        sessionId: string | null;
        kind: string;
        severity: string;
        message: string;
        firedAt: string;
      }>;
    }>;
    triggerTestAlarm(input: {
      kind: string;
      sessionId?: string | null;
    }): Promise<{ alarm: unknown }>;
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
    getApiCallLog(filters: {
      sessionId: string;
      cycleId?: string | null;
      tradeId?: string | null;
    }): Promise<ApiCallLogEntry[]>;
    subscribe<K extends ExvaEventName>(
      name: K,
      handler: (payload: ExvaEventMap[K]) => void,
    ): () => void;
  };
  experienceCatalog: {
    listTemplates(): Promise<{
      templates: import("@electron/shared/domain/experience-inputs/catalog").ExperienceTemplateSummary[];
    }>;
    getConfigurationOptions(input: {
      templateId: string;
      templateVersion?: number;
    }): Promise<
      import("@electron/shared/domain/experience-inputs/catalog").TemplateConfigurationOptions
    >;
    validateDraft(
      input: import("@electron/shared/domain/experience-inputs/catalog").SessionConfigurationDraft,
    ): Promise<
      import("@electron/shared/domain/experience-inputs/validation-result").SessionDraftValidation
    >;
  };
  instrumentSets: {
    list(): Promise<{
      sets: import("@electron/shared/domain/experience-inputs/catalog").InstrumentSetRevision[];
    }>;
    get(input: { setId: string }): Promise<{
      set: import("@electron/shared/domain/experience-inputs/catalog").InstrumentSetRevision;
    }>;
    createRevision(input: {
      setId?: string;
      name: string;
      instrumentClass: InstrumentClass;
      members: Array<{
        canonicalId: string;
        displaySymbol: string;
        venue?: string | null;
      }>;
    }): Promise<{
      set: import("@electron/shared/domain/experience-inputs/catalog").InstrumentSetRevision;
    }>;
  };
  sourceDefinitions: {
    list(): Promise<{
      sources: import("@electron/shared/domain/experience-inputs/catalog").SourceDefinition[];
    }>;
    get(input: { id: string }): Promise<{
      source:
        | import("@electron/shared/domain/experience-inputs/catalog").SourceDefinition
        | null;
    }>;
    setEnabled(input: { id: string; enabled: boolean }): Promise<{
      source: import("@electron/shared/domain/experience-inputs/catalog").SourceDefinition;
    }>;
  };
  sessionInputs: {
    get(input: {
      sessionId: string;
    }): Promise<
      import("@electron/shared/domain/experience-inputs/subscription").SessionInputConfiguration
    >;
    replace(input: {
      sessionId: string;
      inputRevision: number;
      subscriptions: import("@electron/shared/domain/experience-inputs/subscription").SessionInputSubscriptionDraft[];
    }): Promise<
      import("@electron/shared/domain/experience-inputs/subscription").SessionInputConfiguration
    >;
  };
  sessionActivity: {
    list(): Promise<
      import("@electron/shared/domain/session-activity").SessionActivitySnapshot[]
    >;
    get(input: {
      sessionId: string;
    }): Promise<
      | import("@electron/shared/domain/session-activity").SessionActivitySnapshot
      | null
    >;
  };
  palette: {
    query(input: { q: string; limit?: number }): Promise<{
      query: string;
      hits: Array<{
        id: string;
        kind: string;
        title: string;
        subtitle?: string;
        score: number;
        payload: Record<string, string>;
      }>;
    }>;
  };
  backtest: {
    listStrategies(): Promise<{
      strategies: Array<{ id: string; status: string }>;
    }>;
    list(input?: {
      experienceId?: string;
      limit?: number;
    }): Promise<{ runs: unknown[] }>;
    get(input: { id: string }): Promise<{ run: unknown }>;
    run(input: unknown): Promise<unknown>;
    compare(input: { runIds: string[] }): Promise<unknown>;
    sweep(input: unknown): Promise<unknown>;
  };
  dataDoctor: {
    coverage(): Promise<{ cells: unknown[] }>;
    gaps(input: {
      symbol: string;
      timeframe: string;
    }): Promise<{ gaps: unknown[] }>;
    backfill(input: unknown): Promise<unknown>;
    providerHealth(): Promise<{ providers: unknown[] }>;
    setProviderEnabled(input: {
      provider: string;
      enabled: boolean;
    }): Promise<{ ok: true }>;
    runNightlyGapCheck(): Promise<{ cellsWithGaps: number }>;
  };
  briefing: {
    latest(): Promise<{ briefing: unknown }>;
    list(input?: { limit?: number }): Promise<{ briefings: unknown[] }>;
    get(input: { date: string }): Promise<{ briefing: unknown }>;
    assemble(input?: { date?: string }): Promise<{ briefing: unknown }>;
  };
  equity: {
    curve(input?: { range?: "1W" | "1M" | "3M" | "all" }): Promise<unknown>;
    attribution(input?: {
      range?: "1W" | "1M" | "3M" | "all";
    }): Promise<unknown>;
    snapshotNow(): Promise<{ snapshot: unknown }>;
  };
  whatIf: {
    run(input: {
      tradeId: string;
      params?: Record<string, unknown>;
      save?: boolean;
      experienceId?: string;
    }): Promise<unknown>;
  };
  killSwitch: {
    pauseAll(): Promise<{ paused: string[]; skipped: string[] }>;
    killSession(input: { sessionId: string }): Promise<{ status: string }>;
    gauges(): Promise<{ gauges: unknown[] }>;
    flattenAll(input: { confirmation: string }): Promise<{
      closed: string[];
      failed: Array<{ tradeId: string; error: string }>;
    }>;
  };
}
