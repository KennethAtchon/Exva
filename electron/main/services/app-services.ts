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
import { PaperBalancesRepo } from "../db/repositories/brokers/paper-balances-repo";
import { PaperPositionsRepo } from "../db/repositories/brokers/paper-positions-repo";
import { CapitalReservationsRepo } from "../db/repositories/trades/capital-reservations-repo";
import { EventsRepo } from "../db/repositories/system/events-repo";
import { ProviderAccountsRepo } from "../db/repositories/workspace/provider-accounts-repo";
import { SessionBrokerAssignmentsRepo } from "../db/repositories/sessions/session-broker-assignments-repo";
import { SessionTemplatesRepo } from "../db/repositories/sessions/session-templates-repo";
import { SqliteSessionExecutionStepsRepo } from "../db/repositories/sessions/session-execution-steps-repo";
import { SessionRepo } from "../db/repositories/sessions/session-repo";
import { InstrumentCacheRepo } from "../db/repositories/market/instrument-cache-repo";
import { StatsRepo } from "../db/repositories/system/stats-repo";
import { TradeApprovalsRepo } from "../db/repositories/trades/trade-approvals-repo";
import { AutopsiesRepo } from "../db/repositories/trades/autopsies-repo";
import { AutopsyLessonsRepo } from "../db/repositories/trades/autopsy-lessons-repo";
import { TradesRepo } from "../db/repositories/trades/trades-repo";
import { DecisionTraceRepo } from "../db/repositories/trades/decision-trace-repo";
import { SignalObservationsRepo } from "../db/repositories/research/signal-observations-repo";
import { SignalLabelsRepo } from "../db/repositories/research/signal-labels-repo";
import { CalendarEventsRepo } from "../db/repositories/signals/calendar-events-repo";
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
import type { LabelObservation } from "./signals/forecast/calibration-service";
import { SupervisorService } from "./supervisor/supervisor-service";
import {
  parseTelegramSecretJson,
  telegramCredsFromEnv,
} from "./supervisor/notification-sinks";
import { backupSqliteDb } from "./infra/db-backup";
import type { NightlyResearchJobDeps } from "./research/nightly-jobs";
import {
  periodAutopsyNightlyFlagsFromEnv,
  runPeriodAutopsyNightly,
} from "./research/period-autopsy-nightly";
import {
  approveLadderUpgrade,
  tickLadderAutomation,
  type LadderAutomationDeps,
  type LadderState,
} from "./research/ladder-automation";
import { evaluatePromotion } from "./research/promotion-gate";
import { listExperiences, requireExperience } from "../experiences/index";
import type {
  InstrumentClass,
  TradingTimeframe,
} from "@electron/shared/domain/enums";
import { AgentOrchestrator } from "./orchestration/cycle/agent-orchestrator";
import { registerDefaultEngines } from "./pipeline/engines/signal-registry/register-default-engines";
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
import { SessionStrategyConfigService } from "./session/session-strategy-config-service";
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
import { BriefingsRepo } from "../db/repositories/system/briefings-repo";
import { EquitySnapshotsRepo } from "../db/repositories/system/equity-snapshots-repo";
import { PeriodAutopsyService } from "./analytics/period-autopsy-service";
import { TradeAutopsyService } from "./analytics/trade-autopsy-service";
import { AutopsyExportService } from "./analytics/autopsy-export-service";
import { LiveReadinessService } from "./risk/live-readiness-service";
import { PaletteQueryService } from "./operator/palette-query-service";
import { BacktestLabService } from "./operator/backtest-lab-service";
import { DataDoctorService } from "./operator/data-doctor-service";
import { MorningBriefingService } from "./operator/morning-briefing-service";
import { EquitySnapshotService } from "./operator/equity-snapshot-service";
import { WhatIfReplayService } from "./operator/what-if-replay-service";
import { KillSwitchService } from "./operator/kill-switch-service";
import type { KillSwitchGauge } from "./operator/kill-switch-service";
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
import { bootstrapMockRehearsal } from "../experiences/mock-rehearsal-bootstrap";
import { seedExperienceCatalog } from "./experience-catalog/seed-experience-catalog";
import { createExperienceTemplateService } from "./experience-catalog/experience-template-service";
import { InstrumentSetService } from "./instruments/instrument-set-service";
import { InstrumentSetRepo } from "./instruments/instrument-set-repo";
import { SourceDefinitionService } from "./signals/source-definition-service";
import { SourceDefinitionRepo } from "./signals/source-definition-repo";
import { SessionInputConfigurationService } from "./session-inputs/session-input-configuration-service";
import { getStrategyDefinitionRegistry } from "./strategies/index";
import { createSourceAdapterRegistry } from "./signals/adapters/source-adapter-registry";
import { CikTickerCache } from "./signals/cache/cik-ticker-cache";
import { ScheduleCoordinator } from "./scheduling/schedule-coordinator";
import { SessionInputRuntimePlanner } from "./scheduling/session-input-runtime-planner";
import { ScheduledStrategyExecutor } from "./scheduling/scheduled-strategy-executor";
import { MarketCalendarRegistry } from "./scheduling/market-calendar-registry";
import { SubscriptionFanoutResolver } from "./signals/subscription-fanout-resolver";
import type { ExperienceTemplateService } from "./experience-catalog/experience-template-service";
import { INPUT_PROFILE_IDS } from "./experience-catalog/input-profile-seeds";
import { TEMPLATE_IDS } from "./experience-catalog/experience-template-seeds";

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
    paperBalances: PaperBalancesRepo;
    paperPositions: PaperPositionsRepo;
    capitalReservations: CapitalReservationsRepo;
    events: EventsRepo;
    providerAccounts: ProviderAccountsRepo;
    sessionBrokerAssignments: SessionBrokerAssignmentsRepo;
    sessionExecutionSteps: SqliteSessionExecutionStepsRepo;
    session: SessionRepo;
    sessionTemplates: SessionTemplatesRepo;
    stats: StatsRepo;
    tradeApprovals: TradeApprovalsRepo;
    autopsies: AutopsiesRepo;
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
    briefings: BriefingsRepo;
    equitySnapshots: EquitySnapshotsRepo;
  };
  calendarEventsRepo: CalendarEventsRepo;
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
  strategyConfig: SessionStrategyConfigService;
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
  controlRepo: ControlRepo;
  control: ControlAgentService;
  /** In-memory promotion ladder states (experienceId → state). */
  ladderStates: Map<string, LadderState>;
  /** Operator tap to accept a pending ladder upgrade. */
  approveLadderUpgrade: (experienceId: string) => LadderState | null;
  /** Tick ladder automation for all known experiences (also runs nightly). */
  tickLadderAutomation: () => void;
  // V2 configurable session inputs
  experienceTemplateService: ExperienceTemplateService;
  instrumentSetService: InstrumentSetService;
  sourceDefinitionService: SourceDefinitionService;
  sessionInputConfiguration: SessionInputConfigurationService;
  scheduleCoordinator: ScheduleCoordinator;
  // Finish-line 08 operator power tools
  paletteQuery: PaletteQueryService;
  backtestLab: BacktestLabService;
  dataDoctor: DataDoctorService;
  morningBriefing: MorningBriefingService;
  equitySnapshots: EquitySnapshotService;
  whatIfReplay: WhatIfReplayService;
  killSwitch: KillSwitchService;
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
    paperBalances: new PaperBalancesRepo(db),
    paperPositions: new PaperPositionsRepo(db),
    capitalReservations: new CapitalReservationsRepo(db),
    events: new EventsRepo(db),
    providerAccounts: new ProviderAccountsRepo(db),
    sessionBrokerAssignments: new SessionBrokerAssignmentsRepo(db),
    sessionExecutionSteps: new SqliteSessionExecutionStepsRepo(db),
    session: new SessionRepo(db),
    sessionTemplates: new SessionTemplatesRepo(db),
    stats: new StatsRepo(db),
    tradeApprovals: new TradeApprovalsRepo(db),
    autopsies: new AutopsiesRepo(db),
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
    briefings: new BriefingsRepo(db),
    equitySnapshots: new EquitySnapshotsRepo(db),
  };
  const signalSourcesRepo = new SignalSourcesRepo(db);
  const signalEventsRepo = new SignalEventsRepo(db);
  const signalDeliveriesRepo = new SignalDeliveriesRepo(db);
  const signalDeadLettersRepo = new SignalDeadLettersRepo(db);
  const calendarEventsRepo = new CalendarEventsRepo(db);
  const secrets = new SecretsService();
  await seedEnvBackedAccountSecrets(repos, secrets);
  const brokerRegistry = new BrokerRegistry(
    repos.brokerAccounts,
    secrets,
    repos.apiCallLog,
    repos.paperBalances,
    repos.paperPositions,
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
    } catch (err) {
      // Returning [] is correct for market-data coalesce; log so bars outages aren't silent.
      logger.warn(
        { err, symbol: input.symbol, broker: "alpaca" },
        "ohlcv fetch failed; returning empty bars",
      );
      return [];
    }
  });
  marketData.registerFetcher("tradier", async (input) => {
    const account = repos.brokerAccounts
      .list()
      .find((a) => a.brokerType === "tradier");
    if (!account) return [];
    try {
      const adapter = await brokerRegistry.get(account.id);
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
    } catch (err) {
      logger.warn(
        { err, symbol: input.symbol, broker: "tradier" },
        "ohlcv fetch failed; returning empty bars",
      );
      return [];
    }
  });
  marketData.registerFetcher("kraken", async (input) => {
    const { fetchKrakenOhlcv } =
      await import("./broker/adapters/kraken-adapter");
    try {
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
      return await fetchKrakenOhlcv(input.symbol, timeframe, input.barCount);
    } catch (err) {
      logger.warn(
        { err, symbol: input.symbol, broker: "kraken" },
        "ohlcv fetch failed; returning empty bars",
      );
      return [];
    }
  });
  const calibration = new CalibrationService();
  const nightlyResearch: NightlyResearchJobDeps = { calibration };
  // Wired after SessionService / strategyContext exist (forward refs).
  let pauseSessionForSupervisor:
    | ((sessionId: string, reason: string) => Promise<void>)
    | null = null;
  let loadRiskSnapshotsForSupervisor:
    | (() => ReturnType<typeof loadSessionRiskSnapshots>)
    | null = null;
  let telegramCredsCache: ReturnType<typeof telegramCredsFromEnv> = null;
  const supervisor = new SupervisorService({
    eventBus,
    notifications,
    marketData,
    ntfyTopicUrl: env.ntfyTopicUrl,
    smtpUrl: env.smtpUrl,
    resolveTelegram: () => telegramCredsFromEnv() ?? telegramCredsCache,
    nightlyResearch,
    pauseSession: (sessionId, reason) =>
      pauseSessionForSupervisor?.(sessionId, reason),
    loadRiskSnapshots: () => loadRiskSnapshotsForSupervisor?.() ?? [],
    loadAiSpendBySession: () => {
      const sessions = repos.session.listByStatuses([
        "active",
        "attention_required",
        "monitoring_only",
        "paused",
      ]);
      return sessions.map((session) => ({
        sessionId: session.id,
        spendUsd: repos.apiCallLog.dailyDataSpendUsd(session.id),
      }));
    },
  });
  supervisor.start();
  brokerRegistry.setSupervisor(supervisor);
  void secrets.get("notify:telegram").then((raw) => {
    telegramCredsCache = parseTelegramSecretJson(raw);
  });
  const ladderStates = new Map<string, LadderState>();
  const makeLadderDeps = (): LadderAutomationDeps => ({
    getState: (experienceId) => ladderStates.get(experienceId) ?? null,
    setState: (state) => {
      ladderStates.set(state.experienceId, state);
    },
    evaluateEligibility: (experienceId) => {
      const experience = requireExperience(experienceId);
      const observations =
        repos.signalObservations.listByExperience(experienceId);
      const labels = observations.flatMap((obs) =>
        repos.signalLabels.listByObservation(obs.id),
      );
      return evaluatePromotion(experience.researchContract, labels);
    },
    notify: (title, body) => notifications.notify(title, body, "INFO"),
  });
  const tickAllLadders = (): void => {
    for (const experience of listExperiences()) {
      tickLadderAutomation(makeLadderDeps(), experience.id);
    }
  };
  const approveLadderUpgradeForExperience = (
    experienceId: string,
  ): LadderState | null => approveLadderUpgrade(makeLadderDeps(), experienceId);
  const candidateValidation = new CandidateValidationService();
  const orderPolicyGate = new OrderPolicyGate();
  const exitPolicyEvaluator = new ExitPolicyEvaluator();
  const strategyConfig = new SessionStrategyConfigService(db);
  const strategyContext = new SessionStrategyContextService({
    sessionRepo: repos.session,
    strategyConfig,
    providerAccountsRepo: repos.providerAccounts,
    workspacePrefsRepo: repos.workspacePreferences,
  });
  const cyclePlanServicesDeps = {
    strategyContextService: strategyContext,
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
    strategyContext,
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
    strategyContextService: strategyContext,
    tradesRepo: repos.trades,
    decisionTracesRepo: repos.decisionTraces,
    tradeApprovalsRepo: repos.tradeApprovals,
    agentRunsRepo: repos.agentRuns,
    agentMessagesRepo: repos.agentMessages,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
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
    calendarEventsRepo,
    supervisor,
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
      const monitor = new TradeMonitor(
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
      monitor.setFeedDegradedHandler((reason) => {
        void supervisor.raiseWebsocketFeedDegraded(
          sessionId,
          `Order event feed fell back to poll: ${reason}`,
        );
        supervisor.recordFeedHealth({
          feedId: `order-events:${sessionId}`,
          healthy: false,
          detail: reason,
          sessionId,
        });
      });
      return monitor;
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
  nightlyResearch.runLabelBuilder = async () => {
    await labelBuilderTicker.tick();
  };
  nightlyResearch.runLadderAutomation = tickAllLadders;
  nightlyResearch.sendDigest = (summary) => {
    notifications.notify("Exva: nightly digest", summary, "INFO");
    void supervisor.router.deliver({
      title: "Exva: nightly digest",
      body: summary,
      severity: "info",
    });
  };
  nightlyResearch.runDbBackup = async () => {
    const result = backupSqliteDb({
      sourcePath: db.dbPath,
      trigger: "nightly",
    });
    if (!result.ok) {
      await supervisor.raiseBackupFailed(
        result.error ?? "nightly database backup failed",
      );
      return "db-backup: failed";
    }
    if (result.skipped) return "db-backup: skipped (no source)";
    return `db-backup: ${result.backupPath}`;
  };
  nightlyResearch.loadCalibrationLabels = () =>
    loadCalibrationLabelsFromRepos(
      listExperiences().map((e) => e.id),
      repos.signalObservations,
      repos.signalLabels,
    );
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
    30,
    30 * 60 * 1000,
    supervisor,
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
  pauseSessionForSupervisor = async (sessionId, reason) => {
    const status = repos.session.getStatus(sessionId);
    if (status !== "active" && status !== "attention_required") return;
    await session.pause(sessionId);
    repos.events.insert({
      session_id: sessionId,
      trade_id: null,
      level: "ERROR",
      agent_type: "session",
      message: `Supervisor auto-paused session: ${reason}`,
    });
  };
  loadRiskSnapshotsForSupervisor = () =>
    loadSessionRiskSnapshots(repos, strategyContext);

  const sessionTemplates = new SessionTemplateService({
    templates: repos.sessionTemplates,
    sessions: repos.session,
    strategyContext,
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
    autopsies: repos.autopsies,
    lessons: repos.autopsyLessons,
    providerRegistry,
    workspacePrefs: repos.workspacePreferences,
  });
  const periodAutopsy = new PeriodAutopsyService({
    sessions: repos.session,
    trades: repos.trades,
    agentMessages: repos.agentMessages,
    autopsies: repos.autopsies,
    lessons: repos.autopsyLessons,
    events: repos.events,
    providerRegistry,
    workspacePrefs: repos.workspacePreferences,
    eventBus,
  });
  nightlyResearch.runPeriodAutopsy = async () => {
    const flags = periodAutopsyNightlyFlagsFromEnv({
      periodAutopsyRun: env.periodAutopsyRun,
      periodAutopsyAllowHighCost: env.periodAutopsyAllowHighCost,
    });
    const result = await runPeriodAutopsyNightly({
      preview: (input) => periodAutopsy.preview(input),
      run: (input) => periodAutopsy.run(input),
      ...flags,
    });
    return result.summary;
  };
  const autopsyExport = new AutopsyExportService();
  const signalBus = new SignalBus(
    signalEventsRepo,
    signalDeliveriesRepo,
    signalDeadLettersRepo,
    repos.session,
    repos.sessionBrokerAssignments,
    repos.brokerAccounts,
    brokerRouting,
    eventBus,
    instrumentNormalizer,
  );

  // -------------------------------------------------------------------------
  // V2 scheduler setup (always enabled)
  // -------------------------------------------------------------------------

  // Seed catalog (idempotent).
  seedExperienceCatalog(db);

  // Build V2 services.
  const experienceTemplateService = createExperienceTemplateService(db);
  const instrumentSetService = new InstrumentSetService(
    new InstrumentSetRepo(db),
  );
  const sourceDefinitionService = new SourceDefinitionService(
    new SourceDefinitionRepo(db),
  );

  const strategyRegistry = getStrategyDefinitionRegistry();
  const cikCache = new CikTickerCache(db);
  const adapterRegistry = createSourceAdapterRegistry({
    cikCache,
    calendarEventsRepo,
  });

  const sessionInputConfiguration = new SessionInputConfigurationService(
    db,
    strategyRegistry,
    adapterRegistry,
  );

  const calendarRegistry = new MarketCalendarRegistry();
  const fanoutResolver = new SubscriptionFanoutResolver(db);
  const executor = new ScheduledStrategyExecutor({
    db,
    strategyRegistry,
    getBars: async (symbol, timeframe, barCount, instrumentClass) => {
      return marketData.getBars({
        symbol,
        instrumentClass: instrumentClass as InstrumentClass,
        timeframe: timeframe as TradingTimeframe,
        barCount,
      });
    },
  });

  const scheduleCoordinator = new ScheduleCoordinator({
    db,
    executor,
    calendarRegistry,
    emitSignals: (signals, groupKey, subscriptions) =>
      signalBus.ingestScheduledGroupHit(signals, groupKey, subscriptions),
    resolveScheduledFanout: (ids) => fanoutResolver.resolveScheduledFanout(ids),
  });

  const planner = new SessionInputRuntimePlanner({ db, strategyRegistry });
  const plans = planner.buildPlans();
  scheduleCoordinator.reconcile(plans);
  scheduleCoordinator.start();

  signalBus.setSubscriptionFanoutResolver(fanoutResolver);
  const signalRegistry = new SignalSourceRegistry(db, signalBus);
  const sessionListing = new SessionListingService({
    sessionRepo: repos.session,
    assignments: repos.sessionBrokerAssignments,
    trades: repos.trades,
    runtimeManager,
    signalSources: signalSourcesRepo,
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
    strategyContext,
    assignments: repos.sessionBrokerAssignments,
    brokerRouting: repos.brokerRouting,
    brokerAccounts: repos.brokerAccounts,
    liveReadiness,
    provisionDefaultInputs: (sessionId, experienceId) => {
      const profileMap: Record<string, string> = {
        [TEMPLATE_IDS.MEAN_REVERSION]: INPUT_PROFILE_IDS.MEAN_REVERSION_DEFAULT,
        [TEMPLATE_IDS.BREAKOUT]: INPUT_PROFILE_IDS.BREAKOUT_DEFAULT,
        [TEMPLATE_IDS.TREND_FOLLOWING]: INPUT_PROFILE_IDS.TREND_DEFAULT,
        [TEMPLATE_IDS.OPTIONS_FLOW]: INPUT_PROFILE_IDS.OPTIONS_FLOW_DEFAULT,
        [TEMPLATE_IDS.EDGAR_CATALYST]: INPUT_PROFILE_IDS.EDGAR_DEFAULT,
        [TEMPLATE_IDS.PREDICTION_EVENT]: INPUT_PROFILE_IDS.PREDICTION_DEFAULT,
      };
      const profileId = profileMap[experienceId];
      if (!profileId) return;
      sessionInputConfiguration.createFromProfile(sessionId, profileId, 0);
    },
    reconcileScheduleCoordinator: () => {
      const reconcilePlanner = new SessionInputRuntimePlanner({
        db,
        strategyRegistry: getStrategyDefinitionRegistry(),
      });
      scheduleCoordinator.reconcile(reconcilePlanner.buildPlans());
    },
  });
  signals.bootstrapFromDb();
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

  // ── Finish-line 08 operator power tools ─────────────────────────────────
  const paletteQuery = new PaletteQueryService(db, instrumentSetService);
  const backtestLab = new BacktestLabService({
    marketData,
    backtestRuns: repos.backtestRuns,
    experienceExperiments: repos.experienceExperiments,
    eventBus,
  });
  const dataDoctor = new DataDoctorService({
    db,
    marketData,
    eventBus,
    notifications,
    supervisor,
  });
  const equitySnapshotService = new EquitySnapshotService({
    snapshots: repos.equitySnapshots,
    brokerAccounts: repos.brokerAccounts,
    paperBalances: repos.paperBalances,
    trades: repos.trades,
    sessions: repos.session,
    apiCallLog: repos.apiCallLog,
    eventBus,
  });
  const morningBriefing = new MorningBriefingService({
    briefings: repos.briefings,
    trades: repos.trades,
    sessions: repos.session,
    apiCallLog: repos.apiCallLog,
    db,
    supervisor,
    notifications,
    dataDoctor,
    deliverSink: async (title, body) => {
      await supervisor.router.deliver({
        title,
        body,
        severity: "info",
        forceImmediate: true,
      });
    },
    getAiBudgetUsd: () => 25,
  });
  const whatIfReplay = new WhatIfReplayService({
    trades: repos.trades,
    decisionTraces: repos.decisionTraces,
    agentMessages: repos.agentMessages,
    cycleReplay,
    experienceExperiments: repos.experienceExperiments,
    marketData,
  });
  const killSwitch = new KillSwitchService({
    sessions: repos.session,
    trades: repos.trades,
    sessionService: session,
    liveReadiness,
    supervisor,
    eventBus,
    broker,
    capitalReservation,
    loadGauges: (): KillSwitchGauge[] => {
      const snaps = loadSessionRiskSnapshots(repos, strategyContext);
      const byId = new Map(snaps.map((s) => [s.sessionId, s]));
      const listed = repos.session.list({ includeArchived: false });
      return listed.map((s) => {
        const snap = byId.get(s.id);
        let liveReadinessState: KillSwitchGauge["liveReadiness"] = null;
        if (s.executionMode === "live_allowed") {
          const ack = liveReadiness.getAcknowledgedAt(s.id);
          liveReadinessState = {
            readyToStart: Boolean(ack),
            acknowledgedAt: ack,
          };
        }
        return {
          sessionId: s.id,
          sessionName: s.name,
          status: s.status,
          dailyPnlUsd: snap?.dailyPnlUsd ?? 0,
          dailyLossLimitUsd: snap?.dailyLossLimitUsd ?? 0,
          drawdownFraction: snap?.drawdownFraction ?? 0,
          maxDrawdownFraction: snap?.maxDrawdownFraction ?? 0.15,
          liveReadiness: liveReadinessState,
        };
      });
    },
  });

  const prevSendDigest = nightlyResearch.sendDigest;
  nightlyResearch.sendDigest = (summary) => {
    prevSendDigest?.(summary);
    void morningBriefing.assemble().catch(() => undefined);
    void dataDoctor.runNightlyGapCheck().catch(() => undefined);
    equitySnapshotService.maybeSnapshot(true);
  };
  eventBus.on("trade_closed", () => {
    equitySnapshotService.maybeSnapshot(true);
  });

  appServices = {
    db,
    orchestratorDeps: orchestratorDepsBase,
    instrumentCacheService,
    repos,
    calendarEventsRepo,
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
    strategyConfig,
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
    controlRepo,
    control,
    ladderStates,
    approveLadderUpgrade: approveLadderUpgradeForExperience,
    tickLadderAutomation: tickAllLadders,
    // V2 configurable session inputs
    experienceTemplateService,
    instrumentSetService,
    sourceDefinitionService,
    sessionInputConfiguration,
    scheduleCoordinator,
    paletteQuery,
    backtestLab,
    dataDoctor,
    morningBriefing,
    equitySnapshots: equitySnapshotService,
    whatIfReplay,
    killSwitch,
  };
  return appServices;
}

function loadCalibrationLabelsFromRepos(
  experienceIds: string[],
  observations: SignalObservationsRepo,
  labels: SignalLabelsRepo,
): Array<{
  modelId: string;
  modelVersion: string;
  labels: LabelObservation[];
}> {
  const byModel = new Map<string, LabelObservation[]>();
  for (const experienceId of experienceIds) {
    for (const obs of observations.listByExperience(experienceId)) {
      const predicted = extractPredictedProbability(obs.decisionJson);
      if (predicted == null) continue;
      for (const label of labels.listByObservation(obs.id)) {
        if (label.outcomeWin == null) continue;
        const modelId = experienceId;
        const modelVersion = obs.modelVersion ?? "latest";
        const key = `${modelId}@${modelVersion}`;
        const bucket = byModel.get(key) ?? [];
        bucket.push({
          predictedProbability: predicted,
          outcomeWin: label.outcomeWin === 1,
        });
        byModel.set(key, bucket);
      }
    }
  }
  return [...byModel.entries()].map(([key, labelObs]) => {
    const at = key.lastIndexOf("@");
    return {
      modelId: at >= 0 ? key.slice(0, at) : key,
      modelVersion: at >= 0 ? key.slice(at + 1) : "latest",
      labels: labelObs,
    };
  });
}

function extractPredictedProbability(
  decisionJson: string | null,
): number | null {
  if (!decisionJson) return null;
  try {
    const parsed = JSON.parse(decisionJson) as {
      edge?: { predictedProbability?: number | null };
    };
    const p = parsed.edge?.predictedProbability;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  } catch {
    return null;
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

function loadSessionRiskSnapshots(
  repos: AppServices["repos"],
  strategyContext: SessionStrategyContextService,
): import("./supervisor/supervisor-service").SessionRiskSnapshot[] {
  const sessions = repos.session.listByStatuses([
    "active",
    "attention_required",
    "monitoring_only",
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayStartIso = startOfDay.toISOString();
  const nowIso = new Date().toISOString();

  return sessions.map((session) => {
    const risk = strategyContext.getRiskConfig(session.id);
    const closedToday = repos.trades.listClosedInWindow({
      sessionId: session.id,
      windowStart: dayStartIso,
      windowEnd: nowIso,
    });
    const dailyPnlUsd = closedToday.reduce(
      (sum, trade) => sum + (trade.final_pnl_usd ?? 0),
      0,
    );
    const allClosed = repos.trades.listClosed(session.id);
    let peak = 0;
    let equity = 0;
    let maxDd = 0;
    for (const trade of allClosed) {
      equity += trade.final_pnl_usd ?? 0;
      peak = Math.max(peak, equity);
      if (peak > 0) {
        maxDd = Math.max(maxDd, (peak - equity) / peak);
      }
    }
    let maxDrawdownFraction = 0.15;
    if (session.experienceId) {
      try {
        const contract = requireExperience(
          session.experienceId,
        ).researchContract;
        if (contract.validation.maxDrawdownPct > 0) {
          maxDrawdownFraction = contract.validation.maxDrawdownPct;
          // Contracts store either fraction (0.2) or percent (20); normalize.
          if (maxDrawdownFraction > 1) maxDrawdownFraction /= 100;
        }
      } catch {
        // Keep default.
      }
    }
    return {
      sessionId: session.id,
      dailyPnlUsd,
      drawdownFraction: maxDd,
      dailyLossLimitUsd: risk.dailyLossLimitUsd,
      maxDrawdownFraction,
    };
  });
}
