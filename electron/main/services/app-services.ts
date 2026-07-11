import type { App } from "electron";
import { env } from "../config/env";
import { createDbClient } from "@main/db/client";
import {
  SEEDED_ALPACA_BROKER_ID,
  SEEDED_ALPACA_SECRET_REF,
  SEEDED_OPENROUTER_PROVIDER_ID,
  SEEDED_OPENROUTER_SECRET_REF,
} from "@main/db/seed";
import { AgentRunsRepo } from "../db/repositories/agents/agent-runs-repo";
import { AgentMessagesRepo } from "../db/repositories/agents/agent-messages-repo";
import { ApiCallLogRepo } from "../db/repositories/system/api-call-log-repo";
import { BrokerAccountsRepo } from "../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../db/repositories/brokers/broker-routing-repo";
import { CapitalReservationsRepo } from "../db/repositories/trades/capital-reservations-repo";
import { EventsRepo } from "../db/repositories/system/events-repo";
import { ProviderAccountsRepo } from "../db/repositories/workspace/provider-accounts-repo";
import { SessionAiPhasesRepo } from "../db/repositories/sessions/session-ai-phases-repo";
import { SessionBrokerAssignmentsRepo } from "../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRiskConfigRepo } from "../db/repositories/sessions/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../db/repositories/sessions/session-selector-settings-repo";
import { SessionTradeRulesRepo } from "../db/repositories/sessions/session-trade-rules-repo";
import { SessionStrategiesRepo } from "../db/repositories/sessions/session-strategies-repo";
import { SessionTemplatesRepo } from "../db/repositories/sessions/session-templates-repo";
import { SessionTimeframeConfigRepo } from "../db/repositories/sessions/session-timeframe-config-repo";
import { SessionResearchPostureRepo } from "../db/repositories/sessions/session-research-posture-repo";
import { SessionAiSettingsRepo } from "../db/repositories/sessions/session-ai-settings-repo";
import { SqliteSessionExecutionStepsRepo } from "../db/repositories/sessions/session-execution-steps-repo";
import { SessionRepo } from "../db/repositories/sessions/session-repo";
import { InstrumentCacheRepo } from "../db/repositories/market/instrument-cache-repo";
import { GlobalPresetsRepo } from "../db/repositories/presets/global-presets-repo";
import { RiskPresetsRepo } from "../db/repositories/presets/risk-presets-repo";
import { TimeframePresetsRepo } from "../db/repositories/presets/timeframe-presets-repo";
import { ResearchPosturePresetsRepo } from "../db/repositories/presets/research-posture-presets-repo";
import { TradeRulePresetsRepo } from "../db/repositories/presets/trade-rule-presets-repo";
import { StatsRepo } from "../db/repositories/system/stats-repo";
import { TradeApprovalsRepo } from "../db/repositories/trades/trade-approvals-repo";
import { PeriodAutopsiesRepo } from "../db/repositories/trades/period-autopsies-repo";
import { TradeAutopsiesRepo } from "../db/repositories/trades/trade-autopsies-repo";
import { AutopsyLessonsRepo } from "../db/repositories/trades/autopsy-lessons-repo";
import { TradesRepo } from "../db/repositories/trades/trades-repo";
import { DecisionTraceRepo } from "../db/repositories/trades/decision-trace-repo";
import { SignalObservationsRepo } from "../db/repositories/research/signal-observations-repo";
import { SignalLabelsRepo } from "../db/repositories/research/signal-labels-repo";
import {
  BacktestRunsRepo,
  ModelVersionsRepo,
  PromotionDecisionsRepo,
} from "../db/repositories/research/experiment-repos";
import { SignalObservationService } from "./research/signal-observation-service";
import { LabelBuilderService } from "./research/label-builder-service";
import { LabelBuilderTicker } from "./research/label-builder-ticker";
import { createBrokerForwardReturnResolver } from "./research/forward-return-resolver";
import { DriftMonitorTicker } from "./research/drift-monitor-ticker";
import { ResearchExperimentService } from "./research/research-experiment-service";
import { WorkspacePreferencesRepo } from "../db/repositories/workspace/workspace-prefs-repo";
import { LLMRuntime } from "./llm/index";
import {
  BrokerBalanceCacheService,
  BrokerBalanceTicker,
  BrokerCapitalService,
  BrokerRegistry,
  BrokerRoutingService,
  BrokerService,
  InstrumentNormalizer,
} from "./broker";
import { EventBus } from "./infra/event-bus";
import { attachEventBusObserver } from "./infra/event-bus-observer";
import { createLogger } from "./infra/log";
import { NotificationService } from "./infra/notification-service";
import { MarketDataService } from "./marketdata/market-data-service";
import { CalibrationService } from "./signals/forecast/calibration-service";
import { SupervisorService } from "./supervisor/supervisor-service";
import { SessionScheduler } from "./signals/scheduler/session-scheduler";
import {
  asTradingTimeframe,
  createRulesScheduledScan,
} from "./signals/scheduler/rules-scheduled-scan";
import { signalSourceId } from "@electron/shared/instruments/session-input-model";
import { signalDisplayName } from "@electron/shared/domain/signal-descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../experiences/rules-mean-reversion/descriptor";
import { RULES_BREAKOUT_EXPERIENCE } from "../experiences/rules-breakout/descriptor";
import { RULES_TREND_FOLLOWING_EXPERIENCE } from "../experiences/rules-trend-following/descriptor";
import { OPTIONS_FLOW_EDGE_EXPERIENCE } from "../experiences/options-flow-edge/descriptor";
import type { ExperienceDescriptor } from "../experiences/types";
import type { RulesStrategyId } from "./signals/scheduler/rules-scheduled-scan";
import { AgentOrchestrator } from "./orchestration/cycle/agent-orchestrator";
import { registerDefaultEngines } from "./pipeline/engines/signal-registry/register-default-engines";
import { assertValidPipelineDefinitionCatalog } from "./pipeline/effective-ai-phase-config";
import { registerAllPhases } from "./pipeline/definitions";
import { registerDefaultInstrumentAnalyses } from "./pipeline/implementations/registry/register-analyses";
import "../experiences/index";
import { ProviderRegistry } from "./llm/provider-registry";
import { SearchRegistry } from "./search/search-registry";
import { SecretsService } from "./infra/secrets-service";
import { runPreflight, SessionRuntimeManager, SessionService } from "./session";
import { InProcessSessionRuntimeHost } from "./session/session-runtime-host";
import { UtilityProcessSessionRuntimeHost } from "./session/utility-process-runtime-host";
import type { OrchestratorDeps, SessionRuntimeManagerDeps } from "./session";
import { SessionStrategyContextService } from "./session/session-strategy-context-service";
import { CandidateValidationService } from "./orchestration/policy/candidate-validation-service";
import { OrderPolicyGate } from "./orchestration/policy/order-policy-gate";
import { ExitPolicyEvaluator } from "./risk/exit-policy-evaluator";
import { SessionListingService } from "./session/listing-service";
import { SessionTemplateService } from "./session/template-service";
import { SessionWriteService } from "./session/write-service";
import {
  TradeMonitor,
  MOCK_POLL_INTERVAL_MS,
} from "./orchestration/lifecycle/trade-monitor";
import { CycleReplayService } from "./replay/cycle-replay-service";
import { InstrumentCacheService } from "./instrument";
import {
  BrokerAllocationGate,
  CapitalReservationService,
  RiskEngine,
} from "./risk";
import { PaperScorecardService } from "./analytics/paper-scorecard-service";
import { ExperienceScorecardService } from "./analytics/experience-scorecard-service";
import { ResearchSummaryService } from "./analytics/research-summary-service";
import { ExperienceCapitalAllocator } from "./risk/experience-capital-allocator";
import { ExperienceExperimentsRepo } from "../db/repositories/experiences/experience-experiments-repo";
import { PeriodAutopsyService } from "./analytics/period-autopsy-service";
import { TradeAutopsyService } from "./analytics/trade-autopsy-service";
import { AutopsyExportService } from "./analytics/autopsy-export-service";
import { LiveReadinessService } from "./risk/live-readiness-service";
import { SignalSourcesRepo } from "./signals/repos/signal-sources-repo";
import { SignalEventsRepo } from "./signals/repos/signal-events-repo";
import { SignalDeadLettersRepo } from "./signals/repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "./signals/repos/signal-deliveries-repo";
import { SignalDeliveryLifecycle } from "./signals/signal-delivery-lifecycle";
import { SignalBus } from "./signals/signal-bus";
import { SignalSourceRegistry } from "./signals/signal-source-registry";
import { SignalService } from "./signals/signal-service";
import { ControlRepo } from "../db/repositories/control/control-repo";
import { ControlAgentService } from "./control/control-agent-service";
import {
  bootstrapMockRehearsal,
  isMockRehearsalEnabled,
  syncMockRehearsalRuntimeTicker,
} from "../experiences/mock-rehearsal-bootstrap";

