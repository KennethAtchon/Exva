import type { ReasoningLevel } from "@electron/shared/ai/ai-phase";
import type {
  AllocationEnforcement,
  BrokerMode,
  ExecutionMode,
  InstrumentClass,
  ProviderType,
  SearchProviderType,
  SelectionMode,
  SessionStatus,
} from "./enums";
import type { MockExecutionTier, MockScenarioKind } from "./mock-scenario";
import type { SessionStrategyContext } from "./session";

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
  executionMode: ExecutionMode;
  experienceId: string;
  startedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BrokerAssignment {
  brokerAccountId: string;
  allocatedUsd: number;
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
  /** Mock broker only — drives scenario fixtures and adapter behavior. */
  mockScenarioKind: MockScenarioKind | null;
  /** Mock broker only — scripted (canned) vs rehearsal (real LLM). */
  mockExecutionTier: MockExecutionTier | null;
  maxSessions: number;
  allocationEnforcement: AllocationEnforcement;
  balanceRefreshIntervalMin: number;
  balanceCacheUsd: number | null;
  balanceCachedAt: string | null;
  secretRef: string;
  updatedAt: string;
}

export interface BrokerAccountWithState extends BrokerAccount {
  isStale: boolean;
  sessions: Array<{
    sessionId: string;
    sessionName: string;
    status: SessionStatus;
    allocatedUsd: number;
  }>;
  activeSessionCount: number;
  totalAllocatedUsd: number;
  freeCapitalUsd: number | null;
  isOverAllocated: boolean;
  atSessionCap: boolean;
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
  globalEnvironmentMode: "paper" | "live";
  defaultSearchProviderId: string | null;
  allocationEnforcementOverride: AllocationEnforcement | null;
  defaultModelProviderKey: string;
  defaultModelModelId: string;
  defaultModelReasoningLevel: ReasoningLevel;
  autoApproveAssistantTools: boolean;
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
    experienceId: string;
    selectionMode: SelectionMode;
    instrumentClasses: InstrumentClass[];
    instrumentScope: string;
    executionMode: ExecutionMode;
    defaultSearchProviderId: string | null;
  };
  selectorSettings: {
    aiPickerEnabled: boolean;
  };
  strategyContext: SessionStrategyContext;
  brokerAssignments: BrokerAssignment[];
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
  portfolio_value_source: "broker";
  portfolio_broker_count: number;
  unrealized_pnl: number;
  consecutive_losers: number;
  session_uptime_min: number;
}

export interface CostBreakdown {
  total: number;
  by_agent: Array<{ name: string; tokens: number; cost: number }>;
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
