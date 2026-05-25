import type {
  ManagedSessionRuntime,
  OrchestratorDeps,
  SessionRuntimeManagerDeps,
} from "./session-types";
import { buildInProcessSessionRuntime } from "./session-runtime-factory";

export interface SessionRuntimeHost {
  createRuntime(sessionId: string): Promise<ManagedSessionRuntime>;
  shutdownAll?(): Promise<void>;
}

export function createOrchestratorDeps(
  deps: SessionRuntimeManagerDeps,
): OrchestratorDeps {
  return deps;
}

export class InProcessSessionRuntimeHost implements SessionRuntimeHost {
  constructor(private readonly deps: SessionRuntimeManagerDeps) {}

  async createRuntime(sessionId: string): Promise<ManagedSessionRuntime> {
    return buildInProcessSessionRuntime(
      sessionId,
      createOrchestratorDeps(this.deps),
      this.deps.createOrchestrator,
      this.deps.createTradeMonitor,
    );
  }
}
