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

  async initialize(
    initialStatus: Extract<SessionRuntimeStatus, "active" | "paused">,
  ): Promise<void> {
    await this.lifecycle.add(async () => {
      this.status = initialStatus === "active" ? "active" : "paused";
      // Trade monitor runs in BOTH active and paused modes — it watches open
      // positions for exits regardless of whether new intake is allowed.
      this.tradeMonitor.start();
      if (initialStatus === "paused") {
        await this.orchestrator.pause();
      } else {
        await this.orchestrator.start();
      }
    });
  }

  async pause(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "paused" || this.status === "stopping") return;
      this.status = "paused";
      // intake-paused: orchestrator stops opening new cycles, but the
      // trade monitor keeps watching open positions for stop/take-profit/exit.
      await this.orchestrator.pause();
    });
  }

  async resume(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "active" || this.status === "stopping") return;
      this.status = "active";
      // monitor may already be running from paused state; start() is idempotent in adapters
      this.tradeMonitor.start();
      await this.orchestrator.resume();
    });
  }

  async stop(): Promise<void> {
    await this.lifecycle.add(async () => {
      if (this.status === "stopping") return;
      this.status = "stopping";
      // Orchestrator first: stop opening new cycles and release inflight reservations.
      // Monitor stops AFTER orchestrator so any in-flight exit signals still fire.
      await this.orchestrator.stop();
      this.tradeMonitor.stop();
    });
  }
}
