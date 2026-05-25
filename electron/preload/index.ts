import { contextBridge, ipcRenderer } from "electron";
import {
  channels,
  mainToRendererEvents,
  type ExvaEventName,
} from "@electron/shared/ipc/channels";
import {
  invokeEndpoint,
  workspaceEndpoints,
} from "@electron/shared/ipc/endpoints";
import { sessionIdParamSchema } from "../shared/validation/schemas";
import {
  apiKeySchema,
  approvalDecideSchema,
  approvalListFiltersSchema,
  approveTradeSchema,
  brokerAccountAddSchema,
  brokerAccountIdSchema,
  brokerCredentialsSchema,
  brokerRoutingUpdateSchema,
  brokerTestEphemeralSchema,
  eventFiltersSchema,
  listTradesFiltersSchema,
  providerAccountSaveSchema,
  providerAccountDeleteSchema,
  providerAccountTestSchema,
  apiCallLogFiltersSchema,
  cycleIdSchema,
  sessionConfigSchema,
  strategyRiskConfigSaveSchema,
  strategyRulesSaveSchema,
  strategyResearchPostureSaveSchema,
  strategyAiSettingsSaveSchema,
  strategyTimeframeConfigSaveSchema,
  strategyAiPhaseSaveSchema,
  strategyAiPhaseWorkerSaveSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import type { ExvaEventMap } from "@electron/shared/ipc/dto";
import type { ExvaApi } from "./exva-api";

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const eventAllowlist = new Set<string>(mainToRendererEvents);

const exva: ExvaApi = {
  dashboard: {
    getStats: () => invoke(channels.dashboard.getStats),
    getCostBreakdown: (dateRange) =>
      invoke(channels.dashboard.getCostBreakdown, { dateRange }),
  },
  trades: {
    listActive: (filters) =>
      invoke(
        channels.trades.listActive,
        listTradesFiltersSchema.parse(filters ?? {}),
      ),
    getDetail: (tradeId) =>
      invoke(channels.trades.getDetail, tradeIdSchema.parse({ tradeId })),
    forceClose: (tradeId) =>
      invoke(channels.trades.forceClose, tradeIdSchema.parse({ tradeId })),
    approve: (tradeId, approved) =>
      invoke(
        channels.trades.approve,
        approveTradeSchema.parse({ tradeId, approved }),
      ),
  },
  session: {
    start: () => invoke(channels.session.start),
    pause: () => invoke(channels.session.pause),
    resume: () => invoke(channels.session.resume),
    stop: () => invoke(channels.session.stop),
    forceStop: () => invoke(channels.session.forceStop),
    getStatus: () => invoke(channels.session.getStatus),
    getExecutionProgress: (sessionId) =>
      invoke(
        channels.session.getExecutionProgress,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    retryStep: (input) => invoke(channels.session.retryStep, input),
    pauseAfterCurrentStep: (sessionId) =>
      invoke(
        channels.session.pauseAfterCurrentStep,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    clearFailedStep: (input) => invoke(channels.session.clearFailedStep, input),
    list: (filters) => invoke(channels.session.list, filters),
    create: (input) => invoke(channels.session.create, input),
    update: (id, input) => invoke(channels.session.update, { id, input }),
    focus: (id) => invoke(channels.session.focus, { id }),
    goGlobal: () => invoke(channels.session.goGlobal, { mode: "global" }),
    archive: (id) => invoke(channels.session.archive, { id }),
    duplicate: (sourceId, name) =>
      invoke(channels.session.duplicate, { sourceId, name }),
    instrumentCacheGet: (sessionId) =>
      invoke(
        channels.session.instrumentCacheGet,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    instrumentCacheClear: (sessionId) =>
      invoke(
        channels.session.instrumentCacheClear,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    getLiveReadiness: (sessionId) =>
      invoke(
        channels.session.getLiveReadiness,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    acknowledgeLiveReadiness: (sessionId) =>
      invoke(
        channels.session.acknowledgeLiveReadiness,
        sessionIdParamSchema.parse({ sessionId }),
      ),
    testLiveBrokerConnection: (sessionId) =>
      invoke(
        channels.session.testLiveBrokerConnection,
        sessionIdParamSchema.parse({ sessionId }),
      ),
  },
  strategy: {
    get: (sessionId) => invoke(channels.strategy.get, { sessionId }),
    getResearchPosture: (sessionId) =>
      invoke(channels.strategy.getResearchPosture, { sessionId }),
    saveResearchPosture: (input) =>
      invoke(
        channels.strategy.saveResearchPosture,
        strategyResearchPostureSaveSchema.parse(input),
      ),
    getRules: (sessionId) => invoke(channels.strategy.getRules, { sessionId }),
    saveRules: (input) =>
      invoke(channels.strategy.saveRules, strategyRulesSaveSchema.parse(input)),
    getRiskConfig: (sessionId) =>
      invoke(channels.strategy.getRiskConfig, { sessionId }),
    saveRiskConfig: (input) =>
      invoke(
        channels.strategy.saveRiskConfig,
        strategyRiskConfigSaveSchema.parse(input),
      ),
    getTimeframeConfig: (sessionId) =>
      invoke(channels.strategy.getTimeframeConfig, { sessionId }),
    saveTimeframeConfig: (input) =>
      invoke(
        channels.strategy.saveTimeframeConfig,
        strategyTimeframeConfigSaveSchema.parse(input),
      ),
    saveAiSettings: (input) =>
      invoke(
        channels.strategy.saveAiSettings,
        strategyAiSettingsSaveSchema.parse(input),
      ),
    saveAiPhase: (input) =>
      invoke(
        channels.strategy.saveAiPhase,
        strategyAiPhaseSaveSchema.parse(input),
      ),
    saveAiPhaseWorker: (input) =>
      invoke(
        channels.strategy.saveAiPhaseWorker,
        strategyAiPhaseWorkerSaveSchema.parse(input),
      ),
    getProviderModels: (providerKey) =>
      invoke(channels.strategy.getProviderModels, { providerKey }),
    globalPresets: {
      list: () => invoke(channels.strategy.globalPresets.list),
      create: (input) => invoke(channels.strategy.globalPresets.create, input),
      update: (input) => invoke(channels.strategy.globalPresets.update, input),
      delete: (input) => invoke(channels.strategy.globalPresets.delete, input),
    },
    getWorkspaceDefaultModel: () =>
      invoke(channels.strategy.getWorkspaceDefaultModel),
    saveWorkspaceDefaultModel: (input) =>
      invoke(channels.strategy.saveWorkspaceDefaultModel, input),
  },
  workspace: {
    getView: () =>
      invokeEndpoint<
        undefined,
        import("@electron/shared/ipc/dto").WorkspaceViewResponse
      >(invoke, workspaceEndpoints.getView, undefined),
    patchPreferences: (patch) =>
      invokeEndpoint<
        Partial<Omit<import("@/lib/types").WorkspacePreferences, "id">>,
        import("@/lib/types").WorkspacePreferences
      >(invoke, workspaceEndpoints.patchPreferences, patch),
  },
  brokerAccounts: {
    list: () => invoke(channels.brokerAccounts.list),
    refreshBalance: (brokerAccountId) =>
      invoke(channels.brokerAccounts.refreshBalance, { brokerAccountId }),
    updateSettings: (input) =>
      invoke(channels.brokerAccounts.updateSettings, input),
  },
  templates: {
    list: (filters) => invoke(channels.templates.list, filters),
    create: (input) => invoke(channels.templates.create, input),
    delete: (id) => invoke(channels.templates.delete, { id }),
    use: (id) => invoke(channels.templates.use, { id }),
    buildPayloadFromSession: (sessionId) =>
      invoke(channels.templates.buildPayloadFromSession, { sessionId }),
  },
  config: {
    getStrategy: () => invoke(channels.config.getStrategy),
    saveStrategy: (config) =>
      invoke(channels.config.saveStrategy, sessionConfigSchema.parse(config)),
  },
  accounts: {
    saveBroker: (credentials) =>
      invoke(
        channels.accounts.saveBroker,
        brokerCredentialsSchema.parse(credentials),
      ),
    testBroker: () => invoke(channels.accounts.testBroker),
    removeBroker: () => invoke(channels.accounts.removeBroker),
    saveApiKey: (keyType, value) =>
      invoke(
        channels.accounts.saveApiKey,
        apiKeySchema.parse({ keyType, value }),
      ),
    listProviders: () => invoke(channels.accounts.listProviders),
    saveProvider: (input) =>
      invoke(
        channels.accounts.saveProvider,
        providerAccountSaveSchema.parse(input),
      ),
    deleteProvider: (input) =>
      invoke(
        channels.accounts.deleteProvider,
        providerAccountDeleteSchema.parse(input),
      ),
    testProvider: (input) =>
      invoke(
        channels.accounts.testProvider,
        providerAccountTestSchema.parse(input),
      ),
    listBrokers: () => invoke(channels.accounts.listBrokers),
    addBroker: (input) =>
      invoke(channels.accounts.addBroker, brokerAccountAddSchema.parse(input)),
    removeBrokerAccount: (input) =>
      invoke(
        channels.accounts.removeBrokerAccount,
        brokerAccountIdSchema.parse(input),
      ),
    testBrokerAccount: (input) =>
      invoke(
        channels.accounts.testBrokerAccount,
        brokerAccountIdSchema.parse(input),
      ),
    testBrokerEphemeral: (input) =>
      invoke(
        channels.accounts.testBrokerEphemeral,
        brokerTestEphemeralSchema.parse(input),
      ),
    routingGet: () => invoke(channels.accounts.routingGet),
    routingUpdate: (input) =>
      invoke(
        channels.accounts.routingUpdate,
        brokerRoutingUpdateSchema.parse(input),
      ),
  },
  approvals: {
    list: (filters) =>
      invoke(
        channels.approvals.list,
        approvalListFiltersSchema.parse(filters ?? {}),
      ),
    decide: (input) =>
      invoke(channels.approvals.decide, approvalDecideSchema.parse(input)),
  },
  developer: {
    getSettings: () => invoke(channels.developer.getSettings),
    updateSettings: (patch: unknown) =>
      invoke(channels.developer.updateSettings, patch),
    setLogLevel: (input: unknown) =>
      invoke(channels.developer.setLogLevel, input),
    stopLogOverride: (input: { overrideId: string }) =>
      invoke(channels.developer.stopLogOverride, input),
    getScopeDiagnostics: (input: unknown) =>
      invoke(channels.developer.getScopeDiagnostics, input),
    exportDebugBundle: (input: unknown) =>
      invoke(channels.developer.exportDebugBundle, input),
    openPath: (input: { kind: string; path?: string }) =>
      invoke(channels.developer.openPath, input),
    listEventsV2: (input: unknown) =>
      invoke(channels.developer.listEventsV2, input),
  },
  events: {
    list: (filters) =>
      invoke(channels.events.list, eventFiltersSchema.parse(filters)),
    getAgentTraces: (tradeId) =>
      invoke(channels.events.getAgentTraces, tradeIdSchema.parse({ tradeId })),
    getAgentTracesByCycle: (cycleId) =>
      invoke(
        channels.events.getAgentTracesByCycle,
        cycleIdSchema.parse({ cycleId }),
      ),
    getMessagesByCycle: (cycleId) =>
      invoke(
        channels.events.getMessagesByCycle,
        cycleIdSchema.parse({ cycleId }),
      ),
    getApiCallLog: (filters) =>
      invoke(
        channels.events.getApiCallLog,
        apiCallLogFiltersSchema.parse(filters),
      ),
    subscribe: <K extends ExvaEventName>(
      name: K,
      handler: (payload: ExvaEventMap[K]) => void,
    ) => {
      if (!eventAllowlist.has(name)) return () => {};
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ExvaEventMap[K],
      ) => handler(payload);
      ipcRenderer.on(name, listener);
      return () => ipcRenderer.off(name, listener);
    },
  },
};

contextBridge.exposeInMainWorld("exva", exva);
