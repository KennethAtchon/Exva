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
    resume: "session:resume",
    stop: "session:stop",
    getStatus: "session:get-status",
    list: "session:list",
    create: "session:create",
    update: "session:update",
    focus: "session:focus",
    goGlobal: "session:go-global",
    archive: "session:archive",
    duplicate: "session:duplicate",
  },
  workspace: {
    viewGet: "workspace:view:get",
    prefsPatch: "workspace:prefs:patch",
  },
  templates: {
    list: "template:list",
    create: "template:create",
    delete: "template:delete",
    use: "template:use",
    buildPayloadFromSession: "template:build-payload-from-session",
  },
  strategy: {
    get: "strategy:get",
    save: "strategy:save",
    getProviderModels: "strategy:get-provider-models",
    resetPrompt: "strategy:reset-prompt",
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
  "approval_resolved",
  "session_started",
  "session_stopped",
  "session_status_changed",
  "trade_status_changed",
  "selector_run_completed",
  "stats_update",
  "notification",
] as const;

export type ExvaEventName = (typeof mainToRendererEvents)[number];
