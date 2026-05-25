import type { MessageEvent } from "electron";
import { buildWorkerSessionRuntime } from "../services/session/session-runtime-factory";
import { createWorkerOrchestratorDeps } from "../services/session/runtime-worker-deps";
import { WorkerRuntimeRpcClient } from "../services/session/runtime-rpc-bridge";
import type { SessionRuntime } from "../services/session/session-runtime";
import type {
  RuntimeHostInitMessage,
  RuntimeWorkerCommandEnvelope,
  RuntimeWorkerMessage,
} from "../services/session/runtime-worker-protocol";

let runtime: SessionRuntime | null = null;
let sessionId = "";
let rpcClient: WorkerRuntimeRpcClient | null = null;
let startedAtMs = Date.now();

function post(message: RuntimeWorkerMessage): void {
  process.parentPort?.postMessage(message);
}

function uptimeMin(): number {
  return Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
}

async function handleCommand(
  envelope: RuntimeWorkerCommandEnvelope,
): Promise<void> {
  if (!runtime) {
    post({
      type: "command_error",
      requestId: envelope.requestId,
      error: {
        code: "INTERNAL_ERROR",
        message: "Worker runtime is not initialized",
      },
    });
    return;
  }

  try {
    switch (envelope.type) {
      case "initialize":
        await runtime.initialize(envelope.initialStatus);
        startedAtMs = Date.now();
        post({
          type: "ready",
          startedAt: new Date(startedAtMs).toISOString(),
        });
        break;
      case "pause":
        await runtime.pause();
        break;
      case "resume":
        await runtime.resume();
        break;
      case "drainStop":
        await runtime.drainStop();
        break;
      case "stop":
        await runtime.stop();
        post({ type: "stopped" });
        break;
      case "shutdown":
        await runtime.stop();
        post({ type: "stopped" });
        break;
      case "ping":
        post({ type: "pong", at: new Date().toISOString() });
        break;
      case "orchestrator": {
        const orchestrator = runtime.orchestrator;
        let result: unknown;
        switch (envelope.method) {
          case "restartFromAttention":
            await orchestrator.restartFromAttention();
            result = undefined;
            break;
          case "pauseAfterCurrentStep":
            orchestrator.pauseAfterCurrentStep();
            result = undefined;
            break;
          case "retryStep":
            result = await orchestrator.retryStep(
              envelope.args[0] as string,
              envelope.args[1] as import("@/lib/types").ExecutionStage,
            );
            break;
          case "runApprovalRecheck":
            await orchestrator.runApprovalRecheck(
              envelope.args[0] as import("../services/session/session-types").ApprovalRecheckInput,
            );
            result = undefined;
            break;
          case "resolveApproval":
            result = orchestrator.resolveApproval(
              envelope.args[0] as string,
              envelope.args[1] as boolean,
            );
            break;
          case "hasApprovalCallback":
            result = orchestrator.hasApprovalCallback(envelope.args[0] as string);
            break;
          default:
            throw new Error(`Unknown orchestrator method: ${envelope.method}`);
        }
        post({
          type: "orchestrator_result",
          requestId: envelope.requestId,
          result,
        });
        return;
      }
      default:
        throw new Error("Unknown worker command");
    }
    post({ type: "command_ack", requestId: envelope.requestId });
  } catch (error) {
    post({
      type: "command_error",
      requestId: envelope.requestId,
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

process.parentPort?.on("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;

  if (rpcClient && "type" in message && message.type === "rpc_response") {
    rpcClient.handle(message as RuntimeWorkerMessage);
    return;
  }

  if ("type" in message && message.type === "host_init") {
    const init = message as RuntimeHostInitMessage;
    sessionId = init.sessionId;
    rpcClient = new WorkerRuntimeRpcClient(post);
    const deps = createWorkerOrchestratorDeps(sessionId, post);
    runtime = buildWorkerSessionRuntime(sessionId, deps, uptimeMin);
    return;
  }

  if ("requestId" in message) {
    void handleCommand(message as RuntimeWorkerCommandEnvelope);
  }
});

post({ type: "worker_ready" });
