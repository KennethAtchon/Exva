import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { sessions as sessionsTable } from "../../../db/schema";
import { createTestDb } from "../../../db/test-helpers";
import { AgentMessagesRepo } from "../../../db/repositories/agent-messages-repo";
import { AgentRunsRepo } from "../../../db/repositories/agent-runs-repo";
import { EventsRepo } from "../../../db/repositories/events-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/session-risk-config-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/session-trade-rules-repo";
import { StatsRepo } from "../../../db/repositories/stats-repo";
import { TradeApprovalsRepo } from "../../../db/repositories/trade-approvals-repo";
import { TradesRepo } from "../../../db/repositories/trades-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { CapitalReservationsRepo } from "../../../db/repositories/capital-reservations-repo";
import { ProviderAccountsRepo } from "../../../db/repositories/provider-accounts-repo";
import { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SqliteSessionExecutionStepsRepo } from "../../../db/repositories/session-execution-steps-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/session-selector-settings-repo";
import { SessionStrategiesRepo } from "../../../db/repositories/session-strategies-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/session-timeframe-config-repo";
import { SessionAiRoleProfileRepo } from "../../../db/repositories/session-ai-role-profile-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/session-research-posture-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import { InstrumentCacheRepo } from "../../../db/repositories/instrument-cache-repo";
import { PromptAssetLoader } from "../../ai/prompt-asset-loader";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import { SessionStrategyContextService } from "../session-strategy-context-service";
import { SessionRuntimeManager } from "../session-runtime-manager";
import type { CapitalReservationService } from "../../risk/capital-reservation-service";

describe("SessionRuntimeManager", () => {
  let db = createTestDb();
  let sessionAlphaId = "";
  let sessionBetaId = "";

  beforeEach(() => {
    db = createTestDb();
    const sessions = new SessionRepo(db);
    sessionAlphaId = sessions.create({
      name: "Alpha",
      objective: "First runtime",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "NVDA",
      capitalLimitUsd: 5000,
      executionMode: "paper_only",
    }).id;
    sessionBetaId = sessions.create({
      name: "Session B",
      objective: "Second runtime",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "AAPL",
      capitalLimitUsd: 5000,
      executionMode: "paper_only",
    }).id;
    db.db
      .update(sessionsTable)
      .set({ status: "active" })
      .where(inArray(sessionsTable.id, [sessionAlphaId, sessionBetaId]))
      .run();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("rehydrates previously active sessions as paused runtimes", async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const manager = createManager(db, {
      onStart: (sessionId) => started.push(sessionId),
      onStop: (sessionId) => stopped.push(sessionId),
    });

    await manager.rehydrateFromDb();

    expect(manager.listActive()).toHaveLength(2);
    expect(started).toEqual([]);
    expect(stopped).toEqual([]);

    const sessions = new SessionRepo(db);
    expect(sessions.requireById(sessionAlphaId).status).toBe("paused");
    expect(sessions.requireById(sessionBetaId).status).toBe("paused");
  });

  it("stopping one session tears down only that runtime", async () => {
    const stopped: string[] = [];
    const manager = createManager(db, {
      onStop: (sessionId) => stopped.push(sessionId),
    });

    await manager.rehydrateFromDb();
    await manager.stopSession(sessionAlphaId);

    expect(manager.get(sessionAlphaId)).toBeNull();
    expect(manager.get(sessionBetaId)).not.toBeNull();
    expect(stopped).toEqual([sessionAlphaId]);
  });
});

function createManager(
  db: ReturnType<typeof createTestDb>,
  hooks: { onStart?: (sessionId: string) => void; onStop?: (sessionId: string) => void },
) {
  const sessionRepo = new SessionRepo(db);
  const tradesRepo = new TradesRepo(db);
  const tradeApprovalsRepo = new TradeApprovalsRepo(db);
  const agentMessagesRepo = new AgentMessagesRepo(db);
  const agentRunsRepo = new AgentRunsRepo(db);
  const eventsRepo = new EventsRepo(db);
  const statsRepo = new StatsRepo(db);
  const eventBus = new EventBus();
  const sessionAiRolesRepo = new SessionAiRolesRepo(db);
  const sessionSelectorSettingsRepo = new SessionSelectorSettingsRepo(db);
  const sessionExecutionStepsRepo = new SqliteSessionExecutionStepsRepo(db);
  const providerAccountsRepo = new ProviderAccountsRepo(db);
  const workspacePreferencesRepo = new WorkspacePreferencesRepo(db);
  const strategyContextService = new SessionStrategyContextService({
    sessionRepo,
    researchPostureRepo: new SessionResearchPostureRepo(db),
    aiRoleProfileRepo: new SessionAiRoleProfileRepo(db),
    rulesRepo: new SessionTradeRulesRepo(db),
    riskRepo: new SessionRiskConfigRepo(db),
    timeframeRepo: new SessionTimeframeConfigRepo(db),
    aiRolesRepo: sessionAiRolesRepo,
    selectorSettingsRepo: sessionSelectorSettingsRepo,
    providerAccountsRepo,
    workspacePrefsRepo: workspacePreferencesRepo,
    promptAssetLoader: new PromptAssetLoader(),
  });

  return new SessionRuntimeManager({
    sessionRepo,
    sessionStrategiesRepo: new SessionStrategiesRepo(db),
    strategyContextService,
    tradesRepo,
    tradeApprovalsRepo,
    agentMessagesRepo,
    agentRunsRepo,
    eventsRepo,
    statsRepo,
    sessionAiRolesRepo,
    sessionSelectorSettingsRepo,
    sessionExecutionStepsRepo,
    providerAccountsRepo,
    workspacePreferencesRepo,
    capitalReservationsRepo: new CapitalReservationsRepo(db),
    capitalReservation: {
      checkSessionStartFits: () => ({ ok: true as const }),
      reserveForApproval: () => ({}) as never,
      releaseByApproval: () => undefined,
      convertApprovalToOpenOrder: () => undefined,
      convertOrderToPosition: () => undefined,
      releaseOnCancel: () => undefined,
      releaseOnFailure: () => undefined,
      releaseOnClose: () => undefined,
      sumActiveReservedUsd: () => 0,
      listActiveBySession: () => [],
      updateReservedAmountForApproval: () => undefined,
    } as unknown as CapitalReservationService,
    brokerRoutingRepo: new BrokerRoutingRepo(db),
    sessionBrokerAssignmentsRepo: new SessionBrokerAssignmentsRepo(db),
    brokerAccountsRepo: new BrokerAccountsRepo(db),
    brokerRegistry: {} as never,
    brokerRouting: {
      resolveBrokerAccountId: () => "default-broker",
      resolveAdapter: async () => ({}) as never,
      preflightSession: async () => undefined,
    } as never,
    instrumentNormalizer: { toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol } as never,
    instrumentCacheRepo: new InstrumentCacheRepo(db),
    ai: {} as never,
    riskEngine: {} as never,
    bus: eventBus,
    logger: createLogger("runtime-manager-test"),
    createOrchestrator: (sessionId) => ({
      start: async () => hooks.onStart?.(sessionId),
      pause: async () => undefined,
      resume: async () => undefined,
      stop: async () => hooks.onStop?.(sessionId),
      pauseAfterCurrentStep: () => undefined,
      retryStep: async () => ({ ok: true as const }),
      runApprovalRecheck: async () => undefined,
      resolveApproval: () => false,
      hasApprovalCallback: () => false,
    }),
    createTradeMonitor: () => ({
      start: () => undefined,
      stop: () => undefined,
    }),
  });
}
