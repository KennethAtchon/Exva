import type { AppErrorCode } from "@electron/shared/errors";
import type { InstrumentClass, SessionRuntimeStatus, WorkspaceSession } from "@/lib/types";
import type { AgentRunsRepo } from "../../db/repositories/agent-runs-repo";
import type { EventsRepo } from "../../db/repositories/events-repo";
import type { SessionRepo } from "../../db/repositories/session-repo";
import type { StatsRepo } from "../../db/repositories/stats-repo";
import type { TradesRepo } from "../../db/repositories/trades-repo";
import type { AiSdkService } from "../ai-sdk-service";
import type { BrokerService } from "../broker-service";
import type { EventBus } from "../event-bus";
import type { Logger } from "../log";
import type { RiskEngine } from "../risk-engine";

export interface SessionOrchestrator {
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  runApprovalRecheck(input: ApprovalRecheckInput): Promise<void>;
  resolveApproval(tradeId: string, approved: boolean): void;
}

export interface RuntimeTradeMonitor {
  start(): void;
  stop(): void;
}

export interface OrchestratorDeps {
  sessionRepo: SessionRepo;
  tradesRepo: TradesRepo;
  agentRunsRepo: AgentRunsRepo;
  eventsRepo: EventsRepo;
  statsRepo: StatsRepo;
  ai: AiSdkService;
  broker: BrokerService;
  riskEngine: RiskEngine;
  bus: EventBus;
  logger: Logger;
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; code: AppErrorCode; message: string; details?: Record<string, unknown> };

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
  };
  preflight: (session: WorkspaceSession, deps: OrchestratorDeps) => Promise<PreflightResult>;
  orchestratorDeps: OrchestratorDeps;
}
