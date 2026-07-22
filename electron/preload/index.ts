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
  brokerRoutingUpdateSchema,
  brokerTestEphemeralSchema,
  eventFiltersSchema,
  listTradesFiltersSchema,
  providerAccountSaveSchema,
  providerAccountDeleteSchema,
  providerAccountTestSchema,
  apiCallLogFiltersSchema,
  cycleIdSchema,
  strategyConfigApplyPresetSchema,
  strategyConfigDeletePresetSchema,
  strategyConfigGetSchema,
  strategyConfigHistorySchema,
  strategyConfigListPresetsSchema,
  strategyConfigRollbackSchema,
  strategyConfigSavePresetSchema,
  strategyConfigUpdateSchema,
  tradeIdSchema,
} from "@/lib/schemas";
import type { ExvaEventMap } from "@electron/shared/ipc/dto";
import type { ExvaApi } from "./exva-api";
import { createIpcInvokeEnvelope } from "@electron/shared/infra/trace-context";

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(
    channel,
    createIpcInvokeEnvelope(payload),
  ) as Promise<T>;
}

const eventAllowlist = new Set<string>(mainToRendererEvents);

const exva: ExvaApi = {
  diagnostics: {
    reportRendererError: (input) =>
      invoke(channels.diagnostics.reportRendererError, input),
  },
  dashboard: {
    getStats: () => invoke(channels.dashboard.getStats),
    getCostBreakdown: (dateRange) =>
      invoke(channels.dashboard.getCostBreakdown, { dateRange }),
    getCalendarAttention: () => invoke(channels.dashboard.getCalendarAttention),
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
  autopsy: {
    summarize: (tradeId) =>
      invoke(
        channels.trades.autopsy.summarize,
        tradeIdSchema.parse({ tradeId }),
      ),
    list: (tradeId) =>
      invoke(channels.trades.autopsy.list, tradeIdSchema.parse({ tradeId })),
    listLessons: (autopsyId) =>
      invoke(channels.trades.autopsy.listLessons, { autopsyId }),
    addLesson: (input) => invoke(channels.trades.autopsy.addLesson, input),
    updateLesson: (input) =>
      invoke(channels.trades.autopsy.updateLesson, input),
    export: (autopsyId, format) =>
      invoke(channels.trades.autopsy.export, { autopsyId, format }),
    period: {
      run: (input) => invoke(channels.autopsy.period.run, input),
      list: (input) => invoke(channels.autopsy.period.list, input),
      get: (input) => invoke(channels.autopsy.period.get, input),
      preview: (input) => invoke(channels.autopsy.period.preview, input),
      lessons: {
        list: (input) => invoke(channels.autopsy.period.lessons.list, input),
        update: (input) =>
          invoke(channels.autopsy.period.lessons.update, input),
        add: (input) => invoke(channels.autopsy.period.lessons.add, input),
        promote: (input) =>
          invoke(channels.autopsy.period.lessons.promote, input),
      },
      export: (input) => invoke(channels.autopsy.period.export, input),
    },
  },
  experiences: {
    list: () => invoke(channels.experiences.list),
    listScorecards: () => invoke(channels.experiences.listScorecards),
    getScorecard: (experienceId: string) =>
      invoke(channels.experiences.getScorecard, { experienceId }),
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
    goGlobal: () => invoke(channels.session.goGlobal),
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
    debugInjectSignal: (sessionId, opts) =>
      invoke(channels.session.debugInjectSignal, {
        sessionId,
        ...opts,
      }),
    debugForceTrade: (sessionId) =>
      invoke(
        channels.session.debugForceTrade,
        sessionIdParamSchema.parse({ sessionId }),
      ),
  },
  strategy: {
    get: (sessionId) => invoke(channels.strategy.get, { sessionId }),
    getProviderModels: (providerKey) =>
      invoke(channels.strategy.getProviderModels, { providerKey }),
    getWorkspaceDefaultModel: () =>
      invoke(channels.strategy.getWorkspaceDefaultModel),
    saveWorkspaceDefaultModel: (input) =>
      invoke(channels.strategy.saveWorkspaceDefaultModel, input),
  },
  strategyConfig: {
    get: (sessionId) =>
      invoke(
        channels.strategyConfig.get,
        strategyConfigGetSchema.parse({ sessionId }),
      ),
    update: (input) =>
      invoke(
        channels.strategyConfig.update,
        strategyConfigUpdateSchema.parse(input),
      ),
    applyPreset: (input) =>
      invoke(
        channels.strategyConfig.applyPreset,
        strategyConfigApplyPresetSchema.parse(input),
      ),
    listPresets: (kind) =>
      invoke(
        channels.strategyConfig.listPresets,
        strategyConfigListPresetsSchema.parse(kind ? { kind } : {}),
      ),
    savePreset: (input) =>
      invoke(
        channels.strategyConfig.savePreset,
        strategyConfigSavePresetSchema.parse(input),
      ),
    deletePreset: (input) =>
      invoke(
        channels.strategyConfig.deletePreset,
        strategyConfigDeletePresetSchema.parse(input),
      ),
    history: (sessionId) =>
      invoke(
        channels.strategyConfig.history,
        strategyConfigHistorySchema.parse({ sessionId }),
      ),
    rollback: (input) =>
      invoke(
        channels.strategyConfig.rollback,
        strategyConfigRollbackSchema.parse(input),
      ),
  },
  signals: {
    listSources: () => invoke(channels.signals.sources.list),
    createSource: (input) => invoke(channels.signals.sources.create, input),
    updateSource: (input) => invoke(channels.signals.sources.update, input),
    deleteSource: (id) => invoke(channels.signals.sources.delete, { id }),
    enableSource: (id) => invoke(channels.signals.sources.enable, { id }),
    disableSource: (id) => invoke(channels.signals.sources.disable, { id }),
    testSource: (id) => invoke(channels.signals.sources.test, { id }),
    listSessionEvents: (input) => invoke(channels.signals.events.list, input),
    listSessionDeadLetters: (input) =>
      invoke(channels.signals.deadLetters.list, input),
    replaySignalDeadLetter: (input) =>
      invoke(channels.signals.deadLetters.replay, input),
    getSessionReadiness: (input) =>
      invoke(channels.signals.sessions.getReadiness, input),
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
    resetPaperBalance: (input) =>
      invoke(channels.brokerAccounts.resetPaperBalance, input),
  },
  templates: {
    list: (filters) => invoke(channels.templates.list, filters),
    create: (input) => invoke(channels.templates.create, input),
    delete: (id) => invoke(channels.templates.delete, { id }),
    use: (id) => invoke(channels.templates.use, { id }),
    buildPayloadFromSession: (sessionId) =>
      invoke(channels.templates.buildPayloadFromSession, { sessionId }),
  },
  accounts: {
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
  control: {
    isEnabled: () => invoke(channels.control.isEnabled),
    listConversations: () => invoke(channels.control.listConversations),
    getConversation: (id) => invoke(channels.control.getConversation, { id }),
    createConversation: (input) =>
      invoke(channels.control.createConversation, input ?? {}),
    renameConversation: (input) =>
      invoke(channels.control.renameConversation, input),
    deleteConversation: (id) =>
      invoke(channels.control.deleteConversation, { id }),
    send: (input) => invoke(channels.control.send, input),
    confirm: (input) => invoke(channels.control.confirm, input),
    reject: (input) => invoke(channels.control.reject, input),
    cancel: (conversationId) =>
      invoke(channels.control.cancel, { conversationId }),
    getActivity: () => invoke(channels.control.getActivity),
  },
  experienceCatalog: {
    listTemplates: () => invoke("experience-catalog:templates:list"),
    getConfigurationOptions: (input: {
      templateId: string;
      templateVersion?: number;
    }) => invoke("experience-catalog:configuration-options", input),
    validateDraft: (input: unknown) =>
      invoke("experience-catalog:validate-draft", input),
  },
  instrumentSets: {
    list: () => invoke("instrument-sets:list"),
    get: (input: { setId: string }) => invoke("instrument-sets:get", input),
    createRevision: (input: unknown) =>
      invoke("instrument-sets:create-revision", input),
  },
  sourceDefinitions: {
    list: () => invoke(channels.sourceDefinitions.list),
    get: (input: { id: string }) =>
      invoke(channels.sourceDefinitions.get, input),
    setEnabled: (input: { id: string; enabled: boolean }) =>
      invoke(channels.sourceDefinitions.setEnabled, input),
  },
  sessionInputs: {
    get: (input: { sessionId: string }) => invoke("session-inputs:get", input),
    replace: (input: unknown) => invoke("session-inputs:replace", input),
  },
  sessionActivity: {
    list: () => invoke(channels.sessionActivity.list),
    get: (input: { sessionId: string }) =>
      invoke(channels.sessionActivity.get, input),
    listTransitions: (input: { sessionId: string }) =>
      invoke(channels.sessionActivity.listTransitions, input),
    monitoringHealth: () => invoke(channels.sessionActivity.monitoringHealth),
    analytics: (input: { sessionId: string }) =>
      invoke(channels.sessionActivity.analytics, input),
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
  ops: {
    getBackupStatus: () => invoke(channels.ops.getBackupStatus),
    runBackupNow: () => invoke(channels.ops.runBackupNow),
    getNotificationRouting: () => invoke(channels.ops.getNotificationRouting),
    updateNotificationRouting: (patch: unknown) =>
      invoke(channels.ops.updateNotificationRouting, patch),
    testNotificationSink: (input: { sink: "ntfy" | "telegram" | "smtp" }) =>
      invoke(channels.ops.testNotificationSink, input),
    setTelegramSecret: (input: { botToken: string; chatId: string }) =>
      invoke(channels.ops.setTelegramSecret, input),
    clearTelegramSecret: () => invoke(channels.ops.clearTelegramSecret),
    listAlarms: () => invoke(channels.ops.listAlarms),
    triggerTestAlarm: (input: { kind: string; sessionId?: string | null }) =>
      invoke(channels.ops.triggerTestAlarm, input),
  },
  palette: {
    query: (input: { q: string; limit?: number }) =>
      invoke(channels.palette.query, input),
  },
  backtest: {
    listStrategies: () => invoke(channels.backtest.listStrategies),
    list: (input?: { experienceId?: string; limit?: number }) =>
      invoke(channels.backtest.list, input ?? {}),
    get: (input: { id: string }) => invoke(channels.backtest.get, input),
    run: (input: unknown) => invoke(channels.backtest.run, input),
    compare: (input: { runIds: string[] }) =>
      invoke(channels.backtest.compare, input),
    sweep: (input: unknown) => invoke(channels.backtest.sweep, input),
  },
  dataDoctor: {
    coverage: () => invoke(channels.dataDoctor.coverage),
    gaps: (input: { symbol: string; timeframe: string }) =>
      invoke(channels.dataDoctor.gaps, input),
    backfill: (input: unknown) => invoke(channels.dataDoctor.backfill, input),
    providerHealth: () => invoke(channels.dataDoctor.providerHealth),
    setProviderEnabled: (input: { provider: string; enabled: boolean }) =>
      invoke(channels.dataDoctor.setProviderEnabled, input),
    runNightlyGapCheck: () => invoke(channels.dataDoctor.runNightlyGapCheck),
  },
  briefing: {
    latest: () => invoke(channels.briefing.latest),
    list: (input?: { limit?: number }) =>
      invoke(channels.briefing.list, input ?? {}),
    get: (input: { date: string }) => invoke(channels.briefing.get, input),
    assemble: (input?: { date?: string }) =>
      invoke(channels.briefing.assemble, input ?? {}),
  },
  equity: {
    curve: (input?: { range?: "1W" | "1M" | "3M" | "all" }) =>
      invoke(channels.equity.curve, input ?? {}),
    attribution: (input?: { range?: "1W" | "1M" | "3M" | "all" }) =>
      invoke(channels.equity.attribution, input ?? {}),
    snapshotNow: () => invoke(channels.equity.snapshotNow),
  },
  whatIf: {
    run: (input: {
      tradeId: string;
      params?: Record<string, unknown>;
      save?: boolean;
      experienceId?: string;
    }) => invoke(channels.whatIf.run, input),
  },
  killSwitch: {
    pauseAll: () => invoke(channels.killSwitch.pauseAll),
    killSession: (input: { sessionId: string }) =>
      invoke(channels.killSwitch.killSession, input),
    gauges: () => invoke(channels.killSwitch.gauges),
    flattenAll: (input: { confirmation: string }) =>
      invoke(channels.killSwitch.flattenAll, input),
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
