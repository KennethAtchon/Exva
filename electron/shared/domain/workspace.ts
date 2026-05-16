import type {
  AgentRole,
  BrokerMode,
  CapitalAllocationMode,
  ExecutionMode,
  InstrumentClass,
  ProviderType,
  SearchProviderType,
  SelectionMode,
  SessionStatus,
} from "./enums";
import type { SessionAiRole, SessionStrategy, SessionStrategyContext } from "./session";

export interface WorkspaceSession {
  id: string;
  name: string;
  objective: string;
  status: SessionStatus;
  isFocused: boolean;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  capitalLimitUsd: number;
  executionMode: ExecutionMode;
  startedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderAccount {
  id: string;
  name: string;
  category: "ai" | "search";
  providerType: ProviderType | SearchProviderType;
  secretRef: string;
  metadataJson: string | null;
  isConfigured: boolean;
  lastTestStatus: "unknown" | "ok" | "error";
  updatedAt: string;
}

export interface BrokerAccount {
  id: string;
  name: string;
  brokerType: string;
  supportedInstrumentClasses: InstrumentClass[];
  mode: BrokerMode;
  secretRef: string;
  updatedAt: string;
}

export interface BrokerRoutingDefault {
  instrumentClass: InstrumentClass;
  defaultBrokerAccountId: string;
}

export interface SessionBrokerRoutingOverride {
  sessionId: string;
  instrumentClass: InstrumentClass;
  brokerAccountId: string;
}

export interface WorkspacePreferences {
  id: 1;
  globalIncludeArchived: boolean;
  defaultSearchProviderId: string | null;
  capitalAllocationMode: CapitalAllocationMode;
  globalCapitalPoolUsd: number | null;
  defaultModelProviderKey: string;
  defaultModelModelId: string;
  updatedAt: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  description: string | null;
  sourceSessionId: string | null;
  templatePayloadJson: string;
  instrumentClasses: InstrumentClass[];
  updatedAt: string;
}

export interface SessionTemplatePayload {
  version: 1;
  identity: {
    objective: string;
    selectionMode: SelectionMode;
    instrumentClasses: InstrumentClass[];
    instrumentScope: string;
    executionMode: ExecutionMode;
    capitalLimitUsd: number;
    defaultSearchProviderId: string | null;
  };
  selectorSettings: {
    aiPickerEnabled: boolean;
  };
  strategyContext?: SessionStrategyContext;
  strategy: Omit<SessionStrategy, "sessionId">;
  aiRoles: Array<Omit<SessionAiRole, "sessionId">>;
  brokerAssignments: Array<{ brokerAccountId: string }>;
  brokerOverridesByInstrumentClass: Partial<Record<InstrumentClass, string>>;
}

export interface DashboardStats {
  session_status: SessionStatus;
  daily_pnl_usd: number;
  daily_pnl_pct: number;
  total_trades_today: number;
  closed_trades_today: number;
  win_rate_today: number;
  open_trades: number;
  daily_api_spend: number;
  api_budget: number;
  portfolio_value: number;
  /** Whether `portfolio_value` came from a live broker balance call or fell back to the session capital limit. */
  portfolio_value_source: "broker" | "session_capital_limit";
  portfolio_broker_count: number;
  unrealized_pnl: number;
  session_uptime_min: number;
}

export interface CostBreakdown {
  total: number;
  by_agent: Array<{ name: AgentRole; tokens: number; cost: number }>;
  by_trade: Array<{ instrumentSymbol: string; cost: number }>;
  cache_savings_usd: number;
  daily_history: Array<{ date: string; cost: number }>;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  account_balance?: number;
}

export interface BrokerCredentials {
  provider: "alpaca";
  api_key: string;
  secret_key: string;
  mode: BrokerMode;
}
