import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InstrumentClass } from "@/lib/types";
import { createTestDb } from "../../../db/test-helpers";
import { AgentMessagesRepo } from "../../../db/repositories/agents/agent-messages-repo";
import { AgentRunsRepo } from "../../../db/repositories/agents/agent-runs-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { CapitalReservationsRepo } from "../../../db/repositories/trades/capital-reservations-repo";
import { EventsRepo } from "../../../db/repositories/system/events-repo";
import { InstrumentCacheRepo } from "../../../db/repositories/market/instrument-cache-repo";
import { ProviderAccountsRepo } from "../../../db/repositories/workspace/provider-accounts-repo";
import { SessionAiPhasesRepo } from "../../../db/repositories/sessions/session-ai-phases-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SqliteSessionExecutionStepsRepo } from "../../../db/repositories/sessions/session-execution-steps-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/sessions/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/sessions/session-selector-settings-repo";
import { SessionStrategiesRepo } from "../../../db/repositories/sessions/session-strategies-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/sessions/session-trade-rules-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/sessions/session-timeframe-config-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/sessions/session-research-posture-repo";
import { SessionAiSettingsRepo } from "../../../db/repositories/sessions/session-ai-settings-repo";
import { StatsRepo } from "../../../db/repositories/system/stats-repo";
import { TradeApprovalsRepo } from "../../../db/repositories/trades/trade-approvals-repo";
import { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace/workspace-prefs-repo";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import { runPreflight } from "../preflight";
import { SessionRuntimeManager } from "../session-runtime-manager";
import { SessionService } from "../session-service";
import { SessionStrategyContextService } from "../session-strategy-context-service";
import { SessionWriteService } from "../write-service";

describe("session onboarding integration", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("blocks session start until an AI provider is configured, then starts paper trading", async () => {
    const harness = createHarness(db);
    harness.insertBroker({
      id: "paper-broker",
      name: "Paper Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    const { id: sessionId } = harness.sessionWrites.create({
      name: "Paper Session",
      objective: "Trade NVDA in paper mode",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "NVDA",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "paper-broker", allocatedUsd: 5000 },
      ],
      brokerOverridesByInstrumentClass: { stock: "paper-broker" },
    });

    await expect(harness.session.start(sessionId)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(
      harness.events.query({ sessionId, minLevel: "ERROR" })[0]?.message,
    ).toContain("Preflight provider-credentials failed");

    harness.configureDefaultAiProvider();

    await expect(harness.session.start(sessionId)).resolves.toBe("active");
    expect(harness.sessions.requireById(sessionId).status).toBe("active");
    expect(harness.sessions.requireById(sessionId).executionMode).toBe(
      "paper_only",
    );
    expect(harness.runtimeManager.get(sessionId)?.status).toBe("active");
    expect(harness.startedSessions).toEqual([sessionId]);
    expect(harness.routing.resolveBrokerAccountId(sessionId, "stock")).toBe(
      "paper-broker",
    );
  });

  it("starts a new session from the workspace default AI model without visiting Strategy", async () => {
    const harness = createHarness(db);
    harness.insertBroker({
      id: "paper-broker",
      name: "Paper Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });
    harness.configureWorkspaceDefaultAiModel({
      providerId: "provider-openrouter",
      providerType: "openrouter",
      providerName: "OpenRouter",
      modelId: "google/gemma-4-31b-it",
    });

    const { id: sessionId } = harness.sessionWrites.create({
      name: "Workspace Default Session",
      objective: "Trade NVDA using workspace defaults",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "NVDA",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      brokerAssignments: [
        { brokerAccountId: "paper-broker", allocatedUsd: 5000 },
      ],
      brokerOverridesByInstrumentClass: { stock: "paper-broker" },
    });

    const phases = harness.sessionAiPhasesRepo.listBySession(sessionId);
    expect(phases).toHaveLength(5);
    expect(phases.every((p) => p.providerKey === "provider-openrouter")).toBe(
      true,
    );
    expect(phases.every((p) => p.modelId === "google/gemma-4-31b-it")).toBe(
      true,
    );

    await expect(harness.session.start(sessionId)).resolves.toBe("active");
    expect(harness.startedSessions).toEqual([sessionId]);
  });

  it("starts a live-allowed session with a live broker account", async () => {
    const harness = createHarness(db);
    harness.insertBroker({
      id: "live-broker",
      name: "Live Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "live",
    });
    harness.configureDefaultAiProvider();

    const { id: sessionId } = harness.sessionWrites.create({
      name: "Live Session",
      objective: "Trade AAPL live",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "AAPL",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "live_allowed",
      brokerAssignments: [
        { brokerAccountId: "live-broker", allocatedUsd: 5000 },
      ],
      brokerOverridesByInstrumentClass: { stock: "live-broker" },
    });

    await expect(harness.session.start(sessionId)).resolves.toBe("active");

    expect(harness.sessions.requireById(sessionId).status).toBe("active");
    expect(harness.sessions.requireById(sessionId).executionMode).toBe(
      "live_allowed",
    );
    expect(harness.brokers.require("live-broker").mode).toBe("live");
    expect(harness.startedSessions).toEqual([sessionId]);
    expect(harness.routing.resolveBrokerAccountId(sessionId, "stock")).toBe(
      "live-broker",
    );
  });

  it("returns an empty portfolio value when no session exists yet", async () => {
    const harness = createHarness(db);

    await expect(harness.session.getPortfolioValue()).resolves.toEqual({
      value: 0,
      source: "broker",
      brokerCount: 0,
    });
  });
});

function createHarness(db: ReturnType<typeof createTestDb>) {
  const sessions = new SessionRepo(db);
  const brokers = new BrokerAccountsRepo(db);
  const events = new EventsRepo(db);
  const sessionBrokerAssignments = new SessionBrokerAssignmentsRepo(db);
  const brokerRoutingRepo = new BrokerRoutingRepo(db);
  const providerAccounts = new ProviderAccountsRepo(db);
  const sessionAiPhasesRepo = new SessionAiPhasesRepo(db);
  const sessionSelectorSettings = new SessionSelectorSettingsRepo(db);
  const workspacePreferences = new WorkspacePreferencesRepo(db);
  const startedSessions: string[] = [];
  const eventBus = new EventBus();
  const strategyContextService = new SessionStrategyContextService({
    sessionRepo: sessions,
    researchPostureRepo: new SessionResearchPostureRepo(db),
    rulesRepo: new SessionTradeRulesRepo(db),
    riskRepo: new SessionRiskConfigRepo(db),
    timeframeRepo: new SessionTimeframeConfigRepo(db),
    aiSettingsRepo: new SessionAiSettingsRepo(db),
    selectorSettingsRepo: sessionSelectorSettings,
    providerAccountsRepo: providerAccounts,
    workspacePrefsRepo: workspacePreferences,
    sessionAiPhasesRepo,
  });

  const brokerRegistry = {
    get: async () => new MockBrokerAdapter(),
  };
  const routing = new BrokerRoutingService(
    brokers,
    sessionBrokerAssignments,
    brokerRoutingRepo,
    brokerRegistry as never,
  );
  const capitalReservation = {
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
  };

  const orchestratorDeps = {
    sessionRepo: sessions,
    sessionStrategiesRepo: new SessionStrategiesRepo(db),
    strategyContextService,
    tradesRepo: new TradesRepo(db),
    tradeApprovalsRepo: new TradeApprovalsRepo(db),
    agentRunsRepo: new AgentRunsRepo(db),
    agentMessagesRepo: new AgentMessagesRepo(db),
    eventsRepo: events,
    statsRepo: new StatsRepo(db),
    sessionAiPhasesRepo,
    sessionSelectorSettingsRepo: sessionSelectorSettings,
    sessionExecutionStepsRepo: new SqliteSessionExecutionStepsRepo(db),
    providerAccountsRepo: providerAccounts,
    workspacePreferencesRepo: workspacePreferences,
    capitalReservationsRepo: new CapitalReservationsRepo(db),
    capitalReservation: capitalReservation as never,
    brokerRoutingRepo,
    sessionBrokerAssignmentsRepo: sessionBrokerAssignments,
    brokerAccountsRepo: brokers,
    brokerRegistry: brokerRegistry as never,
    brokerRouting: routing,
    brokerBalanceCache: {
      getBalance: async () => 0,
      refreshAll: async () => [],
    } as never,
    brokerCapital: {
      checkSessionStartFits: () => ({ ok: true as const }),
    } as never,
    brokerAllocationGate: {
      checkOrderFits: () => ({ ok: true as const }),
      checkInstrumentConflict: () => ({ ok: true as const }),
    } as never,
    instrumentNormalizer: {
      toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol,
    } as never,
    ai: {} as never,
    riskEngine: {} as never,
    bus: eventBus,
    logger: createLogger("session-onboarding-test"),
    instrumentCacheRepo: new InstrumentCacheRepo(db),
  };

  const runtimeManager = new SessionRuntimeManager({
    ...orchestratorDeps,
    createOrchestrator: (sessionId) => ({
      start: async () => {
        startedSessions.push(sessionId);
      },
      pause: async () => undefined,
      resume: async () => undefined,
      restartFromAttention: async () => undefined,
      stop: async () => undefined,
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

  return {
    brokers,
    events,
    routing,
    runtimeManager,
    sessionAiPhasesRepo,
    session: new SessionService({
      sessionRepo: sessions,
      tradesRepo: orchestratorDeps.tradesRepo,
      eventsRepo: events,
      sessionBrokerAssignmentsRepo: sessionBrokerAssignments,
      brokerRegistry: brokerRegistry as never,
      brokerBalanceCache: { getBalance: async () => 0 } as never,
      runtimeManager,
      preflight: runPreflight,
      orchestratorDeps,
      liveReadiness: {
        check: async () => ({ readyToStart: true, checks: [] }),
      },
    }),
    sessions,
    sessionWrites: new SessionWriteService({
      sessions,
      events,
      selectorSettings: sessionSelectorSettings,
      assignments: sessionBrokerAssignments,
      brokerRouting: brokerRoutingRepo,
      brokerAccounts: brokers,
    }),
    startedSessions,
    configureDefaultAiProvider() {
      providerAccounts.upsert({
        id: "provider-openrouter",
        name: "OpenRouter",
        category: "ai",
        providerType: "openrouter",
        secretRef: "provider:provider-openrouter",
        metadataJson: null,
        isConfigured: true,
      });
      workspacePreferences.update({
        defaultModelProviderKey: "provider-openrouter",
        defaultModelModelId: "google/gemma-4-31b-it",
      });
      for (const session of sessions.list()) {
        for (const phase of sessionAiPhasesRepo.listBySession(session.id)) {
          sessionAiPhasesRepo.upsertPhase(session.id, {
            ...phase,
            providerKey: "provider-openrouter",
            modelId: "google/gemma-4-31b-it",
          });
        }
      }
    },
    configureWorkspaceDefaultAiModel(input: {
      providerId: string;
      providerName: string;
      providerType: "anthropic" | "openai" | "openrouter";
      modelId: string;
    }) {
      providerAccounts.upsert({
        id: input.providerId,
        name: input.providerName,
        category: "ai",
        providerType: input.providerType,
        secretRef: `provider:${input.providerId}`,
        metadataJson: null,
        isConfigured: true,
      });
      workspacePreferences.update({
        defaultModelProviderKey: input.providerId,
        defaultModelModelId: input.modelId,
      });
    },
    insertBroker(input: {
      id: string;
      name: string;
      brokerType: string;
      supportedInstrumentClasses: InstrumentClass[];
      mode: "paper" | "live";
    }) {
      brokers.insert({
        ...input,
        secretRef: `broker:${input.id}`,
      });
    },
  };
}