export interface AppServices {
  /** Shared deps shape for IPC helpers (e.g. instrument cache fingerprint). */
  orchestratorDeps: OrchestratorDeps;
  instrumentCacheService: InstrumentCacheService;
  db: ReturnType<typeof createDbClient>;
  repos: {
    agentRuns: AgentRunsRepo;
    agentMessages: AgentMessagesRepo;
    apiCallLog: ApiCallLogRepo;
    brokerAccounts: BrokerAccountsRepo;
    brokerRouting: BrokerRoutingRepo;
    capitalReservations: CapitalReservationsRepo;
    events: EventsRepo;
    providerAccounts: ProviderAccountsRepo;
    sessionAiPhases: SessionAiPhasesRepo;
    sessionBrokerAssignments: SessionBrokerAssignmentsRepo;
    sessionRiskConfig: SessionRiskConfigRepo;
    sessionSelectorSettings: SessionSelectorSettingsRepo;
    sessionExecutionSteps: SqliteSessionExecutionStepsRepo;
    session: SessionRepo;
    sessionTradeRules: SessionTradeRulesRepo;
    sessionStrategies: SessionStrategiesRepo;
    sessionTemplates: SessionTemplatesRepo;
    sessionTimeframeConfig: SessionTimeframeConfigRepo;
    sessionResearchPosture: SessionResearchPostureRepo;
    sessionAiSettings: SessionAiSettingsRepo;
    stats: StatsRepo;
    tradeApprovals: TradeApprovalsRepo;
    periodAutopsies: PeriodAutopsiesRepo;
    tradeAutopsies: TradeAutopsiesRepo;
    experienceExperiments: ExperienceExperimentsRepo;
    autopsyLessons: AutopsyLessonsRepo;
    trades: TradesRepo;
    decisionTraces: DecisionTraceRepo;
    signalObservations: SignalObservationsRepo;
    signalLabels: SignalLabelsRepo;
    modelVersions: ModelVersionsRepo;
    backtestRuns: BacktestRunsRepo;
    promotionDecisions: PromotionDecisionsRepo;
    workspacePreferences: WorkspacePreferencesRepo;
    instrumentCache: InstrumentCacheRepo;
    globalPresets: GlobalPresetsRepo;
    riskPresets: RiskPresetsRepo;
    timeframePresets: TimeframePresetsRepo;
    researchPosturePresets: ResearchPosturePresetsRepo;
    tradeRulePresets: TradeRulePresetsRepo;
  };
  ai: LLMRuntime;
  providerRegistry: ProviderRegistry;
  searchRegistry: SearchRegistry;
  brokerRegistry: BrokerRegistry;
  broker: BrokerService;
  brokerCapital: BrokerCapitalService;
  brokerBalanceCache: BrokerBalanceCacheService;
  brokerAllocationGate: BrokerAllocationGate;
  balanceTicker: BrokerBalanceTicker;
  capitalReservation: CapitalReservationService;
  eventBus: EventBus;
  notifications: NotificationService;
  marketData: MarketDataService;
  supervisor: SupervisorService;
  runtimeManager: SessionRuntimeManager;
  risk: RiskEngine;
  secrets: SecretsService;
  session: SessionService;
  sessionListing: SessionListingService;
  strategyContext: SessionStrategyContextService;
  sessionTemplates: SessionTemplateService;
  sessionWrites: SessionWriteService;
  cycleReplay: CycleReplayService;
  paperScorecard: PaperScorecardService;
  experienceScorecard: ExperienceScorecardService;
  experienceCapitalAllocator: ExperienceCapitalAllocator;
  researchSummary: ResearchSummaryService;
  signalObservation: SignalObservationService;
  labelBuilder: LabelBuilderService;
  researchExperiment: ResearchExperimentService;
  periodAutopsy: PeriodAutopsyService;
  liveReadiness: LiveReadinessService;
  tradeAutopsy: TradeAutopsyService;
  autopsyExport: AutopsyExportService;
  signals: SignalService;
  sessionScheduler: SessionScheduler;
  controlRepo: ControlRepo;
  control: ControlAgentService;
}

