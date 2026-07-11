import "./ipc-electron-mock";
import { vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstrumentClass } from "@/lib/types";
import { sessionRequiresInstrumentScope } from "@electron/shared/domain";
import { createTestDb } from "../../db/test-helpers";
import type { DbClient } from "../../db/client";
import { AgentRunsRepo } from "../../db/repositories/agents/agent-runs-repo";
import { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import { ApiCallLogRepo } from "../../db/repositories/system/api-call-log-repo";
import { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../db/repositories/brokers/broker-routing-repo";
import { CapitalReservationsRepo } from "../../db/repositories/trades/capital-reservations-repo";
import { EventsRepo } from "../../db/repositories/system/events-repo";
import { ProviderAccountsRepo } from "../../db/repositories/workspace/provider-accounts-repo";
import { SessionAiPhasesRepo } from "../../db/repositories/sessions/session-ai-phases-repo";
import { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRiskConfigRepo } from "../../db/repositories/sessions/session-risk-config-repo";
import { SessionSelectorSettingsRepo } from "../../db/repositories/sessions/session-selector-settings-repo";
import { SessionTradeRulesRepo } from "../../db/repositories/sessions/session-trade-rules-repo";
import { SessionStrategiesRepo } from "../../db/repositories/sessions/session-strategies-repo";
import { SessionTemplatesRepo } from "../../db/repositories/sessions/session-templates-repo";
import { SessionTimeframeConfigRepo } from "../../db/repositories/sessions/session-timeframe-config-repo";
import { SessionResearchPostureRepo } from "../../db/repositories/sessions/session-research-posture-repo";
import { SessionAiSettingsRepo } from "../../db/repositories/sessions/session-ai-settings-repo";
import { SqliteSessionExecutionStepsRepo } from "../../db/repositories/sessions/session-execution-steps-repo";
import { SessionRepo } from "../../db/repositories/sessions/session-repo";
import { InstrumentCacheRepo } from "../../db/repositories/market/instrument-cache-repo";
import { GlobalPresetsRepo } from "../../db/repositories/presets/global-presets-repo";
import { RiskPresetsRepo } from "../../db/repositories/presets/risk-presets-repo";
import { TimeframePresetsRepo } from "../../db/repositories/presets/timeframe-presets-repo";
import { ResearchPosturePresetsRepo } from "../../db/repositories/presets/research-posture-presets-repo";
import { TradeRulePresetsRepo } from "../../db/repositories/presets/trade-rule-presets-repo";
import { StatsRepo } from "../../db/repositories/system/stats-repo";
import { TradeApprovalsRepo } from "../../db/repositories/trades/trade-approvals-repo";
import { PeriodAutopsiesRepo } from "../../db/repositories/trades/period-autopsies-repo";
import { TradeAutopsiesRepo } from "../../db/repositories/trades/trade-autopsies-repo";
import { AutopsyLessonsRepo } from "../../db/repositories/trades/autopsy-lessons-repo";
import { TradesRepo } from "../../db/repositories/trades/trades-repo";
import { DecisionTraceRepo } from "../../db/repositories/trades/decision-trace-repo";
import { SignalObservationsRepo } from "../../db/repositories/research/signal-observations-repo";
import { SignalLabelsRepo } from "../../db/repositories/research/signal-labels-repo";
import {
  BacktestRunsRepo,
  ModelVersionsRepo,
  PromotionDecisionsRepo,
} from "../../db/repositories/research/experiment-repos";
import { SignalObservationService } from "../../services/research/signal-observation-service";
import { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import { ExperienceExperimentsRepo } from "../../db/repositories/experiences/experience-experiments-repo";
import { MockBrokerAdapter } from "../../services/broker/adapters/mock-adapter";
import { BrokerRoutingService } from "../../services/broker/broker-routing-service";
import { BrokerService } from "../../services/broker/broker-service";
import { EventBus } from "../../services/infra/event-bus";
import { createLogger } from "../../services/infra/log";
import { PaperScorecardService } from "../../services/analytics/paper-scorecard-service";
import { ExperienceScorecardService } from "../../services/analytics/experience-scorecard-service";
import { ResearchSummaryService } from "../../services/analytics/research-summary-service";
import { CycleReplayService } from "../../services/replay/cycle-replay-service";
import { SessionListingService } from "../../services/session/listing-service";
import { runPreflight } from "../../services/session/preflight";
import { SessionRuntimeManager } from "../../services/session/session-runtime-manager";
import { SessionService } from "../../services/session/session-service";
import { SessionStrategyContextService } from "../../services/session/session-strategy-context-service";
import { SessionWriteService } from "../../services/session/write-service";
import { SignalSourcesRepo } from "../../services/signals/repos/signal-sources-repo";
import type { AppServices } from "../../services/app-services";
import type { OrchestratorDeps } from "../../services/session";
import { registerApprovalHandlers } from "../trading/approvals";
import { registerIpcHandlers } from "../register";
import { registerSessionHandlers } from "../session/session";
import { registerTradeHandlers } from "../trading/trades";
import { registerStrategyHandlers } from "../workspace/strategy";
import "../../experiences/index";
import { ipcHarness } from "./ipc-electron-mock";

export { ipcHarness } from "./ipc-electron-mock";
export type IpcTestContext = IpcTestHarness;

export interface IpcTestHarness {
  services: AppServices;
  db: DbClient;
  eventBus: EventBus;
  replayDir: string;
  startedSessions: string[];
  configureAiProvider: (sessionId?: string) => void;
  validSessionCreatePayload: (
    brokerAccountId: string,
    overrides?: Record<string, unknown>,
  ) => Record<string, unknown>;
  insertBroker: (input: {
    id: string;
    name?: string;
    brokerType?: string;
    supportedInstrumentClasses?: InstrumentClass[];
    mode?: "paper" | "live";
  }) => void;
  cleanup: () => void;
}

export function createIpcTestServices(existingDb?: DbClient): IpcTestHarness {
  const db = existingDb ?? createTestDb();
  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), "exva-ipc-test-"));
  const eventBus = new EventBus();
  const startedSessions: string[] = [];
  const signalSourcesRepo = new SignalSourcesRepo(db);
  const signalObservationsRepo = new SignalObservationsRepo(db);

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
    experienceExperiments: new ExperienceExperimentsRepo(db),
    autopsyLessons: new AutopsyLessonsRepo(db),
    trades: new TradesRepo(db),
    decisionTraces: new DecisionTraceRepo(db),
    signalObservations: signalObservationsRepo,
    signalLabels: new SignalLabelsRepo(db),
    modelVersions: new ModelVersionsRepo(db),
    backtestRuns: new BacktestRunsRepo(db),
    promotionDecisions: new PromotionDecisionsRepo(db),
    workspacePreferences: new WorkspacePreferencesRepo(db),
    instrumentCache: new InstrumentCacheRepo(db),
    globalPresets: new GlobalPresetsRepo(db),
    riskPresets: new RiskPresetsRepo(db),
    timeframePresets: new TimeframePresetsRepo(db),
    researchPosturePresets: new ResearchPosturePresetsRepo(db),
    tradeRulePresets: new TradeRulePresetsRepo(db),
  };

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
    signalSourceTypes: signalSourcesRepo,
  });

  const mockAdapter = new MockBrokerAdapter();
  const brokerRegistry = {
    get: async () => mockAdapter,
    isMockAccount: () => true,
  };

  const routing = new BrokerRoutingService(
    repos.brokerAccounts,
    repos.sessionBrokerAssignments,
    repos.brokerRouting,
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
    capitalReservation: capitalReservation as never,
    brokerRoutingRepo: repos.brokerRouting,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerAccountsRepo: repos.brokerAccounts,
    brokerRegistry: brokerRegistry as never,
    brokerRouting: routing,
    brokerBalanceCache: {
      getBalance: async () => 10_000,
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
    decisionTracesRepo: repos.decisionTraces,
    signalObservationsRepo,
    ai: {} as never,
    riskEngine: {} as never,
    bus: eventBus,
    logger: createLogger("ipc-test"),
    instrumentCacheRepo: repos.instrumentCache,
    signalSourcesRepo,
  } satisfies OrchestratorDeps;

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

  const session = new SessionService({
    sessionRepo: repos.session,
    tradesRepo: repos.trades,
    eventsRepo: repos.events,
    sessionBrokerAssignmentsRepo: repos.sessionBrokerAssignments,
    brokerRegistry: brokerRegistry as never,
    brokerBalanceCache: { getBalance: async () => 10_000 } as never,
    runtimeManager,
    preflight: runPreflight,
    orchestratorDeps,
    liveReadiness: {
      check: async () => ({ readyToStart: true, checks: [] }),
    },
  });

  const sessionListing = new SessionListingService({
    sessionRepo: repos.session,
    assignments: repos.sessionBrokerAssignments,
    trades: repos.trades,
    runtimeManager,
    signalSources: signalSourcesRepo,
    signalRegistry: { snapshot: () => null } as never,
    brokerAccounts: repos.brokerAccounts,
  });

  const sessionWrites = new SessionWriteService({
    sessions: repos.session,
    events: repos.events,
    selectorSettings: repos.sessionSelectorSettings,
    assignments: repos.sessionBrokerAssignments,
    brokerRouting: repos.brokerRouting,
    brokerAccounts: repos.brokerAccounts,
    signals: {
      replaceSessionSubscriptions: (sessionId, sourceIds) => {
        signalSourcesRepo.replaceSessionSubscriptions(sessionId, sourceIds);
      },
      requiresInstrumentScopeForSourceIds: (sourceIds) => {
        const subscribedSources = sourceIds.flatMap((sourceId) => {
          const source = signalSourcesRepo.get(sourceId);
          return source ? [{ type: source.type }] : [];
        });
        return sessionRequiresInstrumentScope(subscribedSources);
      },
      getSource: (sourceId) => signalSourcesRepo.get(sourceId),
    },
  });

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

  const researchSummary = new ResearchSummaryService(experienceScorecard);

  const cycleReplay = new CycleReplayService({
    agentMessages: repos.agentMessages,
    trades: repos.trades,
    instrumentCache: repos.instrumentCache,
    sessionExecutionSteps: repos.sessionExecutionSteps,
    userDataPath: replayDir,
  });

  const services: AppServices = {
    db,
    orchestratorDeps,
    instrumentCacheService: {
      getView: () => ({ entries: [] }),
      clear: () => undefined,
    } as unknown as AppServices["instrumentCacheService"],
    repos,
    ai: {} as AppServices["ai"],
    providerRegistry: {
      listModels: async () => [],
    } as unknown as AppServices["providerRegistry"],
    searchRegistry: {} as AppServices["searchRegistry"],
    brokerRegistry: brokerRegistry as never,
    broker: new BrokerService(brokerRegistry as never),
    brokerCapital: orchestratorDeps.brokerCapital,
    brokerBalanceCache: orchestratorDeps.brokerBalanceCache,
    brokerAllocationGate: orchestratorDeps.brokerAllocationGate,
    balanceTicker: {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as AppServices["balanceTicker"],
    capitalReservation: capitalReservation as never,
    eventBus,
    notifications: {} as AppServices["notifications"],
    marketData: {} as AppServices["marketData"],
    supervisor: {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as AppServices["supervisor"],
    runtimeManager,
    risk: {} as AppServices["risk"],
    secrets: {} as AppServices["secrets"],
    session,
    sessionListing,
    strategyContext,
    sessionTemplates: {} as AppServices["sessionTemplates"],
    sessionWrites,
    cycleReplay,
    paperScorecard,
    experienceScorecard,
    experienceCapitalAllocator: {} as AppServices["experienceCapitalAllocator"],
    researchSummary,
    signalObservation: new SignalObservationService(signalObservationsRepo),
    labelBuilder: {} as AppServices["labelBuilder"],
    researchExperiment: {} as AppServices["researchExperiment"],
    periodAutopsy: {} as AppServices["periodAutopsy"],
    liveReadiness: {
      check: async () => ({ readyToStart: true, checks: [] }),
      acknowledge: () => undefined,
    } as unknown as AppServices["liveReadiness"],
    tradeAutopsy: {} as AppServices["tradeAutopsy"],
    autopsyExport: {} as AppServices["autopsyExport"],
    signals: {
      ensureAllExperienceSignalSources: () => [],
    } as unknown as AppServices["signals"],
    controlRepo: {} as AppServices["controlRepo"],
    control: {} as AppServices["control"],
  };

  function configureAiProvider(sessionId?: string) {
    repos.providerAccounts.upsert({
      id: "provider-openrouter",
      name: "OpenRouter",
      category: "ai",
      providerType: "openrouter",
      secretRef: "provider:provider-openrouter",
      metadataJson: null,
      isConfigured: true,
    });
    repos.workspacePreferences.update({
      defaultModelProviderKey: "provider-openrouter",
      defaultModelModelId: "google/gemma-4-31b-it",
    });
    const targets = sessionId
      ? [repos.session.requireById(sessionId)]
      : repos.session.list();
    for (const target of targets) {
      for (const phase of repos.sessionAiPhases.listBySession(target.id)) {
        repos.sessionAiPhases.upsertPhase(target.id, {
          ...phase,
          providerKey: "provider-openrouter",
          modelId: "google/gemma-4-31b-it",
        });
      }
    }
  }

  function validSessionCreatePayload(
    brokerAccountId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      name: "IPC Test Session",
      objective: "Trade NVDA in paper mode",
      selectionMode: "manual_shortlist",
      instrumentScope: "NVDA",
      selectorSettings: { aiPickerEnabled: false },
      executionMode: "paper_only",
      brokerAssignments: [{ brokerAccountId, allocatedUsd: 5000 }],
      brokerOverridesByInstrumentClass: { stock: brokerAccountId },
      experienceId: "edgar-catalyst",
      ...overrides,
    };
  }

  function insertBroker(input: {
    id: string;
    name?: string;
    brokerType?: string;
    supportedInstrumentClasses?: InstrumentClass[];
    mode?: "paper" | "live";
  }) {
    repos.brokerAccounts.insert({
      id: input.id,
      name: input.name ?? "Mock Paper",
      brokerType: input.brokerType ?? "mock",
      supportedInstrumentClasses: input.supportedInstrumentClasses ?? ["stock"],
      mode: input.mode ?? "paper",
      secretRef: `broker:${input.id}`,
    });
  }

  return {
    services,
    db,
    eventBus,
    replayDir,
    startedSessions,
    configureAiProvider,
    validSessionCreatePayload,
    insertBroker,
    cleanup: () => {
      db.sqlite.close();
      fs.rmSync(replayDir, { recursive: true, force: true });
    },
  };
}

export function resetIpcHandlers(): void {
  ipcHarness.handlers.clear();
  ipcHarness.windows = [ipcHarness.mockBrowserWindow];
}

export function registerPhase4IpcHandlers(services: AppServices): void {
  registerSessionHandlers(services);
  registerTradeHandlers(services);
  registerApprovalHandlers(services);
  registerStrategyHandlers(services);
}

export function registerIpcTestHandlers(services: AppServices): void {
  resetIpcHandlers();
  registerIpcHandlers(services);
}

export function createIpcInvokeEvent(options?: {
  trusted?: boolean;
  subFrame?: boolean;
}): IpcMainInvokeEvent {
  const trusted = options?.trusted !== false;
  return {
    sender: {
      id: trusted ? ipcHarness.trustedWebContentsId : -1,
    },
    senderFrame: options?.subFrame ? { parent: {} } : { parent: null },
  } as IpcMainInvokeEvent;
}

export async function invokeIpc<T>(
  channel: string,
  payload?: unknown,
  options?: { trusted?: boolean; subFrame?: boolean },
): Promise<T> {
  if (options?.trusted === false) {
    ipcHarness.windows = [];
  } else {
    ipcHarness.windows = [ipcHarness.mockBrowserWindow];
  }

  const handler = ipcHarness.handlers.get(channel);
  if (!handler) {
    throw new Error(`No IPC handler registered for ${channel}`);
  }

  return (await handler(createIpcInvokeEvent(options), payload)) as T;
}

export async function invokeIpcError(
  channel: string,
  payload?: unknown,
  options?: { trusted?: boolean; subFrame?: boolean },
) {
  try {
    await invokeIpc(channel, payload, options);
    throw new Error(`Expected IPC error for ${channel}`);
  } catch (error) {
    const err = error as Error & { code?: string };
    return { code: err.code ?? "UNKNOWN", message: err.message };
  }
}
