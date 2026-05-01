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
import { AiSdkService } from "./ai-sdk-service";
import { AgentOrchestrator } from "./agent-orchestrator";
import { BrokerService } from "./broker-service";
import { EventBus } from "./event-bus";
import { createLogger } from "./log";
import { NotificationService } from "./notification-service";
import { PromptAssetLoader } from "./prompt-asset-loader";
import { RiskEngine } from "./risk-engine";
import { SecretsService } from "./secrets-service";
import { runPreflight, SessionRuntimeManager, SessionService } from "./session";
import { TradeMonitor } from "./trade-monitor";

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
  ai: AiSdkService;
  broker: BrokerService;
  eventBus: EventBus;
  notifications: NotificationService;
  promptAssetLoader: PromptAssetLoader;
  runtimeManager: SessionRuntimeManager;
  risk: RiskEngine;
  secrets: SecretsService;
  session: SessionService;
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
  const ai = new AiSdkService(secrets);
  const notifications = new NotificationService(eventBus);
  const promptAssetLoader = new PromptAssetLoader();
  const logger = createLogger("app-services");

  const runtimeManager = new SessionRuntimeManager({
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    agentRunsRepo: repos.agentRuns,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
    ai,
    broker,
    riskEngine: risk,
    bus: eventBus,
    logger,
    createOrchestrator: (sessionId, deps) => new AgentOrchestrator(sessionId, deps),
    createTradeMonitor: (sessionId) =>
      new TradeMonitor(sessionId, repos.trades, repos.stats, repos.session, broker, () => 100000, eventBus),
  });

  const orchestratorDeps = {
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    agentRunsRepo: repos.agentRuns,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
    ai,
    broker,
    riskEngine: risk,
    bus: eventBus,
    logger,
  };

  const session = new SessionService({
    sessionRepo: repos.session,
    eventsRepo: repos.events,
    runtimeManager,
    preflight: runPreflight,
    orchestratorDeps,
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
  };
}
