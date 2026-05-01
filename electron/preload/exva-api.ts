import type {
  AgentRole,
  AgentRun,
  BrokerCredentials,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  EventRow,
  SessionConfig,
  SessionStatus,
  Trade,
  TradeDecisionPayload,
  TradeDetail,
} from "@/lib/types";

export type ExvaEventName =
  | "trade_opened"
  | "trade_closed"
  | "agent_event"
  | "approval_required"
  | "session_started"
  | "session_stopped"
  | "stats_update"
  | "notification";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  session_started: {};
  session_stopped: { reason: string };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export interface ExvaApi {
  dashboard: {
    getStats(): Promise<DashboardStats>;
    getCostBreakdown(dateRange?: string): Promise<CostBreakdown>;
  };
  trades: {
    listActive(): Promise<Trade[]>;
    getDetail(tradeId: string): Promise<TradeDetail>;
    forceClose(tradeId: string): Promise<void>;
    approve(tradeId: string, approved: boolean): Promise<void>;
  };
  session: {
    start(): Promise<SessionStatus>;
    pause(): Promise<SessionStatus>;
    resume(): Promise<SessionStatus>;
    stop(): Promise<SessionStatus>;
    getStatus(): Promise<SessionStatus>;
  };
  config: {
    getStrategy(): Promise<SessionConfig>;
    saveStrategy(config: SessionConfig): Promise<void>;
  };
  accounts: {
    saveBroker(credentials: BrokerCredentials): Promise<ConnectionTestResult>;
    testBroker(): Promise<ConnectionTestResult>;
    removeBroker(): Promise<void>;
    saveApiKey(keyType: string, value: string): Promise<void>;
  };
  events: {
    list(filters?: {
      minLevel?: string;
      agentType?: AgentRole;
      search?: string;
      limit?: number;
    }): Promise<EventRow[]>;
    getAgentTraces(tradeId: string): Promise<AgentRun[]>;
    subscribe<K extends ExvaEventName>(name: K, handler: (payload: ExvaEventMap[K]) => void): () => void;
  };
}
