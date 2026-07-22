import type { UtilityProcess } from "electron";
import type { ExecutionStage } from "@/lib/types";
import type { Logger } from "../infra/log";
import { MainRuntimeRpcBridge } from "./runtime-rpc-bridge";
import type {
  RuntimeHostMessage,
  RuntimeInitialStatus,
  RuntimeWorkerCommand,
  RuntimeWorkerCommandEnvelope,
  RuntimeWorkerMessage,
} from "./runtime-worker-protocol";
import type {
  ApprovalRecheckInput,
  ManagedSessionRuntime,
  SessionOrchestrator,
} from "./session-types";
import {
  currentTraceCarrier,
  getBootId,
  runWithChildSpan,
  runWithRootSpan,
} from "../infra/telemetry-context";
import type { RuntimeDiagnosticKind } from "../infra/runtime-diagnostics";

type PendingCommand = {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RecordUtilityDiagnostic = (input: {
  kind: Extract<RuntimeDiagnosticKind, "utility_error" | "utility_exit">;
  detail: Record<string, unknown>;
  severity?: "WARN" | "ERROR" | "CRITICAL";
}) => void;

const COMMAND_TIMEOUT_MS = 30_000;
const LONG_COMMAND_TIMEOUT_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_HEARTBEATS = 3;

export class RemoteOrchestrator implements SessionOrchestrator {
  constructor(
    private readonly send: (command: RuntimeWorkerCommand) => Promise<unknown>,
  ) {}

  async start(): Promise<void> {
    throw new Error(
      "Remote orchestrator start is handled by runtime.initialize()",
    );
  }

  async pause(): Promise<void> {
    throw new Error("Remote orchestrator pause is handled by runtime.pause()");
  }

  async resume(): Promise<void> {
    throw new Error(
      "Remote orchestrator resume is handled by runtime.resume()",
    );
  }

  async stop(): Promise<void> {
    throw new Error("Remote orchestrator stop is handled by runtime.stop()");
  }

  async restartFromAttention(): Promise<void> {
    await this.send({
      type: "orchestrator",
      method: "restartFromAttention",
      args: [],
    });
  }

  pauseAfterCurrentStep(): void {
    void this.send({
      type: "orchestrator",
      method: "pauseAfterCurrentStep",
      args: [],
    });
  }

  async retryStep(
    cycleId: string,
    stage: ExecutionStage,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return (await this.send({
      type: "orchestrator",
      method: "retryStep",
      args: [cycleId, stage],
    })) as { ok: true } | { ok: false; reason: string };
  }

  async runApprovalRecheck(input: ApprovalRecheckInput): Promise<void> {
    await this.send({
      type: "orchestrator",
      method: "runApprovalRecheck",
      args: [input],
    });
  }

  resolveApproval(tradeId: string, approved: boolean): boolean {
    void this.send({
      type: "orchestrator",
      method: "resolveApproval",
      args: [tradeId, approved],
    });
    return true;
  }

  hasApprovalCallback(tradeId: string): boolean {
    void this.send({
      type: "orchestrator",
      method: "hasApprovalCallback",
      args: [tradeId],
    });
    return false;
  }
}

export class UtilityProcessSessionRuntime implements ManagedSessionRuntime {
  readonly orchestrator: SessionOrchestrator;
  readonly tradeMonitor = {
    start: () => undefined,
    stop: () => undefined,
  };
  private startedAtValue: string;
  status: ManagedSessionRuntime["status"] = "starting";

  get startedAt(): string {
    return this.startedAtValue;
  }

  private readonly pendingCommands = new Map<string, PendingCommand>();
  private readonly pendingOrchestrator = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatRequestId: string | null = null;
  private missedHeartbeats = 0;
  private shutDown = false;
  private disposed = false;
  private readonly onDispose?: () => void;

  private constructor(
    readonly sessionId: string,
    private readonly child: UtilityProcess,
    private readonly bridge: MainRuntimeRpcBridge,
    private readonly logger: Logger,
    startedAt: string,
    onDispose?: () => void,
    private readonly recordDiagnostic?: RecordUtilityDiagnostic,
  ) {
    this.onDispose = onDispose;
    this.startedAtValue = startedAt;
    this.orchestrator = new RemoteOrchestrator((command) =>
      this.sendCommand(command),
    );
  }

  static async connect(input: {
    sessionId: string;
    child: UtilityProcess;
    bridge: MainRuntimeRpcBridge;
    logger: Logger;
    onDispose?: () => void;
    recordDiagnostic?: RecordUtilityDiagnostic;
  }): Promise<UtilityProcessSessionRuntime> {
    const runtime = new UtilityProcessSessionRuntime(
      input.sessionId,
      input.child,
      input.bridge,
      input.logger,
      new Date().toISOString(),
      input.onDispose,
      input.recordDiagnostic,
    );
    await runtime.waitForReady();
    runtime.startHeartbeat();
    return runtime;
  }

  uptimeMin(): number {
    const startedAtMs = Date.parse(this.startedAtValue);
    if (Number.isNaN(startedAtMs)) return 0;
    return Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
  }

  async initialize(initialStatus: RuntimeInitialStatus): Promise<void> {
    await this.sendCommand({ type: "initialize", initialStatus });
    this.status =
      initialStatus === "active"
        ? "active"
        : initialStatus === "monitoring_only"
          ? "paused"
          : "paused";
  }

  async pause(): Promise<void> {
    await this.sendCommand({ type: "pause" });
    this.status = "paused";
  }

  async drainStop(): Promise<void> {
    await this.sendCommand({ type: "drainStop" });
    this.status = "paused";
  }

  async resume(): Promise<void> {
    await this.sendCommand({ type: "resume" });
    this.status = "active";
  }

  async stop(): Promise<void> {
    await this.sendCommand({ type: "stop" });
    this.status = "stopping";
  }

  async shutdown(): Promise<void> {
    if (this.shutDown) return;
    this.shutDown = true;
    try {
      await this.sendCommand({ type: "shutdown" });
    } catch {
      this.child.kill();
    } finally {
      this.dispose();
    }
  }

  handleMessage(message: RuntimeWorkerMessage): void {
    if (
      message.type === "rpc_request" ||
      message.type === "event" ||
      message.type === "runtime_status" ||
      message.type === "log"
    ) {
      void this.bridge.handle(message);
    }
    switch (message.type) {
      case "ready":
        this.startedAtValue = message.startedAt;
        return;
      case "command_ack":
        this.resolvePending(this.pendingCommands, message.requestId, undefined);
        return;
      case "command_error":
        this.rejectPending(
          this.pendingCommands,
          message.requestId,
          new Error(message.error.message),
        );
        this.rejectPending(
          this.pendingOrchestrator,
          message.requestId,
          new Error(message.error.message),
        );
        return;
      case "orchestrator_result":
        this.resolvePending(
          this.pendingOrchestrator,
          message.requestId,
          message.result,
        );
        return;
      case "pong":
        if (message.requestId === this.heartbeatRequestId) {
          this.heartbeatRequestId = null;
          this.missedHeartbeats = 0;
        }
        return;
      case "stopped":
        this.dispose();
        return;
      default:
        return;
    }
  }

  handleExit(code: number): void {
    this.logger.warn(
      { sessionId: this.sessionId, exitCode: code },
      "utility process session runtime exited",
    );
    this.recordDiagnostic?.({
      kind: "utility_exit",
      severity: code === 0 ? "WARN" : "ERROR",
      detail: { exitCode: code },
    });
    this.dispose();
  }

  private async waitForReady(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Session runtime worker ready timeout"));
      }, 30_000);
      const onMessage = (message: RuntimeWorkerMessage) => {
        this.handleMessage(message);
        if (message.type === "worker_ready") {
          clearTimeout(timeout);
          this.child.off("message", onMessage);
          this.child.postMessage({
            type: "host_init",
            sessionId: this.sessionId,
            bootId: getBootId(),
          } satisfies RuntimeHostMessage);
          resolve();
        }
      };
      this.child.on("message", onMessage);
    });
  }

  private sendCommand(command: RuntimeWorkerCommand): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const timeoutMs =
      command.type === "orchestrator" && command.method === "runApprovalRecheck"
        ? LONG_COMMAND_TIMEOUT_MS
        : COMMAND_TIMEOUT_MS;
    return runWithChildSpan({ utilityRequestId: requestId }, () => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new Error(`Utility command timed out: ${command.type}`);
          this.rejectPending(this.pendingCommands, requestId, error);
          this.rejectPending(this.pendingOrchestrator, requestId, error);
          this.logger.error(
            {
              eventName: "utility.command.timeout",
              sessionId: this.sessionId,
              utilityRequestId: requestId,
              command: command.type,
              deadlineMs: timeoutMs,
              outcome: "timeout",
            },
            "utility process command timed out",
          );
          this.recordDiagnostic?.({
            kind: "utility_error",
            detail: {
              failure: "command_timeout",
              utilityRequestId: requestId,
              command: command.type,
              deadlineMs: timeoutMs,
            },
          });
          this.child.kill();
          this.dispose();
        }, timeoutMs);
        if (command.type === "orchestrator") {
          this.pendingOrchestrator.set(requestId, { resolve, reject, timer });
        } else {
          this.pendingCommands.set(requestId, {
            resolve: () => resolve(undefined),
            reject,
            timer,
          });
        }
        try {
          this.child.postMessage({
            ...command,
            requestId,
            context: currentTraceCarrier(requestId) ?? undefined,
          } satisfies RuntimeWorkerCommandEnvelope);
        } catch (error) {
          this.rejectPending(this.pendingCommands, requestId, error);
          this.rejectPending(this.pendingOrchestrator, requestId, error);
        }
      });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.heartbeatRequestId) {
        this.missedHeartbeats += 1;
        this.logger.warn(
          {
            eventName: "utility.heartbeat.missed",
            sessionId: this.sessionId,
            missedHeartbeats: this.missedHeartbeats,
          },
          "utility process heartbeat missed",
        );
        if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          this.recordDiagnostic?.({
            kind: "utility_error",
            detail: {
              failure: "heartbeat_timeout",
              utilityRequestId: this.heartbeatRequestId,
              missedHeartbeats: this.missedHeartbeats,
              heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            },
          });
          this.child.kill();
          this.dispose();
        }
        return;
      }
      const requestId = crypto.randomUUID();
      runWithRootSpan({ utilityRequestId: requestId }, () => {
        this.heartbeatRequestId = requestId;
        this.child.postMessage({
          type: "ping",
          requestId,
          context: currentTraceCarrier(requestId) ?? undefined,
        } satisfies RuntimeWorkerCommandEnvelope);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.onDispose?.();
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Utility process runtime disposed"));
    }
    this.pendingCommands.clear();
    for (const pending of this.pendingOrchestrator.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Utility process runtime disposed"));
    }
    this.pendingOrchestrator.clear();
    this.heartbeatRequestId = null;
  }

  private resolvePending<T>(
    pendingMap: Map<
      string,
      {
        resolve: (value: T) => void;
        reject: (error: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >,
    requestId: string,
    value: T,
  ): void {
    const pending = pendingMap.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingMap.delete(requestId);
    pending.resolve(value);
  }

  private rejectPending<T>(
    pendingMap: Map<
      string,
      {
        resolve: (value: T) => void;
        reject: (error: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >,
    requestId: string,
    error: unknown,
  ): void {
    const pending = pendingMap.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingMap.delete(requestId);
    pending.reject(error);
  }
}
