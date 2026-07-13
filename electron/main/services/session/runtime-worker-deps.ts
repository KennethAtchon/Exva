import type { OrchestratorDeps } from "./session-types";
import {
  createDepProxy,
  WorkerForwardingEventBus,
  WorkerLogger,
  WorkerRuntimeRpcClient,
} from "./runtime-rpc-bridge";
import type { RuntimeWorkerMessage } from "./runtime-worker-protocol";

export function createWorkerOrchestratorDeps(
  sessionId: string,
  post: (message: RuntimeWorkerMessage) => void,
): OrchestratorDeps {
  const rpc = new WorkerRuntimeRpcClient(post);
  const bus = new WorkerForwardingEventBus(sessionId, post);
  const logger = new WorkerLogger(sessionId, post);

  return {
    sessionRepo: createDepProxy(rpc, "sessionRepo"),
    strategyContextService: createDepProxy(rpc, "strategyContextService"),
    tradesRepo: createDepProxy(rpc, "tradesRepo"),
    decisionTracesRepo: createDepProxy(rpc, "decisionTracesRepo"),
    tradeApprovalsRepo: createDepProxy(rpc, "tradeApprovalsRepo"),
    agentRunsRepo: createDepProxy(rpc, "agentRunsRepo"),
    agentMessagesRepo: createDepProxy(rpc, "agentMessagesRepo"),
    eventsRepo: createDepProxy(rpc, "eventsRepo"),
    statsRepo: createDepProxy(rpc, "statsRepo"),
    sessionExecutionStepsRepo: createDepProxy(rpc, "sessionExecutionStepsRepo"),
    providerAccountsRepo: createDepProxy(rpc, "providerAccountsRepo"),
    workspacePreferencesRepo: createDepProxy(rpc, "workspacePreferencesRepo"),
    capitalReservationsRepo: createDepProxy(rpc, "capitalReservationsRepo"),
    capitalReservation: createDepProxy(rpc, "capitalReservation"),
    brokerRoutingRepo: createDepProxy(rpc, "brokerRoutingRepo"),
    sessionBrokerAssignmentsRepo: createDepProxy(
      rpc,
      "sessionBrokerAssignmentsRepo",
    ),
    brokerAccountsRepo: createDepProxy(rpc, "brokerAccountsRepo"),
    brokerRegistry: createDepProxy(rpc, "brokerRegistry"),
    brokerRouting: createDepProxy(rpc, "brokerRouting"),
    brokerBalanceCache: createDepProxy(rpc, "brokerBalanceCache"),
    brokerCapital: createDepProxy(rpc, "brokerCapital"),
    brokerAllocationGate: createDepProxy(rpc, "brokerAllocationGate"),
    instrumentNormalizer: createDepProxy(rpc, "instrumentNormalizer"),
    instrumentCacheRepo: createDepProxy(rpc, "instrumentCacheRepo"),
    signalSourcesRepo: createDepProxy(rpc, "signalSourcesRepo"),
    signalObservationsRepo: createDepProxy(rpc, "signalObservationsRepo"),
    ai: createDepProxy(rpc, "ai"),
    riskEngine: createDepProxy(rpc, "riskEngine"),
    bus: bus as unknown as OrchestratorDeps["bus"],
    logger: logger as unknown as OrchestratorDeps["logger"],
  };
}
