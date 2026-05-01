import type { AppErrorCode } from "@electron/shared/errors";
import type { InstrumentClass, SessionRuntimeStatus, WorkspaceSession } from "@/lib/types";
import type { AgentRunsRepo } from "../../db/repositories/agent-runs-repo";
import type { BrokerAccountsRepo } from "../../db/repositories/broker-accounts-repo";
import type { BrokerRoutingRepo } from "../../db/repositories/broker-routing-repo";
import type { CapitalReservationsRepo } from "../../db/repositories/capital-reservations-repo";
import type { EventsRepo } from "../../db/repositories/events-repo";
import type { ProviderAccountsRepo } from "../../db/repositories/provider-accounts-repo";
import type { SessionAiRolesRepo } from "../../db/repositories/session-ai-roles-repo";
import type { SessionBrokerAssignmentsRepo } from "../../db/repositories/session-broker-assignments-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { SessionSelectorSettingsRepo } from "../../db/repositories/session-selector-settings-repo";
import type { StatsRepo } from "../../db/repositories/stats-repo";
import type { TradeApprovalsRepo } from "../../db/repositories/trade-approvals-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { WorkspacePreferencesRepo } from "../../db/repositories/workspace-prefs-repo";
import type { AiSdkService } from "../ai/ai-sdk-service";
import type { BrokerService } from "../broker/broker-service";
import type { EventBus } from "../infra/event-bus";
import type { Logger } from "../infra/log";
import type { RiskEngine } from "../orchestration/risk-engine";

export interface SessionOrchestrator {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
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
  tradesRepo: TradesRepo;
  tradeApprovalsRepo: TradeApprovalsRepo;
  agentRunsRepo: AgentRunsRepo;
  eventsRepo: EventsRepo;
  statsRepo: StatsRepo;
  sessionAiRolesRepo: SessionAiRolesRepo;
  sessionSelectorSettingsRepo: SessionSelectorSettingsRepo;
  providerAccountsRepo: ProviderAccountsRepo;
  workspacePreferencesRepo: WorkspacePreferencesRepo;
  capitalReservationsRepo: CapitalReservationsRepo;
  brokerRoutingRepo: BrokerRoutingRepo;
  sessionBrokerAssignmentsRepo: SessionBrokerAssignmentsRepo;
  brokerAccountsRepo: BrokerAccountsRepo;
  ai: AiSdkService;
  broker: BrokerService;
  riskEngine: RiskEngine;
  bus: EventBus;
  logger: Logger;
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
  | { ok: false; check: string; code: AppErrorCode; message: string; details?: Record<string, unknown> };

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
  createOrchestrator(sessionId: string, deps: OrchestratorDeps): SessionOrchestrator;
  createTradeMonitor(sessionId: string): RuntimeTradeMonitor;
}

export interface SessionLifecycleDeps {
  sessionRepo: SessionRepo;
  eventsRepo: EventsRepo;
  runtimeManager: {
    startSession(sessionId: string): Promise<SessionRuntime>;
    pauseSession(sessionId: string): Promise<void>;
    resumeSession(sessionId: string): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    get(sessionId: string): SessionRuntime | null;
  };
  preflight: (session: WorkspaceSession, deps: OrchestratorDeps) => Promise<PreflightResult>;
  orchestratorDeps: OrchestratorDeps;
}
