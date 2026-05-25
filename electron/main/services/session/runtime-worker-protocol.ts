import type { ExvaEventName } from "@electron/shared/ipc/channels";
import type { SerializedAppError } from "@electron/shared/infra/errors";

export type RuntimeInitialStatus = "active" | "paused" | "monitoring_only";

export type RuntimeWorkerCommand =
  | { type: "initialize"; initialStatus: RuntimeInitialStatus }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "drainStop" }
  | { type: "stop" }
  | { type: "shutdown" }
  | { type: "ping" }
  | {
      type: "orchestrator";
      method:
        | "restartFromAttention"
        | "pauseAfterCurrentStep"
        | "retryStep"
        | "runApprovalRecheck"
        | "resolveApproval"
        | "hasApprovalCallback";
      args: unknown[];
    };

export type RuntimeWorkerCommandEnvelope = RuntimeWorkerCommand & {
  requestId: string;
};

export type RuntimeWorkerMessage =
  | { type: "worker_ready" }
  | { type: "ready"; startedAt: string }
  | { type: "stopped" }
  | { type: "pong"; at: string }
  | { type: "command_ack"; requestId: string }
  | { type: "command_error"; requestId: string; error: SerializedAppError }
  | {
      type: "orchestrator_result";
      requestId: string;
      result: unknown;
    }
  | { type: "rpc_request"; id: number; path: string; args: unknown[] }
  | {
      type: "rpc_response";
      id: number;
      result?: unknown;
      error?: SerializedAppError;
    }
  | { type: "event"; name: ExvaEventName; payload: unknown }
  | {
      type: "runtime_status";
      sessionId: string;
      status: "active" | "paused" | "stopping" | null;
    }
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      meta?: Record<string, unknown>;
    };

export type RuntimeHostInitMessage = {
  type: "host_init";
  sessionId: string;
};

export type RuntimeHostMessage = RuntimeHostInitMessage | RuntimeWorkerCommand;
