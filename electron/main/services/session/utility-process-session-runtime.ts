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

type PendingCommand = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

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
    }
  >();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
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
  ) {
    this.onDispose = onDispose;
    this.startedAtValue = startedAt;
    this.orchestrator = new RemoteOrchestrator((command) =>
      this.sendCommand(command),
    );
    this.startHeartbeat();
  }

  static async connect(input: {
    sessionId: string;
    child: UtilityProcess;
    bridge: MainRuntimeRpcBridge;
    logger: Logger;
    onDispose?: () => void;
  }): Promise<UtilityProcessSessionRuntime> {
    const runtime = new UtilityProcessSessionRuntime(
      input.sessionId,
      input.child,
      input.bridge,
      input.logger,
      new Date().toISOString(),
      input.onDispose,
    );
    await runtime.waitForReady();
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
    void this.bridge.handle(message);
    switch (message.type) {
      case "ready":
        this.startedAtValue = message.startedAt;
        return;
      case "command_ack":
        this.pendingCommands.get(message.requestId)?.resolve();
        this.pendingCommands.delete(message.requestId);
        return;
      case "command_error":
        this.pendingCommands
          .get(message.requestId)
          ?.reject(new Error(message.error.message));
        this.pendingCommands.delete(message.requestId);
        this.pendingOrchestrator
          .get(message.requestId)
          ?.reject(new Error(message.error.message));
        this.pendingOrchestrator.delete(message.requestId);
        return;
      case "orchestrator_result":
        this.pendingOrchestrator
          .get(message.requestId)
          ?.resolve(message.result);
        this.pendingOrchestrator.delete(message.requestId);
        return;
      case "pong":
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
          } satisfies RuntimeHostMessage);
          resolve();
        }
      };
      this.child.on("message", onMessage);
    });
  }

  private sendCommand(command: RuntimeWorkerCommand): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (command.type === "orchestrator") {
        this.pendingOrchestrator.set(requestId, { resolve, reject });
      } else {
        this.pendingCommands.set(requestId, {
          resolve: () => resolve(undefined),
          reject,
        });
      }
      this.child.postMessage({
        ...command,
        requestId,
      } satisfies RuntimeWorkerCommandEnvelope);
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.sendCommand({ type: "ping" }).catch((error) => {
        this.logger.warn(
          { sessionId: this.sessionId, err: error },
          "utility process heartbeat failed",
        );
      });
    }, 15_000);
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
      pending.reject(new Error("Utility process runtime disposed"));
    }
    this.pendingCommands.clear();
    for (const pending of this.pendingOrchestrator.values()) {
      pending.reject(new Error("Utility process runtime disposed"));
    }
    this.pendingOrchestrator.clear();
  }
}
