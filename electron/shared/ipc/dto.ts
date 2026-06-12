import type {
  DashboardStats,
  EventRow,
  ExecutionMode,
  ExecutionStage,
  ExecutionStepStatus,
  InstrumentClass,
  ProviderAccount,
  SelectionMode,
  SessionResearchPosture,
  SessionAiSettings,
  SessionRiskConfig,
  SessionSelectorSettings,
  SessionStatus,
  SessionTimeframeConfig,
  SessionTradeRules,
  Trade,
  TradeDecisionPayload,
  WorkspacePreferences,
  WorkspaceViewMode,
} from "@/lib/types";
import type { PhaseRuntimeSummary } from "@electron/shared/ai/ai-phase";
import type { AndonCordPayload } from "@electron/shared/domain/autopsy";

export interface SessionSummary {
  id: string;
  name: string;
  objective: string;
  status: SessionStatus;
  isFocused: boolean;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId: string | null;
  totalAllocatedUsd: number;
  executionMode: ExecutionMode;
  brokerCount: number;
  openTradeCount: number;
  uptimeMin: number;
  updatedAt: string;
}

export interface WorkspaceViewResponse {
  workspaceViewMode: WorkspaceViewMode;
  focusedSessionId: string | null;
  preferences: WorkspacePreferences;
}

export interface ExperienceSummary {
  id: string;
  displayName: string;
  signalSourceType: string;
  pipelineId: string;
  presets: {
    posturePresetId: string;
    rulesPresetId: string;
    riskPresetId: string;
    timeframePresetId: string;
  };
}

export interface SessionCreateInput {
  name: string;
  objective: string;
  experienceId?: string;
  selectionMode: SelectionMode;
  instrumentClasses: InstrumentClass[];
  instrumentScope: string;
  defaultSearchProviderId?: string | null;
  selectorSettings: {
    aiPickerEnabled: boolean;
  };
  executionMode: ExecutionMode;
  brokerAssignments: Array<{ brokerAccountId: string; allocatedUsd: number }>;
  brokerOverridesByInstrumentClass?: Partial<
    Record<InstrumentClass, string | null>
  >;
  subscribedSourceIds?: string[];
}

export interface StrategyGetResponse {
  researchPosture: SessionResearchPosture;
  rules: SessionTradeRules;
  riskConfig: SessionRiskConfig;
  timeframe: SessionTimeframeConfig;
  aiSettings: SessionAiSettings;
  selectorSettings: SessionSelectorSettings;
  providers: ProviderAccount[];
  sessionStatus: SessionStatus;
  selectionMode: SelectionMode;
  defaultSearchProviderId: string | null;
  workspaceDefaultSearchProviderId: string | null;
  workspaceDefaultModelProviderKey: string;
  workspaceDefaultModelModelId: string;
  aiPhases: PhaseRuntimeSummary[];
}

export interface UserGlobalPresetRow {
  id: string;
  name: string;
  isBuiltIn: boolean;
  createdAt: number;
  presetJson: string;
}

export interface ProviderModelEntry {
  id: string;
  label: string;
  maxContextTokens: number;
}

export interface SessionExecutionProgressResponse {
  steps: Array<{
    stage: ExecutionStage;
    status: ExecutionStepStatus;
    attempt: number;
    nextRetryAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    outcome: string | null;
    retryable: boolean;
  }>;
  cycleId: string | null;
  openTradeCount: number;
  monitoringActive: boolean;
}

export type ExvaEventMap = {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  approval_resolved: {
    approvalId: string;
    tradeId: string;
    status: "approved" | "rejected";
  };
  session_started: Record<string, never>;
  session_stopped: { reason: string };
  session_status_changed: { sessionId: string; status: SessionStatus };
  trade_status_changed: Trade;
  selector_run_completed: { sessionId: string; count: number };
  research_phase_started: { sessionId: string; phase: string; cycleId: string };
  research_phase_step: {
    sessionId: string;
    phase: string;
    message: string;
    cycleId: string;
  };
  research_phase_complete: {
    sessionId: string;
    phase: string;
    cycleId: string;
    instrumentCount: number;
  };
  research_phase_failed: {
    sessionId: string;
    phase: string;
    cycleId: string;
    error: string;
  };
  "step:started": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    attempt: number;
  };
  "step:succeeded": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
  };
  "step:failed": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
    nextRetryAt: string | null;
  };
  "step:retrying": {
    sessionId: string;
    cycleId: string;
    stage: ExecutionStage;
    attempt: number;
    nextRetryAt: string;
  };
  broker_balance_updated: {
    brokerAccountId: string;
    balanceUsd: number;
    cachedAt: string;
  };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
  andon_cord_fired: AndonCordPayload;
  signal_received: {
    signalId: string;
    sourceId: string;
    sourceType: string;
    ticker: string;
    companyName: string | null;
    detectedAt: string;
  };
  signal_delivery_updated: {
    deliveryId: string;
    sessionId: string;
    signalId: string;
    status:
      | "queued"
      | "waiting_for_resume"
      | "processing"
      | "triggered"
      | "traded"
      | "rejected"
      | "dropped"
      | "expired";
    statusBucket: "pending" | "completed" | "dropped";
  };
};

export type ExvaEventName = keyof ExvaEventMap;
