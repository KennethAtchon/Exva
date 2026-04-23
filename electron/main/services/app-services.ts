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
import { NotificationService } from "./notification-service";
import { RiskEngine } from "./risk-engine";
import { SecretsService } from "./secrets-service";
import { SessionService } from "./session-service";
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
  orchestrator: AgentOrchestrator;
  risk: RiskEngine;
  secrets: SecretsService;
  session: SessionService;
  monitor: TradeMonitor;
}

export async function createAppServices(app: App): Promise<AppServices> {
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

  let orchestrator: AgentOrchestrator;
  const session = new SessionService({
    sessionRepo: repos.session,
    statsRepo: repos.stats,
    eventsRepo: repos.events,
    secrets,
    broker,
    risk,
    eventBus,
    getOrchestrator: () => orchestrator,
  });

  orchestrator = new AgentOrchestrator({
    ai,
    broker,
    risk,
    tradesRepo: repos.trades,
    agentRunsRepo: repos.agentRuns,
    eventsRepo: repos.events,
    statsRepo: repos.stats,
    eventBus,
    getConfig: () => repos.session.getConfig(),
    getStats: () =>
      repos.stats.dashboardStats(
        session.getStatus(),
        session.getPortfolioValue(),
        session.uptimeMin(),
        repos.session.getConfig().max_api_spend_usd,
      ),
    isActive: () => session.isActive(),
  });

  const monitor = new TradeMonitor(repos.trades, repos.stats, broker, () => session, eventBus);
  monitor.start();

  return {
    db,
    repos,
    ai,
    broker,
    eventBus,
    notifications,
    orchestrator,
    risk,
    secrets,
    session,
    monitor,
  };
}
