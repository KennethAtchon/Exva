import { serializeError } from "@electron/shared/infra/errors";
import type { ExvaEventName } from "@electron/shared/ipc/channels";
import type { EventBus } from "../infra/event-bus";
import type { OrchestratorDeps } from "./session-types";
import type { RuntimeWorkerMessage } from "./runtime-worker-protocol";
import {
  currentTraceCarrier,
  runWithChildSpan,
  runWithRemoteContext,
  runWithRemoteParent,
} from "../infra/telemetry-context";

export async function invokeOrchestratorDep(
  deps: OrchestratorDeps,
  path: string,
  args: unknown[],
): Promise<unknown> {
  const [scope, method] = path.split(".");
  if (!scope || !method) {
    throw new Error(`Invalid orchestrator RPC path: ${path}`);
  }
  const target = deps[scope as keyof OrchestratorDeps] as unknown as
    | Record<string, (...params: unknown[]) => unknown>
    | undefined;
  const fn = target?.[method];
  if (typeof fn !== "function") {
    throw new Error(`Unknown orchestrator RPC path: ${path}`);
  }
  return await fn.apply(target, args);
}

export class MainRuntimeRpcBridge {
  constructor(
    private readonly sessionId: string,
    private readonly deps: OrchestratorDeps,
    private readonly eventBus: EventBus,
    private readonly post: (message: RuntimeWorkerMessage) => void,
  ) {}

  async handle(message: RuntimeWorkerMessage): Promise<void> {
    const run = <T>(mode: "parent" | "context", fn: () => T): T => {
      if (!message.context) return fn();
      return mode === "parent"
        ? runWithRemoteParent(message.context, fn)
        : runWithRemoteContext(message.context, fn);
    };
    switch (message.type) {
      case "rpc_request":
        await run("parent", () =>
          this.handleRpcRequest(message.id, message.path, message.args),
        );
        return;
      case "event":
        run("context", () =>
          this.eventBus.emit(message.name, message.payload as never),
        );
        return;
      case "runtime_status":
        run("context", () => {
          if (message.status === null) {
            this.eventBus.clearRuntimeStatus(message.sessionId);
          } else {
            this.eventBus.setRuntimeStatus(message.sessionId, message.status);
          }
        });
        return;
      case "log":
        run("context", () =>
          this.deps.logger[message.level](
            { sessionId: this.sessionId, ...(message.meta ?? {}) },
            message.message,
          ),
        );
        return;
      default:
        return;
    }
  }

  private async handleRpcRequest(
    id: number,
    path: string,
    args: unknown[],
  ): Promise<void> {
    try {
      const result = await invokeOrchestratorDep(this.deps, path, args);
      this.post({ type: "rpc_response", id, result });
    } catch (error) {
      this.post({ type: "rpc_response", id, error: serializeError(error) });
    }
  }
}

export class WorkerRuntimeRpcClient {
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private rpcId = 0;
  private disposed = false;

  constructor(
    private readonly post: (message: RuntimeWorkerMessage) => void,
    private readonly timeoutMs = 30_000,
  ) {}

  handle(message: RuntimeWorkerMessage): void {
    if (message.type !== "rpc_response") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  call(path: string, args: unknown[] = []): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error("Runtime RPC disposed"));
    const id = ++this.rpcId;
    const requestId = crypto.randomUUID();
    return runWithChildSpan({ utilityRequestId: requestId }, () => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Runtime RPC timed out: ${path}`));
        }, this.timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.post({
          type: "rpc_request",
          id,
          requestId,
          path,
          args,
          context: currentTraceCarrier(requestId) ?? undefined,
        });
      });
    });
  }

  dispose(reason = "Runtime RPC disposed"): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

export function createDepProxy<T extends object>(
  client: WorkerRuntimeRpcClient,
  namespace: string,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return (...args: unknown[]) =>
        client.call(`${namespace}.${property}`, args);
    },
  });
}

export class WorkerForwardingEventBus {
  private readonly listeners = new Map<
    ExvaEventName,
    Set<(payload: unknown) => void>
  >();
  private runtimeStatusValue: "active" | "paused" | "stopping" | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly post: (message: RuntimeWorkerMessage) => void,
  ) {}

  emit(name: ExvaEventName, payload: unknown): void {
    this.post({ type: "event", name, payload });
    const handlers = this.listeners.get(name);
    if (!handlers) return;
    for (const handler of handlers) handler(payload);
  }

  on(name: ExvaEventName, handler: (payload: unknown) => void): () => void {
    const handlers = this.listeners.get(name) ?? new Set();
    handlers.add(handler);
    this.listeners.set(name, handlers);
    return () => handlers.delete(handler);
  }

  runtimeStatus(): "active" | "paused" | "stopping" | null {
    return this.runtimeStatusValue;
  }

  setRuntimeStatus(
    sessionId: string,
    status: "active" | "paused" | "stopping",
  ): void {
    this.runtimeStatusValue = status;
    this.post({ type: "runtime_status", sessionId, status });
  }

  clearRuntimeStatus(sessionId: string): void {
    this.runtimeStatusValue = null;
    this.post({ type: "runtime_status", sessionId, status: null });
  }
}

export class WorkerLogger {
  constructor(
    private readonly sessionId: string,
    private readonly post: (message: RuntimeWorkerMessage) => void,
  ) {}

  debug(meta: Record<string, unknown>, message: string): void {
    this.post({
      type: "log",
      level: "debug",
      message,
      meta: { ...meta, sessionId: this.sessionId },
    });
  }

  info(meta: Record<string, unknown>, message: string): void {
    this.post({
      type: "log",
      level: "info",
      message,
      meta: { ...meta, sessionId: this.sessionId },
    });
  }

  warn(meta: Record<string, unknown>, message: string): void {
    this.post({
      type: "log",
      level: "warn",
      message,
      meta: { ...meta, sessionId: this.sessionId },
    });
  }

  error(meta: Record<string, unknown>, message: string): void {
    this.post({
      type: "log",
      level: "error",
      message,
      meta: { ...meta, sessionId: this.sessionId },
    });
  }
}
