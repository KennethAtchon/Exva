import type { App } from "electron";
import { createDbClient } from "../db/client";
import { AgentRunsRepo } from "../db/repositories/agent-runs-repo";
import { BrokerAccountsRepo } from "../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../db/repositories/broker-routing-repo";
import { CapitalReservationsRepo } from "../db/repositories/capital-reservations-repo";
import { EventsRepo } from "../db/repositories/events-repo";
import { ProviderAccountsRepo } from "../db/repositories/provider-accounts-repo";
import { SessionAiRolesRepo } from "../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../db/repositories/session-broker-assignments-repo";
import { SessionSelectorSettingsRepo } from "../db/repositories/session-selector-settings-repo";
import { SessionStrategiesRepo } from "../db/repositories/session-strategies-repo";
import { SessionTemplatesRepo } from "../db/repositories/session-templates-repo";
import { SessionRepo } from "../db/repositories/session-repo";
import { StatsRepo } from "../db/repositories/stats-repo";
import { TradeApprovalsRepo } from "../db/repositories/trade-approvals-repo";
import { TradesRepo } from "../db/repositories/trades-repo";
import { WorkspacePreferencesRepo } from "../db/repositories/workspace-prefs-repo";
import { AiRuntime } from "./ai/ai-runtime";
import { AgentOrchestrator } from "./orchestration/agent-orchestrator";
import { BrokerService } from "./broker/broker-service";
import { EventBus } from "./infra/event-bus";
import { createLogger } from "./infra/log";
import { NotificationService } from "./infra/notification-service";
import { PromptAssetLoader } from "./ai/prompt-asset-loader";
import { ProviderRegistry } from "./ai/provider-registry";
import { SearchRegistry } from "./ai/search/search-registry";
import { RiskEngine } from "./orchestration/risk-engine";
import { SecretsService } from "./infra/secrets-service";
import { runPreflight, SessionRuntimeManager, SessionService } from "./session";
import type { SessionRuntimeManagerDeps } from "./session";
import { SessionListingService } from "./session/listing-service";
import { SessionTemplateService } from "./session/template-service";
import { SessionWriteService } from "./session/write-service";
import { TradeMonitor } from "./broker/trade-monitor";

export interface AppServices {
  db: ReturnType<typeof createDbClient>;
  repos: {
    agentRuns: AgentRunsRepo;
    brokerAccounts: BrokerAccountsRepo;
    brokerRouting: BrokerRoutingRepo;
    capitalReservations: CapitalReservationsRepo;
    events: EventsRepo;
    providerAccounts: ProviderAccountsRepo;
    sessionAiRoles: SessionAiRolesRepo;
    sessionBrokerAssignments: SessionBrokerAssignmentsRepo;
    sessionSelectorSettings: SessionSelectorSettingsRepo;
    session: SessionRepo;
    sessionStrategies: SessionStrategiesRepo;
    sessionTemplates: SessionTemplatesRepo;
    stats: StatsRepo;
    tradeApprovals: TradeApprovalsRepo;
    trades: TradesRepo;
    workspacePreferences: WorkspacePreferencesRepo;
  };
  ai: AiRuntime;
  broker: BrokerService;
  eventBus: EventBus;
  notifications: NotificationService;
  promptAssetLoader: PromptAssetLoader;
  runtimeManager: SessionRuntimeManager;
  risk: RiskEngine;
  secrets: SecretsService;
  session: SessionService;
  sessionListing: SessionListingService;
  sessionTemplates: SessionTemplateService;
  sessionWrites: SessionWriteService;
}

export async function createAppServices(app: App): Promise<AppServices> {
  // userData represent /Library/Application Support/App, think of it where your app files config lives
  const db = createDbClient(app.getPath("userData"));
  const repos = {
    agentRuns: new AgentRunsRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    capitalReservations: new CapitalReservationsRepo(db),
    events: new EventsRepo(db),
    providerAccounts: new ProviderAccountsRepo(db),
    sessionAiRoles: new SessionAiRolesRepo(db),
    sessionBrokerAssignments: new SessionBrokerAssignmentsRepo(db),
    sessionSelectorSettings: new SessionSelectorSettingsRepo(db),
    session: new SessionRepo(db),
    sessionStrategies: new SessionStrategiesRepo(db),
    sessionTemplates: new SessionTemplatesRepo(db),
    stats: new StatsRepo(db),
    tradeApprovals: new TradeApprovalsRepo(db),
    trades: new TradesRepo(db),
    workspacePreferences: new WorkspacePreferencesRepo(db),
  };
  const secrets = new SecretsService();
  const broker = new BrokerService(secrets);
  await broker.restore();

  const eventBus = new EventBus();
  const risk = new RiskEngine();
  const providerRegistry = new ProviderRegistry(repos.providerAccounts, secrets);
  const searchRegistry = new SearchRegistry(repos.providerAccounts, secrets);
  const notifications = new NotificationService(eventBus);
  const promptAssetLoader = new PromptAssetLoader();
  const ai = new AiRuntime(
    providerRegistry,
    searchRegistry,
    promptAssetLoader,
    repos.sessionAiRoles,
    repos.session,
    repos.workspacePreferences,
  );
  const logger = createLogger("app-services");

  let runtimeManager: SessionRuntimeManager;
  const orchestratorDepsBase = {
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    tradeApprovalsRepo: repos.tradeApprovals,
    agentRunsRepo: repos.agentRuns,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
    sessionAiRolesRepo: repos.sessionAiRoles,
    sessionSelectorSettingsRepo: repos.sessionSelectorSettings,
    providerAccountsRepo: repos.providerAccounts,
    workspacePreferencesRepo: repos.workspacePreferences,
    capitalReservationsRepo: repos.capitalReservations,
    brokerRoutingRepo: repos.brokerRouting,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerAccountsRepo: repos.brokerAccounts,
    ai,
    broker,
    riskEngine: risk,
    bus: eventBus,
    logger,
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
        broker,
        () => 100000,
        eventBus,
        () => runtimeManager.get(sessionId)?.uptimeMin() ?? 0,
      ),
  };
  runtimeManager = new SessionRuntimeManager(runtimeManagerDeps);

  const orchestratorDeps = orchestratorDepsBase;

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
    strategies: repos.sessionStrategies,
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

  return {
    db,
    repos,
    ai,
    broker,
    eventBus,
    notifications,
    promptAssetLoader,
    runtimeManager,
    risk,
    secrets,
    session,
    sessionListing,
    sessionTemplates,
    sessionWrites,
  };
}