export async function createAppServices(app: App): Promise<AppServices> {
  // userData represent /Library/Application Support/App, think of it where your app files config lives
  const db = createDbClient(app.getPath("userData"));
  const repos = {
    agentRuns: new AgentRunsRepo(db),
    agentMessages: new AgentMessagesRepo(db),
    apiCallLog: new ApiCallLogRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    capitalReservations: new CapitalReservationsRepo(db),
    events: new EventsRepo(db),
    providerAccounts: new ProviderAccountsRepo(db),
    sessionAiPhases: new SessionAiPhasesRepo(db),
    sessionBrokerAssignments: new SessionBrokerAssignmentsRepo(db),
    sessionRiskConfig: new SessionRiskConfigRepo(db),
    sessionSelectorSettings: new SessionSelectorSettingsRepo(db),
    sessionExecutionSteps: new SqliteSessionExecutionStepsRepo(db),
    session: new SessionRepo(db),
    sessionTradeRules: new SessionTradeRulesRepo(db),
    sessionStrategies: new SessionStrategiesRepo(db),
    sessionTemplates: new SessionTemplatesRepo(db),
    sessionTimeframeConfig: new SessionTimeframeConfigRepo(db),
    sessionResearchPosture: new SessionResearchPostureRepo(db),
    sessionAiSettings: new SessionAiSettingsRepo(db),
    stats: new StatsRepo(db),
    tradeApprovals: new TradeApprovalsRepo(db),
    periodAutopsies: new PeriodAutopsiesRepo(db),
    tradeAutopsies: new TradeAutopsiesRepo(db),
    experienceExperiments: new ExperienceExperimentsRepo(db),
    autopsyLessons: new AutopsyLessonsRepo(db),
    trades: new TradesRepo(db),
    decisionTraces: new DecisionTraceRepo(db),
    signalObservations: new SignalObservationsRepo(db),
    signalLabels: new SignalLabelsRepo(db),
    modelVersions: new ModelVersionsRepo(db),
    backtestRuns: new BacktestRunsRepo(db),
    promotionDecisions: new PromotionDecisionsRepo(db),
    workspacePreferences: new WorkspacePreferencesRepo(db),
    instrumentCache: new InstrumentCacheRepo(db),
    globalPresets: new GlobalPresetsRepo(db),
    riskPresets: new RiskPresetsRepo(db),
    timeframePresets: new TimeframePresetsRepo(db),
    researchPosturePresets: new ResearchPosturePresetsRepo(db),
    tradeRulePresets: new TradeRulePresetsRepo(db),
  };
  const signalSourcesRepo = new SignalSourcesRepo(db);
  const signalEventsRepo = new SignalEventsRepo(db);
  const signalDeliveriesRepo = new SignalDeliveriesRepo(db);
  const signalDeadLettersRepo = new SignalDeadLettersRepo(db);
  const secrets = new SecretsService();
  await seedEnvBackedAccountSecrets(repos, secrets);
  const brokerRegistry = new BrokerRegistry(
    repos.brokerAccounts,
    secrets,
    repos.apiCallLog,
  );
  const instrumentNormalizer = new InstrumentNormalizer();
  const logger = createLogger("app-services");
  const brokerRouting = new BrokerRoutingService(
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    repos.brokerRouting,
    brokerRegistry,
  );
  const brokerBalanceCache = new BrokerBalanceCacheService(
    repos.brokerAccounts,
    brokerRegistry,
  );
  const brokerCapital = new BrokerCapitalService(
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    repos.session,
  );
  const brokerAllocationGate = new BrokerAllocationGate(
    repos.sessionBrokerAssignments,
    repos.trades,
    repos.workspacePreferences,
    repos.brokerAccounts,
  );
  const capitalReservation = new CapitalReservationService(
    repos.capitalReservations,
  );
  const broker = new BrokerService(brokerRegistry);

  const eventBus = new EventBus();
  const signalDeliveryLifecycle = new SignalDeliveryLifecycle(
    signalDeliveriesRepo,
    eventBus,
  );
  attachEventBusObserver(eventBus, logger);
  const balanceTicker = new BrokerBalanceTicker(
    repos.brokerAccounts,
    brokerBalanceCache,
    eventBus,
    logger,
  );
  const risk = new RiskEngine();
  const providerRegistry = new ProviderRegistry(
    repos.providerAccounts,
    secrets,
  );
  const searchRegistry = new SearchRegistry(repos.providerAccounts, secrets);
  const notifications = new NotificationService(eventBus);
  const marketData = new MarketDataService(db);
  // Resolve OHLCV through the first Alpaca account when one exists; otherwise
  // the fetcher returns [] so MarketDataService can still serve DB-cached bars.
  marketData.registerFetcher("alpaca", async (input) => {
    const alpacaAccount = repos.brokerAccounts
      .list()
      .find((account) => account.brokerType === "alpaca");
    if (!alpacaAccount) return [];
    try {
      const adapter = await brokerRegistry.get(alpacaAccount.id);
      if (!adapter.getOhlcv) return [];
      const timeframe =
        input.timeframe === "1w"
          ? "1d"
          : input.timeframe === "15m" ||
              input.timeframe === "30m" ||
              input.timeframe === "1h" ||
              input.timeframe === "4h" ||
              input.timeframe === "1d"
            ? input.timeframe
            : "1d";
      return adapter.getOhlcv(input.symbol, timeframe, input.barCount);
    } catch {
      return [];
    }
  });
  const calibration = new CalibrationService();
  const supervisor = new SupervisorService({
    eventBus,
    notifications,
    marketData,
    nightlyResearch: { calibration },
  });
  supervisor.start();
  const candidateValidation = new CandidateValidationService();
  const orderPolicyGate = new OrderPolicyGate();
  const exitPolicyEvaluator = new ExitPolicyEvaluator();
  const strategyContext = new SessionStrategyContextService({
    sessionRepo: repos.session,
    researchPostureRepo: repos.sessionResearchPosture,
    rulesRepo: repos.sessionTradeRules,
    riskRepo: repos.sessionRiskConfig,
    timeframeRepo: repos.sessionTimeframeConfig,
    aiSettingsRepo: repos.sessionAiSettings,
    selectorSettingsRepo: repos.sessionSelectorSettings,
    providerAccountsRepo: repos.providerAccounts,
    workspacePrefsRepo: repos.workspacePreferences,
    sessionAiPhasesRepo: repos.sessionAiPhases,
    signalSourceTypes: signalSourcesRepo,
  });
  const cyclePlanServicesDeps = {
    sessionSelectorSettingsRepo: repos.sessionSelectorSettings,
    sessionAiPhasesRepo: repos.sessionAiPhases,
    workspacePreferencesRepo: repos.workspacePreferences,
    instrumentCacheRepo: repos.instrumentCache,
    agentRunsRepo: repos.agentRuns,
    agentMessagesRepo: repos.agentMessages,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerAccountsRepo: repos.brokerAccounts,
    brokerRouting,
    statsRepo: repos.stats,
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    decisionTracesRepo: repos.decisionTraces,
    instrumentNormalizer,
  };
  const ai = new LLMRuntime(
    providerRegistry,
    searchRegistry,
    repos.sessionAiPhases,
    repos.session,
    repos.workspacePreferences,
    repos.apiCallLog,
    repos.agentRuns,
    brokerRouting,
    brokerRegistry,
    strategyContext,
    cyclePlanServicesDeps,
    cyclePlanServicesDeps,
  );
  registerDefaultEngines({
    riskEngine: risk,
    candidateValidation,
    orderPolicyGate,
    brokerAllocationGate,
    exitPolicyEvaluator,
  });
  registerAllPhases();
  registerDefaultInstrumentAnalyses();
  assertValidPipelineDefinitionCatalog();
  balanceTicker.start();

  // reason: forward reference — createTradeMonitor closure reads runtimeManager before it's assigned below
  // eslint-disable-next-line prefer-const
  let runtimeManager: SessionRuntimeManager;
  const orchestratorDepsBase: OrchestratorDeps = {
    sessionRepo: repos.session,
    sessionStrategiesRepo: repos.sessionStrategies,
    strategyContextService: strategyContext,
    tradesRepo: repos.trades,
    decisionTracesRepo: repos.decisionTraces,
    tradeApprovalsRepo: repos.tradeApprovals,
    agentRunsRepo: repos.agentRuns,
    agentMessagesRepo: repos.agentMessages,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
    sessionAiPhasesRepo: repos.sessionAiPhases,
    sessionSelectorSettingsRepo: repos.sessionSelectorSettings,
    sessionExecutionStepsRepo: repos.sessionExecutionSteps,
    providerAccountsRepo: repos.providerAccounts,
    workspacePreferencesRepo: repos.workspacePreferences,
    capitalReservationsRepo: repos.capitalReservations,
    capitalReservation,
    brokerRoutingRepo: repos.brokerRouting,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerAccountsRepo: repos.brokerAccounts,
    brokerRegistry,
    brokerRouting,
    brokerBalanceCache,
    brokerCapital,
    brokerAllocationGate,
    instrumentNormalizer,
    ai,
    riskEngine: risk,
    bus: eventBus,
    logger,
    instrumentCacheRepo: repos.instrumentCache,
    signalObservationsRepo: repos.signalObservations,
    signalDeliveriesRepo,
    signalDeliveryLifecycle,
    signalSourcesRepo,
  };

  const runtimeManagerDeps: SessionRuntimeManagerDeps = {
    ...orchestratorDepsBase,
    createOrchestrator: (sessionId, deps) =>
      new AgentOrchestrator(sessionId, deps),
    createTradeMonitor: (sessionId) => {
      const assignments =
        repos.sessionBrokerAssignments.listAssignments(sessionId);
      const isMockSession = assignments.some((a) =>
        brokerRegistry.isMockAccount(a.brokerAccountId),
      );
      return new TradeMonitor(
        sessionId,
        repos.trades,
        repos.stats,
        repos.session,
        brokerRegistry,
        strategyContext,
        capitalReservation,
        () => 100000,
        eventBus,
        () => strategyContext.get(sessionId).riskConfig.maxAiSpendUsd,
        () => runtimeManager.get(sessionId)?.uptimeMin() ?? 0,
        instrumentNormalizer,
        isMockSession ? MOCK_POLL_INTERVAL_MS : undefined,
      );
    },
  };
  runtimeManager = new SessionRuntimeManager(
    runtimeManagerDeps,
    env.utilityProcessRuntimes
      ? new UtilityProcessSessionRuntimeHost(
          runtimeManagerDeps,
          eventBus,
          logger,
        )
      : new InProcessSessionRuntimeHost(runtimeManagerDeps),
  );

  const instrumentCacheService = new InstrumentCacheService(
    repos.instrumentCache,
    () => orchestratorDepsBase,
  );

  const paperScorecard = new PaperScorecardService({
    trades: repos.trades,
    brokerAccounts: repos.brokerAccounts,
    apiCallLog: repos.apiCallLog,
    session: repos.session,
    sessionExecutionSteps: repos.sessionExecutionSteps,
  });

  const experienceScorecard = new ExperienceScorecardService({
    trades: repos.trades,
    brokerAccounts: repos.brokerAccounts,
    brokerAssignments: repos.sessionBrokerAssignments,
    session: repos.session,
    apiCallLog: repos.apiCallLog,
  });
  const experienceCapitalAllocator = new ExperienceCapitalAllocator(
    experienceScorecard,
  );
  const researchSummary = new ResearchSummaryService(experienceScorecard);

  const signalObservation = new SignalObservationService(
    repos.signalObservations,
  );
  const labelBuilder = new LabelBuilderService({
    observations: repos.signalObservations,
    labels: repos.signalLabels,
    logger,
  });
  const labelBuilderTicker = new LabelBuilderTicker(
    labelBuilder,
    createBrokerForwardReturnResolver({
      brokerRouting,
      instrumentNormalizer,
      logger,
    }),
    logger,
  );
  labelBuilderTicker.start();
  const researchExperiment = new ResearchExperimentService({
    observations: repos.signalObservations,
    labels: repos.signalLabels,
    modelVersions: repos.modelVersions,
    backtestRuns: repos.backtestRuns,
    promotionDecisions: repos.promotionDecisions,
  });
  const driftMonitorTicker = new DriftMonitorTicker(
    researchExperiment,
    repos.session,
    repos.events,
    logger,
  );
  driftMonitorTicker.start();

  ai.setExperienceCapitalAllocator(experienceCapitalAllocator);

  const liveReadiness = new LiveReadinessService(
    db,
    repos.session,
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    brokerRegistry,
    paperScorecard,
    experienceScorecard,
    researchExperiment,
  );

  const session = new SessionService({
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    eventsRepo: repos.events,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerRegistry,
    brokerBalanceCache,
    runtimeManager,
    preflight: runPreflight,
    orchestratorDeps: orchestratorDepsBase,
    liveReadiness,
  });

  const sessionTemplates = new SessionTemplateService({
    templates: repos.sessionTemplates,
    sessions: repos.session,
    strategyContext,
    selectorSettings: repos.sessionSelectorSettings,
    brokerAssignments: repos.sessionBrokerAssignments,
    brokerRouting: repos.brokerRouting,
    providerAccounts: repos.providerAccounts,
    brokerAccounts: repos.brokerAccounts,
  });

  const cycleReplay = new CycleReplayService({
    agentMessages: repos.agentMessages,
    trades: repos.trades,
    instrumentCache: repos.instrumentCache,
    sessionExecutionSteps: repos.sessionExecutionSteps,
    userDataPath: app.getPath("userData"),
  });

  const tradeAutopsy = new TradeAutopsyService({
    trades: repos.trades,
    agentMessages: repos.agentMessages,
    autopsies: repos.tradeAutopsies,
    lessons: repos.autopsyLessons,
    providerRegistry,
    workspacePrefs: repos.workspacePreferences,
  });
  const periodAutopsy = new PeriodAutopsyService({
    sessions: repos.session,
    trades: repos.trades,
    tradeAutopsies: repos.tradeAutopsies,
    agentMessages: repos.agentMessages,
    autopsies: repos.periodAutopsies,
    lessons: repos.autopsyLessons,
    events: repos.events,
    providerRegistry,
    workspacePrefs: repos.workspacePreferences,
    eventBus,
  });
  const autopsyExport = new AutopsyExportService();
  const signalBus = new SignalBus(
    signalEventsRepo,
    signalDeliveriesRepo,
    signalDeadLettersRepo,
    signalSourcesRepo,
    repos.session,
    repos.sessionBrokerAssignments,
    repos.brokerAccounts,
    brokerRouting,
    eventBus,
    instrumentNormalizer,
  );
  const sessionScheduler = new SessionScheduler(async (signals) => {
    for (const sig of signals) {
      // Dual-read: rules experiences still gate on sourceType "timer".
      await signalBus.ingestMarketSignal(sig, "timer");
    }
  });
  registerRulesScheduledScans({
    scheduler: sessionScheduler,
    marketData,
    sourcesRepo: signalSourcesRepo,
  });
  sessionScheduler.start();
  const signalRegistry = new SignalSourceRegistry(db, signalBus);
  const sessionListing = new SessionListingService({
    sessionRepo: repos.session,
    assignments: repos.sessionBrokerAssignments,
    trades: repos.trades,
    runtimeManager,
    signalSources: signalSourcesRepo,
    signalRegistry,
    brokerAccounts: repos.brokerAccounts,
  });
  const signals = new SignalService(
    signalSourcesRepo,
    signalEventsRepo,
    signalDeliveriesRepo,
    signalDeadLettersRepo,
    signalRegistry,
    signalBus,
    repos.session,
  );
  runtimeManagerDeps.signals = signals;
  const sessionWrites = new SessionWriteService({
    sessions: repos.session,
    events: repos.events,
    selectorSettings: repos.sessionSelectorSettings,
    assignments: repos.sessionBrokerAssignments,
    brokerRouting: repos.brokerRouting,
    brokerAccounts: repos.brokerAccounts,
    liveReadiness,
    signals,
    syncMockRehearsalSignalSourceTicker: (ticker) => {
      if (!isMockRehearsalEnabled()) return;
      syncMockRehearsalRuntimeTicker(signalSourcesRepo, signalRegistry, ticker);
    },
  });
  signals.bootstrapFromDb();
  signals.ensureAllExperienceSignalSources();
  bootstrapMockRehearsal({
    sourcesRepo: signalSourcesRepo,
    registry: signalRegistry,
    sessions: repos.session.list({ includeArchived: true }),
    listAssignments: (sessionId) =>
      repos.sessionBrokerAssignments.listAssignments(sessionId),
    brokerAccounts: repos.brokerAccounts.list().map((broker) => ({
      id: broker.id,
      brokerType: broker.brokerType,
      mockScenarioKind: broker.mockScenarioKind ?? null,
    })),
  });

  const controlRepo = new ControlRepo(db);
  // reason: ControlAgentService needs the fully-built container; resolve it lazily.
  // eslint-disable-next-line prefer-const
  let appServices: AppServices;
  const control = new ControlAgentService({
    repo: controlRepo,
    providerRegistry,
    apiCallLog: repos.apiCallLog,
    workspacePrefs: repos.workspacePreferences,
    eventBus,
    getServices: () => appServices,
  });

  appServices = {
    db,
    orchestratorDeps: orchestratorDepsBase,
    instrumentCacheService,
    repos,
    ai,
    providerRegistry,
    searchRegistry,
    brokerRegistry,
    broker,
    brokerCapital,
    brokerBalanceCache,
    brokerAllocationGate,
    balanceTicker,
    capitalReservation,
    eventBus,
    notifications,
    marketData,
    supervisor,
    runtimeManager,
    risk,
    secrets,
    session,
    sessionListing,
    strategyContext,
    sessionTemplates,
    sessionWrites,
    cycleReplay,
    paperScorecard,
    experienceScorecard,
    experienceCapitalAllocator,
    researchSummary,
    signalObservation,
    labelBuilder,
    researchExperiment,
    periodAutopsy,
    liveReadiness,
    tradeAutopsy,
    autopsyExport,
    signals,
    sessionScheduler,
    controlRepo,
    control,
  };
  return appServices;
}

