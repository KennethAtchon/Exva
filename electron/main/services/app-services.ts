import type { App } from "electron";
import { createDbClient } from "@main/db/client";
import { AgentRunsRepo } from "../db/repositories/agent-runs-repo";
import { AgentMessagesRepo } from "../db/repositories/agent-messages-repo";
import { ApiCallLogRepo } from "../db/repositories/api-call-log-repo";
import { BrokerAccountsRepo } from "../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../db/repositories/broker-routing-repo";
import { CapitalReservationsRepo } from "../db/repositories/capital-reservations-repo";
import { EventsRepo } from "../db/repositories/events-repo";
import { ProviderAccountsRepo } from "../db/repositories/provider-accounts-repo";
import { SessionAiRolesRepo } from "../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../db/repositories/session-broker-assignments-repo";
import { SessionRiskConfigRepo } from "../db/repositories/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../db/repositories/session-selector-settings-repo";
import { SessionStrategyProfileRepo } from "../db/repositories/session-strategy-profile-repo";
import { SessionStrategiesRepo } from "../db/repositories/session-strategies-repo";
import { SessionTemplatesRepo } from "../db/repositories/session-templates-repo";
import { SessionTimeframeConfigRepo } from "../db/repositories/session-timeframe-config-repo";
import { SessionRepo } from "../db/repositories/session-repo";
import { InstrumentCacheRepo } from "../db/repositories/instrument-cache-repo";
import { StatsRepo } from "../db/repositories/stats-repo";
import { TradeAutopsiesRepo } from "../db/repositories/trade-autopsies-repo";
import { TradeApprovalsRepo } from "../db/repositories/trade-approvals-repo";
import { TradesRepo } from "../db/repositories/trades-repo";
import { WorkspacePreferencesRepo } from "../db/repositories/workspace-prefs-repo";
import { AiRuntime } from "./ai/ai-runtime/index";
import { BrokerRegistry, BrokerRoutingService, BrokerService, InstrumentNormalizer } from "./broker";
import { EventBus } from "./infra/event-bus";
import { createLogger } from "./infra/log";
import { NotificationService } from "./infra/notification-service";
import { AgentOrchestrator } from "./orchestration/agent-orchestrator";
import { PromptAssetLoader } from "./ai/prompt-asset-loader";
import { ProviderRegistry } from "./ai/provider-registry";
import { SearchRegistry } from "./ai/search/search-registry";
import { SecretsService } from "./infra/secrets-service";
import { runPreflight, SessionRuntimeManager, SessionService } from "./session";
import type { OrchestratorDeps, SessionRuntimeManagerDeps } from "./session";
import { SessionStrategyContextService } from "./session/session-strategy-context-service";
import { SessionListingService } from "./session/listing-service";
import { SessionTemplateService } from "./session/template-service";
import { SessionWriteService } from "./session/write-service";
import { TradeMonitor } from "./orchestration/trade-monitor";
import { TradeAutopsyService } from "./orchestration/trade-autopsy-service";
import { InstrumentCacheService } from "./instrument";
import { CapitalReservationService, RiskEngine } from "./risk";

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
    sessionAiRoles: SessionAiRolesRepo;
    sessionBrokerAssignments: SessionBrokerAssignmentsRepo;
    sessionRiskConfig: SessionRiskConfigRepo;
    sessionSelectorSettings: SessionSelectorSettingsRepo;
    session: SessionRepo;
    sessionStrategyProfile: SessionStrategyProfileRepo;
    sessionStrategies: SessionStrategiesRepo;
    sessionTemplates: SessionTemplatesRepo;
    sessionTimeframeConfig: SessionTimeframeConfigRepo;
    stats: StatsRepo;
    tradeAutopsies: TradeAutopsiesRepo;
    tradeApprovals: TradeApprovalsRepo;
    trades: TradesRepo;
    workspacePreferences: WorkspacePreferencesRepo;
    instrumentCache: InstrumentCacheRepo;
  };
  ai: AiRuntime;
  providerRegistry: ProviderRegistry;
  searchRegistry: SearchRegistry;
  brokerRegistry: BrokerRegistry;
  broker: BrokerService;
  capitalReservation: CapitalReservationService;
  eventBus: EventBus;
  notifications: NotificationService;
  promptAssetLoader: PromptAssetLoader;
  runtimeManager: SessionRuntimeManager;
  risk: RiskEngine;
  secrets: SecretsService;
  session: SessionService;
  sessionListing: SessionListingService;
  strategyContext: SessionStrategyContextService;
  sessionTemplates: SessionTemplateService;
  sessionWrites: SessionWriteService;
  tradeAutopsy: TradeAutopsyService;
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
    sessionAiRoles: new SessionAiRolesRepo(db),
    sessionBrokerAssignments: new SessionBrokerAssignmentsRepo(db),
    sessionRiskConfig: new SessionRiskConfigRepo(db),
    sessionSelectorSettings: new SessionSelectorSettingsRepo(db),
    session: new SessionRepo(db),
    sessionStrategyProfile: new SessionStrategyProfileRepo(db),
    sessionStrategies: new SessionStrategiesRepo(db),
    sessionTemplates: new SessionTemplatesRepo(db),
    sessionTimeframeConfig: new SessionTimeframeConfigRepo(db),
    stats: new StatsRepo(db),
    tradeAutopsies: new TradeAutopsiesRepo(db),
    tradeApprovals: new TradeApprovalsRepo(db),
    trades: new TradesRepo(db),
    workspacePreferences: new WorkspacePreferencesRepo(db),
    instrumentCache: new InstrumentCacheRepo(db),
  };
  const secrets = new SecretsService();
  const brokerRegistry = new BrokerRegistry(repos.brokerAccounts, secrets);
  const instrumentNormalizer = new InstrumentNormalizer();
  const brokerRouting = new BrokerRoutingService(
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    repos.brokerRouting,
    brokerRegistry,
  );
  const capitalReservation = new CapitalReservationService(repos.capitalReservations, repos.workspacePreferences);
  const broker = new BrokerService(brokerRegistry);

  const eventBus = new EventBus();
  const risk = new RiskEngine();
  const providerRegistry = new ProviderRegistry(repos.providerAccounts, secrets);
  const searchRegistry = new SearchRegistry(repos.providerAccounts, secrets);
  const notifications = new NotificationService(eventBus);
  const promptAssetLoader = new PromptAssetLoader();
  const strategyContext = new SessionStrategyContextService({
    sessionRepo: repos.session,
    profileRepo: repos.sessionStrategyProfile,
    riskRepo: repos.sessionRiskConfig,
    timeframeRepo: repos.sessionTimeframeConfig,
    aiRolesRepo: repos.sessionAiRoles,
    selectorSettingsRepo: repos.sessionSelectorSettings,
    providerAccountsRepo: repos.providerAccounts,
    workspacePrefsRepo: repos.workspacePreferences,
    promptAssetLoader,
  });
  const ai = new AiRuntime(
    providerRegistry,
    searchRegistry,
    promptAssetLoader,
    repos.sessionAiRoles,
    repos.session,
    repos.workspacePreferences,
    repos.apiCallLog,
    brokerRouting,
    brokerRegistry,
    strategyContext,
  );
  const logger = createLogger("app-services");

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
    sessionAiRolesRepo: repos.sessionAiRoles,
    sessionSelectorSettingsRepo: repos.sessionSelectorSettings,
    providerAccountsRepo: repos.providerAccounts,
    workspacePreferencesRepo: repos.workspacePreferences,
    capitalReservationsRepo: repos.capitalReservations,
    capitalReservation,
    brokerRoutingRepo: repos.brokerRouting,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerAccountsRepo: repos.brokerAccounts,
    brokerRegistry,
    brokerRouting,
    instrumentNormalizer,
    ai,
    riskEngine: risk,
    bus: eventBus,
    logger,
    instrumentCacheRepo: repos.instrumentCache,
  };

  const runtimeManagerDeps: SessionRuntimeManagerDeps = {
    ...orchestratorDepsBase,
    createOrchestrator: (sessionId, deps) => new AgentOrchestrator(sessionId, deps),
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
      ),
  };
  runtimeManager = new SessionRuntimeManager(runtimeManagerDeps);

  const orchestratorDeps = orchestratorDepsBase;
  const instrumentCacheService = new InstrumentCacheService(repos.instrumentCache, () => orchestratorDeps);

  const session = new SessionService({
    sessionRepo: repos.session,
    eventsRepo: repos.events,
    runtimeManager,
    preflight: runPreflight,
    orchestratorDeps,
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
    aiRoles: repos.sessionAiRoles,
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
  });

  const tradeAutopsy = new TradeAutopsyService(
    repos.trades,
    repos.agentMessages,
    repos.tradeAutopsies,
    providerRegistry,
  );

  return {
    db,
    orchestratorDeps,
    instrumentCacheService,
    repos,
    ai,
    providerRegistry,
    searchRegistry,
    brokerRegistry,
    broker,
    capitalReservation,
    eventBus,
    notifications,
    promptAssetLoader,
    runtimeManager,
    risk,
    secrets,
    session,
    sessionListing,
    strategyContext,
    sessionTemplates,
    sessionWrites,
    tradeAutopsy,
  };
}
