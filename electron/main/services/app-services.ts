import type { App } from "electron";
import { createDbClient } from "../db/client";
import { AgentRunsRepo } from "../db/repositories/agent-runs-repo";
import { EventsRepo } from "../db/repositories/events-repo";
import { SessionRepo } from "../db/repositories/session-repo";
import { StatsRepo } from "../db/repositories/stats-repo";
import { TradesRepo } from "../db/repositories/trades-repo";
import { AiSdkService } from "./ai-sdk-service";
import { AgentOrchestrator } from "./agent-orchestrator";
import { BrokerService } from "./broker-service";
import { EventBus } from "./event-bus";
import { createLogger } from "./log";
import { NotificationService } from "./notification-service";
import { RiskEngine } from "./risk-engine";
import { SecretsService } from "./secrets-service";
import { runPreflight, SessionRuntimeManager, SessionService } from "./session";
import { TradeMonitor } from "./trade-monitor";

export interface AppServices {
  db: ReturnType<typeof createDbClient>;
  repos: {
    agentRuns: AgentRunsRepo;
    events: EventsRepo;
    session: SessionRepo;
    stats: StatsRepo;
    trades: TradesRepo;
  };
  ai: AiSdkService;
  broker: BrokerService;
  eventBus: EventBus;
  notifications: NotificationService;
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
    events: new EventsRepo(db),
    session: new SessionRepo(db),
    stats: new StatsRepo(db),
    trades: new TradesRepo(db),
  };
  const secrets = new SecretsService();
  const broker = new BrokerService(secrets);
  await broker.restore();

  const eventBus = new EventBus();
  const risk = new RiskEngine();
  const ai = new AiSdkService(secrets);
  const notifications = new NotificationService(eventBus);
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
    runtimeManager,
    risk,
    secrets,
    session,
  };
}
