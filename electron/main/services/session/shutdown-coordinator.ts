import type { SessionRuntimeManager } from "./session-runtime-manager";
import type { Logger } from "../infra/log";

export class ShutdownCoordinator {
  private shuttingDown = false;

  constructor(
    private readonly runtimeManager: SessionRuntimeManager,
    private readonly logger: Logger,
    private readonly closeDb: () => void,
  ) {}

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const activeRuntimes = this.runtimeManager.listActive();
    this.logger.info(
      { runtimeCount: activeRuntimes.length },
      "graceful shutdown: stopping session runtimes",
    );

    for (const runtime of activeRuntimes) {
      try {
        await this.runtimeManager.stopSession(runtime.sessionId);
      } catch (error) {
        this.logger.error(
          { sessionId: runtime.sessionId, err: error },
          "graceful shutdown: runtime stop failed",
        );
      }
    }

    this.closeDb();
    this.logger.info("graceful shutdown complete");
  }
}