function registerRulesScheduledScans(input: {
  scheduler: SessionScheduler;
  marketData: MarketDataService;
  sourcesRepo: import("./signals/repos/signal-sources-repo").SignalSourcesRepo;
}): void {
  const specs: Array<{
    experience: ExperienceDescriptor;
    strategyId: RulesStrategyId;
    marketHours: "regular" | "extended" | "24_7";
  }> = [
    {
      experience: RULES_MEAN_REVERSION_EXPERIENCE,
      strategyId: "mean-reversion",
      marketHours: "regular",
    },
    {
      experience: RULES_BREAKOUT_EXPERIENCE,
      strategyId: "breakout",
      marketHours: "24_7",
    },
    {
      experience: RULES_TREND_FOLLOWING_EXPERIENCE,
      strategyId: "trend-following",
      marketHours: "24_7",
    },
    {
      experience: OPTIONS_FLOW_EDGE_EXPERIENCE,
      strategyId: "options-flow",
      marketHours: "regular",
    },
  ];

  for (const { experience, strategyId, marketHours } of specs) {
    for (const signal of experience.signals) {
      if (!signal.symbol || !signal.pollCadence) continue;
      const sourceId = signalSourceId(experience.id, signal.id);
      // Identity row for subscription/fan-out only — SessionScheduler owns cadence.
      if (!input.sourcesRepo.get(sourceId)) {
        input.sourcesRepo.create({
          id: sourceId,
          type: "timer",
          name: signalDisplayName(signal),
          description: `${experience.displayName} schedule identity (SessionScheduler)`,
          enabled: signal.enabledByDefault,
          experienceId: experience.id,
          instrumentClass: signal.instrumentClass,
          pollCadence: signal.pollCadence,
          analysisTimeframe: signal.defaultAnalysisTimeframe,
          pipelineId: experience.pipelineId,
          configJson: JSON.stringify({
            signalId: signal.id,
            symbol: signal.symbol,
            cadence: signal.pollCadence,
            pollCadence: signal.pollCadence,
            analysisTimeframe: signal.defaultAnalysisTimeframe,
            instrumentClass: signal.instrumentClass,
          }),
        });
      }

      input.scheduler.register(
        createRulesScheduledScan({
          id: sourceId,
          experienceId: experience.id,
          strategyId,
          symbol: signal.symbol,
          instrumentClass: signal.instrumentClass,
          analysisTimeframe: signal.defaultAnalysisTimeframe ?? "1h",
          schedule: {
            cadence: signal.pollCadence,
            marketHours,
            jitterPct: 0.05,
          },
          getBars: async (symbol, tf, count) =>
            input.marketData.getBars({
              symbol,
              instrumentClass: signal.instrumentClass,
              timeframe: asTradingTimeframe(tf),
              barCount: count,
            }),
        }),
      );
    }
  }
}

async function seedEnvBackedAccountSecrets(
  repos: AppServices["repos"],
  secrets: SecretsService,
): Promise<void> {
  if (
    env.openRouterKey &&
    env.openRouterModel &&
    repos.providerAccounts.find(SEEDED_OPENROUTER_PROVIDER_ID)
  ) {
    await secrets.set(SEEDED_OPENROUTER_SECRET_REF, env.openRouterKey);
  }

  if (
    env.alpacaApiKey &&
    env.alpacaSecretKey &&
    repos.brokerAccounts.find(SEEDED_ALPACA_BROKER_ID)
  ) {
    await secrets.set(
      SEEDED_ALPACA_SECRET_REF,
      JSON.stringify({
        provider: "alpaca" as const,
        api_key: env.alpacaApiKey,
        secret_key: env.alpacaSecretKey,
        mode: "paper" as const,
      }),
    );
  }
}
