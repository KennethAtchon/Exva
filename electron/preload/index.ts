import { contextBridge, ipcRenderer } from "electron";
import { channels, mainToRendererEvents, type ExvaEventName } from "@electron/shared/channels";
import {
  apiKeySchema,
  approveTradeSchema,
  brokerCredentialsSchema,
  eventFiltersSchema,
  sessionConfigSchema,
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
    listActive: () => invoke(channels.trades.listActive),
    getDetail: (tradeId) => invoke(channels.trades.getDetail, tradeIdSchema.parse({ tradeId })),
    forceClose: (tradeId) => invoke(channels.trades.forceClose, tradeIdSchema.parse({ tradeId })),
    approve: (tradeId, approved) =>
      invoke(channels.trades.approve, approveTradeSchema.parse({ tradeId, approved })),
  },
  session: {
    start: () => invoke(channels.session.start),
    pause: () => invoke(channels.session.pause),
    resume: () => invoke(channels.session.resume),
    stop: () => invoke(channels.session.stop),
    getStatus: () => invoke(channels.session.getStatus),
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
  },
  events: {
    list: (filters) => invoke(channels.events.list, eventFiltersSchema.parse(filters)),
    getAgentTraces: (tradeId) => invoke(channels.events.getAgentTraces, tradeIdSchema.parse({ tradeId })),
    subscribe: <K extends ExvaEventName>(name: K, handler: (payload: ExvaEventMap[K]) => void) => {
      if (!eventAllowlist.has(name)) return () => {};
      const listener = (_event: Electron.IpcRendererEvent, payload: ExvaEventMap[K]) => handler(payload);
      ipcRenderer.on(name, listener);
      return () => ipcRenderer.off(name, listener);
    },
  },
};

contextBridge.exposeInMainWorld("exva", exva);
