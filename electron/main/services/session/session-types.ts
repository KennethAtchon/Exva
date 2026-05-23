import type { AppErrorCode } from "@electron/shared/infra/errors";
import type {
  InstrumentClass,
  SessionRuntimeStatus,
  WorkspaceSession,
} from "@/lib/types";
import type { AgentRunsRepo } from "../../db/repositories/agents/agent-runs-repo";
import type { AgentMessagesRepo } from "../../db/repositories/agents/agent-messages-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/brokers/broker-accounts-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/brokers/broker-routing-repo";
import type { CapitalReservationsRepo } from "../../db/repositories/trades/capital-reservations-repo";
import type { EventsRepo } from "../../db/repositories/system/events-repo";
import type { ProviderAccountsRepo } from "../../db/repositories/workspace/provider-accounts-repo";
import type { SessionAiPhasesRepo } from "../../db/repositories/sessions/session-ai-phases-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import type { SessionRepo } from "../../db/repositories/sessions/session-repo";
import type { SessionStrategiesRepo } from "../../db/repositories/sessions/session-strategies-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/sessions/session-selector-settings-repo";
import type { SessionExecutionStepsRepo } from "../../db/repositories/sessions/session-execution-steps-repo";
import type { StatsRepo } from "../../db/repositories/system/stats-repo";
import type { TradeApprovalsRepo } from "../../db/repositories/trades/trade-approvals-repo";
import type { TradesRepo } from "../../db/repositories/trades/trades-repo";
import type { InstrumentCacheRepo } from "../../db/repositories/market/instrument-cache-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace/workspace-prefs-repo";
import type { LLMRuntime } from "../llm/index";
import type { ExecutionStage } from "@/lib/types";
import type { BrokerRegistry } from "../broker/broker-registry";
import type { InstrumentNormalizer } from "../broker/instrument-normalizer";
import type { BrokerRoutingService } from "../broker/broker-routing-service";
import type { BrokerBalanceCacheService } from "../broker/broker-balance-cache-service";
import type { BrokerCapitalService } from "../broker/broker-capital-service";
import type { EventBus } from "../infra/event-bus";
import type { BrokerAllocationGate } from "../risk/broker-allocation-gate";
import type { CapitalReservationService } from "../risk/capital-reservation-service";
import type { Logger } from "../infra/log";
import type { RiskEngine } from "../risk/risk-engine";
import type { SessionStrategyContextService } from "./session-strategy-context-service";

export interface SessionOrchestrator {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  restartFromAttention(): Promise<void>;
  stop(): Promise<void>;
  pauseAfterCurrentStep(): void;
  retryStep(
    cycleId: string,
    stage: ExecutionStage,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  runApprovalRecheck(input: ApprovalRecheckInput): Promise<void>;
  /** Returns true when a live wait callback was invoked. */
  resolveApproval(tradeId: string, approved: boolean): boolean;
  hasApprovalCallback(tradeId: string): boolean;
}

export interface RuntimeTradeMonitor {
  start(): void;
  stop(): void;
}

export interface OrchestratorDeps {
  sessionRepo: SessionRepo;
  sessionStrategiesRepo: SessionStrategiesRepo;
  strategyContextService: SessionStrategyContextService;
  tradesRepo: TradesRepo;
  tradeApprovalsRepo: TradeApprovalsRepo;
  agentRunsRepo: AgentRunsRepo;
  agentMessagesRepo: AgentMessagesRepo;
  eventsRepo: EventsRepo;
  statsRepo: StatsRepo;
  sessionAiPhasesRepo: SessionAiPhasesRepo;
  sessionSelectorSettingsRepo: SessionSelectorSettingsRepo;
  sessionExecutionStepsRepo: SessionExecutionStepsRepo;
  providerAccountsRepo: ProviderAccountsRepo;
  workspacePreferencesRepo: WorkspacePreferencesRepo;
  capitalReservationsRepo: CapitalReservationsRepo;
  /** Shared-pool reservation lifecycle (Phase 8). */
  capitalReservation: CapitalReservationService;
  brokerRoutingRepo: BrokerRoutingRepo;
  sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo;
  brokerAccountsRepo: BrokerAccountsRepo;
  brokerRegistry: BrokerRegistry;
  brokerRouting: BrokerRoutingService;
  brokerBalanceCache: BrokerBalanceCacheService;
  brokerCapital: BrokerCapitalService;
  brokerAllocationGate: BrokerAllocationGate;
  instrumentNormalizer: InstrumentNormalizer;
  ai: LLMRuntime;
  riskEngine: RiskEngine;
  bus: EventBus;
  logger: Logger;
  instrumentCacheRepo: InstrumentCacheRepo;
}

/** Per-check failure (preflight runner adds `check` name). */
export type PreflightStepFailure = {
  ok: false;
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type PreflightResult =
  | { ok: true }
  | {
      ok: false;
      check: string;
      code: AppErrorCode;
      message: string;
      details?: Record<string, unknown>;
    };

export interface SessionRuntime {
  sessionId: string;
  status: SessionRuntimeStatus;
  orchestrator: SessionOrchestrator;
  tradeMonitor: RuntimeTradeMonitor;
  startedAt: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface ApprovalRecheckInput {
  sessionId: string;
  instrumentSymbol: string;
  instrumentClass: InstrumentClass;
  approvalId: string;
}

export interface SessionRuntimeManagerDeps extends OrchestratorDeps {
  createOrchestrator(
    sessionId: string,
    deps: OrchestratorDeps,
  ): SessionOrchestrator;
  createTradeMonitor(sessionId: string): RuntimeTradeMonitor;
}

export interface SessionLifecycleDeps {
  sessionRepo: SessionRepo;
  eventsRepo: EventsRepo;
  sessionBrokerAssignmentsRepo?: SessionBrokerAssignmentsRepo;
  brokerRegistry?: BrokerRegistry;
  brokerBalanceCache?: {
    getBalance(brokerAccountId: string): Promise<number>;
  };
  runtimeManager: {
    startSession(sessionId: string): Promise<SessionRuntime>;
    pauseSession(sessionId: string): Promise<void>;
    resumeSession(sessionId: string): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    get(sessionId: string): SessionRuntime | null;
  };
  preflight: (
    session: WorkspaceSession,
    deps: OrchestratorDeps,
  ) => Promise<PreflightResult>;
  orchestratorDeps: OrchestratorDeps;
  liveReadiness: {
    check(
      sessionId: string,
    ): Promise<{
      readyToStart: boolean;
      checks: { name: string; passed: boolean }[];
    }>;
  };
}
