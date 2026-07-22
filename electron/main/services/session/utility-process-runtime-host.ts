import path from "node:path";
import { utilityProcess } from "electron";
import { createOrchestratorDeps } from "./session-runtime-host";
import { MainRuntimeRpcBridge } from "./runtime-rpc-bridge";
import type { EventBus } from "../infra/event-bus";
import type { Logger } from "../infra/log";
import {
  recordRuntimeDiagnostic,
  sanitizeDiagnosticText,
  type RuntimeDiagnosticKind,
} from "../infra/runtime-diagnostics";
import type {
  ManagedSessionRuntime,
  SessionRuntimeManagerDeps,
} from "./session-types";
import { UtilityProcessSessionRuntime } from "./utility-process-session-runtime";

export function resolveSessionWorkerPath(): string {
  return path.join(__dirname, "session-runtime-worker.cjs");
}

export class UtilityProcessSessionRuntimeHost {
  private readonly children = new Map<string, UtilityProcessSessionRuntime>();

  constructor(
    private readonly deps: SessionRuntimeManagerDeps,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  async createRuntime(sessionId: string): Promise<ManagedSessionRuntime> {
    const workerPath = resolveSessionWorkerPath();
    const child = utilityProcess.fork(workerPath, [], {
      serviceName: `exva-session-${sessionId.slice(0, 8)}`,
      stdio: "pipe",
    });

    const orchestratorDeps = createOrchestratorDeps(this.deps);
    const recordDiagnostic = (input: {
      kind: Extract<RuntimeDiagnosticKind, "utility_error" | "utility_exit">;
      detail: Record<string, unknown>;
      severity?: "WARN" | "ERROR" | "CRITICAL";
    }) =>
      recordRuntimeDiagnostic({
        ...input,
        sessionId,
        services: { repos: { events: this.deps.eventsRepo } },
      });
    const bridge = new MainRuntimeRpcBridge(
      sessionId,
      orchestratorDeps,
      this.eventBus,
      (message) => {
        if (!child) return;
        child.postMessage(message);
      },
    );

    child.on("message", (message) => {
      const runtime = this.children.get(sessionId);
      runtime?.handleMessage(message as never);
    });

    child.on("exit", (code) => {
      this.children.get(sessionId)?.handleExit(code);
      this.children.delete(sessionId);
    });

    child.stderr?.on("data", (chunk) => {
      const stderr = sanitizeDiagnosticText(chunk, 2000);
      this.logger.warn({ sessionId, stderr }, "session runtime worker stderr");
      recordDiagnostic({
        kind: "utility_error",
        severity: "WARN",
        detail: { failure: "worker_stderr", stderr },
      });
    });

    let runtime: UtilityProcessSessionRuntime;
    try {
      runtime = await UtilityProcessSessionRuntime.connect({
        sessionId,
        child,
        bridge,
        logger: this.logger,
        onDispose: () => {
          this.children.delete(sessionId);
        },
        recordDiagnostic,
      });
    } catch (error) {
      recordDiagnostic({
        kind: "utility_error",
        detail: {
          failure: "worker_connect_failed",
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
      child.kill();
      throw error;
    }
    this.children.set(sessionId, runtime);
    return runtime;
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(
      [...this.children.values()].map((runtime) => runtime.shutdown()),
    );
    this.children.clear();
  }
}
