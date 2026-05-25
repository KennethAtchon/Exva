import type { ExecutionStage } from "@/lib/types";
import { AgentOrchestrator } from "../orchestration/cycle/agent-orchestrator";
import { TradeMonitor } from "../orchestration/lifecycle/trade-monitor";
import type {
  ApprovalRecheckInput,
  OrchestratorDeps,
  RuntimeTradeMonitor,
  SessionOrchestrator,
} from "./session-types";
import { SessionRuntime } from "./session-runtime";
import type { RuntimeInitialStatus } from "./runtime-worker-protocol";

export function buildInProcessSessionRuntime(
  sessionId: string,
  deps: OrchestratorDeps,
  createOrchestrator: (
    sessionId: string,
    orchestratorDeps: OrchestratorDeps,
  ) => SessionOrchestrator,
  createTradeMonitor: (sessionId: string) => RuntimeTradeMonitor,
): SessionRuntime {
  const orchestratorDeps = deps;
  return new SessionRuntime(
    sessionId,
    createOrchestrator(sessionId, orchestratorDeps),
    createTradeMonitor(sessionId),
  );
}

export function buildWorkerSessionRuntime(
  sessionId: string,
  deps: OrchestratorDeps,
  uptimeMin: () => number,
): SessionRuntime {
  const orchestrator = new AgentOrchestrator(sessionId, deps);
  const tradeMonitor = new TradeMonitor(
    sessionId,
    deps.tradesRepo,
    deps.statsRepo,
    deps.sessionRepo,
    deps.brokerRegistry,
    deps.strategyContextService,
    deps.capitalReservation,
    () => 0,
    deps.bus,
    () => deps.strategyContextService.get(sessionId).riskConfig.maxAiSpendUsd,
    uptimeMin,
    deps.instrumentNormalizer,
  );
  return new SessionRuntime(sessionId, orchestrator, tradeMonitor);
}

export type { RuntimeInitialStatus, ApprovalRecheckInput, ExecutionStage };
