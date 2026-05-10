import { contextBridge, ipcRenderer } from "electron";
import { channels, mainToRendererEvents, type ExvaEventName } from "@electron/shared/channels";
import { sessionIdParamSchema } from "../shared/schemas";
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
  strategyAiRolesSaveSchema,
  strategyProfileSaveSchema,
  strategyRiskConfigSaveSchema,
  strategyTimeframeConfigSaveSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import type { ExvaApi, ExvaEventMap } from "./exva-api";

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const eventAllowlist = new Set<string>(mainToRendererEvents);

const exva: ExvaApi = {
  dashboard: {
    getStats: () => invoke(channels.dashboard.getStats),
    getCostBreakdown: (dateRange) => invoke(channels.dashboard.getCostBreakdown, { dateRange }),
  },
  trades: {
    listActive: (filters) => invoke(channels.trades.listActive, listTradesFiltersSchema.parse(filters ?? {})),
    getDetail: (tradeId) => invoke(channels.trades.getDetail, tradeIdSchema.parse({ tradeId })),
    forceClose: (tradeId) => invoke(channels.trades.forceClose, tradeIdSchema.parse({ tradeId })),
    approve: (tradeId, approved) =>
      invoke(channels.trades.approve, approveTradeSchema.parse({ tradeId, approved })),
    summarizeAutopsy: (tradeId) =>
      invoke(channels.trades.summarizeAutopsy, tradeIdSchema.parse({ tradeId })),
    listAutopsies: (tradeId) =>
      invoke(channels.trades.listAutopsies, tradeIdSchema.parse({ tradeId })),
  },
  session: {
    start: () => invoke(channels.session.start),
    pause: () => invoke(channels.session.pause),
    resume: () => invoke(channels.session.resume),
    stop: () => invoke(channels.session.stop),
    getStatus: () => invoke(channels.session.getStatus),
    list: (filters) => invoke(channels.session.list, filters),
    create: (input) => invoke(channels.session.create, input),
    update: (id, input) => invoke(channels.session.update, { id, input }),
    focus: (id) => invoke(channels.session.focus, { id }),
    goGlobal: () => invoke(channels.session.goGlobal, { mode: "global" }),
    archive: (id) => invoke(channels.session.archive, { id }),
    duplicate: (sourceId, name) => invoke(channels.session.duplicate, { sourceId, name }),
    instrumentCacheGet: (sessionId) =>
      invoke(channels.session.instrumentCacheGet, sessionIdParamSchema.parse({ sessionId })),
    instrumentCacheClear: (sessionId) =>
      invoke(channels.session.instrumentCacheClear, sessionIdParamSchema.parse({ sessionId })),
  },
  strategy: {
    get: (sessionId) => invoke(channels.strategy.get, { sessionId }),
    getProfile: (sessionId) => invoke(channels.strategy.getProfile, { sessionId }),
    saveProfile: (input) => invoke(channels.strategy.saveProfile, strategyProfileSaveSchema.parse(input)),
    getRiskConfig: (sessionId) => invoke(channels.strategy.getRiskConfig, { sessionId }),
    saveRiskConfig: (input) => invoke(channels.strategy.saveRiskConfig, strategyRiskConfigSaveSchema.parse(input)),
    getTimeframeConfig: (sessionId) => invoke(channels.strategy.getTimeframeConfig, { sessionId }),
    saveTimeframeConfig: (input) =>
      invoke(channels.strategy.saveTimeframeConfig, strategyTimeframeConfigSaveSchema.parse(input)),
    saveAiRoles: (input) => invoke(channels.strategy.saveAiRoles, strategyAiRolesSaveSchema.parse(input)),
    getProviderModels: (providerKey) => invoke(channels.strategy.getProviderModels, { providerKey }),
    resetPrompt: (role) => invoke(channels.strategy.resetPrompt, { role }),
  },
  workspace: {
    getView: () => invoke(channels.workspace.viewGet),
    patchPreferences: (patch) => invoke(channels.workspace.prefsPatch, patch),
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
    saveStrategy: (config) => invoke(channels.config.saveStrategy, sessionConfigSchema.parse(config)),
  },
  accounts: {
    saveBroker: (credentials) => invoke(channels.accounts.saveBroker, brokerCredentialsSchema.parse(credentials)),
    testBroker: () => invoke(channels.accounts.testBroker),
    removeBroker: () => invoke(channels.accounts.removeBroker),
    saveApiKey: (keyType, value) =>
      invoke(channels.accounts.saveApiKey, apiKeySchema.parse({ keyType, value })),
    listProviders: () => invoke(channels.accounts.listProviders),
    saveProvider: (input) => invoke(channels.accounts.saveProvider, providerAccountSaveSchema.parse(input)),
    deleteProvider: (input) => invoke(channels.accounts.deleteProvider, providerAccountDeleteSchema.parse(input)),
    testProvider: (input) => invoke(channels.accounts.testProvider, providerAccountTestSchema.parse(input)),
    listBrokers: () => invoke(channels.accounts.listBrokers),
    addBroker: (input) => invoke(channels.accounts.addBroker, brokerAccountAddSchema.parse(input)),
    removeBrokerAccount: (input) => invoke(channels.accounts.removeBrokerAccount, brokerAccountIdSchema.parse(input)),
    testBrokerAccount: (input) => invoke(channels.accounts.testBrokerAccount, brokerAccountIdSchema.parse(input)),
    testBrokerEphemeral: (input) =>
      invoke(channels.accounts.testBrokerEphemeral, brokerTestEphemeralSchema.parse(input)),
    routingGet: () => invoke(channels.accounts.routingGet),
    routingUpdate: (input) => invoke(channels.accounts.routingUpdate, brokerRoutingUpdateSchema.parse(input)),
  },
  approvals: {
    list: (filters) => invoke(channels.approvals.list, approvalListFiltersSchema.parse(filters ?? {})),
    decide: (input) => invoke(channels.approvals.decide, approvalDecideSchema.parse(input)),
  },
  events: {
    list: (filters) => invoke(channels.events.list, eventFiltersSchema.parse(filters)),
    getAgentTraces: (tradeId) => invoke(channels.events.getAgentTraces, tradeIdSchema.parse({ tradeId })),
    getAgentTracesByCycle: (cycleId) => invoke(channels.events.getAgentTracesByCycle, cycleIdSchema.parse({ cycleId })),
    getMessagesByCycle: (cycleId) => invoke(channels.events.getMessagesByCycle, cycleIdSchema.parse({ cycleId })),
    getApiCallLog: (filters) => invoke(channels.events.getApiCallLog, apiCallLogFiltersSchema.parse(filters)),
    subscribe: <K extends ExvaEventName>(name: K, handler: (payload: ExvaEventMap[K]) => void) => {
      if (!eventAllowlist.has(name)) return () => {};
      const listener = (_event: Electron.IpcRendererEvent, payload: ExvaEventMap[K]) => handler(payload);
      ipcRenderer.on(name, listener);
      return () => ipcRenderer.off(name, listener);
    },
  },
};

contextBridge.exposeInMainWorld("exva", exva);
