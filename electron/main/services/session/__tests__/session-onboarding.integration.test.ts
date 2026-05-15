import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InstrumentClass } from "@/lib/types";
import { createTestDb } from "../../../db/test-helpers";
import { AgentMessagesRepo } from "../../../db/repositories/agent-messages-repo";
import { AgentRunsRepo } from "../../../db/repositories/agent-runs-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { CapitalReservationsRepo } from "../../../db/repositories/capital-reservations-repo";
import { EventsRepo } from "../../../db/repositories/events-repo";
import { InstrumentCacheRepo } from "../../../db/repositories/instrument-cache-repo";
import { ProviderAccountsRepo } from "../../../db/repositories/provider-accounts-repo";
import { SessionAiRolesRepo } from "../../../db/repositories/session-ai-roles-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SqliteSessionExecutionStepsRepo } from "../../../db/repositories/session-execution-steps-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { SessionRiskConfigRepo } from "../../../db/repositories/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/session-selector-settings-repo";
import { SessionStrategiesRepo } from "../../../db/repositories/session-strategies-repo";
import { SessionTradeRulesRepo } from "../../../db/repositories/session-trade-rules-repo";
import { SessionTimeframeConfigRepo } from "../../../db/repositories/session-timeframe-config-repo";
import { SessionAiRoleProfileRepo } from "../../../db/repositories/session-ai-role-profile-repo";
import { SessionResearchPostureRepo } from "../../../db/repositories/session-research-posture-repo";
import { StatsRepo } from "../../../db/repositories/stats-repo";
import { TradeApprovalsRepo } from "../../../db/repositories/trade-approvals-repo";
import { TradesRepo } from "../../../db/repositories/trades-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";
import { PromptAssetLoader } from "../../ai/prompt-asset-loader";
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
      capitalLimitUsd: 5000,
      executionMode: "paper_only",
      brokerAccountIds: ["paper-broker"],
      brokerOverridesByInstrumentClass: { stock: "paper-broker" },
    });

    await expect(harness.session.start(sessionId)).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
    expect(harness.events.query({ sessionId, minLevel: "ERROR" })[0]?.message).toContain("Preflight provider-credentials failed");

    harness.configureDefaultAiProvider();

    await expect(harness.session.start(sessionId)).resolves.toBe("active");
    expect(harness.sessions.requireById(sessionId).status).toBe("active");
    expect(harness.sessions.requireById(sessionId).executionMode).toBe("paper_only");
    expect(harness.runtimeManager.get(sessionId)?.status).toBe("active");
    expect(harness.startedSessions).toEqual([sessionId]);
    expect(harness.routing.resolveBrokerAccountId(sessionId, "stock")).toBe("paper-broker");
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
      capitalLimitUsd: 5000,
      executionMode: "paper_only",
      brokerAccountIds: ["paper-broker"],
      brokerOverridesByInstrumentClass: { stock: "paper-broker" },
    });

    const roles = harness.sessionAiRoles.listBySession(sessionId);
    expect(roles).toHaveLength(5);
    expect(roles.every((role) => role.providerKey === "provider-openrouter")).toBe(true);
    expect(roles.every((role) => role.modelId === "google/gemma-4-31b-it")).toBe(true);

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
      capitalLimitUsd: 5000,
      executionMode: "live_allowed",
      brokerAccountIds: ["live-broker"],
      brokerOverridesByInstrumentClass: { stock: "live-broker" },
    });

    await expect(harness.session.start(sessionId)).resolves.toBe("active");

    expect(harness.sessions.requireById(sessionId).status).toBe("active");
    expect(harness.sessions.requireById(sessionId).executionMode).toBe("live_allowed");
    expect(harness.brokers.require("live-broker").mode).toBe("live");
    expect(harness.startedSessions).toEqual([sessionId]);
    expect(harness.routing.resolveBrokerAccountId(sessionId, "stock")).toBe("live-broker");
  });
});

function createHarness(db: ReturnType<typeof createTestDb>) {
  const sessions = new SessionRepo(db);
  const brokers = new BrokerAccountsRepo(db);
  const events = new EventsRepo(db);
  const sessionBrokerAssignments = new SessionBrokerAssignmentsRepo(db);
  const brokerRoutingRepo = new BrokerRoutingRepo(db);
  const providerAccounts = new ProviderAccountsRepo(db);
  const sessionAiRoles = new SessionAiRolesRepo(db);
  const sessionSelectorSettings = new SessionSelectorSettingsRepo(db);
  const workspacePreferences = new WorkspacePreferencesRepo(db);
  const startedSessions: string[] = [];
  const eventBus = new EventBus();
  const promptAssetLoader = new PromptAssetLoader();
  const strategyContextService = new SessionStrategyContextService({
    sessionRepo: sessions,
    researchPostureRepo: new SessionResearchPostureRepo(db),
    aiRoleProfileRepo: new SessionAiRoleProfileRepo(db),
    rulesRepo: new SessionTradeRulesRepo(db),
    riskRepo: new SessionRiskConfigRepo(db),
    timeframeRepo: new SessionTimeframeConfigRepo(db),
    aiRolesRepo: sessionAiRoles,
    selectorSettingsRepo: sessionSelectorSettings,
    providerAccountsRepo: providerAccounts,
    workspacePrefsRepo: workspacePreferences,
    promptAssetLoader,
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
    sessionAiRolesRepo: sessionAiRoles,
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
    instrumentNormalizer: { toBrokerSymbol: ({ symbol }: { symbol: string }) => symbol } as never,
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
    sessionAiRoles,
    session: new SessionService({
      sessionRepo: sessions,
      eventsRepo: events,
      runtimeManager,
      preflight: runPreflight,
      orchestratorDeps,
      liveReadiness: { check: async () => ({ readyToStart: true, checks: [] }) },
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
        id: "provider-anthropic",
        name: "Anthropic",
        category: "ai",
        providerType: "anthropic",
        secretRef: "provider:provider-anthropic",
        metadataJson: null,
        isConfigured: true,
      });
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
