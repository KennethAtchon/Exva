export const channels = {
  dashboard: {
    getStats: "dashboard:get-stats",
    getCostBreakdown: "dashboard:get-cost-breakdown",
  },
  trades: {
    listActive: "trades:list-active",
    getDetail: "trades:get-detail",
    forceClose: "trades:force-close",
    approve: "trades:approve",
  },
  session: {
    start: "session:start",
    pause: "session:pause",
    stop: "session:stop",
    getStatus: "session:get-status",
  },
  config: {
    getStrategy: "config:get-strategy",
    saveStrategy: "config:save-strategy",
  },
  accounts: {
    saveBroker: "accounts:save-broker",
    testBroker: "accounts:test-broker",
    removeBroker: "accounts:remove-broker",
    saveApiKey: "accounts:save-api-key",
  },
  events: {
    list: "events:list",
    getAgentTraces: "events:get-agent-traces",
  },
} as const;

export const mainToRendererEvents = [
  "trade_opened",
  "trade_closed",
  "agent_event",
  "approval_required",
  "session_started",
  "session_stopped",
  "stats_update",
  "notification",
] as const;

export type ExvaEventName = (typeof mainToRendererEvents)[number];
