import type { App } from "electron";
import { env } from "../config/env";
import { createDbClient } from "@main/db/client";
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
import { AgentOrchestrator } from "./orchestration/cycle/agent-orchestrator";
import { registerDefaultEngines } from "./signal/registry/register-default-engines";
import { assertValidPipelineDefinitionCatalog } from "./pipeline/effective-ai-phase-config";
import { registerAllPhases } from "./pipeline/definitions";
import { registerDefaultInstrumentAnalyses } from "./pipeline/implementations/registry/register-analyses";
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
import { TradeMonitor } from "./orchestration/lifecycle/trade-monitor";
import { CycleReplayService } from "./replay/cycle-replay-service";
import { InstrumentCacheService } from "./instrument";
import {
  BrokerAllocationGate,
  CapitalReservationService,
  RiskEngine,
} from "./risk";
import { PaperScorecardService } from "./analytics/paper-scorecard-service";
import { PeriodAutopsyService } from "./analytics/period-autopsy-service";
import { TradeAutopsyService } from "./analytics/trade-autopsy-service";
import { AutopsyExportService } from "./analytics/autopsy-export-service";
import { LiveReadinessService } from "./risk/live-readiness-service";

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
    autopsyLessons: AutopsyLessonsRepo;
    trades: TradesRepo;
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
  periodAutopsy: PeriodAutopsyService;
  liveReadiness: LiveReadinessService;
  tradeAutopsy: TradeAutopsyService;
  autopsyExport: AutopsyExportService;
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
    autopsyLessons: new AutopsyLessonsRepo(db),
    trades: new TradesRepo(db),
    workspacePreferences: new WorkspacePreferencesRepo(db),
    instrumentCache: new InstrumentCacheRepo(db),
    globalPresets: new GlobalPresetsRepo(db),
    riskPresets: new RiskPresetsRepo(db),
    timeframePresets: new TimeframePresetsRepo(db),
    researchPosturePresets: new ResearchPosturePresetsRepo(db),
    tradeRulePresets: new TradeRulePresetsRepo(db),
  };
  const secrets = new SecretsService();
  const brokerRegistry = new BrokerRegistry(repos.brokerAccounts, secrets);
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
  };

  const runtimeManagerDeps: SessionRuntimeManagerDeps = {
    ...orchestratorDepsBase,
    createOrchestrator: (sessionId, deps) =>
      new AgentOrchestrator(sessionId, deps),
    createTradeMonitor: (sessionId) =>
      new TradeMonitor(
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
      ),
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

  const liveReadiness = new LiveReadinessService(
    db,
    repos.session,
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    brokerRegistry,
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

  const sessionListing = new SessionListingService({
    sessionRepo: repos.session,
    assignments: repos.sessionBrokerAssignments,
    trades: repos.trades,
    runtimeManager,
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

  const sessionWrites = new SessionWriteService({
    sessions: repos.session,
    events: repos.events,
    selectorSettings: repos.sessionSelectorSettings,
    assignments: repos.sessionBrokerAssignments,
    brokerRouting: repos.brokerRouting,
    brokerAccounts: repos.brokerAccounts,
    liveReadiness,
  });

  const cycleReplay = new CycleReplayService({
    agentMessages: repos.agentMessages,
    trades: repos.trades,
    instrumentCache: repos.instrumentCache,
    sessionExecutionSteps: repos.sessionExecutionSteps,
    userDataPath: app.getPath("userData"),
  });

  const paperScorecard = new PaperScorecardService({
    trades: repos.trades,
    apiCallLog: repos.apiCallLog,
    session: repos.session,
    sessionExecutionSteps: repos.sessionExecutionSteps,
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

  return {
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
    periodAutopsy,
    liveReadiness,
    tradeAutopsy,
    autopsyExport,
  };
}
