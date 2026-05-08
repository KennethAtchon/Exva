import PQueue from "p-queue";
import type { SessionRuntimeStatus } from "@/lib/types";
import type { RuntimeTradeMonitor, SessionOrchestrator } from "./session-types";

export class SessionRuntime {
  readonly startedAt = new Date().toISOString();
  status: SessionRuntimeStatus = "starting";
  private readonly lifecycle = new PQueue({ concurrency: 1 });

  uptimeMin(): number {
    const startedAtMs = Date.parse(this.startedAt);
    if (Number.isNaN(startedAtMs)) return 0;
    return Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
  }

  constructor(
    readonly sessionId: string,
    readonly orchestrator: SessionOrchestrator,
    readonly tradeMonitor: RuntimeTradeMonitor,
  ) {}

  async initialize(initialStatus: Extract<SessionRuntimeStatus, "active" | "paused">): Promise<void> {
    await this.lifecycle.add(async () => {
      this.status = initialStatus === "active" ? "active" : "paused";
      if (initialStatus === "paused") {
        await this.orchestrator.pause();
        this.tradeMonitor.stop();
      } else {
        await this.orchestrator.start();
        this.tradeMonitor.start();
      }
    });
  }

  async pause(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "paused" || this.status === "stopping") return;
      this.status = "paused";
      await this.orchestrator.pause();
      this.tradeMonitor.stop();
    });
  }

  async resume(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "active" || this.status === "stopping") return;
      this.status = "active";
      await this.orchestrator.resume();
      this.tradeMonitor.start();
    });
  }

  async stop(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "stopping") return;
      this.status = "stopping";
      this.tradeMonitor.stop();
      await this.orchestrator.stop();
    });
  }
}
