/**
 * In-memory worker-level progress for the active pipeline phase of a session.
 * Updated from EventBus; never sits in the trade execution path.
 */

import type { EventBus } from "../infra/event-bus";

export type PipelineWorkerStatus = "running" | "succeeded" | "failed";

export interface PipelineWorkerProgressEntry {
  workerId: string;
  status: PipelineWorkerStatus;
}

export interface PipelineWorkerProgressSnapshot {
  sessionId: string;
  cycleId: string;
  phase: string;
  stageId: string;
  frontier: number;
  tradeId: string | null;
  workers: PipelineWorkerProgressEntry[];
  updatedAt: string;
}

export class PipelineWorkerProgressTracker {
  private readonly bySession = new Map<string, PipelineWorkerProgressSnapshot>();
  private unsubs: Array<() => void> = [];

  constructor(private readonly bus: EventBus) {}

  start(): () => void {
    const clear = (sessionId: string): void => {
      this.bySession.delete(sessionId);
    };

    this.unsubs = [
      this.bus.on("pipeline_worker_progress", (payload) => {
        this.bySession.set(payload.sessionId, {
          ...payload,
          updatedAt: new Date().toISOString(),
        });
      }),
      this.bus.on("research_phase_complete", (payload) => {
        clear(payload.sessionId);
      }),
      this.bus.on("research_phase_failed", (payload) => {
        clear(payload.sessionId);
      }),
      this.bus.on("session_status_changed", (payload) => {
        if (payload.status !== "active") clear(payload.sessionId);
      }),
    ];
    return () => this.stop();
  }

  stop(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.bySession.clear();
  }

  get(sessionId: string): PipelineWorkerProgressSnapshot | null {
    return this.bySession.get(sessionId) ?? null;
  }
}
